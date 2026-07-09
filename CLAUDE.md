# CLAUDE.md — Jeeves Homelab

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is
Home automation monorepo: a custom kitchen dashboard ("Jeeves"), Home Assistant in Docker, laundry/chore/NFC automations, and pool monitoring. One Raspberry Pi 5 does everything: server + kitchen display.

## Hardware
- **Primary:** Raspberry Pi 5, 4GB (CanaKit — official 27W PSU, case, active cooling, SD card). Lives in the kitchen, drives the HDMI panel directly, runs the Chromium kiosk locally → `http://localhost:3000`.
- **Dev machine:** Mac mini (primary development environment).
- **Remote display testing:** Old MacBook — simulates a thin-client kiosk or tablet install pointed at `http://<pi5-ip>:3000`. Tests the same path the Zero W would use.
- **Optional experiment (not on critical path):** Pi Zero W Rev 1.1 as a thin-client kiosk — Chromium on 32-bit Raspberry Pi OS pointed at `http://<pi5-ip>:3000`. Hardware dead end for anything beyond kiosk display — never run Node/servers on the Zero W.

## Architecture
- Pi 5 OS: Raspberry Pi OS 64-bit desktop (kiosk runs locally)
- Docker Compose runs all services on the Pi 5; Home Assistant is a Container install (no add-on store — use HACS for custom integrations).
- NAS is a WD MyCloud EX2 Ultra (Marvell Armada 385, ARMv7 32-bit). Has Portainer/Docker running but cannot host current HA — HA dropped 32-bit ARM support in 2023. Not a viable HA host.
- Jeeves = lightweight Express server + static HTML/CSS dashboard; binds `0.0.0.0` (keeps thin-client option free), LAN-only, Tailscale for remote access — no port forwarding
- Dashboard page must stay light — heavy page permanently kills the Zero W kiosk option
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
  - Entity: `sensor.dryer_current_status` + `sensor.dryer_remaining_time`
  - LG end state is `power_off` (not `end`) — uses prev-state tracking like washer
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
- **Tuya** — 5 window shade controllers (cover entities, open/close/position), 1 pool sweep timer (switch), 2 OhmPlugs; all via Tuya cloud integration + Tuya IoT Platform developer account

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
- HA device pairing: thermostat + lock (native HomeKit → HA HomeKit Controller), smart plugs/lights/speakers (brands TBD)
- Chromium kiosk autostart on Pi desktop boot (low priority — open browser manually for now)
- Homebridge on NAS still running — decommission after HA device migration is confirmed

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

### Pool (see docs/Pool_automation_plan.md)
- ha-poolchem via HACS for water balance + dosing recommendations
- Probes supply pH/temp only; FC, TA, CH, CYA entered manually via input helpers
- Alerts: chemical drift, pump failure, low water level, freeze warning

## Deferred (committed, do later)
- ESPHome pool sensor build (ESP32 + pH/ORP/temp probes)
- Pump power monitoring + water level sensor hardware
- NVMe SSD for the Pi 5 (SD card fine to start; trim HA recorder retention to a few days)
- Freeze-warning automation (winter concern)
- Home Assistant entity data on the Jeeves dashboard
- Zero W thin-client kiosk experiment

## Parked — device/Homebridge migration
Homebridge running on NAS (WD MyCloud EX2 Ultra via Portainer). Plan is to shut it down and move everything to HA on Pi 5. Before doing that, audit what each device is and whether HA has a native integration:
- Thermostat + lock: native HomeKit — pair directly to HA via HomeKit Controller integration
- Smart plugs, lights, speakers: **brands TBD** — identify before migrating
- HA's HomeKit Bridge integration exposes everything back to Apple Home so Siri/automations keep working
- Shut down Homebridge container on NAS once migration is confirmed working

## Parked — decide later (do NOT build unless explicitly asked)
- Local voice control: HA Assist + Whisper (STT) + Piper (TTS). Requires a USB microphone (Pi 5 has no built-in mic; ~$10 USB mic works). 4GB is tight with Chromium running locally — use a small Whisper model, or revisit if Zero W experiment frees the Pi 5.
  - Voice dismiss for appliance tiles: "Jeeves, washer done" / "Jeeves, dryer done" → calls `POST /api/dismiss/washer` or `POST /api/dismiss/dryer`. Dashboard tap-to-dismiss is the current fallback.
- Library holds tile: BiblioCommons (local library system). Fetch holds/ready items on a schedule — likely via RSS feed or authenticated scrape. Credentials go in env vars, never committed. Research the specific library's BiblioCommons URL first.
- Zigbee USB dongle + cheap motion/door/temp sensors
- Energy monitoring via smart plugs (per-device power on the dashboard)
- AQI-triggered automation: PurpleAir threshold → air purifier smart plug + notification
- Weather automation: rain incoming + windows open → notification
- Frigate local camera AI (person/package detection; wants a Coral USB accelerator)
- Boss key: one keypress swaps kiosk to a fake spreadsheet
- **Data history + forecasting:** Time-series storage for door events, energy usage, laundry loads, pool chemistry. Design: SQLite in a Docker volume (not HA's recorder — that's for HA internals). Jeeves server writes and queries it. Pool chemistry history enables dosing trend forecasting. Architecture should be designed with this in mind from the start — status tiles feed history, history feeds forecasting tiles.
- **Tesla via Home Assistant:** HA has Tesla Fleet / Tessie integration. Target features: charging status tile + notifications (charge complete, low battery warning), voice command via HA Assist ("lock the car", "open the trunk"). Needs Tesla account credentials in `.env`, never committed.
- **Garage door automation:** Voice-controlled + automated garage doors via HA. Hardware options: myQ (Chamberlain/LiftMaster — cloud-dependent), ratgdo (local, open-source, replaces the wall panel), or generic reed sensor + relay via ESPHome. ratgdo is preferred (local-first). Integrates with HA for automations (e.g., "close at 10pm if open", "leaving home" scene).
- **OhmHour visibility + automations:** OhmConnect sends OhmHour events (demand-response windows, typically 1h). Dashboard tile showing active/upcoming OhmHour; HA automations to shed load automatically (turn off dryer, EV charging, etc.) when one starts; warnings on the dashboard before turning on high-draw appliances during an event. OhmConnect has a webhook or IFTTT trigger — needs research on best HA integration path.
- **Weekly email reports:** Scheduled summary email (Friday evening or Sunday) covering: appliance cycles run, energy used per device, comparison to prior weeks, pool chemistry trends. Generated by Jeeves server, sent via SMTP or a transactional email service (Resend/Mailgun — API key in `.env`). Requires data history (SQLite) to be in place first.
- **Hourly chimes + status readout:** Big Ben-style chime on the hour via the Pi's audio output, followed by a spoken or displayed status summary ("It's noon. Washer done by 12:34, dryer done by 12:44."). Audio: `aplay` or `mpg123` on the Pi. Text-to-speech: ties into Whisper/Piper voice stack, or a simple pre-recorded chime + dynamic TTS. Chime should respect night-dim hours (10pm–6am = silent).
- **Dishwasher reminder:** Smart plug on the dishwasher monitors power draw. HA automation: if 9:05pm and plug drawing <10W → send notification / dashboard alert ("Start the dishwasher!"). No history needed — purely a time + current-state check. Off-peak timing aligns with energy rate schedule (avoid peak 4–9pm). Smart plug brand TBD — needs energy monitoring capability.
- **Energy rate awareness (time-of-use):** Utility rates vary by season and time of day (summer peak 4–9pm). Jeeves should know the current rate tier and surface it on the dashboard. Use this to: warn before starting high-draw appliances during peak, suggest optimal run times, factor into weekly energy cost reports. Rate schedule hardcoded in config (changes ~2× per year) or fetched from utility API if available.
- **Solar panel monitoring:** Dashboard tile showing current solar production (W), daily yield (kWh), and grid import/export. Integration path TBD when ready to work on this.
- **Main pool pump monitoring + control:** Main circulation pump is separate from the pool sweep (240V Tuya outlet). Hardware path TBD — options: dedicated pool controller (Pentair/Hayward HA integrations), ESPHome CT clamp to detect if pump is drawing power, or a 240V-rated smart relay. Required for the AC pool-heating interlock automation. Research integration path when ready to tackle pool phase.
- **Pool pump / AC pool-heating interlock:** The home HVAC (Resideo T10 Pro) has a "pool heating mode" — a heat pump mode that rejects heat into the pool water instead of the outside air (HeatSource-type desuperheater). Pool pump MUST be running for this mode to be safe; running pool heating without water flow risks overheating the heat exchanger. Automation: if AC enters pool heating mode and pool pump is not running → start pump; if pump fails to start within N seconds → shut off pool heating mode regardless of thermostat setting. Dependencies: (1) Resideo cloud integration (not just HomeKit Controller — HomeKit does not expose pool heating mode as a readable state), (2) pool pump monitoring (power-monitoring smart plug or dedicated pool controller). Add a dashboard tile showing pool heating active + pump state together.

## Git
Remote: `https://github.com/matt-drazba/Jeeves.git`
Auth: HTTPS via osxkeychain — first push after a fresh session requires a manual `git push` in terminal (credentials cached after that).
