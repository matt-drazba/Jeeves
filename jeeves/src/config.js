// @ts-check
/**
 * config.js — environment variables, constants, and startup validation.
 *
 * No behavior here — just configuration values used across the app.
 * Extracted from server.js as part of the decomposition (roadmap #4).
 */

// ── Server ──────────────────────────────────────────────────────────
export const PORT = process.env.PORT || 3000;

// ── Location ────────────────────────────────────────────────────────
// Farm Hill, Redwood City, CA
export const LAT = 37.48;
export const LON = -122.25;
export const LOCATION = 'Redwood City, CA';

export const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ── Home Assistant ──────────────────────────────────────────────────
export const HA_TOKEN = process.env.HA_TOKEN;
export const HA_URL = 'http://host.docker.internal:8123';

export const VOICE_SERVICE_URL = process.env.VOICE_SERVICE_URL || 'http://voice:5100';

// ── Dishwasher ──────────────────────────────────────────────────────
export const DISHWASHER_WATTS_THRESHOLD = 4;
export const DISHWASHER_END_DELAY_MS = 5 * 60 * 1000; // 5 min continuous below threshold = cycle ended

// ── AQI (PurpleAir) ─────────────────────────────────────────────────
export const PURPLEAIR_KEY = process.env.PURPLEAIR_API_KEY;
export const PURPLEAIR_INDOOR_SENSOR = 126601;
export const PURPLEAIR_OUTDOOR_SENSORS = [113020, 81199, 284212];

// ── Pool ────────────────────────────────────────────────────────────
export const POOL_PUMP_WATTS_THRESHOLD = 20; // matches the Shelly on-device ionizer script's threshold

export const POOL_PAD_ENTITIES = {
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

export const POOL_EXTRA_ENTITIES = {
  sweep:     'switch.pool_sweep_socket_1',
  sweepRan:  'input_boolean.sweep_ran_tonight',
};

// Pump energized but water not moving = running against a closed valve. Normal
// operation is 45-60 GPM (docs/pool_heat_recovery.md), so this is far below any
// legitimate reading and only trips on a hard stop, not on "low".
export const FLOW_DEADHEAD_GPM = 10;

// The HA schedule runs 21:45-23:15. A run that ends materially short of that
// was cut off by something (breaker, Tuya round-trip failure, manual stop), and
// that is the whole point of showing the duration rather than a yes/no.
export const SWEEP_FULL_MIN  = 90;
export const SWEEP_SHORT_MIN = 80;

// Filter pressure only means something relative to the clean-filter baseline,
// which is recorded by hand after a backwash (POST /api/pool/set-filter-baseline)
// — there's no automatic "the filter is clean now" signal. Colors and the
// forecast both stay in a "not ready yet" state until that baseline exists.
export const FILTER_WATTS_BAND_FRAC     = 0.15; // ±15% around the baseline's own watts
export const FILTER_ALERT_PSI_OVER_BASE = 9;    // midpoint of the documented +8-10 psi window
export const FILTER_TREND_MIN_DAYS      = 5;
export const FILTER_TREND_MIN_SAMPLES   = 20;

// ── Alerts ──────────────────────────────────────────────────────────
// Level and runbook text are facts from docs/alerting_levels.md — HA doesn't
// expose them — so they live here. The open-alert flag entity is DERIVED from
// the key (input_boolean.alert_open_<key>), and the key must be a member of this
// registry, so nothing client-supplied ever reaches an entity_id.
export const ALERT_REGISTRY = {
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
  localtuya_offline: {
    level: 2,
    title: 'LocalTuya controller offline',
    detector: 'binary_sensor.localtuya_offline',
    action: 'Check the LocalTuya integration in HA. The pool sweep and OhmPlugs are unreachable.',
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
  //
  // open_daytime and close_failed clear themselves the moment the door reaches
  // `closed` (jeeves_garage_close_clears_alerts): closing it IS the physical
  // action both of them name, verified by the hardware. night_open is the
  // deliberate exception — its action is "account for everyone in the house",
  // which no sensor reports, and a door that closed itself at 3am does not
  // answer who opened it. It stays Acknowledge-only and re-raises at 7am.
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
    action: 'Close it, or confirm someone is out there.',
  },
  garage_node_offline: {
    level: 3,
    title: 'Garage controller offline',
    detector: 'binary_sensor.garage_node_offline',
    action: 'Check the ratgdo at http://192.168.0.230 and power-cycle it.',
  },
};

// ── Next Actions ────────────────────────────────────────────────────
// Recurring work, shown as a tile and promoted into a real chore tile on its due
// date. Source 1 (fixed cadence, below) is the only one built. Threshold-based
// (filter backwash, needs the pressure sensor) and chemistry-model-based
// projections append to the same array later and need no UI work.
export const DAY_MS = 86400 * 1000;

// 1-indexed to match tasks.start_month / end_month.
export const MONTH_ABBR = [null, 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                           'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ── BiblioCommons (RCPL library holds) ───────────────────────────
export const BIBLIO_LIBRARY = 'rcpl';
export const BIBLIO_CARD    = process.env.BIBLIO_CARD;
export const BIBLIO_PIN     = process.env.BIBLIO_PIN;
export const BIBLIO_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

// ── Batteries ───────────────────────────────────────────────────────
// Charging (blue) has no house-wide standard signal either — none of these
// integrations use HA's binary_sensor device_class "battery_charging" — so
// it's inferred by looking for a sibling entity sharing the same entity_id
// prefix (sensor.<prefix>_charging or _battery_state) and checking whether
// its state is exactly "charging" (case-insensitive, so "Not Charging"
// correctly reads as false, not a substring match on "charging"). A device
// with no such sibling just never shows as charging — never wrong, just less complete.
export const BATTERY_PINNED = new Set(['sensor.dusty_battery_level', 'sensor.snorlax_battery_level']);

export const BATTERY_ICONS = {
  'sensor.dusty_battery_level':       '🚗',
  'sensor.snorlax_battery_level':     '🚗',
  'sensor.front_door_battery':        '🔔',
  'sensor.front_front_door_battery':  '🔒',
  'sensor.ipad_battery_level':        '📱',
};

// ── Now Playing (Mac mini Music bridge) ──────────────────────────
// Mac mini. Pin this in the router's DHCP reservations — the 2026-08-18 power
// outage moved the lease from .204 to .203 and silently killed the Now Playing tile.
export const MUSIC_BRIDGE_URL = 'http://192.168.0.203:8181';

// ── Calendar (HA Google Calendar API) ────────────────────────────
export const CALENDAR_ENTITY = 'calendar.matthew_drazba';
export const CAL_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ── Chat (Ollama) ─────────────────────────────────────────────────
export const OLLAMA_URL = process.env.OLLAMA_URL || 'http://ollama:11434';
export const CHAT_MODEL = 'llama3.2:3b';
export const CHAT_SYSTEM = `You are Jeeves, a smart home assistant for a house in Redwood City, CA. \
Answer questions concisely and practically. The home has: a Samsung washer, LG dryer, \
dishwasher (monitored via power draw), Rheem heat pump water heater, Resideo T10 Pro thermostat, \
August Smart Lock, Tesla vehicles named Dusty (white) and Snorlax (blue), Bhyve sprinkler system, \
TP-Link Kasa smart outlets, and Tuya window shades. Home automation runs on Home Assistant.`;

// ── Startup environment validation ──────────────────────────────────
/**
 * Log what's available and what's degraded so there's no mystery about
 * missing features after a restart. Call once before app.listen().
 */
export function validateStartupEnv() {
  const envStatus = [];
  const check = (name, isSet, feature) => envStatus.push({ name, isSet, feature });

  check('HA_TOKEN', !!HA_TOKEN, 'Home Assistant (appliances, alerts, calendar, batteries, pool)');
  check('PURPLEAIR_API_KEY', !!PURPLEAIR_KEY, 'AQI outdoor sensors');
  check('RESEND_API_KEY', !!process.env.RESEND_API_KEY, 'Weekly email reports');
  check('REPORT_TO_EMAIL', !!process.env.REPORT_TO_EMAIL, 'Weekly email reports');
  check('BIBLIO_CARD', !!BIBLIO_CARD, 'Library holds');
  check('BIBLIO_PIN', !!BIBLIO_PIN, 'Library holds');
  check('MEMBERS', !!process.env.MEMBERS, 'Chore member seeding');

  const missing = envStatus.filter(e => !e.isSet);
  const present = envStatus.filter(e => e.isSet);

  console.log('── Startup environment check ──');
  for (const e of present) {
    console.log(`  ✓ ${e.name} — ${e.feature}`);
  }
  for (const e of missing) {
    console.log(`  ✗ ${e.name} — ${e.feature} (degraded)`);
  }
  if (missing.length > 0) {
    console.log(`── ${present.length}/${envStatus.length} env vars set, ${missing.length} feature(s) degraded ──`);
  } else {
    console.log('── All env vars set ──');
  }
}

