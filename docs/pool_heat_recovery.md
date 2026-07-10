# Hardware Integrations — Pool Heat Recovery (HotSpot FPH) + IntelliFlo Pump

Status: design settled 2026-07-10. Source: HotSpot FPH installer manual (44p scan, on file),
Pentair IntelliComm II install guide, TFP/community RS-485 references.
Authority order: CLAUDE.md → this doc → coder briefs.

## System facts (verified)

- **Pump:** Pentair IntelliFlo2 VST 3.0 HP, firmware **1.23-VS** (predates the buggy 3.03/3.04
  RS-485 firmware — no Pentair flash needed). Classic Pentair RS-485 protocol (011056-family;
  the protocol break is IntelliFlo3 011075+, not this pump). 8 speed slots: 4 button presets +
  4 external programs. Comm terminals currently unused. Schedule lives in the pump — keep it.
- **HVAC:** Bryant 226ANA048-B, 4-ton two-stage heat pump.
- **FPH:** 4-ton ⇒ **FPH5** per manual sizing table: **min 45 GPM / max 70 GPM**, 75k BTU/h max
  heat rejection. (Confirm FPH5 on the HX label.)
- **FPH control topology** (manual p.11, p.23–24, p.28–29, p.38, p.41):
  - Heat reclaim valve + fan relay + NC solenoid = one parallel trio on a single **24VAC pair**;
    all energize/de-energize together. This pair IS "pool heat mode."
  - 90340 relay across condenser Y/C tells the FPH controller the compressor is running.
    Heat-pump variant also reads the reversing valve so recovery only runs in cooling
    ("Type of AC" setting, p.41).
  - On AC start, controller force-runs the pump for a dry-pipe purge delay (default **20 s**)
    before sampling the PT-100; "Temp Re-Check" periodically re-samples. Controller UI only
    active while the AC runs.
  - Pump-call output: controller **switches one side of 24VAC** (HotSpot-supplied transformer)
    intended to drive a contactor coil — or, for VS pumps, an IntelliComm II input (p.11 diagram,
    example uses program 2).

## The interlock, layered (design decision)

**L1 — hardware flow proof:** Tecmark **3010P** flow switch (+ cover **25165BM**), contacts wired
**in series with the trio's 24VAC leg** (manual p.28). No flow ⇒ diverter physically cannot engage.
Adjust: CW = more GPM required; set to open just below the 45 GPM floor.
Manual p.25 is explicit: pump off during diversion overheats the FPH and can damage FPH/compressor;
the compressor high-pressure switch is last-resort only.
**Status: not installed. Purchase + install = priority 1.**

**L2 — hardware pump start:** FPH pump-call 24VAC → IntelliComm II **GPM/RPM input 4** →
RS-485 → pump runs Ext. Program 4. Highest-numbered active input wins, so the FPH always
outranks other triggers. Pure copper path; no Pi, no network, no HA in the loop.

**L3 — HA (monitor + alert only, later control):** HA failure degrades to "no free heat," never danger.

## Wiring job (one afternoon)

- [ ] **Power IntelliComm II:** 9–24 VDC, 200 mA on its power screw-terminal pair.
      Simplest: 12 VDC wall adapter at the pad. (It is NOT powered by mains directly and NOT
      reliably by the comm line, despite retail blurbs — Pentair manual is authoritative.)
- [ ] **Comm:** Pentair cable (P/N 350122, the black cable on hand) IntelliComm II comm
      terminals → pump green/yellow RS-485 terminals. IntelliComm always addresses pump #1.
- [ ] **Pump-call:** FPH switched-24VAC pair → **GPM/RPM 4** input. Inputs are voltage-driven
      (9–24 V DC/AC), NOT dry-contact — do not wire a bare relay contact across them. Unpolarized.
- [ ] **Pump config:** Ext. Program 4 = RPM for ≥45 GPM. Start 2800–3000, tune down with flow
      data. Internal schedule unchanged. Pump display reads "DISPLAY NOT ACTIVE" while an
      external program runs — normal.
- [ ] **Flow switch:** plumb near HX, wire per p.28 in series with trio 24VAC, adjust threshold.
- [ ] **Test:** AC on, pool below setpoint, pump timer OFF → pump must start at program-4 RPM
      within the 20 s purge window; kill pump breaker mid-recovery → trio must drop out
      (flow switch) and compressor must keep running on the air condenser.

## HA layer (ESP32 at the pad, Wi-Fi OK)

Sensing (all passive, opto-isolated AC-voltage inputs rated for 24VAC):
- Across trio 24VAC **after** the flow switch → `binary_sensor.pool_heat_active` (true diverted state)
- Across FPH pump-call output → `binary_sensor.fph_pump_call`
- Compressor call: from T10 via HomeKit (`hvac_action`) — no Resideo cloud needed
- Pump power: CT clamp (Shelly EM or ESP32 + SCT-013) → `binary_sensor.pool_pump_running`,
  `sensor.pool_pump_watts`

Rules:
- `pool_heat_active && !pool_pump_running` for >30 s → critical alert (means L1/L2 failed/bypassed)
- `fph_pump_call && !pool_heat_active` sustained → flow-switch dropout alert (flow problem)
- Pump off during scheduled hours → alert (existing G1 goal)

Control (phase 2, after monitoring proven): ESP32 relay switching 12 V into **GPM/RPM 2** →
`switch.pool_pump_boost` for pre-swim/automations. Lower priority than FPH by design.
Do NOT add a second RS-485 master (njsPC) while IntelliComm II owns the bus; passive sniffing
for RPM/watts is a later option if CT-clamp wattage proves insufficient.

## Shopping list

- [ ] Tecmark 3010P flow switch
- [ ] 25165BM cover
- [ ] 12 VDC wall adapter (for IntelliComm II power)
- [ ] ESP32 dev board
- [ ] AC opto-isolator module (rated 24VAC, for sensing trio + pump-call)
- [ ] CT clamp (SCT-013) or Shelly EM

## Open items

- [ ] Confirm FPH5 on HX label; note HotSpot transformer VA (p.23 shows 240 VA — ample)
- [ ] Locate IntelliComm II + black cable (P/N 350122); measure run to pump (cable = 50 ft)
- [ ] Pick final program-4 RPM once flow measurable
- [ ] Later sections: pool chemistry probes (ESPHome/ha-poolchem), refrigerant
      line-temp/ΔT BTU metering, water flow meter (also retires RPM guesswork above)
