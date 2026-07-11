# Whisper Voice Control — Architecture Brief

**Project:** Jeeves homelab  
**Scope:** Offline voice dismiss + device control via Whisper STT + Piper TTS on Pi 5  
**Status:** Reviewed by Claude.ai — bugs fixed, ready for implementation

---

## Context

The Pi 5 (4GB, Cortex-A76 @ 2.4GHz) already runs three Docker containers: Home Assistant, Jeeves (Express), and ESPHome. The kitchen display is a Fire HD 8 (2GB) running **Fully Kiosk Browser** (an Android kiosk app — distinct from the Chromium kiosk mode on the Pi that was dropped) pointed at `http://192.168.0.189:3000`. The tablet has a built-in microphone and speaker. The Pi has no audio hardware. All inference runs on the Pi — the tablet is a pure UI surface.

**No LLM, no cloud AI.** Whisper is offline neural STT (audio → text string). Piper is offline neural TTS (text string → audio). Between them is plain regex matching. Nothing generative, nothing cloud.

Primary use case for v1: **voice dismiss** ("dismiss washer", "dryer done"). Secondary: natural-language device control routed through HA Assist.

---

## High-Level Architecture

```
Fire HD 8 (Fully Kiosk Browser)
  └─ MediaRecorder captures mic audio (push-to-talk)
  └─ POST /api/voice with raw audio blob (audio/webm)
       │
       ▼
Jeeves (Express, port 3000)
  └─ Forwards raw blob to voice service
  └─ Receives transcript
  └─ Dispatches command (local OR HA Assist)
  └─ Calls voice service for TTS
  └─ Returns base64 WAV to browser
       │
       ├─ Voice Service (Python, port 5100, internal only)
       │    ├─ POST /transcribe → faster-whisper → {text}
       │    └─ POST /speak     → piper (warm)   → WAV bytes
       │
       └─ Home Assistant (port 8123, HA Assist conversation API)
            └─ POST /api/conversation/process → {response text}
```

No audio hardware on the Pi. No external services. Fully offline after model download.

---

## Component Specifications

### Voice Service (new Docker container)

**Image:** `python:3.11-slim`  
**Internal port:** 5100 (not exposed externally — Jeeves proxies)  
**Framework:** FastAPI with `sync def` endpoints — handlers run in FastAPI's default threadpool, so CPU-bound inference doesn't block the event loop.

Endpoints:

```
POST /transcribe
  Body: raw audio/webm blob (no multipart)
  Response: { "text": "dismiss washer" }

POST /speak
  Body: application/json, { "text": "Washer dismissed." }
  Response: audio/wav (binary)
```

**STT:** `faster-whisper` library with `base.en` model

- `faster-whisper` uses CTranslate2 backend, ~3–5× faster than `openai-whisper` on CPU
- `base.en` (140MB): better accuracy than `tiny.en` for natural phrasing, fits in RAM budget
- Model loaded **once at startup** — warm for all subsequent requests
- Init params: `compute_type="int8"`, `cpu_threads=4`
- Transcribe params: `beam_size=1`, `vad_filter=True`, `initial_prompt="washer, dryer, dishwasher, dismiss"`
- `initial_prompt` biases the domain vocabulary, reduces WER for the target command set
- `vad_filter=True` prevents Whisper hallucinating "Thank you." on silent clips
- Gate on empty transcript or `no_speech_prob > 0.6` — return `{"text": ""}` to trigger the fallback path
- `base.en` on Pi 5 Cortex-A76: estimated 2–4s for a 3s audio clip; drop to `tiny.en` if latency is unacceptable in practice

**TTS:** `piper-tts` Python package, voice `en_US-lessac-medium` (~65MB)

- Load voice model **once at startup** via `PiperVoice.load()` — not as a cold subprocess per request
- Cold subprocess per request would reload the ONNX model each time, eating the entire TTS budget
- ~300–600ms for a 5-word response on Pi 5 when model is warm

**Audio input format:** Browser produces `audio/webm;codecs=opus` via MediaRecorder. `faster-whisper` decodes this via **PyAV**, which bundles FFmpeg libraries in the wheel — no system `ffmpeg` install needed. Keep the image slim; smoke-test one WebM clip in-container to confirm before deploying.

**Model volume:** Named Docker volume `voice_models` mounted at `/models`. First container start downloads models; subsequent starts use cache.

---

### Jeeves changes (server.js additions)

One new endpoint:

```
POST /api/voice
  Body: raw audio/webm blob
  Headers: Content-Type: audio/webm

  1. Forward raw body to voice service POST /transcribe
     (express.raw({type: 'audio/*', limit: '10mb'}) middleware)
  2. Receive { text }
  3. If text is empty → return { action: 'no_speech' }
  4. Run command dispatcher (see below)
  5. Build response text
  6. If night hours (22:00–06:00) → return { action, silent: true } (no TTS)
  7. POST response text to voice service /speak → get WAV bytes
  8. Return { action, audio: <base64 WAV> }
```

No `multer` dependency — `express.raw()` is built-in. Raw blob on both hops (browser→Jeeves, Jeeves→voice service) removes multipart parsing from the critical path.

Add a fetch timeout: `AbortController` with 15s on the `/api/voice` call so the browser state machine can't hang in "processing" if the voice service is slow or down.

---

### Command Dispatcher (in Jeeves)

**Tier 1: Local commands (Jeeves-internal, no HA round-trip)**

Matched with case-insensitive regex on transcript:

| Pattern | Action | Response text |
|---|---|---|
| `/(dismiss\|done).*(washer)/` | `POST /api/dismiss/washer` | "Washer dismissed." |
| `/(dismiss\|done).*(dryer)/` | `POST /api/dismiss/dryer` | "Dryer dismissed." |
| `/(dismiss\|done).*(dishwasher)/` | `POST /api/dismiss/dishwasher` | "Dishwasher dismissed." |
| `/(status\|how).*(washer\|dryer\|dishwasher)/` | read tile state | "Washer is running, done by 10:44." |
| `/what time/` | system clock | "It's 3:42 PM." |

**Tier 2: HA Assist (device control, everything else)**

If Tier 1 doesn't match:
- `POST http://host.docker.internal:8123/api/conversation/process`
  - Note: HA runs `network_mode: host` so it has no name on any Docker network. Must use `host.docker.internal` (the `extra_hosts` entry already in Jeeves service confirms this route works).
- Headers: `Authorization: Bearer ${process.env.HA_TOKEN}`, `Content-Type: application/json`
- Body: `{ "text": transcript, "language": "en" }`
- HA Assist prerequisite: entities must be **exposed to voice assistants** (Settings → Voice Assistants → Expose). Unexposed entities return no-match silently.
- Returns `response.speech.plain.speech` → feed to Piper

**Tier 3: Fallback**

If HA returns no match or errors: "I didn't catch that. Try again."

**Rationale for Tier 1 in Jeeves:** Dismiss commands are Jeeves-internal state — HA has no entity for "washer dismissed." Routing through HA Assist would require custom intents + a webhook back to Jeeves. Keeping Tier 1 local is simpler, faster, and correct separation of concerns.

---

### Dashboard changes (dashboard.html)

A single mic button added to the header. All state is local JS — no new server polling.

**State machine:**

```
idle → [tap] → listening (recording starts)
listening → [tap again] → processing (POST /api/voice, spinner)
listening → [10s timeout] → processing
processing → [response received] → playing (audio plays)
processing → [fetch error or timeout] → idle (show brief error state)
playing → [audio ends] → idle
```

2s silence auto-stop is cut from v1 — requires an AnalyserNode polling loop. Tap-to-stop + 10s cap is sufficient and simpler.

**Visual:**
- Mic icon in fixed corner (always visible, small)
- State color: idle=grey, listening=red pulse, processing=spinner, playing=green
- Night hours (22:00–06:00): mic dimmed; action still executes, no audio plays back

**Audio pipeline (browser side):**

```javascript
let micStream, recorder, chunks = [];
const AudioCtx = window.AudioContext || window.webkitAudioContext;

async function startListening() {
  // AudioContext must be created inside a user gesture (autoplay policy)
  if (!window._audioCtx) window._audioCtx = new AudioCtx();
  
  micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  recorder = new MediaRecorder(micStream, { mimeType: 'audio/webm;codecs=opus' });
  chunks = [];
  recorder.ondataavailable = e => chunks.push(e.data);
  recorder.onstop = sendAudio;
  recorder.start();
  setState('listening');
  
  // 10s hard cap
  setTimeout(() => { if (recorder.state === 'recording') recorder.stop(); }, 10000);
}

async function sendAudio() {
  setState('processing');
  micStream.getTracks().forEach(t => t.stop());
  
  const blob = new Blob(chunks, { type: 'audio/webm' });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  
  try {
    const res = await fetch('/api/voice', {
      method: 'POST',
      headers: { 'Content-Type': 'audio/webm' },
      body: blob,
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const { action, audio, silent } = await res.json();
    
    if (audio && !silent) {
      const wav = Uint8Array.from(atob(audio), c => c.charCodeAt(0));
      const buf = await window._audioCtx.decodeAudioData(wav.buffer);
      const src = window._audioCtx.createBufferSource();
      src.buffer = buf; src.connect(window._audioCtx.destination); src.start();
      src.onended = () => setState('idle');
    } else {
      setState('idle');
    }
  } catch {
    setState('idle'); // timeout or network error
  }
}
```

**Fully Kiosk mic access:** Requires enabling "Allow access to microphone" in Fully Kiosk Advanced Web Settings. Also requires the Fire OS app-level microphone permission granted to Fully Kiosk. Fully Kiosk bypasses the HTTPS requirement for `getUserMedia` — no TLS cert needed on Jeeves.

---

## Docker Compose Addition

```yaml
voice:
  container_name: jeeves-voice
  build: ./voice
  environment:
    - WHISPER_MODEL=base.en
    - PIPER_VOICE=en_US-lessac-medium
  volumes:
    - voice_models:/models
  restart: unless-stopped
  # No `network_mode` line — let Compose place both jeeves and voice on the
  # project default bridge network so container-name DNS resolves correctly.
  # (HA uses network_mode: host and is reached via host.docker.internal.)

volumes:
  voice_models:
```

**Network note:** Container-name DNS (`voice:5100`) only works if both containers are on the same Compose-managed network. Do not set `network_mode: bridge` explicitly on either jeeves or voice — that attaches them to Docker's global bridge where name resolution is disabled. Omitting `network_mode` puts them on the project default network automatically.

---

## RAM Budget

| Service | Estimated RSS |
|---|---|
| Home Assistant | 600–800MB |
| Jeeves (Node.js) | 80–150MB |
| ESPHome | 100–200MB |
| Voice service idle (models loaded) | 350–450MB |
| OS + kernel | 200–300MB |
| **Total** | ~1.4–1.9GB |

Pi 5 has 4GB. Headroom: ~2.1–2.6GB. Peak during Whisper inference: +100–200MB above idle. No memory pressure expected.

If latency is unacceptable empirically: switch `WHISPER_MODEL=tiny.en` (75MB, ~2–3× faster on CPU) — vocabulary is tiny enough that accuracy difference is minimal for home commands.

---

## Latency Budget (push-to-talk, typical 2–3s utterance)

| Step | Estimate |
|---|---|
| MediaRecorder stop → blob ready | ~50ms |
| Network to Pi (same LAN) | <5ms |
| FastAPI raw body parse + PyAV decode | ~50ms |
| faster-whisper base.en inference (3s audio) | 2,000–4,000ms |
| Command dispatch (Tier 1) | <5ms |
| Command dispatch (Tier 2, HA Assist) | 100–400ms |
| Piper TTS warm (5-word response) | 300–600ms |
| Audio decode + playback start (browser) | ~50ms |
| **Total: Tier 1** | ~2.5–4.5s |
| **Total: Tier 2** | ~3.0–5.5s |

Acceptable for home automation — not conversational-speed but appropriate for a dismiss command. Switch to `tiny.en` if Tier 1 feels slow in practice; accuracy is sufficient for the target vocabulary.

---

## Step 0 — De-risk mic capture before any service code

Fully Kiosk mic over HTTP is the single hard blocker. Before writing the voice service:

1. Add a throwaway test page at `/mic-test` in Jeeves: records 3s, plays back locally (no server round-trip)
2. On the Fire HD 8: verify Fully Kiosk "Enable Microphone Access" is on + Fire OS mic permission granted to Fully Kiosk
3. Verify `AudioContext` created inside a tap handler works (autoplay policy)
4. Once playback is confirmed working, remove the test page and proceed with the voice service

---

## Deployment Sequence

1. Step 0: mic test page, verify capture + playback on Fire HD 8
2. Create `voice/` directory: `Dockerfile`, `main.py`, `requirements.txt`
3. Add `voice` service + `voice_models` volume to `docker-compose.yml`
4. Add `/api/voice` endpoint to `server.js` (express.raw middleware, no multer)
5. Add mic button + state machine to `dashboard.html`
6. `git push` → `git pull` on Pi → `docker compose up -d --build voice jeeves`
7. First start: container downloads base.en (~140MB) + Piper voice (~65MB) into `voice_models` volume
8. Enable microphone access in Fully Kiosk Advanced Web Settings
9. Test: tap mic, say "dismiss washer", confirm tile clears and audio plays back

---

## Resolved Questions

1. **Wake word:** Push-to-talk for v1. Wake word (Porcupine JS on tablet) stays parked.
2. **Confidence gating:** No fake confidence field — use `vad_filter=True` + `no_speech_prob > 0.6` + empty transcript check. Tune empirically.
3. **HA Assist vs Tier 1:** Keep dismiss in Jeeves (Tier 1). HA Assist for device control (Tier 2).
4. **Piper voice:** `en_US-lessac-medium` — ship it, can swap later via env var.
5. **ffmpeg:** Not needed. `faster-whisper` uses PyAV (bundled FFmpeg libs). Confirm with one WebM test in-container.
6. **Multi-user:** Single user, requests queue, not a concern.
7. **Night mode:** Silent-execute (action runs, no TTS audio). Visual confirmation only.

---

## What This Does NOT Include (Parked)

- Wake word detection (Porcupine, openWakeWord)
- Streaming STT (word-by-word transcription)
- Ollama/LLM intent parsing
- Multi-turn conversation / context memory
- Remote voice control (Tailscale + mobile)
