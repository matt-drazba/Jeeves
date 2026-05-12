# Kitchen Status Dashboard

A self-contained single-file dashboard designed to run in Chromium kiosk mode on a Raspberry Pi Zero with a 7" display (800×480px). No frameworks, no build tools, no internet required.

![Dashboard screenshot showing clock, weather, and status tiles](.github/preview.png)

## What it shows

- **Live clock** — updates every 15 seconds
- **Weather** — current temp, conditions, high/low, 3-day forecast
- **Status tiles** — laundry, front door, garage, thermostat, who's home, pool (flexible grid — add more tiles without redesign)
- **Alert strip** — cycles through active alerts at the bottom
- **Last updated timestamp** — so you always know when data was last fetched

## States

| State | Color | Meaning |
|-------|-------|---------|
| Normal | White | All good |
| Alert | Red pulse | Needs attention (e.g. laundry done, door unlocked) |
| Degraded | Yellow pulse | Sensor offline or integration unreachable |
| Stale | Yellow strip | Data hasn't refreshed in >2 minutes |
| Error | Red strip | Fetch failed entirely |

Night dimming activates automatically between 10 PM and 6 AM.

## Running on a Raspberry Pi

```bash
# Point Chromium at the dashboard URL in kiosk mode
chromium-browser --kiosk --noerrdialogs --disable-infobars \
  --app=http://localhost/api/dashboard
```

## Connecting real data

The test data is a plain JSON object at the top of `dashboard.html`. To wire up live data, replace the `fetchData()` function:

```js
async function fetchData() {
  const res = await fetch('/api/status');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
```

Your API response should match this shape:

```json
{
  "weather": {
    "location": "Redwood City, CA",
    "temp": 68,
    "condition": "Sunny",
    "high": 72,
    "low": 54,
    "forecast": [
      { "day": "Tue", "high": 74, "low": 55, "condition": "Sunny" }
    ]
  },
  "status": {
    "laundry": { "label": "Laundry", "icon": "🫧", "value": "Done", "alert": true, "degraded": false }
  },
  "alerts": ["Laundry is done!"]
}
```

Add `"degraded": true` to any tile to show the yellow offline state.

## Adding tiles

Just add a new key to the `status` object. The grid uses `auto-fill` so it reflows automatically — no CSS changes needed.

## Stack

- Vanilla HTML, CSS, JavaScript — zero dependencies
- Runs offline with no internet connection
- Single `.html` file, self-contained
- Compatible with any Chromium-based browser

## Security note

If you expose this outside your LAN, add a token header or IP restriction to the `/api/status` endpoint. The dashboard is designed for local network use only.
