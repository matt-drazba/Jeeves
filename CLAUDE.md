# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

Jeeves is a kitchen status dashboard running on a Raspberry Pi Zero W with a 7" display (800×480px). The Pi runs Chromium in kiosk mode pointed at a Replit-hosted Express/TypeScript server. **The Pi is a pure display — all integration logic lives on Replit.**

## Two-agent setup

This repo is worked on by two AI agents. Respect the boundary:

| Agent | Environment | Owns |
|-------|-------------|------|
| Claude Code (this) | Local / VS Code | `CLAUDE.md`, local commits, pushing |
| Replit Agent | Replit workspace | `replit.md`, Express server code, Replit config |

**Do not touch:** `.replit`, `replit.nix`, `artifacts/mockup-sandbox/` — these are Replit platform files. Let the Replit agent handle them.

`replit.md` and `CLAUDE.md` are separate files for separate tools — not duplicates. Keep both updated but don't merge them.

## Canonical files

| File | Purpose |
|------|---------|
| `artifacts/api-server/dashboard.html` | **The dashboard — edit this one only** |
| `artifacts/api-server/src/routes/dashboard.ts` | Serves the dashboard HTML at `/api/dashboard` |
| `artifacts/api-server/src/routes/index.ts` | Route registrations |
| `artifacts/api-server/src/app.ts` | Express app setup (CORS, logging, JSON) |

## Hard constraints

- **Single file** — all HTML, CSS, JS lives in `artifacts/api-server/dashboard.html`. No bundler, no splits.
- **Vanilla only** — no frameworks, no CDN links, no external resources in the dashboard.
- **800×480px fixed** — all layout decisions validated at this size.
- **Pi Zero W is CPU-constrained** — keep per-tick JS work minimal; timer intervals are intentionally coarse.

## Architecture

### Data flow

```
Pi (Chromium kiosk) → Replit Express server → /api/status → dashboard renders
```

`fetchData()` in the dashboard is the only integration point. It currently returns hardcoded `TEST_DATA`. To go live, replace its body with `fetch('/api/status')`. The `/api/status` route lives in `artifacts/api-server/src/routes/`.

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

## Roadmap

### Phase 1 — Pi kiosk ✅ (in progress)
Pi boots Chromium pointed at the Replit URL. No code changes needed.

```bash
chromium-browser --kiosk --noerrdialogs --disable-infobars \
  --app=https://<replit-url>/api/dashboard
```

### Phase 2 — `/api/status` route (next)
Add `GET /api/status` to `artifacts/api-server/src/routes/`. Start with hardcoded stubs matching `TEST_DATA`, then swap `fetchData()` in the dashboard to hit it.

### Phase 3 — Weather
Source: **Open-Meteo** (free, no API key). Fetch from the server (not the browser) and cache ~10 min. Hardcode lat/lon for the location.

### Phase 4 — Home Assistant tiles (one at a time)
Hub: likely Home Assistant. Use HA's REST API — `GET /api/states/<entity_id>` with a `Authorization: Bearer <token>` header. No HA Python client needed; Node `fetch` handles it.

Planned order:
1. Thermostat (`climate.*`)
2. Who's home (`person.*`)
3. Front door / garage (`binary_sensor.*`)
4. Pool (temperature sensor)
5. Laundry (power-monitoring plug — alert when wattage drops)

Config: HA entity IDs and token go in environment variables, not hardcoded.

### Phase 5 — Hardening
- Per-tile try/catch → `degraded: true` on failure (rest of dashboard keeps working)
- Systemd or Replit always-on to keep server running

## Git

Remote: `https://github.com/matt-drazba/Jeeves.git`
Auth: HTTPS via osxkeychain — first push after a fresh session requires a manual `git push` in terminal (credentials cached after that).
