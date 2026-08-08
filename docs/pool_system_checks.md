# Pool System Checks — monthly, seasonal, and power-cycle

**What this is:** the recurring verification list for the pool and heat recovery system. Not a build list — [pool_todo.md](pool_todo.md) is the build list, and every item here assumes the thing being checked is already installed.

**Why it exists:** most of this system's failure modes are silent. The booster destroys its seal in minutes while drawing *less* current than normal. A flow switch that fails closed looks identical to one working correctly. A probe offset of 0.3 °F disarmed a safety alert for a day without changing a single reading anyone looked at. **None of those announce themselves**, and several of them have no alert behind them at all (see the gaps table below). Periodically going and looking is the compensating control.

Last updated: 2026-08-08. Companion docs: [pool_wiring_manual.md](pool_wiring_manual.md) (as-built wiring) · [pool_booster_interlock.md](pool_booster_interlock.md) · [pool_heat_recovery.md](pool_heat_recovery.md) · [pool_data_addendum.md](pool_data_addendum.md) (chemistry targets and sources) · [alerting_runbook.md](alerting_runbook.md).

---

## The gaps these checks exist to cover

Automation covers a lot of this system. It does not cover these, and a check is the only thing standing behind them:

| Gap | Why nothing catches it | Covered by |
|---|---|---|
| **Heat-recovery interlock** — FPH diverting while the main pump is unpowered | The alert is **not built**. Both signals report into HA; nothing consumes them together. See `pool_wiring_manual.md` 3.1 and 4.5 | Monthly check 4, Startup check 5 |
| **Deadhead** — pump running against a closed valve | No flow meter installed, so no signal exists | Monthly check 3 (filter pressure, by eye) |
| **Flow switch drift** — trip point wanders below the FPH5 floor | Nothing measures actual flow to compare against | Seasonal startup check 5 |
| **A Tuya app schedule reappearing** | HA cannot see schedules living in Tuya's cloud | Monthly check 5 |
| **HA itself being down** | The outage kills the pump, the meter, and the messenger together | Nothing. Known blind spot, unresolved |

---

## Part 1 — Monthly (~15 minutes)

Do it on the first weekend of the month. Nothing here needs the equipment off.

### 1. Alert config still resolves

```bash
cd ~/homelab && git pull && python3 scripts/verify-alerts.py
```

Every entity, automation id, and notify service the alerting package references must exist. **`check_config` passing proves none of this** — HA derives a template entity's `entity_id` from its `name`, not its `unique_id`, so a renamed sensor silently orphans any automation pointing at the old id.

⚠ Known gap: the script only scans `jeeves_alerts.yaml`. The `ALERT_REGISTRY` in `jeeves/server.js` is unchecked.

### 2. Open alerts and the acknowledge trail

Open the alert overlay on the dashboard (tap the alert strip or the `alerts` tile).

- [ ] Any open flag older than a week means an alert fired and was never acknowledged — flags clear **only** on Acknowledge, never on recovery, so a fault that self-healed at 2 a.m. still shows here. That is the design; go find out what happened.
- [ ] Zero alerts all month is a result worth noticing, not a pass to skim past. **L1 budget is under ~6/year.** Steady L2/L3 noise means the levels are wrong, which is a bug in [alerting_levels.md](alerting_levels.md), not a fact about the pool.

### 3. Filter pressure, by eye

Read the gauge on the Tagelus TA100D with the pump at its normal RPM.

| Reading | Meaning |
|---|---|
| ~10–15 psi | Clean baseline for this filter |
| **+8–10 psi over your clean baseline** | Backwash now |
| Climbing toward 50 psi | **Stop.** That is the filter's ceiling and a blown lid is an injury risk, not just equipment loss |
| Unusually *low* with the pump running | Suction-side problem — closed valve, clogged skimmer, air leak, lost prime |

There is no pressure sensor, so **this reading is the only deadhead detection this system has.** Write the number down; the trend is what tells you anything, and backwash is deliberately not on a calendar.

### 4. Heat recovery actually diverts ⚠

**This is the check that stands in for the alert that does not exist.** Do it on a day the A/C is running in cooling with the pool below 92 °F.

- [ ] Confirm the pump spins up to ~2200 RPM shortly after the compressor starts (terminal 3, not flow-gated)
- [ ] **Wait ~2 minutes** for the purge delay to expire — judging sooner is judging wrong
- [ ] Confirm the **condenser fan stops.** That, not the pump, is the only proof heat is being recovered
- [ ] Confirm `binary_sensor.pool_pad_pool_heat_active` follows within a couple of seconds
- [ ] Confirm HX outlet temp climbs above inlet within a few minutes

A small ΔT is probably a stage-1 compressor run, not a fault. **ΔT at or below zero while heat-active is on is a real fault** and should have raised an L3 — if it did not, suspect the probe offset before believing the exchanger is fine.

If the fan keeps spinning, go to `pool_wiring_manual.md` 6.1.

### 5. The Tuya app has no schedule ⚠

Open the Tuya/Smart Life app, find the pool sweep timer, and confirm **there is no schedule on it.**

**The Tuya schedule was deleted 2026-08-08 and must never be re-added.** HA is the only thing that commands `switch.pool_sweep_socket_1`, and that is precisely what makes the dry-run interlock safe: every failure mode — HA down, network down, Tuya cloud down — degrades to "the booster never runs." A schedule living in Tuya's cloud can start the PB4-60 with no idea whether the main pump is running, and HA cannot see it to stop it. Check it monthly because app updates and shared accounts can put one back.

### 6. Chemistry

Targets are R-40 ionizer numbers, not conventional-pool numbers. Full table and sources in [pool_data_addendum.md](pool_data_addendum.md).

| Test | Target | Cadence | Note |
|---|---|---|---|
| Free chlorine | **≥ 0.4 ppm** floor | 3 days | EPA label requirement, not a comfort setting |
| **pH** | **7.2–7.6** | 7 days | ⚠ Above 7.6 the copper ions fall out of solution and the ionizer stops working. This is a sanitizer-efficacy parameter |
| Copper | **0.15–0.20 ppm** | 7 days | Per the R-40 manual p.14 |
| TA / calcium | TA 80–140 · CH 150–350 | 30 days | The monthly one |
| **TDS** | **500–3000 ppm** | 365 days | ⚠ Hard floor — below 500 the R-40 cannot produce ions at all |

The 3- and 7-day tests promote themselves onto the dashboard as chore tiles; this monthly pass is for TA/CH and for sanity-checking the trend.

**Copper drifting low is usually a pH problem, not a dosing problem.** Check pH before adding anything.

### 7. Sweep and cleaner

- [ ] Sweep ran on schedule (21:45–23:15) — a miss should have raised the 11:45 p.m. L3
- [ ] Polaris 280 is moving the whole pool, not parked in a corner
- [ ] **Wheel RPM 28–32**, if it is covering poorly. Measure with the pump running and the cleaner held below water, counting revolutions for one minute. Tune by wheel RPM, never by GPM. Under 28: pull the blue restrictor disc, then check the quick-disconnect filter screen, hoses, swivels, gate valve, and baskets. Full procedure in [pool_booster_interlock.md](pool_booster_interlock.md)

### 8. Sensors are alive and honest

- [ ] Pad node online in HA (a 30-min outage should have raised an L3)
- [ ] Shelly EM reporting — pump reads roughly **172 W** on one leg while running, **< 20 W** when off
- [ ] **HX in/out probes agree to within ~0.1 °F with the pump running and heat off.** They quantize in 0.1125 °F steps, so a genuine offset shows as a persistent gap, not noise. If one appears, do **not** paper over it with `out_temp_offset_f` — that field is currently `0.0` and a non-zero value silently disarms the ΔT ≤ 0 alert. Calibrate from logged samples, never a spot reading

---

## Part 2 — Seasonal (cooling season)

Heat recovery only harvests on a **cooling** call, so the FPH side is dormant all winter while the pump keeps running its normal 19-hour schedule year-round.

**There is no winterization here.** This location has no freeze risk. Nothing gets drained, blown out, or plugged. And because the exchanger sits in the circulating return line, pool water moves through it every day the pump runs whether or not refrigerant is being diverted — **the HX does not stagnate over the winter.** Do not invent a task to prevent that.

### Shutdown — last cooling of the season (~October)

The point is to record a known-good state while the system is still fresh in memory, so spring startup has something to compare against.

- [ ] Record final numbers: filter pressure at clean baseline, pump watts at 2200 RPM, a representative HX ΔT during a real diversion, current chemistry
- [ ] Note the FPH setpoint (**92 °F** as of this writing) — if anyone changes it over the winter, this is the record of what it was
- [ ] Note the pump schedule and that Ext. Program 4 is still 2200 RPM
- [ ] Confirm no open alert flags are being carried into the off-season
- [ ] Log anything that misbehaved during the season while you still remember it

### Startup — first cooling of the season (~April/May) ⚠

**This is the most important checklist in this document.** The first cooling call of the year is the first time in ~6 months the flow switch, the 90340, the heat reclaim valve, and the bi-directional solenoid have moved. Verify the interlock deliberately, on a day you choose, rather than discovering it broken.

1. [ ] Read Part 1 checks 3, 4 and 8 first — filter, sensors, probes
2. [ ] Confirm the FPH setpoint and pump Ext. Program 4 RPM match what shutdown recorded
3. [ ] **Watch a full cycle end to end:** compressor start → pump spins up (~2200 RPM) → ~2 min purge → condenser fan stops → `pool_heat_active` true → outlet temp climbs above inlet
4. [ ] Confirm the pump keeps running through the ≥10 min stop delay after the call drops, then returns to its schedule
5. [ ] **Verify the flow switch still trips where it should.** Run the pump at 1500 RPM (~40 GPM, below the FPH5's 45 GPM floor) — the trio must drop out. Return to 2200 RPM — it must hold solidly. **A switch that will not hold a stable trip point gets replaced ($25). Do not nurse one along, and never jumper it to test.**
6. [ ] Confirm no L1/L2 fired during any of the above

If the flow meter has been installed since last season, this is also the day to calibrate it — sequential procedure in `pool_wiring_manual.md` 5.1, and `FLOW_DEADHEAD_GPM` needs setting against a real reading, not the datasheet's theoretical `0.02201`.

---

## Part 3 — Power down and power up

Covers planned electrical work and recovery after an outage. **Order matters, and getting it wrong is the one thing here that can destroy a pump.**

### Power down (planned)

1. [ ] Turn the sweep off first and let the booster stop. **Never leave the booster energized into a shutdown**
2. [ ] Let the main pump run a few more minutes, then stop it
3. [ ] Kill the A/C 240V at the breaker if any work touches the heat pump, FPH, or the 24VAC control wiring — **capacitors hold a lethal charge after disconnect; discharge them**
4. [ ] Note valve positions before touching anything, especially the multiport handle
5. [ ] Note that HA will lose its view of everything: alerts do not fire during an outage, planned or not

### Power up ⚠

**The pump comes back before the booster. Always.** The PB4-60 is not self-priming, has no dry-run protection, and its water-lubricated seal fails within minutes of running dry — while drawing *less* current, so no breaker, overload, or high-amp alert will catch it. The manual requires the booster start **≥30 min after** the filter pump.

1. [ ] **Multiport handle is on Filter** before anything is energized. Never turn the handle with the pump running
2. [ ] Restore main pump power. Confirm it primes — watch for the basket to fill and pressure to come up. Air lock is normal after any drain-down; purge it before assuming a fault
3. [ ] **Check the IntelliFlo2's clock and schedule.** It can come back wrong after an outage. Confirm the 9 p.m.–4 p.m. window is intact and **Ext. Program 4 is still 2200 RPM** — if Program 4 got cleared, heat recovery silently stops working with no other symptom
4. [ ] Confirm the Shelly EM is back and reading real watts, and that its **on-device ionizer script** resumed (it runs independently of HA by design — 20 W threshold, 60 s on-delay for flow establishment)
5. [ ] Confirm the pad node rejoined Wi-Fi and its entities are live in HA
6. [ ] **Wait ≥30 minutes of proven pump runtime before the booster runs.** The HA sweep schedule already enforces this and will skip the run rather than risk it — let it. Do not hand-start the sweep to "test" it
7. [ ] Run `python3 scripts/verify-alerts.py`
8. [ ] Re-check the Tuya app for a schedule (Part 1 check 5) — worth repeating here, since a cloud reconnect is exactly when odd things resurface

### Home Assistant after an outage ⚠

A known failure, documented after the 2026-07-19 outage: Docker starts the HA container before DNS is actually usable, and HA's config-entry retry backoff is hardcoded, exponential, and **gives up after a few minutes.** The entries do not recover on their own.

- [ ] Check **Bhyve, LG ThinQ, EcoNet, and Tesla** for `DNS servers unreachable` / failed setup, and reload any that failed
- [ ] Confirm Tuya reconnected — the sweep switch is unreachable without it, which is safe (the booster simply never runs) but silent
- [ ] Confirm the pool package loaded and the alert automations are present

The permanent fix — a healthcheck-gated `depends_on` so HA does not launch until connectivity is confirmed — is still deferred. Until it lands, this manual check is the only thing between an outage and four dead integrations.

---

## Part 4 — When a check fails

| Symptom | Go to |
|---|---|
| No free heat / fan never stops | `pool_wiring_manual.md` 6.1 decision tree |
| Pool heat active but pump not running | `pool_wiring_manual.md` 6.2 — **kill the A/C at the breaker first** |
| Dashboard disagrees with reality | `pool_wiring_manual.md` 6.4 |
| An alert fired and you need to act | [alerting_runbook.md](alerting_runbook.md) |
| Booster / sweep behaviour | [pool_booster_interlock.md](pool_booster_interlock.md) |
| Chemistry out of range | [pool_data_addendum.md](pool_data_addendum.md) |

**Two rules that override any troubleshooting instinct:**

- **Never jumper the flow switch.** Not to test, not for a second. It is the entire safety interlock, and bridging a suspect switch — a normal, sensible habit everywhere else in HVAC — is the one move that creates the dangerous state with nothing left to catch it. Meter across it instead.
- **Never re-add a schedule in the Tuya app.** See Part 1 check 5.

---

## Changelog

| Date | Change |
|---|---|
| 2026-08-08 | Document created. Monthly / seasonal / power-cycle checks, scoped to pool + heat recovery. Monthly check 4 and startup check 5 exist specifically to stand in for the unbuilt heat-recovery interlock alert; when that alert ships, revisit whether they can be relaxed. |

### Open questions

- [ ] Filter clean baseline is stated as ~10–15 psi from the TA100D spec, **not measured on this filter.** Record the real number at the next backwash and correct the table in Part 1 check 3.
- [ ] Monthly check 4 needs a cooling day with the pool below setpoint. In practice that may not line up with the first weekend of the month — decide whether it slips to "first suitable day" or gets its own trigger.
