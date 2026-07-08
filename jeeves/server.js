// @ts-check
import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// In-memory status cache — stub data until real sources are wired up.
// When adding a real data source, replace the relevant fields here and
// set up a setInterval to refresh them on a schedule.
let cachedStatus = {
  weather: {
    location: 'Home',
    temp: 72,
    condition: 'Sunny',
    high: 78,
    low: 60,
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
