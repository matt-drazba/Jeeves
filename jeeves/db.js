// @ts-check
import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';

const DB_PATH = process.env.DB_PATH || '/data/jeeves.db';
mkdirSync('/data', { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('busy_timeout = 5000');

// ── Schema migrations ──────────────────────────────────────────────

function migrate() {
  const v = db.pragma('user_version', { simple: true });
  if (v < 1) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS devices (
        id    INTEGER PRIMARY KEY,
        name  TEXT NOT NULL UNIQUE,
        kind  TEXT NOT NULL
      );
      INSERT OR IGNORE INTO devices (name, kind) VALUES
        ('washer',     'consumption'),
        ('dryer',      'consumption'),
        ('dishwasher', 'consumption');

      CREATE TABLE IF NOT EXISTS appliance_cycles (
        id          INTEGER PRIMARY KEY,
        appliance   TEXT NOT NULL,
        started_at  INTEGER NOT NULL,
        ended_at    INTEGER,
        duration_s  INTEGER,
        peak_watts  REAL,
        kwh         REAL,
        end_reason  TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_cycles_appliance_started
        ON appliance_cycles(appliance, started_at);

      CREATE TABLE IF NOT EXISTS energy_readings (
        id          INTEGER PRIMARY KEY,
        device_id   INTEGER NOT NULL REFERENCES devices(id),
        recorded_at INTEGER NOT NULL,
        watts       INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_energy_device_recorded
        ON energy_readings(device_id, recorded_at);

      CREATE TABLE IF NOT EXISTS behavior_errors (
        id               INTEGER PRIMARY KEY,
        source           TEXT NOT NULL,
        error_type       TEXT NOT NULL,
        detail           TEXT,
        occurred_at      INTEGER NOT NULL,
        last_seen_at     INTEGER NOT NULL,
        occurrence_count INTEGER NOT NULL DEFAULT 1,
        resolved_at      INTEGER
      );
    `);
    db.pragma('user_version = 1');
    console.log('DB: migrated to v1');
  }
}

migrate();

// ── Cycle tracking ─────────────────────────────────────────────────

const _openCycle   = db.prepare('INSERT INTO appliance_cycles (appliance, started_at) VALUES (?, ?)');
const _getStarted  = db.prepare('SELECT started_at FROM appliance_cycles WHERE id = ?');
const _closeCycle  = db.prepare(
  'UPDATE appliance_cycles SET ended_at=?, duration_s=?, peak_watts=?, kwh=?, end_reason=? WHERE id=?'
);
const _getOpenCycle = db.prepare(
  'SELECT id FROM appliance_cycles WHERE appliance=? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1'
);

export function openCycle(appliance) {
  const now = Math.floor(Date.now() / 1000);
  return _openCycle.run(appliance, now).lastInsertRowid;
}

export function closeCycle(id, { peakWatts = null, kwh = null, endReason = 'normal' } = {}) {
  const row = _getStarted.get(id);
  if (!row) return;
  const now = Math.floor(Date.now() / 1000);
  _closeCycle.run(now, now - row.started_at, peakWatts, kwh, endReason, id);
}

export function getOpenCycleId(appliance) {
  return _getOpenCycle.get(appliance)?.id ?? null;
}

// ── Energy readings ────────────────────────────────────────────────

const _logEnergy = db.prepare(
  'INSERT INTO energy_readings (device_id, recorded_at, watts) SELECT id, ?, ? FROM devices WHERE name=?'
);
const _energyLast = {};

export function maybeLogEnergy(device, watts) {
  const now = Date.now();
  const last = _energyLast[device];
  if (!last || Math.abs(watts - last.watts) >= 5 || now - last.time >= 5 * 60 * 1000) {
    _energyLast[device] = { watts, time: now };
    try { _logEnergy.run(Math.floor(now / 1000), Math.round(watts), device); }
    catch (err) { console.error('DB energy write failed:', err.message); }
  }
}

// ── Behavior errors ────────────────────────────────────────────────

const _getOpenErr  = db.prepare(
  'SELECT id FROM behavior_errors WHERE source=? AND error_type=? AND resolved_at IS NULL LIMIT 1'
);
const _insertErr   = db.prepare(
  'INSERT INTO behavior_errors (source, error_type, detail, occurred_at, last_seen_at) VALUES (?,?,?,?,?)'
);
const _bumpErr     = db.prepare(
  'UPDATE behavior_errors SET last_seen_at=?, occurrence_count=occurrence_count+1, detail=? WHERE id=?'
);
const _resolveErr  = db.prepare(
  'UPDATE behavior_errors SET resolved_at=? WHERE source=? AND error_type=? AND resolved_at IS NULL'
);

const _logErrorTx = db.transaction((source, errorType, detail) => {
  const now = Math.floor(Date.now() / 1000);
  const existing = _getOpenErr.get(source, errorType);
  if (existing) {
    _bumpErr.run(now, detail, existing.id);
  } else {
    _insertErr.run(source, errorType, detail, now, now);
  }
});

export function logError(source, errorType, detail = null) {
  try { _logErrorTx(source, errorType, detail); }
  catch (err) { console.error('DB error write failed:', err.message); }
}

export function resolveError(source, errorType) {
  try { _resolveErr.run(Math.floor(Date.now() / 1000), source, errorType); }
  catch (err) { console.error('DB resolve write failed:', err.message); }
}

// ── Queries ────────────────────────────────────────────────────────

export function getRecentCycles(appliance, limit = 10) {
  return db.prepare(
    'SELECT * FROM appliance_cycles WHERE appliance=? AND ended_at IS NOT NULL ORDER BY started_at DESC LIMIT ?'
  ).all(appliance, limit);
}

export function getOpenErrors() {
  return db.prepare(
    'SELECT * FROM behavior_errors WHERE resolved_at IS NULL ORDER BY occurred_at DESC'
  ).all();
}
