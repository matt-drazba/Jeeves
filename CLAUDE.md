# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

Jeeves is a kitchen status dashboard. The Pi Zero W runs Chromium in kiosk mode pointing at a Replit-hosted Express server. The Pi is a pure display — all integration logic lives in the server.

## Canonical files

| File | Purpose |
|------|---------|
| `artifacts/api-server/dashboard.html` | **The dashboard — edit this one only** |
| `artifacts/api-server/src/routes/dashboard.ts` | Serves the dashboard HTML |
| `artifacts/api-server/src/routes/index.ts` | Route registrations |
| `artifacts/api-server/src/app.ts` | Express app setup |

The root `dashboard.html` is a stale duplicate — do not edit it.

## Hard constraints

- **Single file** — all HTML, CSS, and JS lives in `artifacts/api-server/dashboard.html`. Do not split files or introduce a bundler.
- **No frameworks, no npm, no build tools** — vanilla HTML/CSS/JS only.
- **Offline-capable** — no CDN links or external resources.
- **Target viewport** — 800×480px fixed. The Pi Zero W is CPU-constrained; keep per-tick JS work minimal.

## Architecture

### Data flow

`fetchData()` is the only integration point. Currently it returns the hardcoded `TEST_DATA` object near the top of the script. To connect live data, replace the body of `fetchData()` with a `fetch('/api/status')` call — nothing else needs to change.

Expected API shape:
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

`renderStatus()` builds the tile DOM once on first call, then on subsequent calls only patches `.tile-value` text and the element's class name. **Do not reset `innerHTML` on the status panel during updates** — that would restart CSS pulse animations mid-cycle. A full rebuild is forced every `FULL_REBUILD_EVERY = 30` poll cycles (~30 min) to handle structural changes.

### Tile states

| State    | Color        | Trigger                                           |
|----------|--------------|---------------------------------------------------|
| Normal   | White        | Default                                           |
| Alert    | Red pulse    | `alert: true` on a tile                           |
| Degraded | Yellow pulse | `degraded: true` on a tile                        |
| Stale    | Yellow strip | No successful refresh in >2× `REFRESH_INTERVAL_MS` |
| Error    | Red strip    | `fetchData()` threw                               |

### Adding tiles

Add a new key to the `status` object in the API response. The grid uses CSS `auto-fill` with `minmax(140px, 1fr)` and reflows automatically — no CSS changes needed.

### Timers (intentionally coarse — Pi Zero W)

| Timer | Interval | Why |
|-------|----------|-----|
| Clock / night-dim | 15s | Display shows HH:MM; 1s would be wasteful |
| Data refresh | 60s | `REFRESH_INTERVAL_MS` |
| Staleness check | 30s | Triggers stale state after 2 missed refreshes |
| Alert ticker | 5s | Cycles through active alerts |

Night dimming (opacity 0.45) activates 10 PM–6 AM via JS, not a server flag.

## Running locally

Open `dashboard.html` directly in any Chromium-based browser. No server needed for the demo data path.

For kiosk deployment on the Pi:
```bash
chromium-browser --kiosk --noerrdialogs --disable-infobars --app=http://localhost/api/dashboard
```
