// @ts-check
/**
 * state.js — centralized cache (replaces module-level globals).
 *
 * All mutable application state lives here. server.js imports these
 * bindings and mutates them in place. Extracted from server.js as part
 * of the decomposition (roadmap #4, phase 2).
 */

import { LOCATION } from './config.js';

// ── Main status cache ──────────────────────────────────────────────
// Mutated extensively by polling functions, never reassigned.
export let cachedStatus = {
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

// ── Washer ────────────────────────────────────────────────────────
export const washer = { prevState: 'stop', done: false, cycleId: null, recovered: false };

// ── Dishwasher ────────────────────────────────────────────────────
export const dishwasher = { wasRunning: false, done: false, belowSince: null, peakWatts: 0, cycleId: null, recovered: false };

// ── Dryer ─────────────────────────────────────────────────────────
export const dryer = { done: false, lastEventTime: null, cycleId: null, recovered: false };

// ── Pool ──────────────────────────────────────────────────────────
export const pool = { lastPumpWatts: NaN, lastSweepOn: null };

// ── Task promotion ──────────────────────────────────────────────
// Maps choreId → task key so completing the chore stamps last_done_at
// and the next due date recalculates.
export const promotionTasks = new Map();
export let lastPromotionDate = null;

// ── BiblioCommons ─────────────────────────────────────────────────
export const biblio = { session: null, lastDate: null }; // session: { accessToken, sessionId, accountId, loginAt }

// ── Chores ────────────────────────────────────────────────────────
export const chores = { idCounter: 1 };

// ── Reports ───────────────────────────────────────────────────────
export const report = { lastDate: null };
