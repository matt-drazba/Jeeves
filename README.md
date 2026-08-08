# Jeeves — Home Automation Monorepo

A Raspberry Pi 5 running Home Assistant and a custom kitchen dashboard, plus the
pool monitoring and alerting that grew out of it. LAN-only, no cloud dependency
for anything that matters.

## Layout

```
homelab/
├── docker-compose.yml      # HA + Jeeves + ESPHome
├── homeassistant/
│   └── packages/           # alerting config (deployable; secrets/DB gitignored)
├── jeeves/                 # Express server + single-file dashboard
├── esphome/                # ESP device configs (flashed from the Mac, not the Pi)
├── scripts/                # verify-alerts.py and friends
└── docs/                   # wiring manual, runbooks, design briefs
```

## The pieces

**Jeeves** is an Express server (`jeeves/server.js`) that polls Home Assistant,
Open-Meteo, PurpleAir, and a few other sources on independent timers into one
in-memory cache, and serves it as `/api/status`. History goes to SQLite
(`jeeves/db.js`).

**The dashboard** is one self-contained file, `jeeves/public/dashboard.html` —
vanilla HTML/CSS/JS, no build step, no frameworks, no external requests. It runs
on a wall-mounted Fire HD 8 in Fully Kiosk Browser at a fixed 1280×800.

**Home Assistant** owns devices and alerting. Jeeves displays; it does not decide.
The one exception is acknowledging an alert from the tablet, which calls back into
HA.

## Hardware

| | |
|---|---|
| Server | Raspberry Pi 5 4GB — Docker, HA Container, Jeeves. Headless |
| Display | Fire HD 8 wall-mounted, Fully Kiosk → `http://192.168.0.189:3000` |
| Dev | Mac mini — also the ESPHome flashing host |
| Remote | Tailscale (`100.99.104.79`); no port forwarding |

## Dashboard

Three views. The tile grid is the default; the calendar and the pool page are
opened by tapping a tile and return on their own.

Tiles are driven entirely by the `status` object in the API response — adding a
key adds a tile, and the grid reflows. The grid is a hard **24 cells** at
1280×800 and `#main` is `overflow: hidden`, so anything past that clips silently
rather than scrolling.

Tile states:

| State | Trigger |
|---|---|
| Normal | default |
| Done (green, tappable) | `done: true` — tap to dismiss, optional PIN credits a household member |
| Alert (red pulse) | `alert: true` |
| Degraded (yellow pulse) | `degraded: true` |
| Colored | `color`/`bg` inline override — used by AQI and the alert count |
| Stale / Error | no refresh in >2 min / fetch threw |

Night dimming (opacity 0.45) runs 10pm–6am. Modal overlays sit outside the dimmed
root so they stay readable.

### Rendering

`renderStatus()` builds tile DOM once, then patches only text and class names.
**Never reset `innerHTML` on `#status-panel` during an update** — it restarts the
CSS pulse animations. A full rebuild is forced every 30 cycles.

## Pool

The pool subsystem is the largest part of this repo and has its own documentation:

| Doc | What it is |
|---|---|
| [pool_wiring_manual.md](docs/pool_wiring_manual.md) | As-built wiring. The authority on what is physically installed |
| [alerting_levels.md](docs/alerting_levels.md) | Why the alert levels are what they are |
| [alerting_runbook.md](docs/alerting_runbook.md) | What to do when one fires |
| [pool_todo.md](docs/pool_todo.md) | Consolidated action list |
| [pool_data_addendum.md](docs/pool_data_addendum.md) | Chemistry targets and sources |

Two things to know before touching any of it:

**The booster pump has no dry-run protection.** A Polaris PB4-60 run without the
main pump supplying water destroys its seal in minutes, and it draws *less*
current when dry, so no breaker or overload catches it. The dry-run interlock is
the single most important automation in the repo. It is never suppressed.

**Alerts are graded by when you must act**, not by how bad they sound: L1
now/anywhere/any hour, L2 in the morning, L3 when you get home, L4 over the
weekend. L1 has a budget of about six firings a year. A noisy L1 is a bug in the
levels doc, not a fact about the house.

## Deploying

Three targets, three different commands. Getting these confused is the most common
way a change appears not to work.

**Jeeves** — the dashboard is baked into the image, so `--build` is required.
A plain `docker restart jeeves` will not pick up frontend changes:

```bash
cd ~/homelab && git pull && docker compose up -d --build jeeves
```

**Home Assistant config** — `check_config` passing proves nothing about whether
entities actually registered. `verify-alerts.py` is the real gate:

```bash
cd ~/homelab && git pull \
  && docker exec homeassistant python -m homeassistant --script check_config -c /config \
  && docker restart homeassistant && sleep 45 \
  && python3 scripts/verify-alerts.py
```

**ESPHome** — flashed from the **Mac**, over the air, directly to the device. The
Pi is not in this path at all; its copy of `esphome/*.yaml` is irrelevant to what
the hardware is running. Pushing to GitHub deploys nothing:

```bash
cd "~/Code Repos/Jeeves/esphome" && uvx esphome run pool-pad.yaml
```

## Hard rules

- Never commit secrets — API keys, HA tokens, `secrets.yaml`, `.env`
- **Single file** for the dashboard. No bundler, no splits, no frameworks, no CDN
- Keep the stack minimal — no Node-RED, InfluxDB, Grafana, or MQTT unless there's
  a specific reason
- Alerts are plain and direct. No personality
- Automation must not undo a deliberate human action. Cap or time-bound it
  instead, and say why when it acts
- No global mutes. Any suppression must expire on its own rather than waiting to
  be remembered

## Security

LAN-only by design, with Tailscale for remote access. `/api/status` is unauthenticated
— fine on a trusted LAN, not fine exposed. Do not port-forward it.
