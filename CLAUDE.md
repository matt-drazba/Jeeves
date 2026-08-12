# CLAUDE.md — Jeeves Homelab

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is
Home automation monorepo: a custom kitchen dashboard ("Jeeves"), Home Assistant in Docker, laundry/chore/NFC automations, and pool monitoring. Pi 5 is the server; a Fire HD 8 tablet is the kitchen display.

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
Fire HD 8 / Fully Kiosk Browser (192.168.0.189:3000) → Express /api/status → dashboard renders
```

`fetchData()` in the dashboard calls `fetch('/api/status')`. The dashboard is live — `TEST_DATA` fallback is only used if the fetch fails.

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
├── esphome/            # ESPHome device configs; secrets.yaml gitignored
└── docs/               # hardware specs and planning docs
```

### Jeeves canonical files
| File | Purpose |
|------|---------|
| `jeeves/public/dashboard.html` | **The dashboard — edit this one only** |
| `jeeves/server.js` | Express server — weather fetch, calendar fetch, `/api/status` |
| `jeeves/package.json` | Dependencies: express, node-ical |
| `jeeves/Dockerfile` | node:22-alpine, no build step |
| `docker-compose.yml` | Orchestrates HA + Jeeves + ESPHome (repo root) |
| `esphome/pool-pad.yaml` | ESP8266 pool pad node — relay sensing, DS18B20, flow, BTU/hr |

## Current state (as of 2026-07-10)

### Working
- Pi 5 running Docker; HA Container + Jeeves both up via `docker compose`
- Jeeves dashboard live at `http://192.168.0.189:3000` — accessible from Pi, MacBook, iPad
- Tailscale installed on Pi — IP `100.99.104.79`, accessible from anywhere on Tailscale network
- Live weather from Open-Meteo (no API key), refreshes every 10 min
- Google Calendar weekly view (Sun-Sat grid), fetched every 5 min from **HA's calendar API** (`/api/calendars/calendar.matthew_drazba`), not from an ICS URL — the ICS path was replaced in commit `66536da` and `node-ical` is now a dead dependency in `jeeves/package.json`
  - HA exposes **one entity per Google calendar** — `matthew_drazba`, `family`, `jessica`, `birthdays`, `reserves`, `holidays_in_united_states`, `roy_cloud_community_calendar`. Jeeves reads **only `calendar.matthew_drazba`**, by decision 2026-08-08. Accepted invites copy onto the primary calendar, so they arrive there; events created *on* Family or Jessica's calendar are invisible to Jeeves on purpose
  - **A failed calendar fetch is silent and leaves a stale week on the tablet.** `fetchCalendar()` assigns `cachedStatus.calendar` only on full success, so one throw wipes all seven days to `days: []`; `renderCalendar()` then early-returns on empty data and leaves the previously drawn grid up with no staleness indicator. This masked a multi-day outage as "the calendar is missing some events." Not fixed — the fix is per-calendar isolation plus a stale marker
  - **Diagnosing "missing events" — check auth before touching Jeeves code.** All entities `unavailable` + `/api/calendars/<entity>` returning **404** means the config entry failed setup, not that the entity id is wrong (an unavailable calendar entity is absent from the calendar component entirely). See the Google OAuth note below
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
  - ⚠️ The pool sweep timer controls the **Polaris PB4-60 booster pump**, which has no dry-run protection and destroys its seal in minutes if run without the main pump supplying water. A cloud-scheduled switch is the only thing guarding that today. See `docs/pool_booster_interlock.md` — this device needs to move off Tuya for safety reasons, unlike the shades.
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
- **Rheem water heater (EcoNet)** — integrated in HA; entities/dashboard tile not yet built
- **Bhyve sprinkler controller** — integrated in HA (HACS `sebr/bhyve-home-assistant` 4.1.2); `sprinklers` tile live on the dashboard showing next watering (`server.js:468`). Weather-aware watering is designed but **not built** — full brief in `docs/sprinklers.md`
  - **There is no local control path. Cloud-only, no LocalTuya equivalent exists — do not go looking for one again.** The integration is a websocket to Orbit's cloud
  - **The reasoning from the Tuya pool sweep does not transfer, it inverts.** The B-hyve controller stores its program on the box and runs it on its own clock through any outage; HA can only reach it via Orbit's cloud. So the schedule-on-the-box *is* the local operation. Decided 2026-08-12: **the program stays on the controller and HA modulates it** via `bhyve.update_program(budget:%)` and the self-expiring `bhyve.enable_rain_delay(hours)`. Moving the schedule into YAML was rejected — it would make every run depend on Pi + internet + Orbit cloud and fail silently
  - `budget` is a straight percentage multiplier on run times — **proven, not assumed**: base 2/2/5/5 min at `budget: 110` recorded actual runs of 2.2/2.2/5.5/5.5. It is **per-program, not per-zone**; per-zone bias needs the zones split across Program A and B in the app
  - **`switch.sprinklers_*_smart_watering` reads `on` for every zone and this is a trap** — Orbit's own Smart Watering is *not* running. Program A is `is_smart_program: false` and every zone reports `smart_watering_enabled: false`. Today the system is a fixed even-day 06:00 schedule
  - **The baseline may be wrong, which outranks the automation:** all zones are typed `drip` but run 2–5 minutes, where emitters deliver ~0.5–2 gal/*hour*. Smart scaling of a wrong baseline just makes a wrong number wiggle intelligently. Unresolved 2026-08-12
  - Entities moved to the **`valve.` domain** in 4.1.2, not `switch.`. No flow data — `consumption_gallons` is null on every run, so water actually delivered cannot be verified
- **Pool pump tile live** — Shelly EM Gen3 (`shellyemg3-dcb4d9ce63a4`), 50A CT on one leg of the 240V IntelliFlo2 pump circuit, powered/referenced off a spare 120V breaker in the subpanel; polls `sensor.shellyemg3_dcb4d9ce63a4_energy_meter_0_power` every 30s, threshold 20W = running
  - Note: single CT reads one leg only; a second CT on the Gen3's `IB` channel would give true two-leg wattage if added later
  - Same Shelly also runs an on-device script driving `switch.shellyemg3_dcb4d9ce63a4` → R-40 ionizer relay (20W threshold, 60s on-delay for flow establishment) — replaces the originally planned IntelliFlo accessory-output wiring; see `docs/pool_heat_recovery.md`
  - Energy readings logged to SQLite (`pool_pump` device row) via the same `maybeLogEnergy` path as other appliances
- **Alerting system live** — `homeassistant/packages/jeeves_alerts.yaml`, deployed via `git pull` on the Pi. Two docs: `docs/alerting_levels.md` is the spec (why the levels are what they are), `docs/alerting_runbook.md` is the operator manual (what to do when one fires, acknowledging, deploy, troubleshooting)
  - Verify after any change with `python3 scripts/verify-alerts.py` — checks every entity, automation id, and notify service the package references actually exists. `check_config` passing proves none of that
  - **Levels are defined by when you must act**: L1 now/anywhere/any hour · L2 in the morning · L3 when you get home · L4 over the weekend · L5 system only
  - Delivery: L1 = iOS Critical Alert repeating until acknowledged · L2 = normal push + 7am re-raise · L3 = push + re-raise on arrival home · L4 = digest only
  - **iOS Critical Alerts** via HA Companion — free, no third-party service. Requires iPhone **Settings → Notifications → Home Assistant → Critical Alerts** (iOS setting, not an in-app one). Verified 2026-08-07: full volume through the silent switch, Acknowledge button routes back to HA
  - `notify.mobile_app_matt_drazba_s_iphone` is the notify service; scripts `script.critical_alert` / `script.normal_alert` wrap it
  - **L1 budget: under ~6/year.** A noisy L1 is a bug in the levels doc, not a fact about the house
  - **Live: booster dry-run kill (L1/L2)** — booster on + pump under 20 W for 30s → shuts `switch.pool_sweep_socket_1` off, waits, retries, re-checks. Kill confirmed = L2; **kill unconfirmed = L1** ("go kill the breaker"), since the Tuya cloud round trip can fail or be overridden by a schedule still in the Tuya app. Fails closed — an unavailable power meter reads as pump-off and kills the booster
  - **Live: main pump off during 9pm–4pm window (L2)** — under 20 W for 15 min
  - **Live L3 alerts** — pool pad node offline · Shelly meter offline · sweep did not run tonight · HX calling but ΔT ≤ 0
  - **Template sensor entity_id trap:** HA derives a template entity's `entity_id` from `name`, not `unique_id`, and only at *first registration* — renaming later does not move it, so an automation pointing at a guessed id silently never fires. Always confirm with `/api/states/<entity_id>` after deploying; `check_config` passing proves nothing about whether entities exist
  - HX alert triggers on **ΔT ≤ 0, not "ΔT is small"** — stage-1 compressor runs legitimately produce small HX gains, so a small-delta threshold would fire constantly
  - **⚠️ The HX L3 is DISARMED and has never been able to fire.** Corrected 2026-08-10 — see `docs/pool_probe_calibration.md`. The 2026-08-08 note here claimed `out_temp_offset_f` was zeroed because the raw probes "agree to within one LSB." **That conclusion was wrong.** It inferred raw agreement by subtracting an offset it assumed was live, instead of measuring with the offset actually at zero. Verified 2026-08-10 by reflashing and confirming live: with `out_temp_offset_f: "0.0"` genuinely running, the outlet reads **+0.3°F above the inlet** with the pump running and heat off — i.e. both probes in the same moving water. The alert fires on ΔT ≤ 0, so a dead heat exchanger reads +0.3 and it cannot trip. This is **not a fault** — DS18B20 is ±0.5°C absolute, so two of them may differ by up to 1.8°F; 0.3°F is well inside tolerance and simply has to be calibrated out. Fix is `out_temp_offset_f: "-0.3"`, but **shield the probes first** (see below) since that changes the offset. Then move the threshold to ≈ −0.15°F so quantization noise on a legitimate low-stage run cannot trip it
  - **The outlet probe is probably in the sun** (owner hypothesis 2026-08-10, data supports it). With the pump **off** the probes decouple hard — **+5.51°F at 08-08 16:58 with heat recovery OFF**, peaking at ~5pm and decaying as the sun drops. With the pump **on** they track within ~0.3°F all day, so ~50 GPM swamps the radiative load. **This does not contaminate the heat-recovery numbers** — heat recovery only runs with flow. Fix is closed-cell insulation + reflective jacket on **both legs identically** (ΔT is a difference; symmetric loads cancel). **Never a towel** — wet fabric on a pool pad is an evaporative cooler and a worse artifact. Mitigated in software 2026-08-10: `/api/pool/history` returns `pump_watts` and the dashboard drops pump-off samples from the ΔT chart, gated on measured watts not clock hours (the pump demonstrably ran past its scheduled 4pm stop on 08-09)
  - **Sweep schedule runs in HA** — `switch.pool_sweep_socket_1`, 9:45–11:15pm, gated on the pump having genuinely run ≥30 min per the PB4-60 manual. Verified running 2026-08-08
  - **The Tuya app schedule is DELETED (2026-08-08). Never re-add one.** HA is the only thing that commands this switch, which is what makes the dry-run interlock safe: every failure (HA down, network down, Tuya cloud down) now degrades to "the booster never runs." A schedule in the Tuya app could start the booster with no idea whether the main pump is running
  - A missed night is caught by the 11:45pm "sweep did not run" check
  - The 20 W threshold answers "is the pump energized at all" and is deliberately RPM- and filter-independent. **Do not raise it** — the pump reads ~172 W on one leg at current RPM, so a higher threshold causes false kills. Watts cannot prove the pump moves *enough* water; that needs the flow meter
  - Open-alert flags (`input_boolean.alert_open_*`) clear only on Acknowledge, never on recovery — a fault that self-heals at 2am still surfaces at breakfast
  - **No global mute exists.** `input_boolean.pool_maintenance` was removed 2026-08-08 — it suppressed L2–L4 and nothing ever turned it off, so alerting could be silently disabled for days. Alerts always fire. Any future mute must expire on its own; do not reintroduce one that waits to be remembered
  - **Manual sweep runs are not faults.** Press the Tuya switch any hour, by any method; `jeeves_sweep_max_runtime` only intervenes after 2 hours (owner's stated max for this pool; normal runs are a 90-min countdown). The old outside-window guard killed manual runs within 15 min, silently, which read as a broken switch. Removed 2026-08-08 and **field-verified the same day: a 90-minute manual run completed with no silent kill.** Its own comment gave it away — "not damaging, since there is water, but hours of needless wear and ~1.5 kW of billing" — it was a cost/wear backstop, not a safety interlock, spending manual control to save ~75¢
  - **Known blind spot:** nothing can alert when HA itself is down (outage kills the pump, the Shelly, and the messenger together). Needs a watcher outside the house — unresolved
  - **`verify-alerts.py` now scans every `homeassistant/packages/*.yaml`** (fixed 2026-08-10), not just `jeeves_alerts.yaml` — a second package could otherwise have shipped pointing at an entity that was never registered and the script would still print `PASS`. Full-line comments are stripped first, so prose may name deliberately-deleted entities (`input_boolean.pool_maintenance`) without failing the run
  - **Remaining `verify-alerts.py` gap: `ALERT_REGISTRY` in `jeeves/server.js` is still unchecked** (11 flag entities + 10 detector sensors as of 2026-08-10). This was previously written down here as "~3 lines to fix." **It is not** — verified 2026-08-10. Pointing the same regex at `server.js` produces three false failures that each need handling first: `d.sensor.stats[...]` at `server.js:432` is PurpleAir JSON, not an entity; the template literal `` `input_boolean.alert_open_${k}` `` matches as a truncated `input_boolean.alert_open_`; and `sensor.pool_pad_pool_flow_gpm` (`server.js:600`) is referenced behind the `POOL_FLOW_METER_INSTALLED` flag for hardware that isn't installed. Needs a JS-aware exclusion pass, not a longer file list
  - HA config is deployable: `homeassistant/packages/` is un-ignored in `.gitignore`; secrets, DB, and logs stay ignored. `configuration.yaml` has `homeassistant: packages: !include_dir_named packages`
- **Pool page + alert management on the dashboard (2026-08-08)**
  - **Three views now:** tile grid (default), calendar, and `#view-pool`. Pool page opens by tapping `poolPump` or `poolTemp`, auto-returns after 60s, and every tap inside restarts that timer. It will not time out under an open alert overlay
  - Pool page: four hero cards · 24h schedule timeline (pump window, peak rate, sweep window, now-marker) · two stacked history charts · pad-node readout · footer with next pool task and alert count
  - **Alert overlay** — opens from the alert strip's ticker area, the `alerts` tile, or the pool page. Lists open alerts with level, age, the runbook line, and **whether the detector is still active**. Acknowledging calls `POST /api/alerts/:key/ack` → `input_boolean.turn_off`, the same thing the phone's Acknowledge button does. **L1 needs a second confirming tap** — a wall tablet is far lower friction than a phone, and acknowledging is not fixing
  - New tiles: `poolTemp`, `alerts` (colour-coded by highest open level via the inline `color`/`bg` mechanism, since the diff-patcher overwrites `className` every render), `nextActions`
  - **`TILES_PER_PAGE` is 22** = the 24 visible cells minus the 2 weather tiles. Currently 19 status tiles, so one page
  - **Charts are two stacked single-series plots on a shared time axis, never one plot with two y-scales.** Water temp (~78–86 °F) and ΔT (~0–3 °F) are different scales; a dual axis misrepresents both. Colours validated against the dark surface for contrast and colour-vision separation. No hover layer — it is a touch kiosk with no pointer, so the charts carry direct low/high/current labels instead
  - `cachedStatus.alerts` had been initialised to `[]` and never written since the dashboard was built — the ticker read "All systems normal" regardless of actual state until 2026-08-08
- **Next Up tile + recurring tasks (2026-08-08)** — `tasks` table at schema v6 (`id, domain, title, icon, interval_days, last_done_at, enabled`). `cachedStatus.nextActions[]` carries `{dueAt, confidence, basis, promoteOnDue}`; at **07:00** anything due promotes into a real chore tile via the existing `_addChore()` path, so it taps to claim, takes a PIN, and credits the scoreboard. Completing it stamps `last_done_at` and recalculates. Deleting a promoted chore does **not** mark it done — it re-promotes tomorrow, because marking it done would falsify the maintenance record
  - **Seasonal windows added at schema v8 (2026-08-12) — `tasks.start_month` / `end_month`, nullable.** `interval_days` alone cannot express seasonal work: citrus feeds 3×/year and roses stop at Labor Day, so on interval alone they promote a chore every 35 days through December, and **a tickler that nags out of season is how the tile gets ignored entirely** — the same self-clearing principle as the garage snooze `timer` and the deleted `input_boolean.pool_maintenance`. Out of window, `dueAt` is **deferred to the next window opening, not hidden**, so Next Up reads "Feed the rose · March 1" rather than the task vanishing and looking like a bug. NULL months = no window, so all pre-v8 tasks are unchanged; windows may wrap the year end. v8 also seeds the `garden` domain (`fert_rose`, `fert_citrus_ground`, `fert_potted`, `mulch_beds`) — see `docs/sprinklers.md` §10. **No dashboard work was needed** — the Next Up tile and 07:00 `_addChore()` promotion already consume anything in `tasks`
  - Seeded with documented test cadences only. **Backwash is deliberately absent** — it triggers at +8–10 psi over baseline, not on a calendar, and the pressure sensor is not built. Seeds stamp `last_done_at` at migration time so nothing is due on day one
  - Sources 2 (filter-pressure threshold) and 3 (chemistry model) append to the same array and need no UI work
- **Deadhead detection (display only, 2026-08-08)** — `cachedStatus.pool.flowStatus` is `no_meter | deadhead | ok`, gated on the `POOL_FLOW_METER_INSTALLED` env flag. **Never infer "no meter" from a zero flow reading** — an unconnected pulse counter reports a real `0`, and pump-drawing-current + no-flow is a deadhead (running against a closed valve, spikes filter pressure toward the TA100D's 50 psi ceiling). The alert itself is not built; see Deferred
- **Garage door live (2026-08-10)** — ratgdo32 at `192.168.0.230`, ESPHome firmware, **Security+ 1.0 with ratgdo emulating the wall panel**. Confirmed wired and talking by watching the device's own event stream (polling bytes `38/39/3A` on the bus, `Light state` + `Lock state` coming back). Full doc: `docs/garage_door.md`; automations in `homeassistant/packages/jeeves_garage.yaml`
  - **The obstruction sensor WORKS** — verified 2026-08-10 by streaming the device's event feed while a hand was waved through the photo-eye beam: `OFF → ON → OFF → ON → OFF`. An earlier note here called that wire "possibly never landed" and refused to use it. **That was wrong, and the lesson generalises: a static read of `OFF` is exactly what a correctly wired, unobstructed sensor reports.** "Working" and "disconnected" are indistinguishable at rest — the only way to tell is to make the measured thing happen and watch the value change. It cost ten seconds. Used to decide whether the close-failure L1 says "GO CLEAR THE DOORWAY" or "the beam is clear, look at the opener", and to wait up to 2 min for a blocked beam to clear before commanding a close
  - **`binary_sensor Motion` does not report — MEASURED 2026-08-10, not assumed.** Same 120-second event capture that proved obstruction, with someone walking back and forth under the opener: zero transitions, one sample, `OFF`. The obstruction run over the identical window gave 5 samples and 2 transitions, so the pipeline works and the flat line is a result. Matches the expected cause (Sec+1.0 motion comes from a motion-equipped wall panel; ratgdo replaces the panel). **Do not build "door open but nobody's in there" logic.** Re-test with `curl -s --max-time 120 -N http://192.168.0.230/events | grep -a --line-buffered "binary_sensor-motion"`
  - The door state stays the primary signal either way: a reversal shows up as the door starting to close and never reaching `closed`, true whether or not the beam sensor agrees
  - **Overnight (from 9:15pm):** open 5 min → push with **Leave it open 1 hour** / **Close it now** buttons → 10 min later `script.garage_close_verified` closes it, waits, retries once, verifies. Confirmed closed = informational push, **no alert flag** (the automation fixed it; a flag would make the alert count lie). Unconfirmed = L1
  - **Snooze is a `timer`, not an `input_boolean`, deliberately** — it expires on its own and re-arms the whole sequence via `timer.finished`. Same reasoning that deleted the pool maintenance-mode boolean on 2026-08-08: a mute that waits to be remembered silently disables the thing protecting you
  - **L1 — unexplained opening 10pm–6am.** Door leaves `closed` with no HA command. Sole suppression is `timer.garage_expected_open`, set by a `call_service` listener on `cover.open_cover`/`toggle`/`set_cover_position` targeting the door — it listens for the **service call, not the state change**, because the call event fires before the ESPHome round trip; the other way round is a race that loses. **A car remote or keypad is invisible to HA and will trip this** — accepted 2026-08-10 because nobody here opens the garage in those hours, which is exactly what makes it mean something. Window is narrower than the 9:15pm auto-close window on purpose: 9:15–10pm is still ordinary evening activity
  - **L1 — auto-close could not be confirmed.** Both L1s are **"the house is not protected"** (owner's ruling 2026-08-10, overriding a first draft that had the close failure at L2). Neither is destruction in the booster sense, but an open house at 3am doesn't improve on its own and only a person can fix it. Budget: both should fire **zero** times a year. If the night-open alert starts firing for legitimate arrivals, narrow the window — do not demote it
  - **L2 daytime open >15 min (6am–9:15pm) is alert-only and never moves the door.** Closing one on someone unloading a truck is the "manual control is not a fault" trap. The 15-min threshold is high-signal *only because of how this garage is used* — open while a car is coming or going, not otherwise (owner, 2026-08-10). L3 controller-offline >30 min completes the set
  - **`has_value()` on `binary_sensor.garage_door_open` is load-bearing.** An unavailable cover must read as "not open" so a rebooting ESP routes to the *offline* alert. Backwards, it would command a close against a dead device, fail to verify, and fire an L1 at 3am because the Wi-Fi blipped
  - **Siri, both paths.** Apple Home (HomeKit Bridge → include `cover.garage_door`; entity **Show as → Garage**, or Apple won't expose it as a real GarageDoorOpener) gives "open the garage door", "is the garage door open?", CarPlay, and the Home app — **expect a confirmation prompt on open, which is Apple's rule for garage doors and locks and cannot be disabled**. Plus `script.garage_close` → iOS Shortcut, phrase **"garage down"** (avoid anything containing "close the garage door" — Apple Home claims it). That script is a **plain, unverified close on purpose**: you're standing there watching, so routing it through the verified path would scream while you look straight at the problem
  - **No garage tile on the dashboard**, by decision. The four alerts are in `ALERT_REGISTRY` in `jeeves/server.js`, so they surface through the existing `alerts` tile count and the alert overlay with Acknowledge
- **Fire HD 8 kiosk live (2026-08-08)** — Fully Kiosk Browser on the wall tablet, pointed at `http://192.168.0.189:3000`. Setup guide, settings table, and gotchas in `docs/fire_tablet_kiosk.md`
  - **Kiosk Mode is a Fully PLUS feature**, as are Remote Admin and motion detection. PLUS is unlimited free to try, so the setup can be proven before paying — note unlicensed Fully shows the kiosk PIN on screen as a hint (observed 2026-08-08). Judged acceptable 2026-08-08: you must know the 7-tap exit gesture to ever see it, which no guest does. Not a reason to buy the license
  - **Motion detection stays off** — continuous camera capture plus frame differencing is the biggest CPU drain available on 2GB hardware, and it is a camera in the kitchen. The display just stays on
  - **Do not add a Fully brightness schedule** — the dashboard already self-dims to 0.45 opacity 10pm–6am in JS; layering a second one makes it unreadable
  - Set the Kiosk PIN *before* enabling lockdown. Doing it in the wrong order locks you out and the recovery is a factory reset
  - **Performance is fine — resolved 2026-08-08.** The tablet is sluggish in Silk but the dashboard under Fully is not, and Silk is not used. No debloat needed. There is a latent inefficiency in the dashboard (`.tile.alert`/`.tile.degraded` animate `box-shadow`, which forces a full repaint every frame and cannot be GPU-composited; the fix is a static shadow on an `::after` with animated `opacity`) but it is **not** an observed problem — do not chase it unless slowness shows up under Fully

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
                          # (no CALENDAR_ICS_URL — calendar comes from HA now)
HA_TOKEN=...              # HA long-lived token (Profile → Security → Long-lived access tokens, "Jeeves")
PURPLEAIR_API_KEY=...     # PurpleAir read API key
```

### HA URLs and OAuth reauth
- HA is at **`http://192.168.0.189:8123`** (`raspberrypi.local`). **`homeassistant.local` does not resolve on this network** — verified 2026-08-08. Any integration reauth that redirects to `http://homeassistant.local:8123/auth/external/callback` hangs forever with no error message
- The redirect target comes from the instance URL stored per-browser at **`my.home-assistant.io` → Configure**, not from HA itself. That and **Settings → System → Network → Internal URL** are both set to the IP as of 2026-08-08. Use the IP, never the hostname
- **The Google Cloud OAuth consent screen must stay in "In production" publishing status.** In **Testing** status Google expires refresh tokens after **7 days**, which killed the calendar repeatedly — HA logs `400 Bad Request` from `https://oauth2.googleapis.com/token` and every calendar entity goes `unavailable`. Published 2026-08-08
  - The "your app will be available to any user with a Google Account" warning governs who may *grant* consent using their own account; it exposes nothing of ours. Completing the flow requires the client ID **and secret**, which live only in Google Cloud and HA's config entry — never in this repo
  - The unverified-app interstitial is expected and unrelated to publishing status. Do not pursue Google verification for a personal project
- Check a suspect integration before blaming Jeeves code:
  ```bash
  cd ~/homelab && curl -s -H "Authorization: Bearer $(grep ^HA_TOKEN .env | cut -d= -f2-)" \
    http://localhost:8123/api/config/config_entries/entry \
    | python3 -c "import sys,json;[print(e['domain'],e.get('state'),e.get('reason')) for e in json.load(sys.stdin) if e.get('state')!='loaded']"
  ```

### Deployment workflow (Pi) — Jeeves + HA only
```bash
cd ~/homelab && git pull && docker compose up -d --build jeeves
# Add --build homeassistant only if docker-compose.yml changed for HA
```

### Deployment workflow (ESPHome) — Mac → ESP directly, NOT via the Pi
**The Pi is not in the ESPHome deploy path.** ESPHome is installed on the Mac mini
and flashes the ESP nodes over the air across the LAN. Do **not** `git pull` on the
Pi or use the ESPHome container to deploy device changes — the Pi's copy of
`esphome/*.yaml` is irrelevant to what the device is running.

```bash
cd "/Users/mattdrazba/Code Repos/Jeeves/esphome" && uvx esphome run pool-pad.yaml
```

- Run from the `esphome/` directory — `secrets.yaml` and `.esphome/` (build cache) are resolved relative to CWD and are gitignored, Mac-local only.
- OTA target resolves via mDNS (`pool-pad.local`); the ESP must be on the LAN and awake.
- Pushing to GitHub is for version history only — it does **not** deploy anything to the device.
- USB flashing (Mac, cable to the ESP) is only needed for a first flash or if OTA is bricked.

### Deferred polish
- Weather panel has empty grey space below forecast — needs layout fix (low priority)
- **Dryer "Done!" not firing on cycle end** — FIXED: switched from prev-state tracking on `sensor.dryer_current_status` to polling `event.dryer_notification` (event_type: `drying_is_complete`). Needs verification on next real cycle.

### Not yet wired up
- ~~Chromium kiosk autostart~~ — dropped; Fire HD 8 + Fully Kiosk Browser is the display path
- Apple TV 4K (Family Room) — discovered in HA but not yet paired; PIN appears on TV screen during setup
- AirPort Express units (NuTone, Clips, Block Party) — AirPlay pairing blocked by device restriction; fix is to enable IPv6 on router (Marshall paired successfully, others pending IPv6 fix); controlled indirectly via Mac mini Music bridge in the meantime
- Resideo cloud integration (developer.resideo.com OAuth) — optional backup/enhancement, not a dependency: pool heating mode is sensed locally via the FPH trio 24VAC circuit, not from the thermostat, so this stays additive. Revisited 2026-07-28 as a possible source of HVAC compressor **stage** (1 vs 2) data — need to check whether the Resideo API actually exposes stage before committing; T10 stays on HomeKit for all core control either way. See "HVAC stage visibility" under Parked for the full branch plan (cloud API vs CT clamp).

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

### Pool (see docs/pool_heat_recovery.md, docs/pool_booster_interlock.md)

- **Booster pump dry-run interlock (design settled, no new hardware):** Polaris PB4-60, currently gated only by a cloud-scheduled Tuya timer. Runs dry → seal + impeller destroyed in minutes; draws *less* current when dry, so no breaker/overload/high-amp alert catches it. Manual requires the booster start **≥30 min after** the filter pump and stop **≥30 min before** it. Plan (`docs/pool_booster_interlock.md`): wait for the flow meter already on order → recreate the sweep schedule in HA and **delete it from the Tuya app** so the switch is a dumb relay → HA gates on measured flow + the 30-min windows, turning off immediately if flow drops or the main pump stops. Every failure degrades to "booster never runs."

- Heat recovery interlock: HotSpot FPH5 + Pentair IntelliFlo2 VST + IntelliComm II + Tecmark 3010P flow switch. Full spec in docs.
- **Hardware interlock (L1/L2) is pure copper — no Pi/HA in the safety loop.** HA monitors only (L3).
- **Ext. Program 4 is set to 2200 RPM — it is NOT locked.** Corrected 2026-08-12. The speed is a setting on the IntelliFlo2's own control pad, adjustable up to **3450 RPM**. 2200 was *chosen* as the estimated speed to clear the FPH5's 45 GPM floor, and the ~55–60 GPM that follows is **extrapolated** by linear scaling from the single direct Blue-White reading at 1750 RPM (≈45–50 GPM) — it has never been measured at 2200. Several docs had written this up as "measured, not estimated" and as a physical lock, then built reasoning on top of it; those are corrected. Usable band is roughly **1900–2600 RPM** — the Tecmark drops out below ~1500/40 GPM, and the FPH5's 70 GPM ceiling lands near 2600–2700, so Program 4 cannot just be cranked toward 3450 for more heat recovery. Confirm all of it with the gauge during the sequential flow-meter calibration.
  - **Anything that needs a constant operating point must anchor to measured pump watts (Shelly EM Gen3), not to an assumed RPM.** Watts are a measurement of what the pump is doing; the RPM setting is a belief about how it was configured. This is what the flow-meter drift check and the filter-pressure baseline now use. Any baseline recorded at one Program 4 speed is invalid at another and must be re-established after a speed change.
- Flow switch arriving ~5 days. Breaker-kill test blocked until then.
- Sanitizer: Clearwater MineralPURE R-40 copper/silver ionizer. ORP probe removed — meaningless with copper ions + low FC.
- ESPHome pad node: ESP8266 HiLetgo in hand. Config at `esphome/pool-pad.yaml`. Run ESPHome container first, then flash via USB on Pi.
- **Chemistry system of record: Jeeves' SQLite, NOT ha-poolchem** (ratified 2026-08-07). ha-poolchem via HACS is **rejected — do not install it.** HA's recorder retention is short and already trimmed for SD-card wear, so chemistry stored there is purged in days, while forecasting needs seasons of history. Mirror current values *outward* to HA input_numbers one-way if automations need them. Readings entered manually at poolside; **copper target 0.15–0.20 ppm** (verified against the R-40 manual p.14, 2026-08-07; an earlier 0.2–0.4 figure here was wrong, its upper half exceeds the manufacturer maximum); ORP not used.
  - **Build order: log-only first, dose calculator is phase 2.** Label dose math is unreliable on real pools; the version worth building self-corrects against what past doses actually achieved, which needs logged history to exist first.
  - **Pool volume: 28,800 gallons** (owner estimate 2026-08-07, ±10% — every dose calculation scales linearly with it). R-40 is correctly sized (rated to 40,000). Turnover ≈2×/day at ~50 GPM over the 19-hour run. Full ionization from zero ≈69 h runtime ≈3.6 days on the current schedule.
  - **Copper loss is driven by pH, not backwash.** At 28,800 gallons a single backwash dilutes copper by <1 ppb — an order of magnitude below the HI747's ±10 ppb resolution. Backwash is a slow cumulative term (~10% of volume/year). Above pH 7.6 the ions fall out of solution, which the R-40 manual calls the usual cause of a low ion level. **pH belongs in the copper model as a regressor.** Evaporation + top-up is net-neutral for copper — do not model it as dilution.
  - Other R-40 manual targets, none of them conventional-pool numbers: **pH 7.2–7.6** (above 7.6 the ions fall out of solution and the ionizer stops working — this is a sanitizer-efficacy parameter, not comfort), **TDS 500–3000 ppm** (hard requirement — below 500 the R-40 cannot produce ions at all), TA 80–140, CH 150–350, **CYA not required** (only drain if >150), FC floor 0.4 ppm per the EPA label statement. Full table + sources in `docs/pool_data_addendum.md`.
  - The standard R-40 electrode **CLE-02 is copper only**; the 90/10 copper/silver CLE-51 is an optional upgrade. Which one is installed here is unconfirmed.
  - **Under review** — `docs/pool_chemistry_logging.md` proposes dropping ha-poolchem and making Jeeves' SQLite the system of record for chemistry, since HA's recorder retention can't support forecasting. Not yet ratified.
- **Manual maintenance logging + chemistry forecasting:** parked design brief at `docs/pool_chemistry_logging.md` — phone-at-poolside entry, voice for doses / screen for numbers, two-table schema (tests vs. doses). Open questions: test kit type, log-only vs. dose calculator.

## Deferred (committed, do later)
- **Resideo cloud API stage test — staged, ready to run. See `docs/hvac_fph_measurement.md` Part 1.** Does the Honeywell Home / Resideo API (`api.honeywell.com`, OAuth via developer.honeywell.com) expose whether the Bryant 226ANA048-B is running compressor stage 1 or stage 2? The T10 Pro shows stage on its own screen, which is the reference the API gets checked against.
  - **It is a differential test, not a single payload dump.** A field returning `"Cool"` proves nothing alone — stage only shows up as something that *changes*. Capture the full device JSON three times at states confirmed on the thermostat screen (off / stage 1 / stage 2, forced by dropping the cool setpoint 1–2°F vs 5–6°F below indoor), then diff. Repeat on a second day before trusting a positive.
  - Expectation is that `operationStatus.mode` returns `EquipmentOff`/`Heat`/`Cool` with **no** stage distinction — but that is a guess and the diff settles it.
  - **Fallback if it fails: Shelly EM Gen3 + 2 CTs at the outdoor unit (~$60)**, compressor on one channel and condenser fan on the other. Not a downgrade — it gives runtime and electrical input, which the API never would. Do **not** use one whole-circuit CT: the 90340 kills condenser fan power during diversion, so a single clamp corrupts the stage signal in exactly the condition being studied.
  - **Why this gates other work:** stage moves the supply-air split by more than FPH heat recovery does, so any FPH-vs-cooling comparison without stage labels produces a confident wrong answer. Everything in `docs/hvac_fph_measurement.md` Part 2 (air probes, `hvac_samples` logging, the peak-hours pump cost) is on hold behind it. No code written yet, by decision.
- **Multiport valve position sensing — approach decided 2026-08-10, parts not ordered.** Full brief: `docs/pool_valve_position_sensing.md`. **Sense Filter and Closed only**, via two battery Zigbee contact sensors and one magnet on the Tagelus TA100D handle; Backwash/Rinse/Waste are inferred from "left Filter, wasn't Closed, then pressure dropped and flow jumped." Recirculate is a knowingly accepted blind spot — it looks identical in pressure and flow, and has been used about once ever.
  - **This is the right replacement for maintenance mode.** Valve position is **self-clearing** — turn the handle back and monitoring resumes — whereas `input_boolean.pool_maintenance` waited to be remembered and was deleted 2026-08-08 for exactly that. **NFC tags were considered and rejected for the same reason:** a tag records what someone *says* they did, so a missed tap on the way back leaves HA believing a false thing indefinitely.
  - Parts ~$70: Sonoff Zigbee 3.0 USB Dongle Plus (nothing in the house speaks Zigbee yet) · 2× Third Reality contact sensor — **AAA, not CR2032**, since rechargeable coin cells are the wrong voltage and last months · 2× plastic outdoor junction box (the sensors are indoor plastic, the pad is not) · 1 disc magnet. Wired to the pad node's free GPIO would cost $5 and no batteries; battery was chosen for no conduit run, and the coordinator is wanted house-wide anyway.
  - Install gotchas: **the handle lifts ~½" before it rotates**, so mount beside the arc, not under it; the bracket competes for clearance with the pressure-transducer tee (`docs/pool_data_addendum.md`). Zigbee range to the pad is unproven — if it won't hold, one mains-powered Zigbee plug between house and pool repeats. Don't buy that up front.
  - Unlocks the **"handle left in Backwash"** alert (drain-the-pool hazard, level unratified) and distinguishes handle-in-Closed from a clogged basket, which the flow meter's deadhead detection cannot do on its own.
- **Pool deadhead alert (pump on, no flow) — blocked on the flow meter.** Nothing today watches for the main pump drawing current while water is not moving, i.e. running against a closed valve (the classic after-backwash mistake). This is *not* covered by the booster dry-run check, which is the opposite case (booster on, pump off). A deadheaded TA100D builds toward its 50 psi ceiling and a blown filter lid is an injury risk, not just equipment loss — so the level is probably **L1**, but that is unratified and L1 budget is under ~6/year. Jeeves already *detects* it: `fetchPoolStatus()` reports `flowStatus: no_meter | deadhead | ok`, gated on the `POOL_FLOW_METER_INSTALLED` env flag because an unconnected pulse counter reports a real `0`, not `unavailable` — **never infer "no meter" from a zero reading, that masks the fault.** Detection is display-only; the actual alert belongs in `jeeves_alerts.yaml`. Deliberately not written yet: it cannot be tested until the meter is installed, and an unverifiable safety alert is exactly the failure mode `verify-alerts.py` exists to catch. Write it, and calibrate `FLOW_DEADHEAD_GPM` (currently 10, against a theoretical `multiply: 0.02201`) on install day.
- **HA container startup network dependency fix:** After the 2026-07-19 power outage, Bhyve/LG ThinQ/EcoNet/Tesla all failed setup with `DNS servers unreachable` — Docker started the HA container before the network/DNS was actually usable, and HA's config-entry retry backoff (hardcoded, exponential, gives up after a few minutes) ran out before DNS recovered. Fix: `docker-compose.yml` healthcheck-gated `depends_on` or startup wait so HA doesn't launch until network connectivity is confirmed. Prevents the failure at the source.
- **Config-entry reload watchdog automation:** Safety net on top of the above — HA automation that reloads known-flaky cloud integrations (Bhyve, LG ThinQ, EcoNet, Tesla) every ~15 min for the first hour after HA startup, in case any entry still failed setup despite the network fix.
- **Text (SMS) alert for pool pump / critical failures while away:** Push notifications via the Companion app aren't reliable enough for something safety-critical like the pool heat recovery pump going down during a power outage while on vacation. Need a real SMS path (e.g. Twilio API, or an email-to-SMS gateway) triggered by an HA automation watching pump/flow state and outage/connectivity loss — not just a dashboard tile or app push. API key in `.env`, never committed.
- ESPHome pool pad node: ESP8266 flashed and on WiFi, OTA-capable from the Mac. DS18B20 HX in/out probes wired and confirmed live in HA (2026-07-28). Tecmark 3010P flow switch installed, wiring remaining. **White Rodgers Type 84 relay installed — no optocouplers used** (confirmed 2026-08-07; the earlier "relay/opto inputs remaining" note was stale). Remaining: flow meter (on order — DN50/2", correct size confirmed against the 2" return pipe; 5V DC off the existing buck converter, not the shared 12V adapter; still needs true-union fittings), pool-return probe.
  - **Filter pressure transducer ORDERED 2026-08-12 — 0–60 psi, 1/8"-27 NPT + 1/4"×1/8" brass bushing, 0.5–4.5V, scale constant 75.** The 150 psi order of 08-07 was cancelled by the seller; re-sourcing found that the doc's claim "there is no 60 psi in this family" was simply false, and that claim is what had escalated the range 60 → 80 → 150. Two things to carry into the build: **identify the signal wire by measurement, not colour** (the listing gives Blue/Green/Yellow depending on range and says nothing for 60 — 5V on red, ground on black, third wire reads ~0.5V at atmosphere), and **the two-point calibration against the retained analog gauge is also the range check**, since 60 was picked from a dropdown the spec table doesn't document. A ~0.6× ratio means a 100 psi unit shipped → constant becomes 125, not a return. Buy this class of part on eBay/AliExpress ($16–20), never Amazon ($40+) — same unit. Full brief in `docs/pool_data_addendum.md`
  - **The DN50's plastic construction was challenged and cleared 2026-08-10 — install it, don't buy the $642 paddlewheel yet.** Full brief: `docs/pool_flow_meter_selection.md`. Chemical attack is the wrong worry for *this* pool (copper/silver ionizer, FC floor 0.4 ppm, no shock regime — POM/nylon is fine in that water). Two real risks: **UV** on the body, since the pad is provably in direct sun, mitigated with a shade wrap; and **bearing wear** at ~6,900 h/yr continuous duty, which degrades as a **slow under-read, not a clean failure** — a meter reporting a plausible-but-low GPM is more dangerous than one reading `unavailable`. Free mitigation: indicated GPM falling at **constant measured pump watts** and constant filter pressure *is* bearing wear. Build that drift check before spending money. **It was originally written as "constant RPM, because the pump is locked at 2200" — that premise was false (corrected 2026-08-12, the speed is an adjustable setting) and the check is anchored to Shelly watts instead, which is strictly better since it survives a speed change.** Keep the meter out of any safety kill — the booster interlock gates on **pump watts**, and flow was always an addition to that vote. Upgrade if it drifts is **GF Signet 3-2536-P0, ~$642, open-collector**; the cheaper $350 Blue-White F-2000 sensor outputs an **AC sine wave** an ESP8266 cannot count without a comparator stage, so it is not actually the cheap option. `out_temp_offset_f` retuned to 0.0 and flashed 2026-08-08 — see the alerting notes above. Config at `esphome/pool-pad.yaml`.
- ESPHome pH node: separate ESP32 build (8266 ADC too weak for analog pH). After pad node proven.
- Pool water level sensor hardware
- NVMe SSD for the Pi 5 (SD card fine to start; trim HA recorder retention to a few days)
- Freeze-warning automation (winter concern)
- **Fully Kiosk → HA integration (tablet stays read-only) — deferred by decision 2026-08-08.** The core `fully_kiosk` integration would give battery/screen state plus `fully_kiosk.load_url` to push the display to a view on alert. Skipped: alerts already surface on the wall tile, the ticker, and the phone, so auto-switching saves a glance at a screen already showing the problem. Also needs Plus (Kiosk Mode and Remote Admin are both Plus) and dashboard hash routing, which does not exist. Full cost breakdown in `docs/fire_tablet_kiosk.md`.
- **Pool heat recovery data logging** — **code written, NOT yet running on the Pi.** `pool_heat_samples` (schema v5) and `logPoolHeat()` are in `jeeves/db.js`, and `fetchPoolHeat()` in `server.js` polls the pad node every 2 min — full resolution while heat recovery is active, 10-min heartbeat when idle, `delta_f` computed on write. Flow and BTU columns stay null until the flow meter is installed, then backfill from that day.
  - **The Pi's jeeves container predates this and has no such table.** Deploying HA config via `git pull` + `docker restart homeassistant` does NOT rebuild jeeves — that needs `docker compose up -d --build jeeves`. Verified missing 2026-08-07.

## Parked — decide later (do NOT build unless explicitly asked)
- **Local voice control:** HA Assist + Whisper (STT) + Piper (TTS). Fire HD 8 has built-in mic + speaker — no external hardware needed. Whisper inference runs on Pi 5; dropping Chromium kiosk freed meaningful RAM. Use small Whisper model (tiny or base). Fully Kiosk supports mic access + audio playback. Voice dismiss for appliance tiles: "Jeeves, washer done" → `POST /api/dismiss/washer`. Tap-to-dismiss is the current fallback.
- Library holds tile: BiblioCommons (local library system). Fetch holds/ready items on a schedule — likely via RSS feed or authenticated scrape. Credentials go in env vars, never committed. Research the specific library's BiblioCommons URL first.
- Zigbee USB dongle + cheap motion/door/temp sensors
- Energy monitoring via smart plugs (per-device power on the dashboard)
- AQI-triggered automation: PurpleAir threshold → air purifier smart plug + notification
- **Rain + windows automation:** If rain is forecast or active and window shades are open → push notification to warn. Two triggers: (1) imminent rain (HA weather entity `forecast` condition changes to rain/storm), (2) bonus: 9pm and overnight rain forecast + windows still open → "Close your windows, rain tonight." Shade state from Tuya cover entities (need to verify they report current position reliably). Rain source: HA weather integration or Open-Meteo via template sensor. Both triggers = HA automations with template conditions. No new hardware needed.
- **Picture frame automation:** Dumb frame on Wemo WSP080. Schedule: on in morning (e.g., 7am–10am) and evening (6pm–10pm), off during the day. Presence condition: also on whenever someone is home (via `person` entity or device tracker). Pure HA automation — no new hardware. Wemo is already in HA via HomeKit Controller.
- **Migrate automations from native apps to HA:** TP-Link Kasa (driveway lights schedules, any outlet automations), Tuya (shade schedules, pool sweep timer), and any others currently managed in vendor apps. Centralizes all automations in HA; vendor apps become passthrough only. Inventory existing vendor-app automations before migrating.
- **Bhyve sprinkler automation:** No longer parked — architecture settled 2026-08-12, see the Working section and `docs/sprinklers.md`. Remaining before code: confirm what is planted in each of the four zones (Front Yard, Back Planters, Uphill, Downhill), whether even-day watering is a water-district rule or just how it was set up, and whether the zones are genuinely drip. **Open-Meteo publishes `et0_fao_evapotranspiration` free with no API key** and Jeeves already calls Open-Meteo, so a real ET-minus-rain deficit model is reachable with zero new hardware — no soil sensors needed to start.
- Frigate local camera AI (person/package detection; wants a Coral USB accelerator)
- Boss key: one keypress swaps kiosk to a fake spreadsheet
- **Data history + forecasting:** Time-series storage for door events, energy usage, laundry loads, pool chemistry. Design: SQLite in a Docker volume (not HA's recorder — that's for HA internals). Jeeves server writes and queries it. Pool chemistry history enables dosing trend forecasting. Architecture should be designed with this in mind from the start — status tiles feed history, history feeds forecasting tiles.
- **Tesla notifications + voice via HA Assist:** Integration + dashboard tiles live (see Working section). Remaining: charge-complete + low-battery push notifications; voice commands via HA Assist (parked until voice stack is built).
- ~~**Garage door automation**~~ — **DONE 2026-08-10.** ratgdo32 installed, alerts and overnight auto-close live, Siri wired both ways. See the Working section and `docs/garage_door.md`. The "leaving home" scene idea is **not** being built on presence — device trackers were rejected for pool alerting on 2026-08-08 for the same reason, and the daytime left-open watchdog covers the actual failure (driving off with the door up) without needing to know where anyone is.
- **OhmHour visibility + automations:** OhmConnect sends OhmHour events (demand-response windows, typically 1h). Dashboard tile showing active/upcoming OhmHour; HA automations to shed load automatically (turn off dryer, EV charging, etc.) when one starts.
  - **Researched:** The undocumented `verify-ohm-hour` API and the HA OhmConnect integration both return only Active/Inactive — no scheduled time, ever. IFTTT only fires at start, not in advance. Direct API is a dead end for a "next OhmHour at 4pm" tile.
  - **Chosen approach — HA IMAP + email parsing:** OhmConnect emails the schedule 24–48h in advance. Set up HA's built-in IMAP integration to monitor Gmail (app password, no OAuth) filtered to OhmConnect sender. HA automation parses the time from the email body via `regex_findall` → writes to `input_datetime.ohmhour_scheduled`. Jeeves polls that entity → tile shows scheduled window. Load-shedding automations trigger on same entity.
  - **To start:** need a sample OhmConnect scheduling email (forward one here) to write the regex + automation. Gmail app password setup is the only prerequisite (2 min in Google account settings).
- **Weekly email reports:** Scheduled summary email (Friday evening or Sunday) covering: appliance cycles run, energy used per device, comparison to prior weeks, pool chemistry trends. Generated by Jeeves server, sent via SMTP or a transactional email service (Resend/Mailgun — API key in `.env`). Requires data history (SQLite) to be in place first.
- **Hourly chimes + status readout:** Big Ben-style chime on the hour via the Pi's audio output, followed by a spoken or displayed status summary ("It's noon. Washer done by 12:34, dryer done by 12:44."). Audio: `aplay` or `mpg123` on the Pi. Text-to-speech: ties into Whisper/Piper voice stack, or a simple pre-recorded chime + dynamic TTS. Chime should respect night-dim hours (10pm–6am = silent).
- **Dishwasher reminder:** DONE — HA automation at 9:15pm + Jeeves tile via Weaf HS110. See Working section.
- **Energy rate awareness (time-of-use):** Utility rates vary by season and time of day (summer peak 4–9pm). Jeeves should know the current rate tier and surface it on the dashboard. Use this to: warn before starting high-draw appliances during peak, suggest optimal run times, factor into weekly energy cost reports. Rate schedule hardcoded in config (changes ~2× per year) or fetched from utility API if available.
  - **First: confirm which PG&E plan we're actually on.** Two Teslas make **EV2-A** plausible but it is unverified. This changes the whole model: EV2-A has a **part-peak band (3–4pm and 9pm–midnight)** that E-TOU-C does not — E-TOU-C is simply peak 4–9pm, off-peak everything else. Any TOU logic written against the wrong plan gives wrong advice. Verify before building.
  - **Known win waiting on that answer:** the pool booster (~1.5 kW, ~68 kWh/month) runs 10:00–11:30pm, which is *entirely inside EV2-A part-peak*. If EV2-A applies, shifting the window past midnight moves all of it to off-peak — roughly $10–15/month for a free schedule change. Still satisfies both PB4-60 manual rules. See `docs/pool_booster_interlock.md`. On E-TOU-C it's already off-peak and there's nothing to do.
  - Main pump schedule (9pm–4pm, 19h) already avoids the 4–9pm peak and is the unique optimum for a 19-hour runtime — leave it alone.
- **Polaris 280 cleaner tuning (not yet done):** The 280 is tuned by **wheel RPM, target 28–32** — not by GPM. Measure with the pump running, cleaner held below water, counting wheel revolutions for one minute. Under 28: pull the blue restrictor disc from the wall fitting, then check the quick-disconnect filter screen, hoses/swivels for leaks, gate valve, and baskets. Over 32: add the blue disc, then red, and only after a restrictor is installed back off the pressure relief valve. Measure before changing anything else. Full detail in `docs/pool_booster_interlock.md`.
- **Solar + whole-home energy monitoring:** Three pieces — (1) **Enphase solar panels**: integrate via Enphase Envoy local API or HACS `enphase_envoy` integration; dashboard tile for current production (W) + daily yield (kWh). (2) **Emporia Vue energy monitor**: whole-home + circuit-level monitoring; HACS `emporia_vue` integration; dashboard tiles for grid import/export and top circuits. (3) **PGE TOU rate awareness**: surface current rate tier on dashboard, warn before running high-draw appliances during peak (4–9pm summer). Research integrations before starting — Enphase local API preferred over cloud.
- **Pool heat recovery + pump interlock:** Design settled, implementation in progress. See `docs/pool_heat_recovery.md`. Hardware-first safety (L1 flow switch + L2 IntelliComm II); HA is monitor-only. ESPHome config at `esphome/pool-pad.yaml`.
- **Maintenance tickler / home log:** Track recurring maintenance tasks with due dates — e.g., dishwasher deep clean every 2 months, HVAC filter every quarter, etc. Dashboard tile shows overdue/upcoming items. Backend: SQLite (same store as data history) with task definitions (name, interval, last-done date) and a simple `POST /api/maintenance/done/:task` endpoint to log completion. Smart scheduling: if the dishwasher ran N cycles since last clean, bump the due date forward instead of using calendar time alone. Depends on data history (SQLite) being in place.
- **Chore scorecard with PIN credit:** When dismissing an appliance tile (washer, dryer, dishwasher "Done!"), offer a numpad overlay to optionally enter a 4-digit PIN to attribute credit to a household member. PIN entry is optional — dismissing without a PIN still works as before. Backend: SQLite (`jeeves_data` volume) with `members` table (name, PIN hash) and `task_credits` table (member_id, task, timestamp). Dashboard shows a leaderboard tile or per-member count. Pairs with the voice stack: "Jeeves, washer done, PIN 1234." PIN storage: hash with bcrypt or similar, never store plaintext. Design should support future NFC tap-to-credit (tap your phone = your PIN without typing). No hardware required to start.
- **Home manual chatbot:** Local Q&A over appliance manuals and home-specific knowledge — "what's the best cycle for delicates on the LG?", "how do I calibrate the T10 pool heating mode?". Source material: PDFs of appliance manuals + custom notes stored in `docs/manuals/` (gitignored if large). Approach: run a local LLM via **Ollama** on the Pi 5 (or Mac mini if Pi 5 RAM is tight with Chromium running); small models like Llama 3.2 3B or Phi-3 Mini fit in 4GB with quantization. Jeeves server exposes a `/chat` endpoint that stuffs the relevant manual text into the prompt context (simple RAG — no vector DB needed at this scale) and calls the Ollama API locally. No cloud, no API key, no data leaves the house. Ties into maintenance tickler — chatbot can surface "you're due for a dishwasher clean" alongside cycle advice. Pi 5 RAM is the main constraint — benchmark Ollama alongside Chromium before committing to on-Pi inference.
- **Zero-AI grocery shopping assistant:** Given a shopping list, compare prices across Safeway, Whole Foods, Amazon Fresh, and Costco to find the best deal for pickup or delivery. Credentials per store stored in `.env` (never committed). Approach: Jeeves server or a standalone script calls store APIs or scrapes store websites; returns ranked options per item or per cart total. "Zero-AI" framing = deterministic price comparison, not LLM-driven; LLM optionally used only to parse natural-language list input. Scope: Mac/CLI tool first, Jeeves dashboard integration later if useful.
- **Home recipe repository + ingredient-aware ordering:** Store household recipes (Markdown or JSON in repo, gitignored if containing personal info). For a given recipe, diff against a known pantry state to produce a shopping list, then hand off to the grocery assistant above. Pantry tracking (what's currently stocked) is the hard part — options: manual entry via a simple UI, NFC tap on pantry shelf, or barcode scan via phone. Start with recipe storage + manual shopping list generation; add pantry tracking only if the manual approach proves sustainable.

## Git
Remote: `https://github.com/matt-drazba/Jeeves.git`
Auth: HTTPS via osxkeychain — first push after a fresh session requires a manual `git push` in terminal (credentials cached after that).
