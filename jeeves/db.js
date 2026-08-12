// @ts-check
import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import bcrypt from 'bcryptjs';

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
  if (v < 2) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS members (
        id        INTEGER PRIMARY KEY,
        name      TEXT NOT NULL UNIQUE,
        pin_hash  TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS task_credits (
        id         INTEGER PRIMARY KEY,
        member_id  INTEGER NOT NULL REFERENCES members(id),
        task       TEXT NOT NULL,
        ts         INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_credits_member_ts ON task_credits(member_id, ts);
    `);
    db.pragma('user_version = 2');
    console.log('DB: migrated to v2');
  }
  if (v < 3) {
    db.exec(`
      INSERT OR IGNORE INTO devices (name, kind) VALUES ('home', 'consumption');
    `);
    db.pragma('user_version = 3');
    console.log('DB: migrated to v3');
  }
  if (v < 4) {
    db.exec(`
      INSERT OR IGNORE INTO devices (name, kind) VALUES ('pool_pump', 'consumption');
    `);
    db.pragma('user_version = 4');
    console.log('DB: migrated to v4');
  }
  if (v < 5) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS pool_heat_samples (
        id          INTEGER PRIMARY KEY,
        recorded_at INTEGER NOT NULL,
        hx_in_f     REAL,
        hx_out_f    REAL,
        delta_f     REAL,
        flow_gpm    REAL,
        btu_hr      REAL,
        heat_active INTEGER,
        pump_watts  REAL
      );
      CREATE INDEX IF NOT EXISTS idx_pool_heat_recorded
        ON pool_heat_samples(recorded_at);
    `);
    db.pragma('user_version = 5');
    console.log('DB: migrated to v5');
  }
  if (v < 6) {
    // Recurring maintenance tasks. These drive the "Next Up" tile and promote
    // themselves into chore tiles on their due date.
    //
    // Only genuinely calendar-driven work belongs here. Backwash is deliberately
    // NOT seeded: docs/pool_data_addendum.md is explicit that it triggers at
    // +8-10 psi over measured baseline, not on a schedule, and the filter
    // pressure sensor isn't built yet. A calendar cadence would be invented.
    db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id            INTEGER PRIMARY KEY,
        key           TEXT NOT NULL UNIQUE,
        domain        TEXT NOT NULL,
        title         TEXT NOT NULL,
        icon          TEXT,
        interval_days REAL NOT NULL,
        last_done_at  INTEGER,
        enabled       INTEGER NOT NULL DEFAULT 1
      );
      CREATE INDEX IF NOT EXISTS idx_tasks_enabled ON tasks(enabled, domain);
    `);

    // Start every clock at migration time. Seeding last_done_at NULL would make
    // all six immediately overdue and dump six chore tiles on the first morning.
    const now = Math.floor(Date.now() / 1000);
    const seed = db.prepare(
      `INSERT OR IGNORE INTO tasks (key, domain, title, icon, interval_days, last_done_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    // Test cadences are the R-40 / K-2006 figures from docs/pool_data_addendum.md.
    seed.run('test_fc',        'pool', 'Test free chlorine',   '🧪', 3,   now);
    seed.run('test_copper_ph', 'pool', 'Test copper and pH',   '🧪', 7,   now);
    seed.run('test_ta_ch',     'pool', 'Test TA and calcium',  '🧪', 30,  now);
    seed.run('test_tds',       'pool', 'Test TDS',             '🧪', 365, now);
    seed.run('hvac_filter',    'home', 'Change HVAC filter',   '🌬️', 90,  now);
    seed.run('dishwasher_deep','home', 'Deep clean dishwasher','🍽️', 60,  now);

    db.pragma('user_version = 6');
    console.log('DB: migrated to v6');
  }
  if (v < 7) {
    // Completed sweep runs.
    //
    // input_boolean.sweep_ran_tonight cannot answer "did last night's sweep go
    // well" — jeeves_sweep_missed_check turns it OFF at 23:45 every night, so
    // from midnight onward it always reads false and the tile says "Not yet"
    // for the entire day. It is a latch for the 23:45 check, not a record.
    //
    // A real run needs a duration to be judged: the scheduled window is 90 min,
    // so a 12-minute run means something cut it short. Stored here rather than
    // read back from HA's recorder, which is trimmed to a few days for SD-card
    // wear and would lose the history within the week.
    db.exec(`
      CREATE TABLE IF NOT EXISTS sweep_runs (
        id         INTEGER PRIMARY KEY,
        started_at INTEGER NOT NULL,
        ended_at   INTEGER,
        duration_s INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_sweep_started ON sweep_runs(started_at);
    `);
    db.pragma('user_version = 7');
    console.log('DB: migrated to v7');
  }
  if (v < 8) {
    // Seasonal windows on recurring tasks, plus the garden domain.
    //
    // interval_days alone cannot express garden work. Roses stop feeding around
    // Labor Day so they don't push tender growth into fall; in-ground citrus
    // feeds three times a year and not at all in winter. Seeded on interval
    // alone these promote a chore tile every 35 days through December, and a
    // tickler that nags out of season is how the tile gets ignored entirely.
    //
    // Same reasoning that made the garage snooze a timer and deleted
    // input_boolean.pool_maintenance: suppression has to clear itself rather
    // than wait to be remembered. A month window closes and reopens on its own.
    //
    // NULL start_month/end_month means no window, so every task predating this
    // migration keeps its current always-eligible behaviour.
    db.exec(`
      ALTER TABLE tasks ADD COLUMN start_month INTEGER;
      ALTER TABLE tasks ADD COLUMN end_month   INTEGER;
    `);

    const now = Math.floor(Date.now() / 1000);
    const seed = db.prepare(
      `INSERT OR IGNORE INTO tasks
         (key, domain, title, icon, interval_days, last_done_at, start_month, end_month)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    // Cadences from docs/sprinklers.md section 10.
    //
    // fert_rose seeded today first comes due mid-September, past its August
    // window close, so it will not fire until March. That is deliberate, not an
    // oversight: the rose is being corrected for water and rootstock suckers
    // first, and a water-stressed plant cannot take up fertiliser anyway.
    seed.run('fert_rose',          'garden', 'Feed the rose',       '🌹', 35,  now, 3, 8);
    seed.run('fert_citrus_ground', 'garden', 'Feed pomelo + lemon', '🍋', 120, now, 2, 9);
    seed.run('fert_potted',        'garden', 'Feed potted trees',   '🪴', 35,  now, 3, 9);

    // Deliberately breaks the v6 "stamp last_done_at so nothing is due on day
    // one" rule. Mulching genuinely IS outstanding right now — the rose bed has
    // never been mulched — so a NULL makes it due immediately and it promotes at
    // the next 07:00. Stamping it would hide a real task for a year.
    seed.run('mulch_beds',         'garden', 'Mulch the beds',      '🍂', 365, null, null, null);

    db.pragma('user_version = 8');
    console.log('DB: migrated to v8');
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

// ── Pool heat recovery samples ─────────────────────────────────────

const _logPoolHeat = db.prepare(
  `INSERT INTO pool_heat_samples
     (recorded_at, hx_in_f, hx_out_f, delta_f, flow_gpm, btu_hr, heat_active, pump_watts)
   VALUES (?,?,?,?,?,?,?,?)`
);

const POOL_HEAT_IDLE_INTERVAL_MS = 10 * 60 * 1000; // heartbeat when heat recovery is off
let _poolHeatLastWrite = 0;

/**
 * Called on the pool pad poll (~2 min). Full resolution while heat recovery is
 * running; a 10-minute heartbeat when it is idle, so a season of data stays small.
 */
export function logPoolHeat({ hxInF, hxOutF, flowGpm, btuHr, heatActive, pumpWatts }) {
  const now = Date.now();
  if (!heatActive && now - _poolHeatLastWrite < POOL_HEAT_IDLE_INTERVAL_MS) return;

  const n = (x) => (typeof x === 'number' && !isNaN(x) ? x : null);
  const inF = n(hxInF), outF = n(hxOutF);
  const delta = inF !== null && outF !== null ? +(outF - inF).toFixed(2) : null;

  try {
    _logPoolHeat.run(
      Math.floor(now / 1000), inF, outF, delta,
      n(flowGpm), n(btuHr), heatActive ? 1 : 0, n(pumpWatts)
    );
    _poolHeatLastWrite = now;
  } catch (err) {
    console.error('DB pool heat write failed:', err.message);
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

// pump_watts is included because the chart cannot be read without it. With the
// pump off, water sits stagnant in the exchanger and the two probes stop seeing
// the same water: measured 08-08 16:58 at in=79.4 out=84.9, a +5.5F delta with
// heat recovery OFF. That is a no-flow artifact, not exchanger performance, and
// plotting it sets the y-scale so the real 0-1F signal collapses to nothing.
export function getPoolHeatSamples(sinceTs, limit = 1000) {
  return db.prepare(`
    SELECT recorded_at, hx_in_f, hx_out_f, delta_f, heat_active, pump_watts
    FROM pool_heat_samples
    WHERE recorded_at >= ?
    ORDER BY recorded_at ASC
    LIMIT ?
  `).all(sinceTs, limit);
}

// ── Sweep runs ─────────────────────────────────────────────────────

const _openSweep = db.prepare('INSERT INTO sweep_runs (started_at) VALUES (?)');
const _openSweepRow = db.prepare(
  'SELECT id, started_at FROM sweep_runs WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1'
);
const _closeSweep = db.prepare(
  'UPDATE sweep_runs SET ended_at=?, duration_s=? WHERE id=?'
);

/** Sweep switch turned on. No-op if a run is already open. */
export function openSweepRun() {
  if (_openSweepRow.get()) return;
  try { _openSweep.run(Math.floor(Date.now() / 1000)); }
  catch (err) { console.error('DB sweep open failed:', err.message); }
}

/** Sweep switch turned off. No-op if nothing is open. */
export function closeSweepRun() {
  const row = _openSweepRow.get();
  if (!row) return;
  const now = Math.floor(Date.now() / 1000);
  try { _closeSweep.run(now, now - row.started_at, row.id); }
  catch (err) { console.error('DB sweep close failed:', err.message); }
}

/** Most recent COMPLETED run, or null. */
export function getLastSweepRun() {
  return db.prepare(
    'SELECT started_at, ended_at, duration_s FROM sweep_runs WHERE ended_at IS NOT NULL ORDER BY started_at DESC LIMIT 1'
  ).get() ?? null;
}

// ── Recurring tasks ────────────────────────────────────────────────

const DAY_S = 86400;

// Is a timestamp inside a task's month window? Windows are inclusive and may
// wrap the year end (start 11, end 2 = November through February).
function _inWindow(ts, startMonth, endMonth) {
  const m = new Date(ts * 1000).getMonth() + 1;
  return startMonth <= endMonth
    ? m >= startMonth && m <= endMonth
    : m >= startMonth || m <= endMonth;
}

// First instant of startMonth at or after ts.
function _nextWindowOpen(ts, startMonth) {
  const from = new Date(ts * 1000);
  const open = new Date(from.getFullYear(), startMonth - 1, 1, 0, 0, 0, 0);
  if (open.getTime() < from.getTime()) open.setFullYear(open.getFullYear() + 1);
  return Math.floor(open.getTime() / 1000);
}

// Every enabled task with its computed due date, soonest first. A task that has
// never been done is due now — the v6 seed stamps last_done_at so that only
// happens for rows added deliberately (mulch_beds in v8) or by hand later.
export function getTaskSchedule() {
  const rows = db.prepare(
    'SELECT * FROM tasks WHERE enabled = 1 ORDER BY key ASC'
  ).all();
  return rows
    .map((t) => {
      const rawDue = t.last_done_at
        ? t.last_done_at + Math.round(t.interval_days * DAY_S)
        : Math.floor(Date.now() / 1000);
      // Out of season, a task is deferred to its next window opening rather
      // than hidden. "Feed the rose · March 1" stays visible on Next Up instead
      // of the task silently vanishing for six months and looking like a bug.
      const dueAt =
        t.start_month == null || _inWindow(rawDue, t.start_month, t.end_month)
          ? rawDue
          : _nextWindowOpen(rawDue, t.start_month);
      return {
        key:       t.key,
        domain:    t.domain,
        title:     t.title,
        icon:      t.icon,
        intervalDays: t.interval_days,
        lastDoneAt:   t.last_done_at,
        startMonth:   t.start_month,
        endMonth:     t.end_month,
        dueAt,
      };
    })
    .sort((a, b) => a.dueAt - b.dueAt);
}

export function markTaskDone(key, ts = Math.floor(Date.now() / 1000)) {
  const res = db.prepare('UPDATE tasks SET last_done_at = ? WHERE key = ?').run(ts, key);
  return res.changes > 0;
}

export function getWeeklyStats(sinceTs) {
  const cycles = db.prepare(`
    SELECT appliance,
           COUNT(*)           AS cycle_count,
           AVG(duration_s)    AS avg_duration_s,
           MAX(duration_s)    AS max_duration_s,
           MIN(duration_s)    AS min_duration_s
    FROM appliance_cycles
    WHERE started_at >= ? AND ended_at IS NOT NULL
    GROUP BY appliance
  `).all(sinceTs);

  const errors = db.prepare(`
    SELECT * FROM behavior_errors
    WHERE occurred_at >= ? OR resolved_at >= ? OR resolved_at IS NULL
    ORDER BY occurred_at DESC
  `).all(sinceTs, sinceTs);

  const credits = db.prepare(`
    SELECT m.name, COUNT(tc.id) AS count,
           GROUP_CONCAT(tc.task) AS tasks
    FROM members m
    LEFT JOIN task_credits tc ON tc.member_id = m.id AND tc.ts >= ?
    GROUP BY m.id, m.name
    ORDER BY count DESC, m.name ASC
  `).all(sinceTs);

  return { cycles, errors, credits };
}

// ── Members + chore credits ────────────────────────────────────────

// MEMBERS env var format: "Matt:1234,Jess:5678,Paul:2345,Zack:3456,Tim:4567"
export async function seedMembers(membersEnv) {
  if (!membersEnv) return;
  const upsert = db.prepare(
    'INSERT INTO members (name, pin_hash) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET pin_hash = excluded.pin_hash'
  );
  const pairs = membersEnv.split(',').map(s => s.trim()).filter(Boolean);
  for (const pair of pairs) {
    const colon = pair.indexOf(':');
    if (colon === -1) continue;
    const name = pair.slice(0, colon).trim();
    const pin  = pair.slice(colon + 1).trim();
    if (!name || !pin) continue;
    const hash = await bcrypt.hash(pin, 10);
    upsert.run(name, hash);
  }
  console.log(`DB: seeded ${pairs.length} members`);
}

export async function recordCredit(pin, task) {
  if (!pin) return null;
  const members = db.prepare('SELECT id, name, pin_hash FROM members').all();
  for (const m of members) {
    if (await bcrypt.compare(String(pin), m.pin_hash)) {
      db.prepare('INSERT INTO task_credits (member_id, task, ts) VALUES (?, ?, ?)')
        .run(m.id, task, Math.floor(Date.now() / 1000));
      return m.name;
    }
  }
  return null;
}

export function getWeeklyCredits(sinceTs) {
  return db.prepare(`
    SELECT m.name, COUNT(tc.id) AS count,
           GROUP_CONCAT(tc.task) AS tasks
    FROM members m
    LEFT JOIN task_credits tc ON tc.member_id = m.id AND tc.ts >= ?
    GROUP BY m.id, m.name
    ORDER BY count DESC, m.name ASC
  `).all(sinceTs);
}
