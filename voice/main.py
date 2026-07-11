import io
import os
import tempfile
import urllib.request
import wave

from fastapi import FastAPI, Request, Response

# ── Config ─────────────────────────────────────────────────────────────────────
MODELS_DIR    = "/models"
WHISPER_MODEL = os.getenv("WHISPER_MODEL", "base.en")
PIPER_VOICE   = os.getenv("PIPER_VOICE",   "en_US-lessac-medium")

PIPER_DIR  = os.path.join(MODELS_DIR, "piper")
PIPER_ONNX = os.path.join(PIPER_DIR, f"{PIPER_VOICE}.onnx")
PIPER_JSON = PIPER_ONNX + ".json"

PIPER_URLS = {
    "en_US-lessac-medium": (
        "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0"
        "/en/en_US/lessac/medium/en_US-lessac-medium.onnx"
    ),
}

# ── Redirect model caches into the Docker volume ───────────────────────────────
os.environ["HF_HOME"] = os.path.join(MODELS_DIR, "whisper")
os.makedirs(PIPER_DIR, exist_ok=True)

# ── Download Piper voice model on first start ──────────────────────────────────
if not os.path.exists(PIPER_ONNX):
    url = PIPER_URLS.get(PIPER_VOICE)
    if not url:
        raise RuntimeError(f"No download URL configured for Piper voice: {PIPER_VOICE}")
    print(f"Downloading Piper model: {PIPER_VOICE} (~65 MB) ...")
    urllib.request.urlretrieve(url, PIPER_ONNX)
    urllib.request.urlretrieve(url + ".json", PIPER_JSON)
    print("Piper model ready.")

# ── Load models once at startup (warm for every request) ──────────────────────
print(f"Loading Whisper {WHISPER_MODEL} ...")
from faster_whisper import WhisperModel
whisper = WhisperModel(WHISPER_MODEL, device="cpu", compute_type="int8", cpu_threads=4)
print("Whisper ready.")

print(f"Loading Piper {PIPER_VOICE} ...")
from piper import PiperVoice
piper_voice = PiperVoice.load(PIPER_ONNX, config_path=PIPER_JSON, use_cuda=False)
print("Piper ready.")

app = FastAPI()


def _transcribe(audio_bytes: bytes) -> str:
    with tempfile.NamedTemporaryFile(suffix=".webm") as f:
        f.write(audio_bytes)
        f.flush()
        segments, _ = whisper.transcribe(
            f.name,
            beam_size=1,
            vad_filter=True,
            initial_prompt="washer, dryer, dishwasher, dismiss",
        )
        # Filter out segments where Whisper is uncertain (hallucination guard)
        texts = [seg.text.strip() for seg in segments if seg.no_speech_prob < 0.6]
    return " ".join(texts).strip()


def _speak(text: str) -> bytes:
    raw_audio = b"".join(piper_voice.synthesize_stream_raw(text))
    sample_rate = piper_voice.config.sample_rate
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sample_rate)
        w.writeframes(raw_audio)
    return buf.getvalue()


@app.post("/transcribe")
async def transcribe(request: Request):
    body = await request.body()
    text = _transcribe(body)
    return {"text": text}


@app.post("/speak")
async def speak(request: Request):
    data = await request.json()
    wav = _speak(data.get("text", ""))
    return Response(content=wav, media_type="audio/wav")


@app.get("/health")
async def health():
    return {"ok": True}
