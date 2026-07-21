# Pool Heat Recovery — HotSpot FPH5 + IntelliFlo2 VST

Last updated: 2026-07-10. Authority order: CLAUDE.md → this doc → coder briefs.
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
| Sanitizer | **Clearwater MineralPURE R-40** copper/silver ionizer (40k gal). Low residual chlorine (~90% reduction; small residual still required). Copper target **0.2–0.4 ppm**. |

## Locked program config

| Setting | Value | Notes |
|---|---|---|
| Ext. Program 4 RPM | **2200 RPM** | ~55–60 GPM. Measured, not estimated. |
| Program 4 stop delay | Max / ≥60 s | UI shows seconds. HX flush cool-down after FPH releases pump-call. |
| Input 4 | FPH pump-call (highest priority wins) | Voltage-driven 9–24V AC/DC, NOT dry-contact. Unpolarized. |
| Input 2 | Reserved — future HA relay (`switch.pool_pump_boost`) | Lower priority than FPH by design. |

Pump display shows "DISPLAY NOT ACTIVE" while an external program runs — normal.

## FPH control topology (manual p.11, p.23–24, p.28–29, p.38, p.41)

- Heat reclaim valve + fan relay + NC solenoid = **one parallel trio on a single 24VAC pair**. This pair IS "pool heat mode." All three energize/de-energize together.
- 90340 relay across condenser Y/C tells the FPH controller the compressor is running.
- On AC start: controller force-runs pump for **20 s purge delay** before sampling PT-100. Temp Re-Check periodically re-samples.
- Pump-call output: controller switches one side of 24VAC (HotSpot transformer) → IntelliComm II input 4.

## The interlock, layered

### L1 — hardware flow proof (PRIORITY 1 — not yet installed)
Tecmark **3010P** SPNO flow switch (+ cover **25165BM**), contacts in series with trio 24VAC leg (manual p.28).
No flow → diverter physically cannot engage. Adjust CW = more GPM required; set to open just below 45 GPM floor.
Manual p.25: pump off during diversion overheats FPH and can damage FPH/compressor. Compressor high-pressure switch is last resort only.

**Install into HX blue "outlet water temp" port:** pull titanium insert + grommet → 3/4" MPT x 1/8" FPT reducer bushing (stainless) threads into the port → Tecmark switch (male 1/8" MPT) threads into the bushing, Teflon tape on both joints. 25165BM cover if exposed.

**Calibrate:** run 1500 RPM (~40 GPM, below floor) → adjust CW until trio drops. Run 2200 RPM → must hold. A used unit that won't hold a trip point gets replaced (~$25).

### L2 — hardware pump start
FPH pump-call 24VAC → IntelliComm II GPM/RPM input 4 → RS-485 → pump runs Ext. Program 4 at 2200 RPM. No Pi, no network, no HA in the loop. **Status: IntelliComm II bench-tested ✓. Wiring to FPH remaining.**

### L3 — HA monitoring only
HA failure degrades to "no free heat," never to danger. See HA layer below.

## Wiring remaining (human)

- [ ] FPH pump-call pair (reads ~24VAC when AC on + pool below setpoint) → 18AWG t-stat wire → IntelliComm input 4
- [ ] Live test: setpoint > water temp, AC on → pump self-starts at 2200 RPM within ~30 s
- [ ] Flow switch install + calibrate on arrival (Tecmark 3010P, ~5 days out)
- [ ] **Breaker-kill acceptance test ONLY after flow switch installed.** Until then it creates the dangerous state with nothing to catch it.
- [x] R-40 ionizer control — **DONE, plan changed:** not wired to IntelliFlo accessory output. Instead, Shelly EM Gen3 (`shellyemg3-dcb4d9ce63a4`) on-device script watches `EM1.GetStatus` channel 0 (pump circuit CT) and drives `switch.shellyemg3_dcb4d9ce63a4` (relay → R-40) directly. Threshold 20W, 60s on-delay after pump starts (flow establishment), watts<=0 turns ionizer off immediately. Runs locally on the Shelly — no HA/network dependency, same resilience as the original hardware-interlock plan.

## HA layer (L3 — monitor + alert only)

**Hardware:** ESP8266 HiLetgo (in hand) + 3–24V AC/DC optocoupler module (2+ ch) + DS18B20 × 3 + hall-effect flow sensor + CT clamp. See `esphome/pool-pad.yaml` for full config.

**Sensors:**
- `binary_sensor.pool_pad_pool_heat_active` — opto ch1 across trio 24VAC **after** flow switch
- `binary_sensor.pool_pad_fph_pump_call` — opto ch2 across FPH pump-call output
- `sensor.pool_pad_hx_water_in_temp`, `sensor.pool_pad_hx_water_out_temp` — DS18B20 probes in FPH tank sensor wells
- `sensor.pool_pad_pool_temp` — DS18B20 pool return
- `sensor.pool_pad_pool_flow_gpm` — pulse counter, calibrate against Blue-White gauge
- `sensor.pool_pad_pool_heat_btu_hr` — template: GPM × ΔT(°F) × 500
- `sensor.shellyemg3_dcb4d9ce63a4_energy_meter_0_power` — Shelly EM Gen3, 50A CT on one pump leg (240V, single leg only — see Jeeves tile for running-state derivation). `switch.shellyemg3_dcb4d9ce63a4` drives the R-40 ionizer relay (see ionizer note above).
- Compressor call: T10 via HomeKit (`hvac_action`) — no Resideo cloud needed

**Alert rules (HA automations, phase after monitoring proven):**
- `pool_heat_active && !pool_pump_running` for >30 s → critical alert (L1/L2 failed or bypassed)
- `fph_pump_call && !pool_heat_active` sustained → flow-switch dropout alert
- Pump off during scheduled hours → warn

**Phase 2 — HA control (after monitoring proven):**
ESP32 relay → IntelliComm input 2 → `switch.pool_pump_boost` for pre-swim/automations.
Do NOT add a second RS-485 master (njsPC) while IntelliComm II owns the bus.

## Chemistry

**Probes: pH + temperature only.** ORP is removed from the plan — copper ions + low FC make ORP readings meaningless.
Manual testing with Taylor K-2006 feeds ha-poolchem: FC, pH, TA, CH, CYA.
Copper tracked separately (Taylor K-1730) as its own HA input_number, target 0.2–0.4 ppm — not a ha-poolchem input.

## Parts

**In hand:** ESP8266 HiLetgo, 12VDC adapter (2A), Blue-White inline flow gauge, Tecmark 3010P arriving ~5 days.

**To buy:**
- 3–24V AC/DC optocoupler module, 2+ channels (~$7)
- Waterproof DS18B20 × 3
- Hall-effect pulse flow sensor — **measure pipe first: 1.5" vs 2"**; calibrate against Blue-White
- CT clamp: Shelly EM or SCT-013 (for pump watts)
- 3/4" MPT x 1/8" FPT reducer bushing (stainless), Teflon tape
- 18AWG thermostat wire
- Taylor K-2006 test kit

## Open items

- [ ] Confirm IntelliComm II cable P/N 350122 in hand; measure run to pump
- [ ] Measure pool return pipe diameter before ordering flow sensor
- [ ] Tune Program 4 stop delay to max available on pump UI
- [ ] After flow sensor install: calibrate pulse multiplier against Blue-White at 2200 RPM
- [ ] Open note: confirm whether IntelliFlo accessory output is line-voltage or low-voltage relay signal (check when drive cover is open)
- [ ] Later: refrigerant line-temp/ΔT BTU metering, flow meter retires RPM guesswork
