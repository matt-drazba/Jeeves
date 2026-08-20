# Pool Heat Recovery — HotSpot FPH5 + IntelliFlo2 VST

Last updated: 2026-08-12. Authority order: CLAUDE.md → this doc → coder briefs.
**For as-built wiring, troubleshooting, and how this install differs from the FPH manual, see [pool_wiring_manual.md](pool_wiring_manual.md)** — that doc is the authority on what is physically in the boxes; this one covers design rationale and project status.
Sources: HotSpot FPH installer manual (44p scan), Pentair IntelliComm II guide, TFP community.

## System facts (verified)

| Item | Value |
|---|---|
| Pump | Pentair IntelliFlo2 VST 3.0 HP, firmware **1.23-VS** |
| Pump protocol | Classic Pentair RS-485 (011056-family). Protocol break is IntelliFlo3 011075+, not this pump. No firmware flash needed. |
| Pump slots | 8 speed slots: 4 keypad presets + 4 external programs. External programs are a SEPARATE speed list from keypad buttons. |
| FPH | **FPH5** (confirmed on HX label). Min **45 GPM** / max **70 GPM** / 75k BTU/h max. |
| HVAC | Bryant 226ANA048-B, 4-ton two-stage heat pump. Recovery runs in **cooling only** (Type of AC setting, p.41). |
| Baseline flow | **1750 RPM ≈ 45–50 GPM** (measured, Blue-White inline gauge). Flow scales ~1:1 with RPM. |
| Schedule speeds | The daily schedule is **two-speed**: **2000 RPM** during the sweep window (21:45–23:15), **1750 RPM** the rest of the 19-hour run. Distinct from Ext. Program 4 below, which the FPH commands and which outranks both. Winter speeds are under review — see [pool_system_checks.md](pool_system_checks.md). |
| Sanitizer | **Clearwater MineralPURE R-40** copper/silver ionizer (40k gal). Low residual chlorine (~90% reduction; small residual still required). Copper target **0.15–0.20 ppm** (R-40 manual p.14, verified 2026-08-07 — an earlier 0.2–0.4 figure here was wrong, its upper half exceeds the manufacturer maximum). |

## Program config

**"Locked" was wrong and is corrected 2026-08-12.** Nothing about Ext. Program 4's speed is locked.
It is a setting on the IntelliFlo2's own control pad, adjustable anywhere up to **3450 RPM**. The
2200 figure is the speed that was *chosen* as a good estimate for clearing the FPH5's 45 GPM floor —
it is a decision, not a constraint, and several docs had been treating it as a physical fact and
building reasoning on top of it.

**Usable band for Program 4 is roughly 1900–2600 RPM**, set by the FPH5 at both ends:

- **Floor:** below ~1750 RPM the HX is under its 45 GPM minimum. The Tecmark 3010P enforces this in
  hardware — it is calibrated to drop out at 1500 RPM / ~40 GPM.
- **Ceiling:** the FPH5 maxes at **70 GPM**. On the same linear scaling that produced the 55–60 GPM
  figure, that lands near **2600–2700 RPM**. So Program 4 cannot simply be cranked toward 3450 to
  get more heat recovery — past roughly 2600 it exceeds the exchanger's rated flow.
- Both ends are extrapolated from one measured point. **Confirm with the Blue-White gauge before
  relying on either**, especially before raising the speed.

| Setting | Value | Notes |
|---|---|---|
| Ext. Program 4 RPM | **2200 RPM** (configurable, not locked) | ~55–60 GPM — **extrapolated** by linear scaling from the one direct gauge reading at 1750 RPM, not measured at 2200. Confirm during the sequential flow-meter calibration. |
| Program 4 stop delay | Max / ≥60 s | UI shows seconds. HX flush cool-down after FPH releases pump-call. |
| Input 4 | FPH pump-call (highest priority wins) | Voltage-driven 9–24V AC/DC, NOT dry-contact. Unpolarized. |
| Input 2 | Unused. HA pump control was designed 2026-08-05 and dropped — see "Pump control (L4)" below. | Lower priority than FPH by design. |

Pump display shows "DISPLAY NOT ACTIVE" while an external program runs — normal.

## FPH control topology (manual p.11, p.23–24, p.28–29, p.38, p.41)

- Heat reclaim valve + fan relay + NC solenoid = **one parallel trio on a single 24VAC pair**. This pair IS "pool heat mode." All three energize/de-energize together.
- On AC start: controller force-runs pump for **20 s purge delay** before sampling PT-100. Temp Re-Check periodically re-samples.
- Pump-call output: controller switches one side of 24VAC (HotSpot transformer) → IntelliComm II input 4.
- **90340 relay — verified role and wiring, see dedicated section below.** (Correction, 2026-07-30: an earlier version of this doc said "90340 relay across condenser Y/C tells the FPH controller the compressor is running" — that described the manual's multi-unit diagram (p.23), not this single-unit install. Traced from an actual photo of the box; see below.)

## The interlock, layered

### L1 — hardware flow proof (PRIORITY 1 — installed, wiring remaining)
Tecmark **3010P** SPNO flow switch (+ cover **25165BM**), contacts in series with trio 24VAC leg — installed in line with the wire from FPH controller **Terminal 4** to the 24VAC transformer secondary (HotSpot FPH Heat Pump Installation Manual, "Flow Switch Wiring" diagram, p.27; manual at `~/Desktop/Hot Spot Energy FPH Free Pool Heater Manual.pdf`).
No flow → diverter physically cannot engage. Adjust CW = more GPM required; set to open just below 45 GPM floor.
Manual p.25: pump off during diversion overheats FPH and can damage FPH/compressor. Compressor high-pressure switch is last resort only.

**Install into HX blue "outlet water temp" port:** pull titanium insert + grommet → 3/4" MPT x 1/8" FPT reducer bushing (stainless) threads into the port → Tecmark switch (male 1/8" MPT) threads into the bushing, Teflon tape on both joints. 25165BM cover if exposed.

**Calibrate:** run 1500 RPM (~40 GPM, below floor) → adjust CW until trio drops. Run 2200 RPM → must hold. A used unit that won't hold a trip point gets replaced (~$25).

### L1a — Mars/Supco 90340 relay (downstream of flow switch, drives the trio)

Sits physically between the flow switch output and the trio (heat reclaim valve, bi-directional solenoid, NC fan relay). One relay, one coil, two independent switched poles — it simultaneously **kills fan power** and **applies power to the two valves** the instant the coil energizes. Verified 2026-07-30 by tracing the actual wires in the box against the manufacturer's install sheet, after two rounds of misreading the schematic (see "Common-terminal trap" below — read that before touching this relay).

**Relay identity:** Mars/Supco 90340, DPDT, 24VAC coil, generic HVAC switching relay (same part number sold as a furnace/AC fan relay). Not mentioned by model number anywhere in the HotSpot manual — HotSpot's manual only shows this position as a bare wire junction (single-unit diagram, manual p.22) or, in the *multi-unit* diagram only (manual p.23), as an unlabeled "90340" box used to isolate 24VAC between multiple condensers. **This is a single-A/C-unit install, so the multi-unit meaning does not apply here** — this 90340 is doing double duty as the trio's switching hub, not unit isolation.

**Physical terminal layout (as verified in the box, 2026-07-30):**

| Terminal | Wire | Role |
|---|---|---|
| 1 | Black — from HotSpot 24VAC transformer | Common (pole 1) |
| 2 | Black — to condenser fan | NC contact (pole 1) |
| 3 | *(unused)* | NO contact (pole 1) |
| 4 | White — from HotSpot 24VAC transformer | Common (pole 2) |
| 5 | *(unused)* | NC contact (pole 2) |
| 6 | Red — to heat reclaim valve + bi-directional solenoid | NO contact (pole 2) |
| Coil, left terminal | Yellow (top) + Red (bottom) — continues to next component in the parallel trio bus | Coil leg A |
| Coil, right terminal | White (bottom) — from the FPH flow switch | Coil leg B |

**Behavior:**
- **At rest** (flow switch open / not energized): 1–2 closed → fan runs normally. 4–5 closed but dead-ends (nothing on 5) → no power to the valves.
- **Energized** (flow switch closed, confirming water flow): 1 swings off 2 onto the unused 3 → fan loses power (stops). 4 swings off 5 onto 6 → 24VAC now reaches the heat reclaim valve + bi-directional solenoid, turning heat recovery mode on.
- Net effect: **fan off + valves on, together, only when flow is confirmed** — the flow switch gates the coil, so this relay physically cannot energize the valves without proven flow. This is the same L1 hardware guarantee described above, just traced one hop further downstream.

**Common-terminal trap — read this before wiring or troubleshooting:**
The relay's printed schematic (silkscreened on the case, and in most reprints of it) draws each pole as a pivoting switch arm with a vertical stem dropping to the *middle* terminal (2 for pole 1, 5 for pole 2). That drawing style makes it look like 2 and 5 are the common/pole terminals — **they are not.** Per the manufacturer's actual install sheet (Supco 90340, cited below), the terminal pairs are explicitly listed as **1&2 = NC, 1&3 = NO** and **4&5 = NC, 4&6 = NO** — terminal 1 (and 4) is the one that appears in *both* pairs, which is what makes it the common, regardless of where the drawing's pivot stem appears to land. Trust the manufacturer's stated NC/NO terminal pairs over the pivot-arm drawing.

Source: [Supco 90340 Installation Instructions](https://www.manualslib.com/manual/1430458/Supco-90340.html)

### L2 — hardware pump start
FPH pump-call 24VAC → IntelliComm II GPM/RPM input 4 → RS-485 → pump runs Ext. Program 4 at 2200 RPM. No Pi, no network, no HA in the loop. **Status: IntelliComm II bench-tested ✓. Wiring to FPH remaining.**

### L3 — HA monitoring only
HA failure degrades to "no free heat," never to danger. See HA layer below.

## Wiring remaining (human)

- [x] ~~FPH pump-call pair (reads ~24VAC when AC on + pool below setpoint) → 18AWG t-stat wire → IntelliComm input 4~~ — **DONE**, owner-confirmed 2026-08-07
- [x] ~~Live test: setpoint > water temp, AC on → pump self-starts at 2200 RPM within ~30 s~~ — **DONE**, owner-confirmed 2026-08-07
- [x] Flow switch (Tecmark 3010P) installed — wiring into trio 24VAC leg + calibration still remaining
- [ ] **Breaker-kill acceptance test ONLY after flow switch wired + calibrated.** Until then it creates the dangerous state with nothing to catch it.
- [x] R-40 ionizer control — **DONE, plan changed:** not wired to IntelliFlo accessory output. Instead, Shelly EM Gen3 (`shellyemg3-dcb4d9ce63a4`) on-device script watches `EM1.GetStatus` channel 0 (pump circuit CT) and drives `switch.shellyemg3_dcb4d9ce63a4` (relay → R-40) directly. Threshold 20W, 60s on-delay after pump starts (flow establishment), watts<=0 turns ionizer off immediately. Runs locally on the Shelly — no HA/network dependency, same resilience as the original hardware-interlock plan.

## HA layer (L3 — monitor + alert only)

**Hardware:** ESP8266 HiLetgo (in hand) + 1× White Rodgers Type 84 fan relay (24VAC coil, SPNO, 90-290Q) as an isolated sensing relay + DS18B20 × 3 + hall-effect flow sensor + CT clamp. See `esphome/pool-pad.yaml` for full config.
- Switched from an opto module to this relay: coil taps the 24VAC pair in parallel (non-invasive, same as an opto would), SPNO contact closes 3.3V to the GPIO when energized. GPIO needs an external 10k pulldown to GND (ESP8266 has no internal pulldown except on GPIO16).

**Sensors:**
- `binary_sensor.pool_pad_pool_heat_active` — relay coil across trio 24VAC **after** flow switch
- `sensor.pool_pad_hx_water_in_temp`, `sensor.pool_pad_hx_water_out_temp` — DS18B20 probes in FPH tank sensor wells
- `sensor.pool_pad_pool_temp` — DS18B20 pool return, **deferred, not yet built**: `esphome/pool-pad.yaml` only has the two HX in/out `dallas_temp` blocks today; this is a third probe not yet wired (see Open items below)
- `sensor.pool_pad_pool_flow_gpm` — pulse counter, calibrate against Blue-White gauge, **deferred, not yet built** — flow meter not yet installed
- `sensor.pool_pad_pool_heat_btu_hr` — template: GPM × ΔT(°F) × 500
- `sensor.shellyemg3_dcb4d9ce63a4_energy_meter_0_power` — Shelly EM Gen3, 50A CT on one pump leg (240V, single leg only — see Jeeves tile for running-state derivation). `switch.shellyemg3_dcb4d9ce63a4` drives the R-40 ionizer relay (see ionizer note above).
- Compressor call: T10 via HomeKit (`hvac_action`) — no Resideo cloud needed

**Dropped: FPH pump-call sensor (2026-07-28).** Originally planned as a second relay tapping the FPH's pump-call output (FPH control box terminal ↔ IntelliComm II GPM/RPM Program 4 input), to alert if the FPH requested heat but the trio never energized (flow-switch dropout). Cut after review:
- That failure mode (flow switch fails open despite real flow) only costs lost free heat recovery — no equipment risk. Not worth a second relay, GPIO, and wiring run for a pure efficiency alert.
- The failure mode that actually matters — flow switch stuck *closed* with no real flow, diverting refrigerant into stagnant water (risk of FPH/compressor damage per manual p.25) — isn't caught by the pump-call signal anyway, since in that failure `pool_heat_active` and the pump-call signal would agree with each other while both miss the real problem.
- That dangerous case is instead caught by comparing `pool_heat_active` against `pool_flow_gpm` directly (trio energized/pump running but flow reads ~0) — already-planned sensors, no new hardware needed.
- GPIO4 (D2) is freed up as a result — available for a future use if needed.

**Alert rules (HA automations, phase after monitoring proven):**
- `pool_heat_active && !pool_pump_running` for >30 s → critical alert (L1/L2 failed or bypassed)
- `pool_heat_active && pool_flow_gpm ≈ 0` sustained → critical alert (diverting into stagnant water — the actual danger case)
- Pump off during scheduled hours → warn

## Pump control (L4 — ESP → IntelliComm input 2) — DROPPED 2026-08-05, NOT BUILT

**Do not build this unless explicitly asked.** Designed and reverted the same day. The motivating problem — the main pump running unattended at the wrong time — turned out to be a **booster-pump dry-run risk**, which is solved entirely by the flow meter plus an HA automation with no main-pump control at all ([pool_booster_interlock.md](pool_booster_interlock.md)). The main pump's own 9pm–4pm schedule is fixed and known, so HA can satisfy the booster's "off ≥30 min before the filter pump stops" rule from the schedule alone, without needing to command the pump.

GPIO13 (D7) is free. Config was written and validated, then reverted to a comment block in [esphome/pool-pad.yaml](../esphome/pool-pad.yaml) preserving the findings below.

### Findings retained (if this is ever revisited)

- **Topology would be:** ESP GPIO13 → relay → contact switches 12VDC (shared pad adapter) → IntelliComm II **input 2** → pump runs Ext. Program 2.
- **Input 2, never 4.** Higher input number wins; FPH owns 4, so nothing commanded could interrupt a live diversion.
- **Inputs are voltage-driven, not dry-contact.** The relay must switch a real source — a series switch in a 12V+ leg, not a bare contact across the input terminals.
- **An IntelliComm input can only START a program.** There is no "stop" input. Releasing one means "no external call," after which the pump reverts to its onboard schedule. A genuine remote OFF therefore requires retiring the pump's onboard schedule entirely — at which point the ESP becomes the daily filtration scheduler, and if it dies, filtration stops.
- **Relay polarity trap:** an active-HIGH module is required. GPIO13 idles LOW through boot and reset, so an active-LOW board would start the pump on every ESP reboot.
- **Any such switch needs a local watchdog auto-off**, so a WiFi drop after an on-command can't leave the pump running indefinitely.

*Correction, 2026-08-05:* while this was being designed, a note here warned against adding a low-RPM circulation program on the grounds it could starve the booster pump. That was overstated — Polaris specs the PB4-60 to run on the low-speed setting of a variable-speed pump, and it draws ~24 GPM against a 45–50 GPM baseline. Low-speed programs are fine. The booster's flow-gated interlock is still worth building, but for genuine loss-of-flow (clogged basket, closed valve, lost prime), not for low RPM.

Do NOT add a second RS-485 master (njsPC) while IntelliComm II owns the bus.

## Chemistry

**Probes: pH + temperature only.** ORP is removed from the plan — copper ions + low FC make ORP readings meaningless.
⚠ **Stale — superseded 2026-08-07.** `ha-poolchem` was **rejected**; Jeeves' SQLite is the chemistry system of record, because HA's recorder retention is trimmed for SD-card wear and cannot hold the seasons of history forecasting needs. Copper is measured with a **Hanna HI747**, not a Taylor K-1730, and the target is **0.15–0.20 ppm** — the 0.2–0.4 figure recorded here was wrong, its upper half exceeding the manufacturer maximum. See [pool_chemistry_logging.md](pool_chemistry_logging.md) and [pool_data_addendum.md](pool_data_addendum.md) Part 2. Manual testing with the Taylor K-2006 still covers FC, pH, TA, CH, CYA.

## Parts

**In hand:** ESP8266 HiLetgo, 12VDC adapter (2A) — **shared supply: powers IntelliComm II and ESP8266 off the same 12V/2A adapter** (combined draw well under 2A: IntelliComm modest + ESP8266 ~300mA peak; parallel-tap the 12V+/GND pair rather than daisy-chaining off one set of terminals), Blue-White inline flow gauge, Tecmark 3010P (installed, wiring remaining).

**Flow meter (not yet received):** DN50 (2" MPT, both ends male), 10–300 L/min (~2.6–79 GPM, comfortably covers the 45–70 GPM FPH5 window), 12 pulses/liter, NPN pulse output (works with GPIO12's existing `INPUT_PULLUP`, no external pull-up needed). **Runs on 5V DC, not 12V** — power from the existing buck converter, not the shared 12V adapter (do not power from the ESP8266's 3.3V pin).
- **The DN50's plastic construction was reviewed 2026-08-10 and it is still the right first install** — see [pool_flow_meter_selection.md](pool_flow_meter_selection.md). Chemical attack is a non-issue with a copper/silver ionizer at 0.4 ppm FC; the real risks are UV on the body (shade it) and bearing wear at ~6,900 h/yr, which shows up as a slow *under-read*. Detect it for free by watching indicated GPM **at constant pump watts** (Shelly EM Gen3) and constant filter pressure — **not** "at the locked 2200 RPM", which was the original wording and rested on a Program 4 speed that is in fact user-configurable. Upgrade path if it drifts is a GF Signet 3-2536-P0 at ~$642, not the $500–1000 system price.
- **Needs true-union fittings on both sides** — both ends are male thread, so without a union anywhere in the run, removing/servicing the sensor later means unthreading the entire pipe run. Add to buy list below.
- **Can't install flow meter and Blue-White gauge simultaneously** (no room for both in the run at once) — calibration plan is sequential instead: install Blue-White first, run pump at the Program 4 speed (2200 RPM today), record true GPM; swap in the flow meter **at that same speed setting, unchanged between the two readings**, record pulse rate; compute the real `multiply:` filter value from that pair of readings. Theoretical starting value from the datasheet math: `GPM ≈ pulses/min × 0.02201` — use this as a placeholder in the yaml until the sequential calibration confirms it.

**To buy:**
- 1× White Rodgers Type 84 fan relay, 24VAC coil, SPNO (90-290Q, ~$8.35) + 10k pulldown resistor + female quick-disconnect (Faston) terminals for wiring
- Waterproof DS18B20 × 3 — **done, 2 installed (HX in/out); pool-return probe deferred**
- 2× true-union fittings, 2" female MPT, sized to mate with the DN50 flow meter's male threads on both sides
- CT clamp: Shelly EM or SCT-013 (for pump watts)
- 3/4" MPT x 1/8" FPT reducer bushing (stainless), Teflon tape
- 18AWG thermostat wire
- Taylor K-2006 test kit

## Open items

- [ ] Confirm IntelliComm II cable P/N 350122 in hand; measure run to pump
- [x] ~~Measure pool return pipe diameter before ordering flow sensor~~ — **2" pipe**, owner-confirmed 2026-08-07. The DN50 meter already on order is the correct size. Matches the TA100D's 2" multiport valve.
- [ ] Tune Program 4 stop delay to max available on pump UI
- [ ] After flow sensor install: calibrate pulse multiplier against Blue-White at 2200 RPM
- [ ] Open note: confirm whether IntelliFlo accessory output is line-voltage or low-voltage relay signal (check when drive cover is open)
- [ ] Later: refrigerant line-temp/ΔT BTU metering, flow meter retires RPM guesswork
