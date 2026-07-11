// @ts-check
import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import ical from 'node-ical';
import * as db from './db.js';
import { sendWeeklyReport } from './report.js';

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
    washer:     { label: 'Washer',      icon: '🫧', value: 'Idle', alert: false, degraded: false },
    dryer:      { label: 'Dryer',       icon: '🌀', value: 'Idle', alert: false, degraded: false },
    aqiIn:      { label: 'AQI In',      icon: '🏠', value: '—',    alert: false, degraded: false },
    aqiOut:     { label: 'AQI Out',     icon: '🌿', value: '—',    alert: false, degraded: false },
    dishwasher: { label: 'Dishwasher',  icon: '🍽️', value: 'Idle', alert: false, degraded: false },
    nowPlaying: { label: 'Now Playing', icon: '🎵', value: '—',    sub: '', alert: false, degraded: false },
    dusty:      { label: 'Dusty',       icon: '🚗', value: '—',    sub: '', alert: false, degraded: false },
    snorlax:    { label: 'Snorlax',     icon: '🚗', value: '—',    sub: '', alert: false, degraded: false },
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

// ── Washer ────────────────────────────────────────────────────────
let washerPrevState  = 'stop';
let washerDone       = false;
let washerCycleId    = null;
let washerRecovered  = false;

async function fetchWasher() {
  if (!HA_TOKEN) return;

  const [machineRes, completionRes] = await Promise.allSettled([
    fetchHAState('sensor.laundry_room_washer_machine_state'),
    fetchHAState('sensor.laundry_room_washer_completion_time'),
  ]);

  if (machineRes.status === 'rejected') {
    db.logError('washer', 'fetch_failed', machineRes.reason?.message);
    throw machineRes.reason;
  }
  db.resolveError('washer', 'fetch_failed');

  const state = machineRes.value.state;

  // Restart recovery: re-attach to any open cycle from before a container restart
  if (!washerRecovered) {
    washerRecovered = true;
    const openId = db.getOpenCycleId('washer');
    if (openId) {
      if (state === 'run' || state === 'pause') {
        washerCycleId = openId; // resume tracking
      } else {
        db.closeCycle(openId, { endReason: 'unknown' }); // was running when we restarted, now idle
      }
    }
  }

  if (state === 'run' || state === 'pause') {
    washerDone = false;
    if (!washerCycleId) {
      try { washerCycleId = db.openCycle('washer'); }
      catch (err) { console.error('DB washer cycle open failed:', err.message); }
    }
  } else if (state === 'stop' && (washerPrevState === 'run' || washerPrevState === 'pause')) {
    washerDone = true;
    if (washerCycleId) {
      try { db.closeCycle(washerCycleId); } catch (err) { console.error('DB washer cycle close failed:', err.message); }
      washerCycleId = null;
    }
  }
  washerPrevState = state;

  let value, alert = false, done = false, degraded = false;
  if (washerDone) {
    value = 'Done!';
    done = true;
  } else if (state === 'run') {
    let minsLeft = 0;
    if (completionRes.status === 'fulfilled') {
      minsLeft = Math.round((new Date(completionRes.value.state) - Date.now()) / 60000);
    }
    let eta = '';
    if (completionRes.status === 'fulfilled' && minsLeft > 0) {
      eta = new Date(completionRes.value.state).toLocaleTimeString('en-US', {
        hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/Los_Angeles',
      });
    }
    value = eta ? `Done by ${eta}` : 'Running';
  } else if (state === 'pause') {
    value = 'Paused';
  } else {
    value = 'Idle';
  }

  cachedStatus.status.washer = { label: 'Washer', icon: '🫧', value, alert, done, degraded };
  console.log(`Washer updated: ${value}`);
}

// ── Dishwasher ────────────────────────────────────────────────────
const DISHWASHER_WATTS_THRESHOLD = 4;
const DISHWASHER_END_DELAY_MS    = 5 * 60 * 1000; // 5 min continuous below threshold = cycle ended

let dishwasherWasRunning  = false;
let dishwasherDone        = false;
let dishwasherBelowSince  = null;
let dishwasherPeakWatts   = 0;
let dishwasherCycleId     = null;
let dishwasherRecovered   = false;

async function fetchDishwasher() {
  if (!HA_TOKEN) return;

  let res;
  try {
    res = await fetchHAState('sensor.weaf_current_consumption');
    db.resolveError('dishwasher', 'fetch_failed');
  } catch (err) {
    db.logError('dishwasher', 'fetch_failed', err.message);
    throw err;
  }

  const watts = parseFloat(res.state);

  // Restart recovery
  if (!dishwasherRecovered) {
    dishwasherRecovered = true;
    const openId = db.getOpenCycleId('dishwasher');
    if (openId) {
      if (watts >= DISHWASHER_WATTS_THRESHOLD) {
        dishwasherCycleId    = openId;
        dishwasherWasRunning = true;
      } else {
        db.closeCycle(openId, { peakWatts: dishwasherPeakWatts, endReason: 'unknown' });
      }
    }
  }

  db.maybeLogEnergy('dishwasher', isNaN(watts) ? 0 : watts);

  if (!isNaN(watts) && watts >= DISHWASHER_WATTS_THRESHOLD) {
    dishwasherBelowSince = null;
    dishwasherDone = false;
    dishwasherPeakWatts = Math.max(dishwasherPeakWatts, watts);
    if (!dishwasherWasRunning) {
      dishwasherWasRunning = true;
      try { dishwasherCycleId = db.openCycle('dishwasher'); }
      catch (err) { console.error('DB dishwasher cycle open failed:', err.message); }
    }
  } else if (dishwasherWasRunning) {
    if (dishwasherBelowSince === null) {
      dishwasherBelowSince = Date.now();
    } else if (Date.now() - dishwasherBelowSince >= DISHWASHER_END_DELAY_MS) {
      dishwasherDone       = true;
      dishwasherWasRunning = false;
      dishwasherBelowSince = null;
      if (dishwasherCycleId) {
        try { db.closeCycle(dishwasherCycleId, { peakWatts: dishwasherPeakWatts }); }
        catch (err) { console.error('DB dishwasher cycle close failed:', err.message); }
        dishwasherCycleId   = null;
        dishwasherPeakWatts = 0;
      }
    }
  }

  let value, done = false;
  if (dishwasherDone) {
    value = 'Done!'; done = true;
  } else if (!isNaN(watts) && watts >= DISHWASHER_WATTS_THRESHOLD) {
    value = `Running (${Math.round(watts)}W)`;
  } else {
    value = 'Idle';
  }

  cachedStatus.status.dishwasher = { label: 'Dishwasher', icon: '🍽️', value, done, alert: false, degraded: false };
  console.log(`Dishwasher updated: ${value}`);
}

fetchDishwasher().catch(err => console.error('Dishwasher fetch failed:', err));
setInterval(() => fetchDishwasher().catch(err => console.error('Dishwasher fetch failed:', err)), 30 * 1000);

fetchWasher().catch(err => console.error('Washer fetch failed:', err));
setInterval(() => fetchWasher().catch(err => console.error('Washer fetch failed:', err)), 30 * 1000);

// ── Dryer ─────────────────────────────────────────────────────────
let dryerDone          = false;
let lastDryerEventTime = null;
let dryerCycleId       = null;
let dryerRecovered     = false;

async function fetchDryer() {
  if (!HA_TOKEN) return;

  const [statusRes, remainingRes] = await Promise.allSettled([
    fetchHAState('sensor.dryer_current_status'),
    fetchHAState('sensor.dryer_remaining_time'),
  ]);

  if (statusRes.status === 'rejected') {
    db.logError('dryer', 'fetch_failed', statusRes.reason?.message);
    throw statusRes.reason;
  }
  db.resolveError('dryer', 'fetch_failed');

  const state = statusRes.value.state;

  // Restart recovery
  if (!dryerRecovered) {
    dryerRecovered = true;
    const openId = db.getOpenCycleId('dryer');
    if (openId) {
      if (state === 'running' || state === 'pause') {
        dryerCycleId = openId;
      } else {
        db.closeCycle(openId, { endReason: 'unknown' });
      }
    }
  }

  if (state === 'running' || state === 'pause') {
    dryerDone = false;
    if (!dryerCycleId) {
      try { dryerCycleId = db.openCycle('dryer'); }
      catch (err) { console.error('DB dryer cycle open failed:', err.message); }
    }
  }

  const [notifRes] = await Promise.allSettled([fetchHAState('event.dryer_notification')]);
  if (notifRes.status === 'fulfilled') {
    const eventTime = notifRes.value.state;
    const eventType = notifRes.value.attributes?.event_type;
    if (eventTime !== lastDryerEventTime) {
      lastDryerEventTime = eventTime;
      if (eventType === 'drying_is_complete') {
        dryerDone = true;
        if (dryerCycleId) {
          try { db.closeCycle(dryerCycleId); } catch (err) { console.error('DB dryer cycle close failed:', err.message); }
          dryerCycleId = null;
        }
      }
    }
  }

  let value, alert = false, done = false, degraded = false;
  if (dryerDone) {
    value = 'Done!';
    done = true;
  } else if (state === 'running') {
    let eta = '';
    if (remainingRes.status === 'fulfilled') {
      const minsLeft = Math.round((new Date(remainingRes.value.state) - Date.now()) / 60000);
      if (minsLeft > 0) {
        eta = new Date(remainingRes.value.state).toLocaleTimeString('en-US', {
          hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/Los_Angeles',
        });
      }
    }
    value = eta ? `Done by ${eta}` : 'Running';
  } else if (state === 'pause') {
    value = 'Paused';
  } else {
    value = 'Idle';
  }

  cachedStatus.status.dryer = { label: 'Dryer', icon: '🌀', value, alert, done, degraded };
  console.log(`Dryer updated: ${value}`);
}

fetchDryer().catch(err => console.error('Dryer fetch failed:', err));
setInterval(() => fetchDryer().catch(err => console.error('Dryer fetch failed:', err)), 30 * 1000);

// ── AQI (PurpleAir) ──────────────────────────────────────────────
const PURPLEAIR_KEY             = process.env.PURPLEAIR_API_KEY;
const PURPLEAIR_INDOOR_SENSOR   = 126601;
const PURPLEAIR_OUTDOOR_SENSORS = [113020, 81199, 284212];

function pm25ToAqi(pm) {
  const bp = [
    [0,    12.0,  0,   50 ],
    [12.1, 35.4,  51,  100],
    [35.5, 55.4,  101, 150],
    [55.5, 150.4, 151, 200],
    [150.5,250.4, 201, 300],
    [250.5,500.4, 301, 500],
  ];
  for (const [lo, hi, alo, ahi] of bp) {
    if (pm <= hi) return Math.round(((ahi - alo) / (hi - lo)) * (pm - lo) + alo);
  }
  return 500;
}

function aqiMeta(aqi) {
  if (aqi <= 50)  return { label: 'Good',          color: '#68e143', bg: '#0a1a06' };
  if (aqi <= 100) return { label: 'Moderate',       color: '#f7d300', bg: '#1a1800' };
  if (aqi <= 150) return { label: 'Sensitive',      color: '#ff7e00', bg: '#1a0e00' };
  if (aqi <= 200) return { label: 'Unhealthy',      color: '#ff0000', bg: '#1a0000' };
  if (aqi <= 300) return { label: 'Very Unhealthy', color: '#8f3f97', bg: '#12001a' };
  return                  { label: 'Hazardous',     color: '#7e0023', bg: '#1a0008' };
}

async function fetchPM25(sensorId) {
  const r = await fetch(`https://api.purpleair.com/v1/sensors/${sensorId}?fields=pm2.5_10minute`,
    { headers: { 'X-API-Key': PURPLEAIR_KEY } });
  if (!r.ok) throw new Error(`PurpleAir ${r.status}`);
  const d = await r.json();
  return d.sensor.stats['pm2.5_10minute'];
}

function buildAqiTile(label, icon, aqi) {
  const { label: aqiLabel, color, bg } = aqiMeta(aqi);
  return { label, icon, value: `${aqi} ${aqiLabel}`, color, bg, alert: false, degraded: false, done: false };
}

async function fetchAQI() {
  if (!PURPLEAIR_KEY) return;

  const [indoorRes, ...outdoorResults] = await Promise.allSettled([
    fetchPM25(PURPLEAIR_INDOOR_SENSOR),
    ...PURPLEAIR_OUTDOOR_SENSORS.map(fetchPM25),
  ]);

  if (indoorRes.status === 'fulfilled') {
    const aqi = pm25ToAqi(indoorRes.value);
    cachedStatus.status.aqiIn = buildAqiTile('AQI In', '🏠', aqi);
    console.log(`AQI In updated: ${aqi}`);
  }

  const outdoorReadings = outdoorResults.filter(r => r.status === 'fulfilled').map(r => r.value);
  if (outdoorReadings.length > 0) {
    const pm = outdoorReadings.reduce((a, b) => a + b, 0) / outdoorReadings.length;
    const aqi = pm25ToAqi(pm);
    cachedStatus.status.aqiOut = buildAqiTile('AQI Out', '🌿', aqi);
    console.log(`AQI Out updated: ${aqi}`);
  }
}

fetchAQI().catch(err => console.error('AQI fetch failed:', err));
setInterval(() => fetchAQI().catch(err => console.error('AQI fetch failed:', err)), 10 * 60 * 1000);

// ── Tesla ─────────────────────────────────────────────────────────
const TESLA_VEHICLES = [
  { key: 'dusty',   label: 'Dusty',   prefix: 'dusty'   },
  { key: 'snorlax', label: 'Snorlax', prefix: 'snorlax' },
];

async function fetchTesla() {
  if (!HA_TOKEN) return;
  for (const { key, label, prefix } of TESLA_VEHICLES) {
    try {
      const [battRes, chargingRes, timeRes] = await Promise.allSettled([
        fetchHAState(`sensor.${prefix}_battery_level`),
        fetchHAState(`sensor.${prefix}_charging`),
        fetchHAState(`sensor.${prefix}_time_to_full_charge`),
      ]);

      const pct = battRes.status === 'fulfilled' ? Math.round(parseFloat(battRes.value.state)) : null;
      const chargingState = chargingRes.status === 'fulfilled' ? chargingRes.value.state : null;
      const timeToFull = timeRes.status === 'fulfilled' ? parseFloat(timeRes.value.state) : null;

      const value = pct !== null && !isNaN(pct) ? `${pct}%` : '—';

      let sub = '';
      if (chargingState === 'Charging') {
        if (timeToFull && timeToFull > 0) {
          const h = Math.floor(timeToFull / 60);
          const m = Math.round(timeToFull % 60);
          sub = h > 0 ? `Charging · ${h}h ${m}m` : `Charging · ${m}m`;
        } else {
          sub = 'Charging';
        }
      } else if (chargingState === 'Complete') {
        sub = 'Full';
      } else if (chargingState && chargingState !== 'Disconnected' && chargingState !== 'unknown') {
        sub = chargingState;
      }

      const degraded = pct !== null && !isNaN(pct) && pct < 20;

      cachedStatus.status[key] = { label, icon: '🚗', value, sub, alert: false, degraded, done: false };
      console.log(`Tesla ${label} updated: ${value} ${sub}`);
    } catch (err) {
      console.error(`Tesla ${label} fetch failed:`, err.message);
    }
  }
}

fetchTesla().catch(err => console.error('Tesla fetch failed:', err));
setInterval(() => fetchTesla().catch(err => console.error('Tesla fetch failed:', err)), 5 * 60 * 1000);

// ── Now Playing (Mac mini Music bridge) ──────────────────────────
const MUSIC_BRIDGE_URL = 'http://192.168.0.204:8181';

async function fetchNowPlaying() {
  try {
    const res = await fetch(`${MUSIC_BRIDGE_URL}/now_playing`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error(`Music bridge ${res.status}`);
    const d = await res.json();

    const playing = d.player_state === 'playing';
    const paused  = d.player_state === 'paused';

    let value, sub = '';
    if (playing || paused) {
      value = d.name || '—';
      const speakerStr = (d.speakers || []).join(', ');
      sub = speakerStr ? `${d.artist} · ${speakerStr}` : (d.artist || '');
    } else {
      value = '—';
    }

    cachedStatus.status.nowPlaying = {
      label: 'Now Playing', icon: paused ? '⏸' : '🎵',
      value, sub, alert: false, degraded: paused,
    };
  } catch (err) {
    console.error('Music bridge fetch failed:', err.message);
  }
}

fetchNowPlaying().catch(() => {});
setInterval(() => fetchNowPlaying().catch(() => {}), 15 * 1000);

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

// ── Routes ────────────────────────────────────────────────────────
app.use(express.static(join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'dashboard.html'));
});

app.get('/api/status', (req, res) => {
  res.json(cachedStatus);
});

app.get('/api/history/:appliance', (req, res) => {
  const { appliance } = req.params;
  const limit = Math.min(parseInt(req.query.limit) || 10, 100);
  res.json({ appliance, cycles: db.getRecentCycles(appliance, limit) });
});

app.get('/api/errors', (req, res) => {
  res.json({ errors: db.getOpenErrors() });
});

app.post('/api/dismiss/:appliance', (req, res) => {
  const { appliance } = req.params;
  if (appliance === 'washer') {
    washerDone = false;
    cachedStatus.status.washer = { ...cachedStatus.status.washer, value: 'Idle', done: false };
  } else if (appliance === 'dryer') {
    dryerDone = false;
    cachedStatus.status.dryer = { ...cachedStatus.status.dryer, value: 'Idle', done: false };
  } else if (appliance === 'dishwasher') {
    dishwasherDone = false;
    cachedStatus.status.dishwasher = { ...cachedStatus.status.dishwasher, value: 'Idle', done: false };
  } else {
    return res.status(400).json({ error: 'Unknown appliance' });
  }
  console.log(`${appliance} dismissed`);
  res.json({ ok: true });
});

// ── Weekly report (Sunday 9am) ────────────────────────────────────
let lastReportDate = null;
setInterval(() => {
  const now = new Date();
  if (now.getDay() === 0 && now.getHours() === 9 && now.getMinutes() === 0) {
    const today = now.toDateString();
    if (lastReportDate !== today) {
      lastReportDate = today;
      sendWeeklyReport().catch(err => console.error('Weekly report failed:', err));
    }
  }
}, 60 * 1000);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Jeeves running on http://0.0.0.0:${PORT}`);
});
