# CLAUDE.md — Jeeves Homelab

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is
Home automation monorepo: a custom kitchen dashboard ("Jeeves"), Home Assistant in Docker, laundry/chore/NFC automations, and pool monitoring. One Raspberry Pi 5 does everything: server + kitchen display.

## Hardware
- **Primary:** Raspberry Pi 5, 4GB (CanaKit — official 27W PSU, case, active cooling, SD card). Pure server — runs Docker, HA Container, and Jeeves. No longer driving a local display; Chromium kiosk on Pi 5 is dropped.
- **Kitchen display:** Amazon Fire HD 8 (2020 10th gen or newer, standard 2GB RAM) running **Fully Kiosk Browser** pointed at `http://192.168.0.189:3000`. Wall-mount case with power passthrough. Has built-in mic + speaker — sufficient for future voice control (STT/TTS). No Pi needed for the display.
- **Dev machine:** Mac mini (primary development environment).
- **Remote display testing:** Old MacBook — browser pointed at `http://<pi5-ip>:3000`.
- **Pi Zero W Rev 1.1:** Dropped — 32-bit, too slow for Chromium, dead end. Fire HD 8 replaced this experiment.

## Architecture
- Pi 5 OS: Raspberry Pi OS 64-bit (headless server — no Chromium kiosk)
- Docker Compose runs all services on the Pi 5; Home Assistant is a Container install (no add-on store — use HACS for custom integrations).
- NAS is a WD MyCloud EX2 Ultra (Marvell Armada 385, ARMv7 32-bit). Has Portainer/Docker running but cannot host current HA — HA dropped 32-bit ARM support in 2023. Not a viable HA host.
- Jeeves = lightweight Express server + static HTML/CSS dashboard; binds `0.0.0.0`, LAN-only, Tailscale for remote access — no port forwarding
- Dashboard page must stay light — Fire HD 8 is capable but no reason to bloat it
- ESPHome devices (future) connect via HA's native API — no MQTT broker unless a specific device requires it

### Data flow
```
Chromium kiosk (localhost:3000) → Express /api/status → dashboard renders
```

`fetchData()` in the dashboard is the only integration point. It currently returns hardcoded `TEST_DATA`. To go live, replace its body with `fetch('/api/status')`.

### Expected `/api/status` shape
```json
{
  "weather": {
    "location": "string", "temp": 68, "condition": "Sunny",
    "high": 72, "low": 54,
    "forecast": [{ "day": "Tue", "high": 74, "low": 55, "condition": "Sunny" }]
  },
  "status": {
    "laundry": { "label": "Laundry", "icon": "🫧", "value": "Done", "alert": true, "degraded": false }
  },
  "alerts": ["Laundry is done!"]
}
```

### Tile rendering — diff, not replace
`renderStatus()` builds tile DOM once, then on subsequent calls only patches `.tile-value` text and class names. **Never reset `innerHTML` on `#status-panel` during updates** — it restarts CSS pulse animations. A full rebuild is forced every `FULL_REBUILD_EVERY = 30` poll cycles (~30 min).

### Tile states
| State | Color | Trigger |
|-------|-------|---------|
| Normal | White | Default |
| Alert | Red pulse | `alert: true` on tile |
| Degraded | Yellow pulse | `degraded: true` on tile |
| Stale | Yellow strip | No refresh in >2× `REFRESH_INTERVAL_MS` |
| Error | Red strip | `fetchData()` threw |

### Timers (coarse by design)
| Timer | Interval |
|-------|----------|
| Clock + night-dim | 15s |
| Data refresh (`REFRESH_INTERVAL_MS`) | 60s |
| Staleness check | 30s |
| Alert ticker | 5s |

Night dimming (opacity 0.45) activates 10 PM–6 AM in JS, not via a server flag.

### Adding tiles
Add a new key to the `status` object in the API response. The grid uses CSS `auto-fill minmax(140px, 1fr)` and reflows automatically — no CSS changes needed.

## Repo layout
```
homelab/
├── docker-compose.yml
├── homeassistant/      # HA config; secrets.yaml + database gitignored
├── jeeves/             # Express server + dashboard
└── docs/               # planning .md files (including superseded drafts, kept for history)
```

### Jeeves canonical files
| File | Purpose |
|------|---------|
| `jeeves/public/dashboard.html` | **The dashboard — edit this one only** |
| `jeeves/server.js` | Express server — weather fetch, calendar fetch, `/api/status` |
| `jeeves/package.json` | Dependencies: express, node-ical |
| `jeeves/Dockerfile` | node:22-alpine, no build step |
| `docker-compose.yml` | Orchestrates HA + Jeeves (repo root) |

## Current state (as of 2026-07-09)

### Working
- Pi 5 running Docker; HA Container + Jeeves both up via `docker compose`
- Jeeves dashboard live at `http://192.168.0.189:3000` — accessible from Pi, MacBook, iPad
- Tailscale installed on Pi — IP `100.99.104.79`, accessible from anywhere on Tailscale network
- Live weather from Open-Meteo (no API key), refreshes every 10 min
- Google Calendar weekly view (Sun-Sat grid), fetched from ICS URL every 5 min; timezone-correct for both standard and recurring events (rrule fix in place)
- Dashboard cycles dashboard ↔ calendar every 15s
- Repo cloned at `~/homelab` on Pi; `.env` at `~/homelab/.env` holds secrets (never committed)
- **Washer tile live** — Samsung SmartThings via HA REST API, polls every 30s
  - States: "Done by 10:44 PM" (running), "Paused", "Idle", "Done!" (green, persists until next cycle or dismiss)
  - Entity: `sensor.laundry_room_washer_machine_state` + `sensor.laundry_room_washer_completion_time`
  - "Done!" uses `done: true` flag → `.tile.done` CSS class (solid green); tap tile to dismiss → `POST /api/dismiss/washer`
  - Limitation: loses "Done!" state if Jeeves restarts mid-cycle (prev-state tracking is in-memory)
- **Dryer tile live** — LG ThinQ via native HA LG integration, polls every 30s
  - States: "Done by 12:26 AM" (running), "Paused", "Idle", "Done!" (green)
  - Entity: `sensor.dryer_current_status` + `sensor.dryer_remaining_time` + `event.dryer_notification`
  - "Done!" triggered by `event.dryer_notification` event_type `drying_is_complete` (prev-state tracking on power_off was unreliable due to intermediate states)
  - Tap tile to dismiss → `POST /api/dismiss/dryer`
  - LG account auth: sign-in-with-Apple relay email + reset password to get email/password for HA
- **AQI tiles live** — PurpleAir API, refreshes every 10 min
  - `aqiOut`: average of 3 nearby outdoor sensors (113020, 81199, 284212) — wildfire early warning
  - `aqiIn`: indoor sensor (126601) — kitchen smoke / air purifier trigger
  - Color-coded per PurpleAir scale: green / yellow / orange / red / purple / maroon
  - API key in `.env` as `PURPLEAIR_API_KEY`; sensor IDs hardcoded in server.js
  - No door sensor available from SmartThings or LG HA integrations (known upstream limitation)
- **Tap-to-dismiss** on done tiles — tapping a green tile calls `POST /api/dismiss/:appliance`, resets to Idle
  - Prevents false "Done!" indicator after laundry has been unloaded
  - Voice dismiss planned when Whisper/mic hardware is added
- **TP-Link Kasa** — 3 smart outlets + 1 smart switch (front driveway lights); local integration, auto-discovered
- **Resideo T10 Pro thermostat** — paired via HomeKit Controller; room sensors in separate rooms all showing; Siri control working via HomeKit Bridge
- **August Smart Lock (Front Door)** — paired via native August integration; door sensor, battery %, operator entity; Siri control working via HomeKit Bridge
- **HomeKit Bridge** — HA re-exposed to Apple Home; thermostat + lock accessible via Siri
- **Tuya** — 5 window shade controllers (cover entities, open/close/position), 1 pool sweep timer (switch, 240V), 2 OhmPlugs (energy monitoring); all via Tuya cloud integration + Tuya IoT Platform developer account
- **Wemo WSP080** — provisioned via pywemo (Belkin cloud dead; WPS failed; pywemo connected to device AP and pushed Wi-Fi creds); paired to HA via HomeKit Controller using code on plug
- **Dishwasher tile live** — TP-Link HS110 ("Weaf", formerly on Nissan Leaf charger) on dishwasher outlet; polls `sensor.weaf_current_consumption` every 30s; threshold 4W; "Done!" when power drops after running; tap to dismiss → `POST /api/dismiss/dishwasher`
- **Dishwasher reminder automation** — HA automation: 9:15pm, if `sensor.weaf_current_consumption` < 4W → push notification to Matt's iPhone via HA Companion app ("Start the dishwasher!")
- **Homebridge decommissioned** — all devices migrated to HA; Homebridge container stopped and removed from NAS Portainer
- **HACS installed** on HA Container (install script run from `~/homelab/homeassistant/`, custom_components at `~/homelab/homeassistant/custom_components/`)
- **Apple Music tile live** — Now Playing tile on dashboard showing current track + artist + active AirPlay speakers
  - HACS integration: `apple_music` (domain), from `leguernadrian-boop/apple-music-mac-ha`
  - Companion server: `~/apple-music-bridge/server.js` on Mac mini — Node.js/Express, AppleScript bridge to Music.app, port 8181
  - Companion kept alive via launchd: `~/Library/LaunchAgents/com.jeeves.apple-music-bridge.plist`
  - Jeeves polls `http://192.168.0.204:8181/now_playing` every 15s → `nowPlaying` tile
  - Tile shows: track name (value), "Artist · Speaker1, Speaker2" (sub line); ⏸ icon + degraded state when paused
  - AirPlay speaker detection via AppleScript `AirPlay devices whose current is true`
  - Note: original repo's README server.js was broken (corrupted code, missing `/_ping` endpoint). We wrote a clean replacement. Consider contributing back via PR.
  - macOS permission required: System Settings → Privacy & Security → Automation → enable Music under Terminal
- **Tile sub-line** — dashboard tiles now support an optional `sub` field (small muted text below the value); useful for secondary context like artist name or speaker list
- **Tesla Fleet API** — two vehicles paired in HA via `tesla_fleet` integration (built-in, no HACS)
  - Auth: Tesla developer account, OAuth app, public key hosted at `sq9si.fleetkey.net` via fleetkey.cc
  - Scopes: vehicle info, location, commands, charging (no energy products, no profile)
  - Dusty (white), Snorlax (blue)
  - Dashboard tiles live: battery % + charging status sub-line, polls every 5 min
  - **Lock/unlock**: via HomeKit Bridge accessory entries (`lock.dusty_lock`, `lock.snorlax_lock`); renamed in Apple Home to "Dusty Doors" / "Snorlax Doors"; Siri: "unlock Dusty Doors"
  - **Siri commands (frunk, trunk, windows, honk, fart)**: implemented as HA Scripts → iOS Shortcuts
    - HA Scripts in Settings → Automations & Scenes → Scripts; each script calls one cover/button service
    - iOS Shortcuts use Home Assistant → **Run Script** action
    - If "Run Script" shows "no options available", quit and relaunch the HA Companion app — fixes the sync issue
    - **Naming convention**: avoid car names (Siri routes to Tesla app) and avoid "open"/"trunk" together (triggers media). Use color + action + thing: "open white car trunk", "fart blue car", "honk white car", etc.

### Tile states
| State | CSS class | Trigger |
|-------|-----------|---------|
| Normal | (none) | Default |
| Done | `.done` | `done: true` — solid green, tappable to dismiss |
| Alert | `.alert` | `alert: true` — red pulse, reserved for urgent/error alerts |
| Degraded | `.degraded` | `degraded: true` — yellow pulse |
| AQI color | inline style | `color`/`bg` fields on tile — PurpleAir scale, bypasses class system |

### Secrets in `~/homelab/.env`
```
CALENDAR_ICS_URL=...      # Google Calendar private ICS URL
HA_TOKEN=...              # HA long-lived token (Profile → Security → Long-lived access tokens, "Jeeves")
PURPLEAIR_API_KEY=...     # PurpleAir read API key
```

### Deployment workflow (Pi)
```bash
cd ~/homelab && git pull && docker compose up -d --build jeeves
# Add --build homeassistant only if docker-compose.yml changed for HA
```

### Deferred polish
- Weather panel has empty grey space below forecast — needs layout fix (low priority)
- **Dryer "Done!" not firing on cycle end** — FIXED: switched from prev-state tracking on `sensor.dryer_current_status` to polling `event.dryer_notification` (event_type: `drying_is_complete`). Needs verification on next real cycle.

### Not yet wired up
- ~~Chromium kiosk autostart~~ — dropped; Fire HD 8 + Fully Kiosk Browser is the display path
- Apple TV 4K (Family Room) — discovered in HA but not yet paired; PIN appears on TV screen during setup
- AirPort Express units (NuTone, Clips, Block Party) — AirPlay pairing blocked by device restriction; fix is to enable IPv6 on router (Marshall paired successfully, others pending IPv6 fix); controlled indirectly via Mac mini Music bridge in the meantime
- Resideo cloud integration (developer.resideo.com OAuth) — demoted to optional; pool heating mode is sensed locally via the FPH trio 24VAC circuit, not from the thermostat. T10 stays on HomeKit only.

## Hard rules
- Never commit secrets: API keys, HA long-lived tokens, secrets.yaml
- **Single file** — all dashboard HTML, CSS, JS lives in `jeeves/public/dashboard.html`. No bundler, no splits.
- **Vanilla only** — no frameworks, no CDN links, no external resources in the dashboard.
- Keep the stack minimal — no Node-RED, InfluxDB, Grafana, or MQTT unless explicitly decided
- Prefer known-working custom Jeeves code over adopting frameworks (MagicMirror was tried and dropped)
- Alerts and notifications are plain and direct — no "Jeeves voice"/personality

## Features — full scope

### Dashboard v1 (public APIs, no HA required)
- Clock / date
- Weather: current + forecast — Open-Meteo (free, no API key); fetch server-side, cache ~10 min
- Air quality: PurpleAir API — `X-API-Key` header, `/v1/sensors/<sensor_index>`
- Calendar agenda view — **source TBD**: iCloud via CalDAV (through HA) or a shared .ics URL fetched by Jeeves directly

### Home Assistant phase
- Washer + dryer: power-monitoring smart plugs → cycle-done detection, phone notifications, dashboard tiles
- Additional entity tiles: thermostat, presence, door/garage
- NFC tags via HA companion app: front door = "leaving" scene; bedside = "goodnight" scene; poolside = log manual water test / "swim time" scene
- Chores leaderboard: household tasks logged via NFC taps or buttons → running scoreboard on the Jeeves dashboard

### Pool (see docs/pool_heat_recovery.md)
- Heat recovery interlock: HotSpot FPH5 + Pentair IntelliFlo2 VST + IntelliComm II + Tecmark flow switch. Hardware-first safety; HA monitors only. Full spec in docs.
- ha-poolchem via HACS for water balance + dosing recommendations (future)
- Probes supply pH/temp only; FC, TA, CH, CYA entered manually via input helpers
- Alerts: chemical drift, pump failure, low water level, freeze warning

## Deferred (committed, do later)
- ESPHome pool sensor build (ESP32 + pH/ORP/temp probes)
- Pump power monitoring + water level sensor hardware
- NVMe SSD for the Pi 5 (SD card fine to start; trim HA recorder retention to a few days)
- Freeze-warning automation (winter concern)
- Home Assistant entity data on the Jeeves dashboard
- Zero W thin-client kiosk experiment

## Parked — decide later (do NOT build unless explicitly asked)
- **Local voice control:** HA Assist + Whisper (STT) + Piper (TTS). Fire HD 8 has built-in mic + speaker — no external hardware needed. Whisper inference runs on Pi 5; dropping Chromium kiosk freed meaningful RAM. Use small Whisper model (tiny or base). Fully Kiosk supports mic access + audio playback. Voice dismiss for appliance tiles: "Jeeves, washer done" → `POST /api/dismiss/washer`. Tap-to-dismiss is the current fallback.
- Library holds tile: BiblioCommons (local library system). Fetch holds/ready items on a schedule — likely via RSS feed or authenticated scrape. Credentials go in env vars, never committed. Research the specific library's BiblioCommons URL first.
- Zigbee USB dongle + cheap motion/door/temp sensors
- Energy monitoring via smart plugs (per-device power on the dashboard)
- AQI-triggered automation: PurpleAir threshold → air purifier smart plug + notification
- **Rain + windows automation:** If rain is forecast or active and window shades are open → push notification to warn. Two triggers: (1) imminent rain (HA weather entity `forecast` condition changes to rain/storm), (2) bonus: 9pm and overnight rain forecast + windows still open → "Close your windows, rain tonight." Shade state from Tuya cover entities (need to verify they report current position reliably). Rain source: HA weather integration or Open-Meteo via template sensor. Both triggers = HA automations with template conditions. No new hardware needed.
- **Rheem water heater:** "Smart" Rheem water heater — add to HA via EcoNet integration (HACS: `RhymeWithCream/ha-rheem-econet` or similar). Goals: mode control (heat pump / electric / vacation), temperature setpoint, energy monitoring tile. Research integration before starting — EcoNet cloud auth may require account credentials in `.env`.
- **Picture frame automation:** Dumb frame on Wemo WSP080. Schedule: on in morning (e.g., 7am–10am) and evening (6pm–10pm), off during the day. Presence condition: also on whenever someone is home (via `person` entity or device tracker). Pure HA automation — no new hardware. Wemo is already in HA via HomeKit Controller.
- **Migrate automations from native apps to HA:** TP-Link Kasa (driveway lights schedules, any outlet automations), Tuya (shade schedules, pool sweep timer), and any others currently managed in vendor apps. Centralizes all automations in HA; vendor apps become passthrough only. Inventory existing vendor-app automations before migrating.
- **Bhyve sprinkler automation:** Orbit Bhyve smart sprinkler controller — add to HA via Bhyve integration (HACS: `sebr/hass-bhyve-mqtt` or check HA community for current best option; uses MQTT or cloud API depending on integration). Goals: schedule control from HA, rain-skip automation (skip watering if rain forecast — pairs naturally with rain+windows automation), dashboard tile showing zone status. Research integration before starting.
- Frigate local camera AI (person/package detection; wants a Coral USB accelerator)
- Boss key: one keypress swaps kiosk to a fake spreadsheet
- **Data history + forecasting:** Time-series storage for door events, energy usage, laundry loads, pool chemistry. Design: SQLite in a Docker volume (not HA's recorder — that's for HA internals). Jeeves server writes and queries it. Pool chemistry history enables dosing trend forecasting. Architecture should be designed with this in mind from the start — status tiles feed history, history feeds forecasting tiles.
- **Tesla via Home Assistant:** Integration live (see Working section). Remaining: dashboard tiles (charge %, range, charging state), notifications (charge complete, low battery), voice commands via HA Assist.
- **Garage door automation:** Voice-controlled + automated garage doors via HA. Hardware options: myQ (Chamberlain/LiftMaster — cloud-dependent), ratgdo (local, open-source, replaces the wall panel), or generic reed sensor + relay via ESPHome. ratgdo is preferred (local-first). Integrates with HA for automations (e.g., "close at 10pm if open", "leaving home" scene).
- **OhmHour visibility + automations:** OhmConnect sends OhmHour events (demand-response windows, typically 1h). Dashboard tile showing active/upcoming OhmHour; HA automations to shed load automatically (turn off dryer, EV charging, etc.) when one starts; warnings on the dashboard before turning on high-draw appliances during an event. OhmConnect has a webhook or IFTTT trigger — needs research on best HA integration path.
- **Weekly email reports:** Scheduled summary email (Friday evening or Sunday) covering: appliance cycles run, energy used per device, comparison to prior weeks, pool chemistry trends. Generated by Jeeves server, sent via SMTP or a transactional email service (Resend/Mailgun — API key in `.env`). Requires data history (SQLite) to be in place first.
- **Hourly chimes + status readout:** Big Ben-style chime on the hour via the Pi's audio output, followed by a spoken or displayed status summary ("It's noon. Washer done by 12:34, dryer done by 12:44."). Audio: `aplay` or `mpg123` on the Pi. Text-to-speech: ties into Whisper/Piper voice stack, or a simple pre-recorded chime + dynamic TTS. Chime should respect night-dim hours (10pm–6am = silent).
- **Dishwasher reminder:** DONE — HA automation at 9:15pm + Jeeves tile via Weaf HS110. See Working section.
- **Energy rate awareness (time-of-use):** Utility rates vary by season and time of day (summer peak 4–9pm). Jeeves should know the current rate tier and surface it on the dashboard. Use this to: warn before starting high-draw appliances during peak, suggest optimal run times, factor into weekly energy cost reports. Rate schedule hardcoded in config (changes ~2× per year) or fetched from utility API if available.
- **Solar panel monitoring:** Dashboard tile showing current solar production (W), daily yield (kWh), and grid import/export. Integration path TBD when ready to work on this.
- **Pool heat recovery + pump interlock:** Design settled 2026-07-10. See `docs/pool_heat_recovery.md` for full spec. Summary:
  - **Pump:** Pentair IntelliFlo2 VST 3.0 HP, firmware 1.23-VS, classic RS-485 protocol. Comm terminals unused — IntelliComm II goes here.
  - **FPH:** HotSpot FPH5 (4-ton), min 45 GPM. "Pool heat mode" = 24VAC trio (valve + fan relay + solenoid) on one pair — sensed locally, no Resideo cloud needed.
  - **L1 (hardware safety):** Tecmark 3010P flow switch in series with trio 24VAC — physically blocks diversion if pump isn't flowing. **Not yet installed — priority 1.**
  - **L2 (hardware pump start):** FPH pump-call 24VAC → IntelliComm II GPM/RPM input 4 → RS-485 → pump runs Ext. Program 4 at ≥45 GPM. No Pi/HA in the loop.
  - **L3 (HA monitoring):** ESP32 at pad with opto-isolated AC sense inputs + CT clamp → `binary_sensor.pool_heat_active`, `binary_sensor.fph_pump_call`, `binary_sensor.pool_pump_running`, `sensor.pool_pump_watts`. Alert if L1/L2 fail. HA controls nothing safety-critical.
  - Shopping list: Tecmark 3010P, 25165BM cover, 12VDC adapter, ESP32, AC opto module, CT clamp (SCT-013) or Shelly EM.
- **Maintenance tickler / home log:** Track recurring maintenance tasks with due dates — e.g., dishwasher deep clean every 2 months, HVAC filter every quarter, etc. Dashboard tile shows overdue/upcoming items. Backend: SQLite (same store as data history) with task definitions (name, interval, last-done date) and a simple `POST /api/maintenance/done/:task` endpoint to log completion. Smart scheduling: if the dishwasher ran N cycles since last clean, bump the due date forward instead of using calendar time alone. Depends on data history (SQLite) being in place.
- **Home manual chatbot:** Local Q&A over appliance manuals and home-specific knowledge — "what's the best cycle for delicates on the LG?", "how do I calibrate the T10 pool heating mode?". Source material: PDFs of appliance manuals + custom notes stored in `docs/manuals/` (gitignored if large). Approach: run a local LLM via **Ollama** on the Pi 5 (or Mac mini if Pi 5 RAM is tight with Chromium running); small models like Llama 3.2 3B or Phi-3 Mini fit in 4GB with quantization. Jeeves server exposes a `/chat` endpoint that stuffs the relevant manual text into the prompt context (simple RAG — no vector DB needed at this scale) and calls the Ollama API locally. No cloud, no API key, no data leaves the house. Ties into maintenance tickler — chatbot can surface "you're due for a dishwasher clean" alongside cycle advice. Pi 5 RAM is the main constraint — benchmark Ollama alongside Chromium before committing to on-Pi inference.
- **Zero-AI grocery shopping assistant:** Given a shopping list, compare prices across Safeway, Whole Foods, Amazon Fresh, and Costco to find the best deal for pickup or delivery. Credentials per store stored in `.env` (never committed). Approach: Jeeves server or a standalone script calls store APIs or scrapes store websites; returns ranked options per item or per cart total. "Zero-AI" framing = deterministic price comparison, not LLM-driven; LLM optionally used only to parse natural-language list input. Scope: Mac/CLI tool first, Jeeves dashboard integration later if useful.
- **Home recipe repository + ingredient-aware ordering:** Store household recipes (Markdown or JSON in repo, gitignored if containing personal info). For a given recipe, diff against a known pantry state to produce a shopping list, then hand off to the grocery assistant above. Pantry tracking (what's currently stocked) is the hard part — options: manual entry via a simple UI, NFC tap on pantry shelf, or barcode scan via phone. Start with recipe storage + manual shopping list generation; add pantry tracking only if the manual approach proves sustainable.

## Git
Remote: `https://github.com/matt-drazba/Jeeves.git`
Auth: HTTPS via osxkeychain — first push after a fresh session requires a manual `git push` in terminal (credentials cached after that).
