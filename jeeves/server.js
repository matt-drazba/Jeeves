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
    washer:     { label: 'Washer',      icon: '🫧', value: 'Idle', alert: false, degraded: false },
    dryer:      { label: 'Dryer',       icon: '🌀', value: 'Idle', alert: false, degraded: false },
    aqiIn:      { label: 'AQI In',      icon: '🏠', value: '—',    alert: false, degraded: false },
    aqiOut:     { label: 'AQI Out',     icon: '🌿', value: '—',    alert: false, degraded: false },
    dishwasher: { label: 'Dishwasher',  icon: '🍽️', value: 'Idle', alert: false, degraded: false },
    sprinklers:   { label: 'Sprinklers',   icon: '💧', value: '—',    alert: false, degraded: false },
    waterHeater:  { label: 'Hot Water',    icon: '🚿', value: '—',    sub: '', alert: false, degraded: false },
    library:      { label: 'Library',      icon: '📚', value: '—',    sub: '', alert: false, degraded: false },
    booksOut:     { label: 'Books Out',    icon: '📖', value: '—',    sub: '', alert: false, degraded: false },
    nowPlaying: { label: 'Now Playing', icon: '🎵', value: '—',    sub: '', alert: false, degraded: false },
    dusty:      { label: 'Dusty',       icon: '🚗', value: '—',    sub: '', alert: false, degraded: false },
    snorlax:    { label: 'Snorlax',     icon: '🚗', value: '—',    sub: '', alert: false, degraded: false },
    scoreboard: { label: 'Chores',      icon: '🏆', value: '—',    sub: 'This week', members: [], alert: false, degraded: false },
  },
  alerts: [],
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

    let holdsValue, holdsSub;
    if (ready.length > 0) {
      holdsValue = `${ready.length} Ready`;
      holdsSub   = readyTitles.slice(0, 2).join(', ') + (readyTitles.length > 2 ? '…' : '');
    } else if (holds.length > 0) {
      holdsValue = `${holds.length} Waiting`;
      holdsSub   = '';
    } else {
      holdsValue = 'No Holds';
      holdsSub   = '';
    }
    cachedStatus.status.library = { label: 'Library', icon: '📚', value: holdsValue, sub: holdsSub, alert: ready.length > 0, degraded: false, done: false };

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
    cachedStatus.status.booksOut = { label: 'Books Out', icon: '📖', value: booksValue, sub: booksSub, alert: booksAlert, degraded: booksDegraded, done: false };

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
  console.log(`Chore "${choreName}" completed by ${creditedTo}`);
  res.json({ ok: true, creditedTo });
});

app.delete('/api/chores/:id', (req, res) => {
  _removeChore(parseInt(req.params.id));
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
