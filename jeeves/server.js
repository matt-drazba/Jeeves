// @ts-check
import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';
import * as db from './db.js';
import { sendWeeklyReport } from './report.js';
import { loadDocs, getContext } from './rag.js';

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
    upNext:     { label: 'Today',       icon: '🗓️', value: '—',    sub: '', alert: false, degraded: false, done: false, events: [] },
    washer:     { label: 'Washer',      icon: '🫧', value: 'Idle', alert: false, degraded: false },
    dryer:      { label: 'Dryer',       icon: '🌀', value: 'Idle', alert: false, degraded: false },
    aqiIn:      { label: 'AQI In',      icon: '🏠', value: '—',    alert: false, degraded: false },
    aqiOut:     { label: 'AQI Out',     icon: '🌿', value: '—',    alert: false, degraded: false },
    dishwasher: { label: 'Dishwasher',  icon: '🍽️', value: 'Idle', alert: false, degraded: false },
    sprinklers:   { label: 'Sprinklers',   icon: '💧', value: '—',    alert: false, degraded: false },
    waterHeater:  { label: 'Hot Water',    icon: '🚿', value: '—',    sub: '', alert: false, degraded: false },
    library:      { label: 'Library',      icon: '📚', value: '—',    sub: '', alert: false, degraded: false, readyHolds: [] },
    booksOut:     { label: 'Books Out',    icon: '📖', value: '—',    sub: '', alert: false, degraded: false, checkedOut: [] },
    nowPlaying: { label: 'Now Playing', icon: '🎵', value: '—',    sub: '', alert: false, degraded: false },
    batteries:  { label: 'Batteries',   icon: '🔋', value: '—',    sub: '', alert: false, degraded: false, devices: [] },
    scoreboard: { label: 'Chores',      icon: '🏆', value: '—',    sub: 'This week', members: [], alert: false, degraded: false },
    homeEnergy: { label: 'Home Energy', icon: '⚡', value: '—',    sub: '', alert: false, degraded: false },
    poolPump:   { label: 'Pool Pump',   icon: '🏊', value: '—',    sub: '', alert: false, degraded: false },
    poolTemp:   { label: 'Pool Temp',   icon: '🌡️', value: '—',    sub: '', alert: false, degraded: false },
    nextActions:{ label: 'Next Up',     icon: '🔮', value: '—',    sub: '', alert: false, degraded: false },
    alerts:     { label: 'Alerts',      icon: '🔔', value: '—',    sub: '', alert: false, degraded: false },
  },
  alerts: [],
  alertDetail: [],
  pool: {},
  nextActions: [],
  calendar: { days: [] },
  updatedAt: new Date().toISOString(),
};

// ── Home Assistant ────────────────────────────────────────────────
const HA_TOKEN = process.env.HA_TOKEN;
const HA_URL   = 'http://host.docker.internal:8123';

const VOICE_SERVICE_URL = process.env.VOICE_SERVICE_URL || 'http://voice:5100';

async function fetchHAState(entityId) {
  const res = await fetch(`${HA_URL}/api/states/${entityId}`, {
    headers: { Authorization: `Bearer ${HA_TOKEN}` },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`HA API ${res.status} for ${entityId}`);
  return res.json();
}

// Fetch several entities at once. Takes { key: entityId }, returns
// { key: { state, lastChanged } } for whatever resolved — missing keys mean that
// entity failed or doesn't exist, which callers are expected to handle.
async function fetchHAStates(map) {
  const keys = Object.keys(map);
  const results = await Promise.allSettled(keys.map((k) => fetchHAState(map[k])));
  const out = {};
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      out[keys[i]] = { state: r.value.state, lastChanged: r.value.last_changed };
    }
  });
  return out;
}

// HA reports missing/erroring entities as literal strings, not nulls.
const haNum = (s) =>
  s === undefined || s === null || s === 'unknown' || s === 'unavailable' ? NaN : parseFloat(s);

async function callHAService(domain, service, entityId) {
  const res = await fetch(`${HA_URL}/api/services/${domain}/${service}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${HA_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ entity_id: entityId }),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`HA service ${domain}.${service} → ${res.status} for ${entityId}`);
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
        dishwasherDone = true; // was running before restart, now below threshold = likely done
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
  const pm = d.sensor.stats['pm2.5_10minute'];
  if (pm == null || isNaN(pm)) throw new Error(`PurpleAir ${sensorId}: invalid pm2.5 value`);
  return pm;
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

// ── Bhyve Sprinklers ──────────────────────────────────────────────
async function fetchBhyve() {
  if (!HA_TOKEN) return;
  try {
    const res = await fetchHAState('sensor.sprinklers_next_watering');
    const raw = res.state;
    let value = '—';
    if (raw && raw !== 'unknown' && raw !== 'unavailable') {
      const dt = new Date(raw);
      if (!isNaN(dt)) {
        const now = new Date();
        const todayMidnight = new Date(now); todayMidnight.setHours(0,0,0,0);
        const tomorrowMidnight = new Date(todayMidnight); tomorrowMidnight.setDate(tomorrowMidnight.getDate() + 1);
        const dtMidnight = new Date(dt); dtMidnight.setHours(0,0,0,0);
        const timeStr = dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/Los_Angeles' });
        if (dtMidnight.getTime() === todayMidnight.getTime()) value = `Today ${timeStr}`;
        else if (dtMidnight.getTime() === tomorrowMidnight.getTime()) value = `Tomorrow ${timeStr}`;
        else value = dt.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'America/Los_Angeles' }) + ` ${timeStr}`;
      } else {
        value = raw;
      }
    }
    cachedStatus.status.sprinklers = { label: 'Sprinklers', icon: '💧', value, alert: false, degraded: false };
    console.log(`Sprinklers updated: ${value}`);
  } catch (err) {
    console.error('Bhyve fetch failed:', err.message);
  }
}

fetchBhyve().catch(() => {});
setInterval(() => fetchBhyve().catch(() => {}), 5 * 60 * 1000);

// ── Water Heater (Rheem EcoNet) ───────────────────────────────────
async function fetchWaterHeater() {
  if (!HA_TOKEN) return;
  try {
    const [hotWaterRes, runningRes, runningStateRes, alertRes] = await Promise.allSettled([
      fetchHAState('sensor.heat_pump_water_heater_heat_pump_water_heater_available_hot_water'),
      fetchHAState('binary_sensor.heat_pump_water_heater_heat_pump_water_heater_running'),
      fetchHAState('sensor.heat_pump_water_heater_heat_pump_water_heater_running_state'),
      fetchHAState('sensor.heat_pump_water_heater_heat_pump_water_heater_alert_count'),
    ]);

    const hotWater = hotWaterRes.status === 'fulfilled' ? parseInt(hotWaterRes.value.state, 10) : null;
    const running  = runningRes.status === 'fulfilled'  ? runningRes.value.state === 'on' : false;
    const stateVal = runningStateRes.status === 'fulfilled' ? runningStateRes.value.state : '';
    const alerts   = alertRes.status === 'fulfilled'   ? parseInt(alertRes.value.state, 10) : 0;

    const value = hotWater !== null && !isNaN(hotWater) ? `${hotWater}%` : '—';

    let sub = '';
    if (stateVal && stateVal !== 'unknown' && stateVal !== 'unavailable' && stateVal !== '') {
      sub = stateVal;
    } else {
      sub = running ? 'Heating' : 'Idle';
    }

    const degraded = (hotWater !== null && !isNaN(hotWater) && hotWater < 30) || running;
    const alert    = !isNaN(alerts) && alerts > 0;

    cachedStatus.status.waterHeater = { label: 'Hot Water', icon: '🚿', value, sub, alert, degraded, done: false };
    console.log(`Water heater updated: ${value} (${sub})`);
  } catch (err) {
    console.error('Water heater fetch failed:', err.message);
  }
}

fetchWaterHeater().catch(() => {});
setInterval(() => fetchWaterHeater().catch(() => {}), 5 * 60 * 1000);

// ── Home Energy (Emporia Vue) ─────────────────────────────────────
async function fetchHomeEnergy() {
  if (!HA_TOKEN) return;
  try {
    const [powerRes, todayRes] = await Promise.allSettled([
      fetchHAState('sensor.edgecliff_power_minute_average'),
      fetchHAState('sensor.edgecliff_energy_today'),
    ]);

    const watts = powerRes.status === 'fulfilled' ? parseFloat(powerRes.value.state) : NaN;
    const today = todayRes.status === 'fulfilled' ? parseFloat(todayRes.value.state) : NaN;

    const value = !isNaN(watts) ? `${(watts / 1000).toFixed(1)} kW` : '—';
    const sub   = !isNaN(today) ? `${today.toFixed(1)} kWh today` : '';

    if (!isNaN(watts)) db.maybeLogEnergy('home', watts);

    cachedStatus.status.homeEnergy = { label: 'Home Energy', icon: '⚡', value, sub, alert: false, degraded: false };
    console.log(`Home energy updated: ${value} (${sub})`);
  } catch (err) {
    console.error('Home energy fetch failed:', err.message);
  }
}

fetchHomeEnergy().catch(() => {});
setInterval(() => fetchHomeEnergy().catch(() => {}), 30 * 1000);

// ── Pool Pump (Shelly EM Gen3) ─────────────────────────────────────
const POOL_PUMP_WATTS_THRESHOLD = 20; // matches the Shelly on-device ionizer script's threshold
let lastPumpWatts = NaN; // most recent pump reading, paired onto each pool heat sample

async function fetchPoolPump() {
  if (!HA_TOKEN) return;
  try {
    const res = await fetchHAState('sensor.shellyemg3_dcb4d9ce63a4_energy_meter_0_power');
    const watts = Math.abs(parseFloat(res.state));
    if (isNaN(watts)) throw new Error(`unexpected state: ${res.state}`);

    db.maybeLogEnergy('pool_pump', watts);
    lastPumpWatts = watts;

    const running = watts > POOL_PUMP_WATTS_THRESHOLD;
    const value = running ? 'Running' : 'Idle';
    const sub   = running ? `${Math.round(watts)}W` : '';

    cachedStatus.status.poolPump = { label: 'Pool Pump', icon: '🏊', value, sub, alert: false, degraded: false };
    console.log(`Pool pump updated: ${value} ${sub}`);
  } catch (err) {
    console.error('Pool pump fetch failed:', err.message);
  }
}

fetchPoolPump().catch(() => {});
setInterval(() => fetchPoolPump().catch(() => {}), 30 * 1000);

// ── Pool Heat Recovery logging (ESPHome pool pad node) ─────────────
// Capture only — no dashboard tile. Water temps move slowly, so 2 min is plenty.
// Flow GPM and BTU/hr stay null until the flow meter is installed; the columns
// exist now so they backfill themselves the day it goes in.
const POOL_PAD_ENTITIES = {
  hxIn:   'sensor.pool_pad_hx_water_in_temp',
  hxOut:  'sensor.pool_pad_hx_water_out_temp',
  flow:   'sensor.pool_pad_pool_flow_gpm',
  btu:    'sensor.pool_pad_pool_heat_btu_hr',
  active: 'binary_sensor.pool_pad_pool_heat_active',
  // Live 2026-08-28 — entity_id confirmed against the API, not guessed (this
  // project's own documented trap: HA derives it from the ESPHome `name` at
  // first registration, and it does not match the friendly name literally).
  filterPsi: 'sensor.infrawall_pool_pad_filter_pressure',
};

async function fetchPoolHeat() {
  if (!HA_TOKEN) return;
  try {
    const res = await fetchHAStates(POOL_PAD_ENTITIES);
    const state = Object.fromEntries(Object.entries(res).map(([k, v]) => [k, v.state]));

    // The pad node sleeps or drops off WiFi; a fully unavailable node is not a sample.
    if (state.hxIn === undefined && state.hxOut === undefined) {
      db.logError('pool_pad', 'unavailable', 'no HX temperatures from pool pad node');
      return;
    }
    db.resolveError('pool_pad', 'unavailable');

    db.logPoolHeat({
      hxInF:      haNum(state.hxIn),
      hxOutF:     haNum(state.hxOut),
      flowGpm:    haNum(state.flow),
      btuHr:      haNum(state.btu),
      heatActive: state.active === 'on',
      pumpWatts:  lastPumpWatts,
      filterPressure: haNum(state.filterPsi),
    });
  } catch (err) {
    console.error('Pool heat fetch failed:', err.message);
  }
}

fetchPoolHeat().catch(() => {});
setInterval(() => fetchPoolHeat().catch(() => {}), 2 * 60 * 1000);

// ── Pool page state ────────────────────────────────────────────────
const POOL_EXTRA_ENTITIES = {
  sweep:     'switch.pool_sweep_socket_1',
  sweepRan:  'input_boolean.sweep_ran_tonight',
};

// Pump energized but water not moving = running against a closed valve. Normal
// operation is 45-60 GPM (docs/pool_heat_recovery.md), so this is far below any
// legitimate reading and only trips on a hard stop, not on "low".
const FLOW_DEADHEAD_GPM = 10;

// The HA schedule runs 21:45-23:15. A run that ends materially short of that
// was cut off by something (breaker, Tuya round-trip failure, manual stop), and
// that is the whole point of showing the duration rather than a yes/no.
const SWEEP_FULL_MIN  = 90;
const SWEEP_SHORT_MIN = 80;

let _lastSweepOn = null;   // null until the first poll establishes a baseline

// Turns the stored run into what the tile and the pool card actually say.
function _describeSweep(run) {
  if (!run) return null;
  const mins = Math.round(run.duration_s / 60);
  const when = new Date(run.ended_at * 1000);
  const hh   = when.getHours() % 12 || 12;
  const mm   = String(when.getMinutes()).padStart(2, '0');
  const ampm = when.getHours() < 12 ? 'am' : 'pm';

  // Calendar days back, not elapsed/86400 — a run that ended at 11:15pm last
  // night is "last night" all of today, not "0 days ago" until 11:15pm.
  const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
  const daysAgo = Math.max(0, Math.ceil((midnight.getTime() - when.getTime()) / 86400000));

  const dayText = daysAgo === 0 ? 'Today' : daysAgo === 1 ? 'Last night' : `${daysAgo} days ago`;
  const ok = mins >= SWEEP_SHORT_MIN;

  return {
    endedAt: run.ended_at,
    durationMin: mins,
    daysAgo,
    ok,
    // Stale is a separate question from short: a full 90-min run three nights
    // ago still means the sweep is not running nightly.
    stale: daysAgo > 1,
    text: `${dayText} · ${mins} min`,
    detail: ok
      ? `Ran ${hh}:${mm}${ampm} for ${mins} min — full cycle`
      : `Ran ${hh}:${mm}${ampm} but stopped after ${mins} min of ${SWEEP_FULL_MIN}`,
  };
}

// Filter pressure only means something relative to the clean-filter baseline,
// which is recorded by hand after a backwash (POST /api/pool/set-filter-baseline)
// — there's no automatic "the filter is clean now" signal. Colors and the
// forecast both stay in a "not ready yet" state until that baseline exists.
const FILTER_WATTS_BAND_FRAC     = 0.15; // ±15% around the baseline's own watts
const FILTER_ALERT_PSI_OVER_BASE = 9;    // midpoint of the documented +8-10 psi window
const FILTER_TREND_MIN_DAYS      = 5;
const FILTER_TREND_MIN_SAMPLES   = 20;

// Least-squares slope over [unixSeconds, psi] points. Returns psi per second.
function _linearSlope(points) {
  const n = points.length;
  const sumX  = points.reduce((a, [x])    => a + x, 0);
  const sumY  = points.reduce((a, [, y])  => a + y, 0);
  const sumXY = points.reduce((a, [x, y]) => a + x * y, 0);
  const sumXX = points.reduce((a, [x])    => a + x * x, 0);
  const denom = n * sumXX - sumX * sumX;
  return denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;
}

function _describeFilterHealth(currentPsi) {
  const baseline = db.getFilterBaseline();

  if (!baseline) {
    return {
      value: currentPsi != null ? `${currentPsi.toFixed(1)} PSI` : '—',
      sub: 'Tap to set baseline after backwash',
      color: null, bg: null,
    };
  }
  if (currentPsi == null) {
    return { value: '—', sub: 'Pad node offline', color: null, bg: null };
  }

  const delta = currentPsi - baseline.baselinePsi;
  let color, bg, label;
  if (delta < 5)      { color = '#68e143'; bg = '#0a1a06'; label = 'Healthy'; }
  else if (delta < FILTER_ALERT_PSI_OVER_BASE - 1) { color = '#f0c040'; bg = '#1a1500'; label = 'Watch'; }
  else                { color = '#e53935'; bg = '#1a0000'; label = 'Backwash due'; }

  let sub = `${label} · building trend`;
  if (baseline.baselineWatts) {
    const low  = baseline.baselineWatts * (1 - FILTER_WATTS_BAND_FRAC);
    const high = baseline.baselineWatts * (1 + FILTER_WATTS_BAND_FRAC);
    const samples = db.getFilterTrendSamples(baseline.recordedAt, low, high);
    const spanDays = samples.length > 1
      ? (samples[samples.length - 1].recorded_at - samples[0].recorded_at) / 86400
      : 0;

    if (samples.length >= FILTER_TREND_MIN_SAMPLES && spanDays >= FILTER_TREND_MIN_DAYS) {
      const slopePerSec = _linearSlope(samples.map(s => [s.recorded_at, s.filter_pressure]));
      const thresholdPsi = baseline.baselinePsi + FILTER_ALERT_PSI_OVER_BASE;
      if (slopePerSec > 0.001 / 86400) {
        const daysLeft = Math.max(0, Math.round((thresholdPsi - currentPsi) / (slopePerSec * 86400)));
        sub = `${label} · ~${daysLeft}d to backwash`;
      } else {
        sub = `${label} · stable`;
      }
    }
  }

  return { value: `${currentPsi.toFixed(1)} PSI`, sub, color, bg };
}

async function fetchPoolStatus() {
  if (!HA_TOKEN) return;
  try {
    const res = await fetchHAStates({ ...POOL_PAD_ENTITIES, ...POOL_EXTRA_ENTITIES });
    const s = (k) => res[k]?.state;

    const hxInF   = haNum(s('hxIn'));
    const hxOutF  = haNum(s('hxOut'));
    const rawFilterPsi = haNum(s('filterPsi'));
    const filterPsi = isNaN(rawFilterPsi) ? null : +rawFilterPsi.toFixed(1);
    const padOnline = !isNaN(hxInF) || !isNaN(hxOutF);
    const deltaF  = !isNaN(hxInF) && !isNaN(hxOutF) ? +(hxOutF - hxInF).toFixed(1) : null;
    const heatActive = s('active') === 'on';

    // "No meter installed" and "meter reading zero" must NEVER be conflated.
    //
    // An unconnected pulse counter reports a real 0, not 'unavailable', so they
    // look identical from here — but they mean opposite things. Once the meter is
    // in, pump drawing current + zero flow is a DEADHEAD: the pump is running
    // against a closed valve, which damages the filter. Inferring "must be no
    // meter" from a zero would mask precisely that fault, so it takes an explicit
    // flag. Set POOL_FLOW_METER_INSTALLED=true in ~/homelab/.env on install day.
    const FLOW_METER_INSTALLED = process.env.POOL_FLOW_METER_INSTALLED === 'true';
    const rawFlow = haNum(s('flow'));
    const pumpRunning = lastPumpWatts > POOL_PUMP_WATTS_THRESHOLD;

    let flowStatus;   // 'no_meter' | 'deadhead' | 'ok'
    if (!FLOW_METER_INSTALLED) flowStatus = 'no_meter';
    else if (isNaN(rawFlow)) flowStatus = 'no_meter';
    // Conservative: multiply: 0.02201 in pool-pad.yaml is theoretical and
    // uncalibrated, so this only catches a hard zero-ish reading, not "low".
    // Recalibrate against the Blue-White gauge before tightening it.
    else if (pumpRunning && rawFlow < FLOW_DEADHEAD_GPM) flowStatus = 'deadhead';
    else flowStatus = 'ok';

    const flowLive = FLOW_METER_INSTALLED && !isNaN(rawFlow);

    // Record sweep runs on the switch's own transitions, from ANY source —
    // the HA schedule or a hand press. The question is "did the pool get
    // cleaned", same as the jeeves_sweep_ran_latch automation.
    //
    // _lastSweepOn starts null so the first poll after a restart only sets the
    // baseline. Treating a restart mid-run as a fresh start would log a run
    // that began at boot and report a falsely short duration.
    const sweepOn = s('sweep') === 'on';
    if (_lastSweepOn !== null && sweepOn !== _lastSweepOn) {
      if (sweepOn) db.openSweepRun();
      else         db.closeSweepRun();
    }
    _lastSweepOn = sweepOn;

    cachedStatus.pool = {
      flowStatus,
      waterTempF: isNaN(hxInF) ? null : +hxInF.toFixed(1),
      hxInF:      isNaN(hxInF) ? null : +hxInF.toFixed(1),
      hxOutF:     isNaN(hxOutF) ? null : +hxOutF.toFixed(1),
      deltaF,
      heatActive,
      flowLive,
      flowGpm:    flowLive ? +rawFlow.toFixed(1) : null,
      btuHr:      flowLive && !isNaN(haNum(s('btu'))) ? Math.round(haNum(s('btu'))) : null,
      padOnline,
      pumpRunning,
      pumpWatts:  isNaN(lastPumpWatts) ? null : Math.round(lastPumpWatts),
      sweepOn,
      sweepRanTonight: s('sweepRan') === 'on',
      // The durable answer to "did the last sweep go well". sweepRanTonight is
      // kept only for the 21:45-23:45 live window; it reads false all day.
      lastSweep: _describeSweep(db.getLastSweepRun()),
      filterPsi,
    };

    // Tile: filter pressure. Color/forecast both stay a plain placeholder
    // until a baseline is recorded (POST /api/pool/set-filter-baseline) — see
    // _describeFilterHealth. Tapping the tile opens the pool page, same as
    // poolPump/poolTemp, where the "set baseline" action actually lives.
    const fh = _describeFilterHealth(filterPsi);
    cachedStatus.status.filterHealth = {
      label: 'Filter', icon: '🌀',
      value: fh.value, sub: fh.sub,
      alert: false, degraded: false,
      color: fh.color, bg: fh.bg,
    };

    // Tile: water temp. The HX inlet probe is the pool water temperature.
    if (padOnline && !isNaN(hxInF)) {
      cachedStatus.status.poolTemp = {
        label: 'Pool Temp', icon: '🌡️',
        value: `${hxInF.toFixed(1)}°F`,
        sub: heatActive && deltaF !== null ? `Heat on · ${deltaF > 0 ? '+' : ''}${deltaF}°F` : 'Heat off',
        alert: false, degraded: false,
      };
    } else {
      cachedStatus.status.poolTemp = {
        label: 'Pool Temp', icon: '🌡️', value: '—', sub: 'Pad node offline',
        alert: false, degraded: true,
      };
    }
  } catch (err) {
    console.error('Pool status fetch failed:', err.message);
  }
}

fetchPoolStatus().catch(() => {});
setInterval(() => fetchPoolStatus().catch(() => {}), 30 * 1000);

// ── Alerts ─────────────────────────────────────────────────────────
// Level and runbook text are facts from docs/alerting_levels.md — HA doesn't
// expose them — so they live here. The open-alert flag entity is DERIVED from
// the key (input_boolean.alert_open_<key>), and the key must be a member of this
// registry, so nothing client-supplied ever reaches an entity_id.
const ALERT_REGISTRY = {
  booster_kill_failed: {
    level: 1,
    title: 'Pool booster running dry — kill FAILED',
    detector: 'binary_sensor.pool_booster_dry_run',
    action: 'Go kill the breaker for the sweep circuit now.',
  },
  booster_dry_run: {
    level: 2,
    title: 'Booster dry run caught and killed',
    detector: 'binary_sensor.pool_booster_dry_run',
    action: 'Check why the main pump was off during the sweep window.',
  },
  pump_off: {
    level: 2,
    title: 'Main pump unexpectedly off',
    detector: 'binary_sensor.pool_pump_unexpectedly_off',
    action: 'Check the breaker and the IntelliFlo panel.',
  },
  pad_offline: {
    level: 3,
    title: 'Pool pad node offline',
    detector: 'binary_sensor.pool_pad_node_offline',
    action: 'Power-cycle the ESP; check WiFi coverage at the pad.',
  },
  meter_offline: {
    level: 3,
    title: 'Pump power meter offline',
    detector: 'binary_sensor.pool_pump_meter_offline',
    action: 'Check the Shelly EM in the subpanel.',
  },
  hx_no_transfer: {
    level: 3,
    title: 'Heat exchanger not transferring',
    detector: 'binary_sensor.pool_hx_not_transferring',
    action: 'HX calling but ΔT ≤ 0 — check the trio circuit and probe seating.',
  },
  sweep_skipped: {
    level: 3,
    title: 'Sweep did not run tonight',
    detector: null, // nightly 11:45pm check, no live detector to re-read
    action: 'Check whether the pump ran ≥30 min before 9:45pm.',
  },
  hx_not_engaging: {
    level: 2,
    title: 'Heat recovery not engaging',
    detector: 'binary_sensor.pool_hx_not_engaging',
    action: 'AC cooling 10+ min, pool below setpoint, heat recovery never turned on — check the Tecmark flow switch / filter for a clog (common right after a backwash).',
  },

  // Garage — homeassistant/packages/jeeves_garage.yaml. No garage tile by
  // decision; these surface only through the alerts tile and the overlay.
  // The two L1s are both "the house is open and only a person can close it".
  garage_night_open: {
    level: 1,
    title: 'Garage opened overnight',
    detector: 'binary_sensor.garage_door_open',
    action: 'Account for everyone before going out. Close it from your phone.',
  },
  garage_close_failed: {
    level: 1,
    title: 'Garage would not close',
    detector: 'binary_sensor.garage_door_open',
    action: 'Clear the doorway — the safety beam is reversing it — then close it by hand.',
  },
  garage_open_daytime: {
    level: 2,
    title: 'Garage left open',
    detector: 'binary_sensor.garage_open_too_long',
    action: 'Close it, or confirm someone is out there using it.',
  },
  garage_node_offline: {
    level: 3,
    title: 'Garage controller offline',
    detector: 'binary_sensor.garage_node_offline',
    action: 'Check the ratgdo at http://192.168.0.230 and power-cycle it.',
  },
};

function _ageText(sinceMs) {
  if (!sinceMs) return '';
  const mins = Math.floor((Date.now() - sinceMs) / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m`;
  return `${Math.floor(hrs / 24)}d ${hrs % 24}h`;
}

async function fetchAlerts() {
  if (!HA_TOKEN) return;
  try {
    const keys = Object.keys(ALERT_REGISTRY);
    const map = {};
    for (const k of keys) map[`flag_${k}`] = `input_boolean.alert_open_${k}`;
    for (const k of keys) {
      if (ALERT_REGISTRY[k].detector) map[`det_${k}`] = ALERT_REGISTRY[k].detector;
    }

    const res = await fetchHAStates(map);

    const detail = [];
    for (const k of keys) {
      const flag = res[`flag_${k}`];
      if (!flag || flag.state !== 'on') continue;
      const reg = ALERT_REGISTRY[k];
      const sinceMs = Date.parse(flag.lastChanged);
      detail.push({
        key: k,
        level: reg.level,
        title: reg.title,
        action: reg.action,
        since: flag.lastChanged,
        ageText: _ageText(sinceMs),
        // The flag never clears on recovery, so "is this still broken?" is a
        // separate question from "is this still open". Null = no live detector.
        conditionActive: reg.detector ? res[`det_${k}`]?.state === 'on' : null,
      });
    }
    detail.sort((a, b) => a.level - b.level || Date.parse(a.since) - Date.parse(b.since));

    cachedStatus.alertDetail = detail;
    cachedStatus.alerts = detail.map((d) => `L${d.level} · ${d.title} (${d.ageText})`);

    // Tile. Colour by highest open level, using the inline color/bg mechanism the
    // AQI tiles use — the diff-patcher overwrites className every render, but
    // inline styles survive and override the class colours.
    const LEVEL_STYLE = {
      1: { color: '#e53935', bg: '#1a0000' },
      2: { color: '#ff6b35', bg: '#1a0a00' },
      3: { color: '#f0c040', bg: '#1a1500' },
    };
    const counts = detail.reduce((m, d) => ((m[d.level] = (m[d.level] || 0) + 1), m), {});
    const countText = Object.keys(counts).sort()
      .map((lv) => `${counts[lv]}× L${lv}`).join(' · ');

    if (detail.length === 0) {
      cachedStatus.status.alerts = {
        label: 'Alerts', icon: '🔔', value: 'All clear',
        sub: `${keys.length} checks passing`,
        alert: false, degraded: false,
      };
    } else {
      cachedStatus.status.alerts = {
        label: 'Alerts', icon: '🔔',
        value: `${detail.length} open`,
        sub: countText,
        alert: false, degraded: false,
        ...LEVEL_STYLE[detail[0].level],
      };
    }
  } catch (err) {
    console.error('Alerts fetch failed:', err.message);
  }
}

fetchAlerts().catch(() => {});
setInterval(() => fetchAlerts().catch(() => {}), 30 * 1000);

// ── Next Actions ───────────────────────────────────────────────────
// Recurring work, shown as a tile and promoted into a real chore tile on its due
// date. Source 1 (fixed cadence, below) is the only one built. Threshold-based
// (filter backwash, needs the pressure sensor) and chemistry-model-based
// projections append to the same array later and need no UI work.
const DAY_MS = 86400 * 1000;

function _relativeDay(dueMs) {
  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
  const days = Math.round((dueMs - startOfToday.getTime()) / DAY_MS);
  if (days < 0)  return days === -1 ? 'Yesterday · overdue' : `${-days} days overdue`;
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  const weekday = new Date(dueMs).toLocaleDateString('en-US', { weekday: 'long' });
  return days < 7 ? `${weekday} · in ${days} days` : `in ${days} days`;
}

// 1-indexed to match tasks.start_month / end_month.
const MONTH_ABBR = [null, 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function _ordinal(n) {
  const suffixes = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (suffixes[(v - 20) % 10] || suffixes[v] || suffixes[0]);
}

function refreshNextActions() {
  try {
    const actions = db.getTaskSchedule().map((t) => ({
      id: t.key,
      domain: t.domain,
      title: t.title,
      icon: t.icon,
      dueAt: t.dueAt,
      confidence: 'scheduled',
      // Seasonal tasks name their window. Without it "every 35 days" sitting
      // next to a due date five months out reads as a bug rather than a
      // closed season. Anchor tasks (days_of_month) name their fixed date(s)
      // instead of interval_days, which they ignore.
      basis: `${
        t.daysOfMonth
          ? `monthly on the ${t.daysOfMonth.map(_ordinal).join(' & ')}`
          : `every ${t.intervalDays} days`
      }${
        t.startMonth ? ` · ${MONTH_ABBR[t.startMonth]}–${MONTH_ABBR[t.endMonth]} only` : ''
      } · last done ${
        t.lastDoneAt ? new Date(t.lastDoneAt * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'never'
      }`,
      promoteOnDue: true,
    }));

    cachedStatus.nextActions = actions;

    const next = actions[0];
    if (!next) {
      cachedStatus.status.nextActions = {
        label: 'Next Up', icon: '🔮', value: 'Nothing due', sub: '',
        alert: false, degraded: false,
      };
      return;
    }
    const dueMs = next.dueAt * 1000;
    cachedStatus.status.nextActions = {
      label: 'Next Up', icon: '🔮',
      value: next.title,
      sub: _relativeDay(dueMs),
      alert: false,
      degraded: dueMs < Date.now(),
    };
  } catch (err) {
    console.error('Next actions refresh failed:', err.message);
  }
}

// Promotion: at 07:00 each day, anything due today (or overdue) becomes a chore
// tile via the existing _addChore path — tap to claim, PIN credit, scoreboard.
// _promotedTasks maps choreId → task key so completing the chore stamps
// last_done_at and the next due date recalculates.
const _promotedTasks = new Map();
let _lastPromotionDate = null;

function promoteDueTasks() {
  const now = Date.now();
  for (const action of cachedStatus.nextActions) {
    if (!action.promoteOnDue) continue;
    if (action.dueAt * 1000 > now) continue;
    // Already on the board? Don't stack duplicates across restarts or reruns.
    if ([..._promotedTasks.values()].includes(action.id)) continue;
    const choreId = _addChore(action.title, action.icon);
    _promotedTasks.set(choreId, action.id);
    console.log(`Promoted task "${action.title}" to chore ${choreId}`);
  }
}

refreshNextActions();
setInterval(() => {
  const now = new Date();
  const today = now.toDateString();
  if (now.getHours() === 7 && _lastPromotionDate !== today) {
    _lastPromotionDate = today;
    refreshNextActions();
    promoteDueTasks();
  }
}, 60 * 1000);

// ── BiblioCommons (RCPL library holds) ───────────────────────────
const BIBLIO_LIBRARY = 'rcpl';
const BIBLIO_CARD    = process.env.BIBLIO_CARD;
const BIBLIO_PIN     = process.env.BIBLIO_PIN;
const BIBLIO_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

let biblioSession = null; // { accessToken, sessionId, accountId, loginAt }

function _extractCookies(response) {
  const cookies = {};
  for (const cookie of (response.headers.getSetCookie?.() || [])) {
    const eqIdx = cookie.indexOf('=');
    const semi  = cookie.indexOf(';');
    if (eqIdx === -1) continue;
    const name  = cookie.slice(0, eqIdx).trim();
    const value = cookie.slice(eqIdx + 1, semi === -1 ? undefined : semi).trim();
    cookies[name] = value;
  }
  return cookies;
}

function _cookieStr(cookies) {
  return Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
}

async function _biblioLogin() {
  const loginUrl = `https://${BIBLIO_LIBRARY}.bibliocommons.com/user/login?destination=x`;

  const pageRes = await fetch(loginUrl, { redirect: 'follow' });
  if (!pageRes.ok) throw new Error(`BiblioCommons login page ${pageRes.status}`);
  const html = await pageRes.text();
  const pageCookies = _extractCookies(pageRes);

  // authenticity_token may have attributes in any order
  const tokenMatch = html.match(/name="authenticity_token"[^>]+value="([^"]+)"|value="([^"]+)"[^>]+name="authenticity_token"/);
  const authToken = tokenMatch?.[1] || tokenMatch?.[2];
  if (!authToken) throw new Error('BiblioCommons: authenticity_token not found');

  // POST with redirect:manual so the 302 Set-Cookie headers are accessible
  const loginRes = await fetch(loginUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': _cookieStr(pageCookies),
    },
    body: new URLSearchParams({ authenticity_token: authToken, name: BIBLIO_CARD, user_pin: BIBLIO_PIN }).toString(),
    redirect: 'manual',
  });

  const allCookies  = { ...pageCookies, ..._extractCookies(loginRes) };
  const accessToken = allCookies['bc_access_token'];
  const sessionId   = allCookies['session_id'];
  if (!accessToken || !sessionId) throw new Error('BiblioCommons: login failed — check BIBLIO_CARD/BIBLIO_PIN');

  const accountId = parseInt(sessionId.split('-').pop(), 10) + 1;
  biblioSession = { accessToken, sessionId, accountId, loginAt: Date.now() };
  console.log(`BiblioCommons: logged in, accountId=${accountId}`);
}

async function _biblioGet(path, params = {}) {
  const { accessToken, sessionId, accountId } = biblioSession;
  const url = new URL(`https://gateway.bibliocommons.com/v2/libraries/${BIBLIO_LIBRARY}${path}`);
  url.searchParams.set('accountId', accountId);
  url.searchParams.set('size', '100');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), {
    headers: { 'X-Access-Token': accessToken, 'X-Session-Id': sessionId, 'Accept': 'application/json' },
  });
  if (res.status === 401) { biblioSession = null; throw new Error('BiblioCommons 401'); }
  if (!res.ok) throw new Error(`BiblioCommons ${path} ${res.status}`);
  return res.json();
}

async function fetchBiblio() {
  if (!BIBLIO_CARD || !BIBLIO_PIN) return;
  try {
    if (!biblioSession || Date.now() - biblioSession.loginAt > BIBLIO_SESSION_TTL_MS) {
      await _biblioLogin();
    }

    const [holdsData, checkoutsData] = await Promise.all([
      _biblioGet('/holds'),
      _biblioGet('/checkouts'),
    ]);

    // ── Holds tile ─────────────────────────────────────────────────
    const holds = Object.values(holdsData?.entities?.holds || {});
    const holdBibs = holdsData?.entities?.bibs || {};
    const ready       = holds.filter(h => h.status === 'READY_FOR_PICKUP');
    const readyTitles = ready.map(h => holdBibs[h.metadataId]?.briefInfo?.title || 'Unknown');

    const readyHolds = ready
      .map(h => ({
        title:     (h.bibTitle || 'Unknown').split(' / ')[0],
        branch:    (h.pickupLocation?.name || '').trim(),
        pickupBy:  h.pickupByDate || null,
      }))
      .sort((a, b) => (a.pickupBy || '').localeCompare(b.pickupBy || ''));

    let holdsValue, holdsSub;
    let holdsAlert = false, holdsDegraded = false, holdsDone = false;
    if (ready.length > 0) {
      holdsValue = `${ready.length} Ready`;
      holdsSub   = readyTitles.slice(0, 2).join(', ') + (readyTitles.length > 2 ? '…' : '');

      const soonestPickupBy = readyHolds[0]?.pickupBy;
      const daysLeft = soonestPickupBy
        ? Math.ceil((new Date(soonestPickupBy + 'T23:59:59') - new Date()) / 86400000)
        : -1; // no date on record — treat as urgent

      if (daysLeft <= 3)      holdsAlert    = true;
      else if (daysLeft <= 6) holdsDegraded = true;
      else                    holdsDone     = true;
    } else if (holds.length > 0) {
      holdsValue = `${holds.length} Waiting`;
      holdsSub   = '';
    } else {
      holdsValue = 'No Holds';
      holdsSub   = '';
    }
    cachedStatus.status.library = { label: 'Library', icon: '📚', value: holdsValue, sub: holdsSub, alert: holdsAlert, degraded: holdsDegraded, done: holdsDone, readyHolds };

    // ── Books Out tile ─────────────────────────────────────────────
    const checkouts = Object.values(checkoutsData?.entities?.checkouts || {});
    checkouts.sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''));

    const todayStr   = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
    const soonCutoff = new Date(); soonCutoff.setDate(soonCutoff.getDate() + 5);
    const soonStr    = soonCutoff.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });

    const overdue          = checkouts.filter(c => c.dueDate < todayStr || c.fines > 0);
    const nonRenewableSoon = checkouts.filter(c => c.dueDate <= soonStr && !(c.actions ?? []).includes('renew'));

    const booksAlert    = overdue.length > 0;
    const booksDegraded = !booksAlert && nonRenewableSoon.length > 0;

    let booksValue = checkouts.length > 0 ? `${checkouts.length} Out` : 'None Out';
    let booksSub   = '';
    if (checkouts.length > 0) {
      const soonest = new Date(checkouts[0].dueDate + 'T12:00:00');
      const label   = soonest.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Los_Angeles' });
      booksSub = `Due ${label}`;
    }
    const checkedOut = checkouts.map(c => ({
      title:     (c.bibTitle || 'Unknown').split(' / ')[0],
      branch:    (c.branch?.name || '').trim(),
      dueDate:   c.dueDate || null,
      overdue:   c.dueDate < todayStr || c.fines > 0,
      renewable: (c.actions ?? []).includes('renew'),
    }));

    cachedStatus.status.booksOut = { label: 'Books Out', icon: '📖', value: booksValue, sub: booksSub, alert: booksAlert, degraded: booksDegraded, done: false, checkedOut };

    console.log(`BiblioCommons updated: holds=${holdsValue}, books=${booksValue}`);
  } catch (err) {
    if (err.message === 'BiblioCommons 401') {
      // session expired — retry once with fresh login
      try { await _biblioLogin(); return fetchBiblio(); } catch (e2) { /* fall through */ }
    }
    biblioSession = null;
    console.error('BiblioCommons fetch failed:', err.message);
  }
}

fetchBiblio().catch(() => {});

let lastBiblioDate = null;
setInterval(() => {
  const now = new Date();
  if (now.getHours() === 2 && now.getMinutes() === 0) {
    const today = now.toDateString();
    if (lastBiblioDate !== today) {
      lastBiblioDate = today;
      fetchBiblio().catch(() => {});
    }
  }
}, 60 * 1000);

// ── Batteries ─────────────────────────────────────────────────────
// Auto-discovered, not hand-listed. HA's own built-in Maintenance dashboard
// (2026.5+) does the same thing: every sensor with device_class "battery",
// sorted worst-first, no per-device config. device_class is a plain state
// attribute — visible on the same /api/states call used everywhere else in
// this file, no entity registry or WebSocket API needed. A new battery
// entity in HA just shows up here on the next poll.
//
// Only two things stay explicit, because HA has no signal for either:
//   - PINNED: which devices are always shown regardless of charge. That's a
//     judgment call ("the cars", decision 2026-08-23), not a discoverable fact.
//   - ICONS: cosmetic only. Anything not listed gets the default 🔋.
// Charging (blue) has no house-wide standard signal either — none of these
// integrations use HA's binary_sensor device_class "battery_charging" — so
// it's inferred by looking for a sibling entity sharing the same entity_id
// prefix (sensor.<prefix>_charging or _battery_state) and checking whether
// its state is exactly "charging" (case-insensitive, so "Not Charging"
// correctly reads as false, not a substring match on "charging"). A device
// with no such sibling just never shows as charging — never wrong, just less complete.
const BATTERY_PINNED = new Set(['sensor.dusty_battery_level', 'sensor.snorlax_battery_level']);
const BATTERY_ICONS = {
  'sensor.dusty_battery_level':       '🚗',
  'sensor.snorlax_battery_level':     '🚗',
  'sensor.front_door_battery':        '🔔',
  'sensor.front_front_door_battery':  '🔒',
  'sensor.ipad_battery_level':        '📱',
};

async function fetchBatteries() {
  if (!HA_TOKEN) return;

  const res = await fetch(`${HA_URL}/api/states`, {
    headers: { Authorization: `Bearer ${HA_TOKEN}` },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`HA API ${res.status} fetching /api/states`);
  const all = await res.json();
  const byId = new Map(all.map(e => [e.entity_id, e]));

  const devices = all
    .filter(e => e.attributes?.device_class === 'battery' && !isNaN(parseFloat(e.state)))
    .map(e => {
      const prefix  = e.entity_id.replace(/^sensor\./, '').replace(/_battery(_level)?$/, '');
      const chgEnt  = byId.get(`sensor.${prefix}_charging`) || byId.get(`sensor.${prefix}_battery_state`);
      const charging = chgEnt?.state?.toLowerCase() === 'charging';

      return {
        key:     e.entity_id,
        label:   (e.attributes.friendly_name || e.entity_id).replace(/\s*Battery( Level)?$/i, ''),
        icon:    BATTERY_ICONS[e.entity_id] || '🔋',
        pinned:  BATTERY_PINNED.has(e.entity_id),
        pct:     Math.round(parseFloat(e.state)),
        charging,
        lastChanged: e.last_changed || null,
      };
    });

  const lowest = devices.reduce((min, d) => Math.min(min, d.pct), 100);
  cachedStatus.status.batteries = {
    label: 'Batteries', icon: '🔋',
    value: devices.length ? `${lowest}% lowest` : '—',
    sub: devices.length ? `${devices.length} devices` : '',
    alert: false, degraded: lowest < 20,
    devices,
  };
}

fetchBatteries().catch(err => console.error('Batteries fetch failed:', err));
setInterval(() => fetchBatteries().catch(err => console.error('Batteries fetch failed:', err)), 5 * 60 * 1000);

// ── Now Playing (Mac mini Music bridge) ──────────────────────────
// Mac mini. Pin this in the router's DHCP reservations — the 2026-08-18 power
// outage moved the lease from .204 to .203 and silently killed the Now Playing tile.
const MUSIC_BRIDGE_URL = 'http://192.168.0.203:8181';

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

// ── Calendar (HA Google Calendar API) ────────────────────────────
const CALENDAR_ENTITY = 'calendar.matthew_drazba';
const CAL_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

async function fetchCalendar() {
  if (!HA_TOKEN) return;

  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());

  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // HA calendar API expects local-time ISO strings (no Z / offset)
  const pad = n => String(n).padStart(2, '0');
  const fmtLocal = d =>
    `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;

  const url = `${HA_URL}/api/calendars/${CALENDAR_ENTITY}` +
    `?start=${encodeURIComponent(fmtLocal(weekStart))}&end=${encodeURIComponent(fmtLocal(weekEnd))}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${HA_TOKEN}` },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`HA Calendar ${res.status}`);
  const events = await res.json();

  const days = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(weekStart);
    date.setDate(weekStart.getDate() + i);
    const dateStr = `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`;
    return {
      date: dateStr,
      dayName: CAL_DAYS[i],
      dayNum: date.getDate(),
      isToday: date.getTime() === today.getTime(),
      events: [],
    };
  });

  for (const ev of events) {
    const allDay = !!ev.start?.date;
    if (allDay) {
      // HA returns date strings directly: "2026-07-13" — no TZ conversion needed
      const startStr = ev.start.date;
      const endStr   = ev.end?.date;   // exclusive end
      for (const day of days) {
        const covers = endStr ? (day.date >= startStr && day.date < endStr) : day.date === startStr;
        if (covers) day.events.push({ title: ev.summary || '(No title)', time: null, allDay: true, sortKey: -1 });
      }
    } else {
      // dateTime includes UTC offset — new Date() handles it correctly
      const d = new Date(ev.start.dateTime);
      const midnight = new Date(d);
      midnight.setHours(0, 0, 0, 0);
      const idx = Math.round((midnight - weekStart) / 86400000);
      if (idx < 0 || idx >= 7) continue;
      const timeStr = d.toLocaleTimeString('en-US', {
        hour: 'numeric', minute: '2-digit', hour12: true,
        timeZone: 'America/Los_Angeles',
      });
      days[idx].events.push({
        title: ev.summary || '(No title)',
        time: timeStr,
        allDay: false,
        sortKey: d.getHours() * 60 + d.getMinutes(),
      });
    }
  }

  for (const day of days) {
    day.events.sort((a, b) => a.sortKey - b.sortKey);
  }

  cachedStatus.calendar = { days };
  cachedStatus.updatedAt = new Date().toISOString();
  console.log(`Calendar updated: ${events.length} events`);
}

fetchCalendar().catch(err => console.error('Calendar fetch failed:', err));
setInterval(() => fetchCalendar().catch(err => console.error('Calendar fetch failed:', err)), 5 * 60 * 1000);

// "Today" tile: next up to 3 upcoming events, computed fresh each request
// so it reflects the current time even between 5-min calendar refreshes.
function computeUpNext() {
  const days = cachedStatus.calendar?.days || [];
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const todayStr = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;
  const today = days.find(d => d.date === todayStr);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  const upcoming = today
    ? today.events.filter(ev => ev.allDay || ev.sortKey >= nowMinutes).slice(0, 3)
    : [];

  return {
    label: 'Today',
    icon: '🗓️',
    value: upcoming.length ? `${upcoming.length} Upcoming` : 'All Clear',
    sub: upcoming.length ? (upcoming[0].allDay ? upcoming[0].title : `Next: ${upcoming[0].time}`) : '',
    alert: false,
    degraded: false,
    done: upcoming.length === 0,
    events: upcoming.map(ev => ({ time: ev.allDay ? 'All day' : ev.time, title: ev.title })),
  };
}

// ── Routes ────────────────────────────────────────────────────────
// no-store: the kiosk tablet's WebView must never serve dashboard.html from
// its own cache. Fully Kiosk's "Reload on Screen On"/"Auto Reload on Idle"
// just re-navigate to the same URL — without this, that "reload" can be
// satisfied entirely from local cache and the tablet keeps running whatever
// JS was current the last time it made a real request, silently missing any
// dashboard feature shipped since. Single small HTML file on a LAN — no
// caching upside to trade away.
app.use(express.static(join(__dirname, 'public'), {
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-store'),
}));

app.get('/', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'dashboard.html'));
});

app.get('/api/status', (req, res) => {
  res.json({ ...cachedStatus, status: { ...cachedStatus.status, upNext: computeUpNext() } });
});

app.get('/api/history/:appliance', (req, res) => {
  const { appliance } = req.params;
  const limit = Math.min(parseInt(req.query.limit) || 10, 100);
  res.json({ appliance, cycles: db.getRecentCycles(appliance, limit) });
});

app.get('/api/errors', (req, res) => {
  res.json({ errors: db.getOpenErrors() });
});

// Acknowledging clears the open-alert flag in HA — the same thing the
// Acknowledge button on the phone notification does. The key must be a registry
// member, so the entity_id can never be built from arbitrary input.
app.post('/api/alerts/:key/ack', express.json(), async (req, res) => {
  const { key } = req.params;
  if (!Object.hasOwn(ALERT_REGISTRY, key)) {
    return res.status(400).json({ error: 'Unknown alert' });
  }
  try {
    await callHAService('input_boolean', 'turn_off', `input_boolean.alert_open_${key}`);
    await fetchAlerts();               // reflect it now, don't wait for the 30s poll
    console.log(`Alert "${key}" acknowledged from the dashboard`);
    res.json({ ok: true, alerts: cachedStatus.alerts, alertDetail: cachedStatus.alertDetail });
  } catch (err) {
    console.error('Alert ack failed:', err.message);
    res.status(502).json({ error: 'HA service call failed' });
  }
});

app.get('/api/pool/history', (req, res) => {
  const hours = Math.min(Math.max(parseInt(req.query.hours) || 24, 1), 168);
  const sinceTs = Math.floor((Date.now() - hours * 3600 * 1000) / 1000);
  res.json({ hours, samples: db.getPoolHeatSamples(sinceTs) });
});

// Manual — recorded once, right after a backwash. There's no automatic
// "filter is clean now" signal to detect this from, so a person has to say so.
app.post('/api/pool/set-filter-baseline', express.json(), (req, res) => {
  const psi = cachedStatus.pool?.filterPsi;
  if (psi == null) {
    return res.status(409).json({ error: 'No live filter pressure reading right now — try again once the pad node is online.' });
  }
  const watts = cachedStatus.pool?.pumpWatts ?? null;
  const baseline = db.setFilterBaseline(psi, watts);
  console.log(`Filter baseline set: ${psi} PSI @ ${watts ?? '—'} W`);
  res.json({ ok: true, baseline });
});

function refreshScoreboard() {
  const sinceTs = Math.floor((Date.now() - 7 * 24 * 60 * 60 * 1000) / 1000);
  const credits = db.getWeeklyCredits(sinceTs);
  const members = credits.map(m => ({ name: m.name, count: m.count }));
  const withCredits = members.filter(m => m.count > 0);
  const value = withCredits.length === 0
    ? 'All square'
    : withCredits.map(m => `${m.name} ${m.count}`).join(' · ');
  cachedStatus.status.scoreboard = { label: 'Chores', icon: '🏆', value, sub: 'This week', members, alert: false, degraded: false };
}

refreshScoreboard();

function _dismissAppliance(appliance) {
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
    return false;
  }
  return true;
}

// ── Chore tiles ───────────────────────────────────────────────────
let _choreIdCounter = 1;

function _addChore(name, icon) {
  const id = _choreIdCounter++;
  cachedStatus.status[`chore_${id}`] = {
    label: name, icon: icon || '🧹', value: 'Tap to claim!',
    isChore: true, choreId: id,
    alert: false, degraded: false, done: false,
  };
  return id;
}

function _removeChore(id) {
  delete cachedStatus.status[`chore_${id}`];
}

app.get('/api/chores/presets', (req, res) => {
  try {
    res.json(JSON.parse(readFileSync('/app/chores.json', 'utf-8')));
  } catch {
    res.json([]);
  }
});

app.post('/api/chores', express.json(), (req, res) => {
  const { name, icon } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: 'name required' });
  const id = _addChore(name.trim(), icon);
  res.json({ ok: true, choreId: id });
});

app.post('/api/chores/:id/complete', express.json(), async (req, res) => {
  const id  = parseInt(req.params.id);
  const key = `chore_${id}`;
  const { pin } = req.body || {};
  if (!cachedStatus.status[key]) return res.status(404).json({ error: 'Chore not found' });
  if (!pin) return res.status(400).json({ error: 'pin required' });
  const choreName  = cachedStatus.status[key].label;
  const creditedTo = await db.recordCredit(pin, choreName);
  if (!creditedTo) return res.json({ ok: false, creditedTo: null });
  _removeChore(id);
  refreshScoreboard();

  // If this chore was promoted from a recurring task, restart that task's clock.
  const taskKey = _promotedTasks.get(id);
  if (taskKey) {
    db.markTaskDone(taskKey);
    _promotedTasks.delete(id);
    refreshNextActions();
    console.log(`Task "${taskKey}" marked done — next due date recalculated`);
  }

  console.log(`Chore "${choreName}" completed by ${creditedTo}`);
  res.json({ ok: true, creditedTo });
});

app.delete('/api/chores/:id', (req, res) => {
  const id = parseInt(req.params.id);
  // Deleting a promoted chore dismisses it from the board but does NOT mark the
  // task done — it's still due, so it re-promotes tomorrow. Marking it done
  // would falsify the maintenance record.
  _promotedTasks.delete(id);
  _removeChore(id);
  res.json({ ok: true });
});

app.post('/api/dismiss/:appliance', express.json(), async (req, res) => {
  const { appliance } = req.params;
  const { pin } = req.body || {};

  if (pin) {
    // With PIN: only dismiss if PIN is valid
    const creditedTo = await db.recordCredit(pin, appliance);
    if (!creditedTo) return res.json({ ok: false, creditedTo: null }); // wrong PIN
    if (!_dismissAppliance(appliance)) return res.status(400).json({ error: 'Unknown appliance' });
    refreshScoreboard();
    console.log(`${appliance} dismissed by ${creditedTo}`);
    return res.json({ ok: true, creditedTo });
  }

  // No PIN (skip): always dismiss
  if (!_dismissAppliance(appliance)) return res.status(400).json({ error: 'Unknown appliance' });
  console.log(`${appliance} dismissed (no credit)`);
  res.json({ ok: true, creditedTo: null });
});

// ── Test helper (LAN only) ────────────────────────────────────────
app.post('/api/test/done/:appliance', (req, res) => {
  const { appliance } = req.params;
  if (appliance === 'washer')     { washerDone = true;     cachedStatus.status.washer     = { ...cachedStatus.status.washer,     value: 'Done!', done: true }; }
  else if (appliance === 'dryer') { dryerDone = true;      cachedStatus.status.dryer      = { ...cachedStatus.status.dryer,      value: 'Done!', done: true }; }
  else if (appliance === 'dishwasher') { dishwasherDone = true; cachedStatus.status.dishwasher = { ...cachedStatus.status.dishwasher, value: 'Done!', done: true }; }
  else return res.status(400).json({ error: 'unknown' });
  res.json({ ok: true });
});

// ── Voice ─────────────────────────────────────────────────────────
async function dispatchVoice(text) {
  const t = text.toLowerCase();

  if (/(dismiss|done).*(washer)|(washer).*(dismiss|done)/.test(t)) {
    _dismissAppliance('washer');
    return { action: 'dismiss_washer', responseText: 'Washer dismissed.' };
  }
  if (/(dismiss|done).*(dryer)|(dryer).*(dismiss|done)/.test(t)) {
    _dismissAppliance('dryer');
    return { action: 'dismiss_dryer', responseText: 'Dryer dismissed.' };
  }
  if (/(dismiss|done).*(dishwasher)|(dishwasher).*(dismiss|done)/.test(t)) {
    _dismissAppliance('dishwasher');
    return { action: 'dismiss_dishwasher', responseText: 'Dishwasher dismissed.' };
  }
  if (/what.*time|time.*is.*it/.test(t)) {
    const timeStr = new Date().toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/Los_Angeles',
    });
    return { action: 'time', responseText: `It's ${timeStr}.` };
  }

  // Tier 2: HA Assist
  if (HA_TOKEN) {
    try {
      const haRes = await fetch(`${HA_URL}/api/conversation/process`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${HA_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, language: 'en' }),
        signal: AbortSignal.timeout(5000),
      });
      if (haRes.ok) {
        const data = await haRes.json();
        const speech = data?.response?.speech?.plain?.speech;
        if (speech) return { action: 'ha_assist', responseText: speech };
      }
    } catch (err) {
      console.error('HA Assist error:', err.message);
    }
  }

  return { action: 'no_match', responseText: "I didn't catch that. Try again." };
}

app.post('/api/voice', express.raw({ type: 'audio/*', limit: '10mb' }), async (req, res) => {
  try {
    const transcribeRes = await fetch(`${VOICE_SERVICE_URL}/transcribe`, {
      method: 'POST',
      headers: { 'Content-Type': req.headers['content-type'] || 'audio/webm' },
      body: req.body,
      signal: AbortSignal.timeout(15000),
    });
    if (!transcribeRes.ok) throw new Error(`Voice service ${transcribeRes.status}`);
    const { text } = await transcribeRes.json();

    if (!text) return res.json({ action: 'no_speech', silent: true });

    const { action, responseText } = await dispatchVoice(text);
    console.log(`Voice: "${text}" → ${action}`);

    const hour = new Date().getHours();
    if (hour >= 22 || hour < 6) return res.json({ action, silent: true });

    const speakRes = await fetch(`${VOICE_SERVICE_URL}/speak`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: responseText }),
      signal: AbortSignal.timeout(10000),
    });
    if (!speakRes.ok) throw new Error(`TTS ${speakRes.status}`);

    const audio = Buffer.from(await speakRes.arrayBuffer()).toString('base64');
    res.json({ action, audio });
  } catch (err) {
    console.error('Voice error:', err.message);
    res.json({ action: 'error', silent: true });
  }
});

// ── Chat (Ollama) ─────────────────────────────────────────────────
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://ollama:11434';
const CHAT_MODEL = 'llama3.2:3b';
const CHAT_SYSTEM = `You are Jeeves, a smart home assistant for a house in Redwood City, CA. \
Answer questions concisely and practically. The home has: a Samsung washer, LG dryer, \
dishwasher (monitored via power draw), Rheem heat pump water heater, Resideo T10 Pro thermostat, \
August Smart Lock, Tesla vehicles named Dusty (white) and Snorlax (blue), Bhyve sprinkler system, \
TP-Link Kasa smart outlets, and Tuya window shades. Home automation runs on Home Assistant.`;

app.post('/api/chat', express.json(), async (req, res) => {
  const { message, history = [] } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: 'message required' });

  const context = getContext(message.trim());
  const systemContent = context ? `${CHAT_SYSTEM}\n\n${context}` : CHAT_SYSTEM;

  const messages = [
    { role: 'system', content: systemContent },
    ...history.slice(-10),
    { role: 'user', content: message.trim() },
  ];

  let ollamaRes;
  try {
    ollamaRes = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: CHAT_MODEL, messages, stream: true, options: { num_predict: 400 } }),
    });
  } catch (err) {
    console.error('Chat connect error:', err.message);
    const msg = err.code === 'ECONNREFUSED' ? 'Chat service starting up' : 'Chat unavailable';
    return res.status(503).json({ error: msg });
  }

  if (ollamaRes.status === 404) return res.status(503).json({ error: 'Model not ready — run: docker exec ollama ollama pull llama3.2:3b' });
  if (!ollamaRes.ok) return res.status(503).json({ error: `Ollama ${ollamaRes.status}` });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const reader = ollamaRes.body.getReader();
  const decoder = new TextDecoder();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const line of decoder.decode(value).split('\n')) {
        if (!line.trim()) continue;
        try {
          const data = JSON.parse(line);
          if (data.message?.content) {
            res.write(`data: ${JSON.stringify({ token: data.message.content })}\n\n`);
          }
          if (data.done) {
            res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
          }
        } catch { /* partial JSON line, skip */ }
      }
    }
  } catch (err) {
    console.error('Chat stream error:', err.message);
  } finally {
    res.end();
  }
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

loadDocs().catch(err => console.error('RAG load failed:', err));
db.seedMembers(process.env.MEMBERS).catch(err => console.error('Member seed failed:', err));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Jeeves running on http://0.0.0.0:${PORT}`);
});
