// @ts-check
import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

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
    laundry: { label: 'Laundry', icon: '🫧', value: 'Idle', alert: false, degraded: false },
  },
  alerts: [],
  updatedAt: new Date().toISOString(),
};

// Fetch weather on startup, then every 10 minutes
fetchWeather().catch(err => console.error('Weather fetch failed:', err));
setInterval(() => fetchWeather().catch(err => console.error('Weather fetch failed:', err)), 10 * 60 * 1000);

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
