// @ts-check
import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import ical from 'node-ical';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// Farm Hill, Redwood City, CA
const LAT = 37.48;
const LON = -122.25;
const LOCATION = 'Redwood City, CA';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function wmoToCondition(code) {
  if (code === 0)                          return 'Clear';
  if (code <= 3)                           return 'Cloudy';
  if (code <= 48)                          return 'Fog';
  if (code <= 67)                          return 'Rain';
  if (code <= 77)                          return 'Snow';
  if (code <= 82)                          return 'Shower';
  if (code <= 99)                          return 'Storm';
  return 'Clear';
}

async function fetchWeather() {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}` +
    `&current=temperature_2m,weathercode` +
    `&daily=weathercode,temperature_2m_max,temperature_2m_min` +
    `&temperature_unit=fahrenheit&timezone=America%2FLos_Angeles&forecast_days=4`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  const d = await res.json();

  const forecast = [1, 2, 3].map(i => ({
    day:       DAYS[new Date(d.daily.time[i] + 'T12:00:00').getDay()],
    high:      Math.round(d.daily.temperature_2m_max[i]),
    low:       Math.round(d.daily.temperature_2m_min[i]),
    condition: wmoToCondition(d.daily.weathercode[i]),
  }));

  cachedStatus.weather = {
    location:  LOCATION,
    temp:      Math.round(d.current.temperature_2m),
    condition: wmoToCondition(d.current.weathercode),
    high:      Math.round(d.daily.temperature_2m_max[0]),
    low:       Math.round(d.daily.temperature_2m_min[0]),
    forecast,
  };
  cachedStatus.updatedAt = new Date().toISOString();
  console.log(`Weather updated: ${cachedStatus.weather.temp}° ${cachedStatus.weather.condition}`);
}

// In-memory status cache
let cachedStatus = {
  weather: {
    location:  LOCATION,
    temp:      72,
    condition: 'Sunny',
    high:      78,
    low:       60,
    forecast: [
      { day: 'Wed', high: 75, low: 58, condition: 'Cloudy' },
      { day: 'Thu', high: 70, low: 55, condition: 'Rain' },
      { day: 'Fri', high: 73, low: 57, condition: 'Sunny' },
    ],
  },
  status: {
    washer: { label: 'Washer', icon: '🫧', value: 'Idle', alert: false, degraded: false },
    dryer:  { label: 'Dryer',  icon: '🌀', value: 'Idle', alert: false, degraded: false },
  },
  alerts: [],
  calendar: { days: [] },
  updatedAt: new Date().toISOString(),
};

// ── Home Assistant ────────────────────────────────────────────────
const HA_TOKEN = process.env.HA_TOKEN;
const HA_URL = 'http://host.docker.internal:8123';

async function fetchHAState(entityId) {
  const res = await fetch(`${HA_URL}/api/states/${entityId}`, {
    headers: { Authorization: `Bearer ${HA_TOKEN}` },
  });
  if (!res.ok) throw new Error(`HA API ${res.status} for ${entityId}`);
  return res.json();
}

let washerPrevState = 'stop';
let washerDone = false;

async function fetchWasher() {
  if (!HA_TOKEN) return;

  const [machineRes, completionRes] = await Promise.allSettled([
    fetchHAState('sensor.laundry_room_washer_machine_state'),
    fetchHAState('sensor.laundry_room_washer_completion_time'),
  ]);

  if (machineRes.status === 'rejected') throw machineRes.reason;
  const state = machineRes.value.state;

  if (state === 'run' || state === 'pause') {
    washerDone = false;
  } else if (state === 'stop' && (washerPrevState === 'run' || washerPrevState === 'pause')) {
    washerDone = true;
  }
  washerPrevState = state;

  let value, alert = false, degraded = false;
  if (washerDone) {
    value = 'Done!';
    alert = true;
  } else if (state === 'run') {
    let minsLeft = 0;
    if (completionRes.status === 'fulfilled') {
      minsLeft = Math.round((new Date(completionRes.value.state) - Date.now()) / 60000);
    }
    let timeStr = '';
    if (minsLeft > 0) {
      timeStr = minsLeft >= 60
        ? ` · ${Math.floor(minsLeft / 60)}h ${minsLeft % 60}m`
        : ` · ${minsLeft}m`;
    }
    value = `Running${timeStr}`;
  } else if (state === 'pause') {
    value = 'Paused';
  } else {
    value = 'Idle';
  }

  cachedStatus.status.washer = { label: 'Washer', icon: '🫧', value, alert, degraded };
  console.log(`Washer updated: ${value}`);
}

fetchWasher().catch(err => console.error('Washer fetch failed:', err));
setInterval(() => fetchWasher().catch(err => console.error('Washer fetch failed:', err)), 30 * 1000);

// Fetch weather on startup, then every 10 minutes
fetchWeather().catch(err => console.error('Weather fetch failed:', err));
setInterval(() => fetchWeather().catch(err => console.error('Weather fetch failed:', err)), 10 * 60 * 1000);

// ── Calendar ──────────────────────────────────────────────────────
const CALENDAR_ICS_URL = process.env.CALENDAR_ICS_URL;
const CAL_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

async function fetchCalendar() {
  if (!CALENDAR_ICS_URL) return;

  const events = await ical.async.fromURL(CALENDAR_ICS_URL);

  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay()); // back to Sunday

  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const days = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(weekStart);
    date.setDate(weekStart.getDate() + i);
    return {
      date: date.toISOString().slice(0, 10),
      dayName: CAL_DAYS[i],
      dayNum: date.getDate(),
      isToday: date.getTime() === today.getTime(),
      events: [],
    };
  });

  const addEvent = (startDate, summary, allDay) => {
    const d = new Date(startDate);
    const midnight = new Date(d);
    midnight.setHours(0, 0, 0, 0);
    const idx = Math.round((midnight - weekStart) / 86400000);
    if (idx < 0 || idx >= 7) return;
    const timeStr = allDay ? null : d.toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit', hour12: true,
      timeZone: 'America/Los_Angeles',
    });
    days[idx].events.push({
      title: summary || '(No title)',
      time: timeStr,
      allDay,
      sortKey: allDay ? -1 : d.getHours() * 60 + d.getMinutes(),
    });
  };

  for (const ev of Object.values(events)) {
    if (ev.type !== 'VEVENT') continue;
    const allDay = !!ev.start?.dateOnly;
    if (ev.rrule) {
      for (let occ of ev.rrule.between(weekStart, weekEnd, true)) {
        if (ev.start?.tz === 'America/Los_Angeles') {
          // rrule stores occurrences as "local time in UTC disguise" — UTC values ARE the Pacific hours.
          // Re-parse as local time so the process TZ (America/Los_Angeles) interprets them correctly.
          const pad = n => String(n).padStart(2, '0');
          const local = `${occ.getUTCFullYear()}-${pad(occ.getUTCMonth()+1)}-${pad(occ.getUTCDate())}T${pad(occ.getUTCHours())}:${pad(occ.getUTCMinutes())}:00`;
          occ = new Date(local);
        }
        addEvent(occ, ev.summary, allDay);
      }
    } else if (ev.start) {
      addEvent(ev.start, ev.summary, allDay);
    }
  }

  for (const day of days) {
    day.events.sort((a, b) => a.sortKey - b.sortKey);
  }

  cachedStatus.calendar = { days };
  cachedStatus.updatedAt = new Date().toISOString();
  console.log('Calendar updated');
}

fetchCalendar().catch(err => console.error('Calendar fetch failed:', err));
setInterval(() => fetchCalendar().catch(err => console.error('Calendar fetch failed:', err)), 5 * 60 * 1000);

app.use(express.static(join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'dashboard.html'));
});

app.get('/api/status', (req, res) => {
  res.json(cachedStatus);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Jeeves running on http://0.0.0.0:${PORT}`);
});
