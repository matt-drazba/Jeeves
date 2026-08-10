# Measuring what FPH heat recovery costs the house

Created 2026-08-10. Status: **nothing built.** One test staged (see Part 1).
Related: [pool_heat_recovery.md](pool_heat_recovery.md) · [pool_wiring_manual.md](pool_wiring_manual.md)

## The question

Does diverting condenser heat into the pool make the house cool worse, and what is
the recovered heat actually worth?

## Framing corrections

These three change the whole rig, and an earlier draft of this project got all
three wrong.

**It is a cooling measurement, not a heating one.** Recovery runs in **cooling
only** ([pool_heat_recovery.md](pool_heat_recovery.md), System facts). The metric
is a **split** — return minus supply, normally 16–22 °F — not a furnace-style
"temperature rise." Any plan quoting a 68 °F return and a 104 °F supply is
describing a furnace and does not apply here.

**The pump is not the control knob.** The FPH commands the pump directly: 24VAC
pump-call → IntelliComm II input 4 → Ext. Program 4 at 2200 RPM. External programs
outrank the onboard schedule, so **the FPH will start a pump you turned off.** The
control is the **FPH controller's pool setpoint** — below current pool temp means
no call and no diversion; above means diversion. One knob, instantly reversible,
changes nothing else.

**The independent variable already exists.** `binary_sensor.pool_pad_pool_heat_active`
is true only when the trio is energized *and* flow is proven
([pool-pad.yaml](../esphome/pool-pad.yaml)). Label every cycle from this sensor,
never from the setpoint that was dialled in.

## Why compressor stage gates everything

The Bryant 226ANA048-B is **two-stage**. Stage 1 vs stage 2 moves the supply split
by several °F. The FPH effect is plausibly 1–2 °F. Without knowing the stage of
each cycle, an FPH-on vs FPH-off comparison is measuring the compressor, not the
FPH — and would produce a confident wrong answer rather than an obvious failure.

So stage sensing is a **prerequisite**, not the "future enhancement" the original
brief filed it under. This is the same item parked in CLAUDE.md as "HVAC compressor
stage visibility."

The T10 Pro displays equipment stage on its own screen, which is what makes Part 1
testable: the thermostat is the reference the API gets checked against.

---

# Part 1 — Staged test: does the Resideo cloud API expose stage?

**This is the only active work item.** Everything in Part 2 is on hold until it
resolves, because the answer decides whether ~$60 of CT hardware is needed.

## Test design

It is a **differential test, not a single dump.** A field named `mode` returning
`"Cool"` proves nothing on its own — the stage information, if it exists, may only
become visible as a value that *changes* between stage 1 and stage 2. So capture
the full raw payload three times at states you have independently confirmed on the
thermostat screen, then diff them.

| Capture | Thermostat state | How to force it |
|---|---|---|
| `off.json` | Equipment off | Setpoint above indoor temp, wait for the compressor to stop |
| `stage1.json` | Cooling, stage 1 | Drop cool setpoint ~1–2 °F below indoor, confirm stage 1 on screen |
| `stage2.json` | Cooling, stage 2 | Drop cool setpoint ~5–6 °F below indoor, confirm stage 2 on screen |

Confirm each state **on the T10 screen** before capturing. That screen is ground
truth; the payload is the thing under test.

Do all three inside one access token's lifetime (~30 min) or refresh between them.

## Setup (one time)

1. Create an app at **developer.honeywell.com** (Honeywell Home / Resideo developer
   portal — `developer.resideo.com` redirects here; the API host is
   `api.honeywell.com`). Note the **Consumer Key** (`apikey`) and **Consumer Secret**.
2. Set a redirect URI. `https://localhost` is fine — nothing needs to listen on it,
   you only read the `code` out of the browser address bar.
3. Authorize in a browser:

```
https://api.honeywell.com/oauth2/authorize?response_type=code&redirect_uri=https://localhost&client_id=YOUR_CONSUMER_KEY
```

   Approve, then copy the `code=` value from the resulting `https://localhost/?code=...` URL.

4. Exchange it for tokens:

```bash
KEY=YOUR_CONSUMER_KEY
SECRET=YOUR_CONSUMER_SECRET
CODE=THE_CODE_FROM_THE_URL

curl -s -X POST https://api.honeywell.com/oauth2/token \
  -H "Authorization: Basic $(printf '%s:%s' "$KEY" "$SECRET" | base64)" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=authorization_code&code=$CODE&redirect_uri=https://localhost" \
  | python3 -m json.tool
```

   Keep `access_token` and `refresh_token`. **Neither goes in this repo.**

5. Find the location and device IDs:

```bash
TOKEN=THE_ACCESS_TOKEN
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://api.honeywell.com/v2/locations?apikey=$KEY" \
  | python3 -c "import sys,json
for loc in json.load(sys.stdin):
    print('locationID:', loc['locationID'], loc.get('name'))
    for d in loc.get('devices', []):
        print('   deviceID:', d.get('deviceID'), '|', d.get('deviceModel'), '|', d.get('userDefinedDeviceName'))"
```

## Capture

Run this three times, once per row of the table above, changing the filename:

```bash
KEY=YOUR_CONSUMER_KEY
TOKEN=THE_ACCESS_TOKEN
LOC=YOUR_LOCATION_ID
DEV=YOUR_DEVICE_ID

curl -s -H "Authorization: Bearer $TOKEN" \
  "https://api.honeywell.com/v2/devices/thermostats/$DEV?apikey=$KEY&locationId=$LOC" \
  | python3 -m json.tool > ~/Desktop/stage2.json    # <- rename per capture
```

## Read the result

```bash
cd ~/Desktop && diff off.json stage1.json ; echo '--- 1 vs 2 ---' ; diff stage1.json stage2.json
```

**Decide from the payload, not from documentation and not from field names that
merely sound promising.** The test passes only if some field differs between
`stage1.json` and `stage2.json` in a way that is stable and repeatable.

Where to look first: `operationStatus` (it carries `mode`, `fanRequest`,
`circulationFanRequest`), then `changeableValues`, `settings`, and `deviceSettings`.
My expectation is that `operationStatus.mode` returns something like
`EquipmentOff` / `Heat` / `Cool` with **no stage distinction** — but that is a guess,
and the diff is the point.

Ignore fields that differ for uninteresting reasons: `indoorTemperature`,
`indoorHumidity`, setpoints you just changed, and any timestamp.

**Repeat once on a second day** before trusting a positive result. A field that
happened to differ once is not a stage signal.

## Recording the outcome

Write the answer back into this doc — the payload diff, and the verdict:

- **Exposes stage** → note the exact JSON path. Jeeves polls the Resideo API for
  stage; no CT purchase. Note that this puts a cloud dependency in the data path,
  so gaps are expected and must be recorded as missing rather than interpolated.
- **Does not expose stage** → fall back to the CT (Part 2). Not a consolation
  prize: the CT gives **runtime and electrical input**, which the API would never
  provide and which the whole economics half depends on.

---

# Part 2 — On hold until Part 1 resolves

## Stage sensing fallback

**Shelly EM Gen3 + 2 CTs at the outdoor unit (~$60).** Same part already proven on
the pool pump. Use both channels: **compressor on one, condenser fan on the other.**

Do **not** clamp the whole outdoor circuit on a single CT. The 90340 relay kills
condenser fan power during diversion ([pool_heat_recovery.md](pool_heat_recovery.md),
L1a), so a whole-circuit CT would see the fan drop out and corrupt the stage signal
in exactly the condition being studied. Two channels also give independent hardware
confirmation that the fan really did stop.

## Air-side rig

**Supply plenum and return plenum at the air handler. Nothing in any room.**

This is also the hidden option: no visible hardware in the living space, and the
probe tip still sits in the airstream — DS18B20 on its lead through a 6 mm hole,
electronics outside, foil tape over the penetration. Same external-probe
arrangement the battery Zigbee units use, without their problems.

- **Supply probe** — 12–18" downstream of the coil, out of line-of-sight of it, or
  it reads radiant coupling to a cold coil instead of air.
- **Return probe** — return plenum, downstream of the filter, before the coil.
- Neither probe touching a duct wall.

**Not vent registers.** Register temperatures measure duct loss and mixing — a real
question, but a duct-balance one with no relationship to FPH mode, and it would
cost long wire runs through the house to answer badly.

**Not battery Zigbee.** The OWON THS 317-ET and SONOFF SNZB-02LD report on a
deadband, typically 0.5–1 °C — up to **1.8 °F**, as large as the effect being
measured. Secondary problems: no Zigbee coordinator exists here, Zigbee2MQTT would
violate the no-MQTT hard rule in CLAUDE.md, and a radio inside sheet-metal duct is
in a Faraday cage.

**Parts:** 2nd ESP8266 (~$8) · 2× DS18B20 (one spare already in hand, the third of
three per [pool_heat_recovery.md](pool_heat_recovery.md) Parts) · 4.7k pull-up ·
AHT20 for return humidity (~$5) · foil tape. **Confirm power and usable wifi at the
air handler before ordering** — closets and attics are often marginal.

### Probe cross-calibration is the whole experiment

DS18B20 absolute accuracy is ±0.5 °C (±0.9 °F); the effect is 1–2 °F. Only the
**paired difference** between the two specific probes carries signal.

Strap both probes together in still air, log for a full hour, take the **median**
offset, bake it in as an `offset:` filter. Verify: blower off, both settled, split
reads ~0.0.

From logged data, never a spot reading — [pool-pad.yaml](../esphome/pool-pad.yaml)
`out_temp_offset_f` is the write-up of getting exactly this wrong one system over,
where a single spot reading produced a +0.3 offset that silently disarmed the alert
it fed.

## Logging

Jeeves SQLite, not HA recorder — recorder retention is trimmed for SD-card wear and
would purge this inside a week, while the comparison needs 3–4 weeks. Same reasoning
that made SQLite the chemistry system of record.

New `hvac_samples` table: supply, return, split, return RH, outdoor, pool water,
running, FPH active, pump W, compressor W, fan W, stage. 30 s while cooling, 10-min
heartbeat when idle — same shape as `logPoolHeat()`.

Gate the poller behind an env flag (`HVAC_NODE_INSTALLED`), matching the existing
`POOL_FLOW_METER_INSTALLED` pattern. Without it, a 30 s timer against entities that
do not exist parks a permanently-open `behavior_errors` row for weeks.

**Deploying this also finally lands `pool_heat_samples`** — the Pi's jeeves
container predates schema v5 and has never had that table. `git pull` plus an HA
restart does not rebuild jeeves; it needs `docker compose up -d --build jeeves`.

## Procedure

1. **Alternate daily** — flip the FPH setpoint above/below pool temp each morning.
   Alternating controls for weather drift far better than a week on / week off.
2. **Label from the sensor**, not the knob.
3. **Exclude transients** — the FPH force-runs the pump for a purge delay before
   sampling its PT-100 (~20 s per the manual, ~2 min observed in
   [pool_system_checks.md](pool_system_checks.md)), plus coil pulldown. Use only the
   last 5 minutes of runs ≥10 minutes.
4. **Matched bins, not eyeballed graphs** — bin by (stage, outdoor ±2 °F), compare
   mean steady-state split FPH-on vs FPH-off within bins.
5. **Then regress on (outdoor − pool water).** See below.

**Realistic duration: 3–4 weeks**, not one. Resolving ~1 °F against cycle-to-cycle
variance needs roughly 20–30 matched cycles per arm.

## What the answer is likely to be

**The effect probably changes sign, and that is the finding worth having.**
Condensing temperature follows the heat sink. Pool at 80 °F against outdoor air at
100 °F makes the FPH the *better* sink — lower head pressure, more capacity, and the
house cools **better**. Pool at 88 °F on a mild 78 °F day makes it the *worse* sink.

So regress on **(outdoor temp − pool water temp)** rather than bucketing FPH on/off.
Pool water is already measured (HX inlet probe). This tells you *when* to disable
FPH, which a two-bucket comparison cannot.

## The cost side, which the original brief never asked about

**The FPH forces the pump on during peak rate hours.** The pump schedule is
9pm–4pm, and the 4–9pm off-window is the *unique* peak-optimal choice
([pool_booster_interlock.md](pool_booster_interlock.md)). But whenever the AC calls
between 4pm and 9pm and the pool wants heat, the FPH starts the pump at 2200 RPM —
roughly 1.4–1.9 kW, at peak rates, on the hottest afternoons of the year.

This has never been costed, and the Shelly EM on the pool pump already measures it.
It is plausibly the most economically significant number this project can produce.

Credit against it: the condenser fan stops during diversion, saving ~200–400 W.

**Benefit side** is `sensor.pool_pad_pool_heat_btu_hr` — **blocked on the flow
meter**, since BTU/hr is GPM × ΔT × 500 and GPM is currently unmeasured. That meter
is the critical path for the economics half.

## Secondary note: latent load

A DS18B20 reads dry-bulb only. On a humid day more capacity goes to
dehumidification and the split shrinks even though total capacity has not changed.
Local humidity makes this second-order, but an AHT20 at the return gives RH →
enthalpy, so the analysis can correct for it instead of assuming it away.

## Margin check

The condenser fan stopping means **all** heat rejection goes through the FPH5 alone.
A 4-ton unit at stage 2 rejects roughly 60,000 BTU/hr; the FPH5 is rated 75,000 —
adequate, but the margin narrows with hot pool water or flow near the 45 GPM floor.
Worth watching once stage data exists.
