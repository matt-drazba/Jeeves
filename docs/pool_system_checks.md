# Pool System Checks — monthly, changeover, and power-cycle

**What this is:** the recurring verification list for the pool and heat recovery system. Not a build list — [pool_todo.md](pool_todo.md) is the build list, and every item here assumes the thing being checked is already installed.

**Why it exists:** most of this system's failure modes are silent. The booster destroys its seal in minutes while drawing *less* current than normal. A flow switch that fails closed looks identical to one working correctly. A probe offset of 0.3 °F disarmed a safety alert for a day without changing a single reading anyone looked at. **None of those announce themselves**, and several have no alert behind them at all (see the gaps table below). Periodically going and looking is the compensating control.

Last updated: 2026-09-03. Companion docs: [pool_wiring_manual.md](pool_wiring_manual.md) (as-built wiring) · [pool_booster_interlock.md](pool_booster_interlock.md) · [pool_heat_recovery.md](pool_heat_recovery.md) · [pool_data_addendum.md](pool_data_addendum.md) (chemistry targets and sources) · [alerting_runbook.md](alerting_runbook.md).

---

## ⚠ Read this before assuming a pool season

**The pool runs 12 months a year.** It is never closed, drained, blown out, or plugged — there is no freeze risk at this location. The pump keeps its 19-hour window year-round and the Polaris stays in the water.

**It is covered, though.** A **manual solar blanket**, on whenever nobody is swimming and **continuously Nov 1 – Mar 31**. No motor, no reel automation, no HA integration — nothing to monitor and nothing that can fail electrically. But it is not incidental to how this pool behaves: it drives heat retention, cuts UV loss of chlorine, slows pH rise by reducing aeration, and keeps debris out. **Evaporation is dramatic whenever it comes off.** Several checks below only make sense in light of it.

**The only thing that shuts down is the FPH free-heat unit**, and it shuts down because the heat pump gets switched from A/C to heat mode around Nov 1. Heat recovery only harvests on a *cooling* call, so from that point until spring there is nothing for it to do.

Two consequences worth stating up front, because both look like faults and neither is:

- The heat exchanger sits in the **circulating return line**, so pool water moves through it every day the pump runs whether or not refrigerant is being diverted. **It does not stagnate over the winter.** Do not invent a task to prevent that.
- Pool *use* stops about Nov 1 – Mar 31 even though the pool keeps running. That changes chemistry demand, not the pool's operation. See check 6.

---

## The gaps these checks exist to cover

Automation covers a lot of this system. It does not cover these, and a check is the only thing standing behind them:

| Gap | Why nothing catches it | Covered by |
|---|---|---|
| **Heat-recovery interlock** — FPH diverting while the main pump is unpowered | The alert is **not built**. Both signals report into HA; nothing consumes them together. See `pool_wiring_manual.md` 3.1 and 4.5 | Monthly check 4 (summer only), and the spring changeover |
| **Deadhead** — pump running against a closed valve | Flow meter is not installed, so no flow-based signal exists yet | Monthly check 3 (filter pressure, by eye) |
| **Flow switch drift** — trip point wanders below the FPH5 floor | Nothing measures actual flow to compare against | Spring changeover |
| **`pool_heat_active` true while the FPH is disabled** | Nothing watches for it; in winter it is an anomaly rather than a normal state | Monthly check 4, winter form |
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

⚠ Known gap: the script scans every Home Assistant package, but the `ALERT_REGISTRY` in `jeeves/server.js` is still unchecked.

### 2. Open alerts and the acknowledge trail

Open the alert overlay on the dashboard (tap the alert strip or the `alerts` tile).

- [ ] Any open flag older than a week means an alert fired and was never acknowledged — flags clear **only** on Acknowledge, never on recovery, so a fault that self-healed at 2 a.m. still shows here. That is the design; go find out what happened.
- [ ] Zero alerts all month is a result worth noticing, not a pass to skim past. **L1 budget is under ~6/year.** Steady L2/L3 noise means the levels are wrong, which is a bug in [alerting_levels.md](alerting_levels.md), not a fact about the pool.

⚠ **The ΔT ≤ 0 L3 cannot fire Nov–Mar.** It is gated on `pool_heat_active`, and with the FPH disabled that is never true. It is **dormant, not disarmed and not broken** — worth knowing, since "an alert that never fires" is exactly what a silently broken one looks like.

### 3. Filter pressure, by eye

Read the gauge on the Tagelus TA100D with the pump at its normal speed.

| Reading | Meaning |
|---|---|
| ~10–15 psi | Clean baseline for this filter |
| **+8–10 psi over your clean baseline** | Backwash now |
| Climbing toward 50 psi | **Stop.** That is the filter's ceiling and a blown lid is an injury risk, not just equipment loss |
| Unusually *low* with the pump running | Suction-side problem — closed valve, clogged skimmer, air leak, lost prime |

The pressure sensor now records this reading, but it does not replace the analog gauge as the field reference. The dashboard trend remains unavailable until a clean-filter baseline is recorded; backwash is deliberately not on a calendar.

Note the reading moves with pump speed, so record which speed you read it at — comparing a 1750 RPM reading against a 2000 RPM one will invent a trend that isn't there.

### 4. Heat recovery — and the winter version of the same check

**Summer (FPH enabled).** This is the check that stands in for the interlock alert that does not exist. Do it on a day the A/C is running in cooling with the pool below 92 °F.

- [ ] Pump spins up to ~2200 RPM shortly after the compressor starts (terminal 3, not flow-gated)
- [ ] **Wait ~2 minutes** for the purge delay to expire — judging sooner is judging wrong
- [ ] **The condenser fan stops.** That, not the pump, is the only proof heat is being recovered
- [ ] `binary_sensor.pool_pad_pool_heat_active` follows within a couple of seconds
- [ ] HX outlet temp climbs above inlet within a few minutes

A small ΔT is probably a stage-1 compressor run, not a fault. **ΔT at or below zero while heat-active is on is a real fault** and should have raised an L3 — if it did not, suspect the probe offset before believing the exchanger is fine. If the fan keeps spinning, go to `pool_wiring_manual.md` 6.1.

**Winter (FPH disabled), Nov–Mar.** The summer check is impossible — no cooling call comes, so there is nothing to observe. Nothing covers the gap and nothing needs to: the FPH is inert. The check inverts instead:

- [ ] ⚠ **`pool_heat_active` must be false, always.** With the FPH disabled at its controller it should never go true. If it does, the disable did not take or something is calling the diversion circuit anyway — investigate before the next cooling call
- [ ] The pump should never self-start to Program 4. If it spins up to 2200 RPM without you asking, the FPH is still calling

### 5. The Tuya app has no schedule ⚠

Open the Tuya/Smart Life app, find the pool sweep timer, and confirm **there is no schedule on it.**

**The Tuya schedule was deleted 2026-08-08 and must never be re-added.** HA is the only thing that commands `switch.pool_sweep_socket_1`, and that is precisely what makes the dry-run interlock safe: every failure mode — HA down, network down, Tuya cloud down — degrades to "the booster never runs." A schedule living in Tuya's cloud can start the PB4-60 with no idea whether the main pump is running, and HA cannot see it to stop it. Check monthly, because app updates and shared accounts can put one back.

### 6. Chemistry

Targets are R-40 ionizer numbers, not conventional-pool numbers. Full table and sources in [pool_data_addendum.md](pool_data_addendum.md).

| Test | Target | Note |
|---|---|---|
| Free chlorine | **≥ 0.4 ppm** floor | EPA label requirement, not a comfort setting |
| **pH** | **7.2–7.6** | ⚠ Above 7.6 the copper ions fall out of solution and the ionizer stops working. A sanitizer-efficacy parameter, not comfort |
| Copper | **0.15–0.20 ppm** | R-40 manual p.14 |
| TA / calcium | TA 80–140 · CH 150–350 | |
| **TDS** | **500–3000 ppm** | ⚠ Hard floor — below 500 the R-40 cannot produce ions at all |

**Targets do not change in winter.** FC ≥ 0.4 is a label floor and pH ≤ 7.6 is what keeps copper in solution; neither relaxes because nobody is swimming. What changes is **demand** — with cold water, no bathers, and less UV it collapses, so you add far less while aiming at the same numbers.

**The solar blanket is doing a lot of this work.** It blocks the UV that destroys chlorine and suppresses the surface aeration that drives pH up, so demand is lower than an uncovered pool of this size would suggest — and lower again Nov–Mar when it never comes off. Evaporation is large whenever it is off, but **evaporation plus top-up is net-neutral for copper** (evaporation concentrates, top-up dilutes back) — do not model top-ups as dilution.

**Copper drifting low is usually a pH problem, not a dosing problem.** Check pH before adding anything.

⚠ **A basic kit exists and is in use — a drop-reagent test kit plus the R-40's own CLA-41 ion kit — but the higher-resolution Hanna Group A kit (HI747/HI701) is still on order** ([pool_todo.md](pool_todo.md)). Readings so far: pH 7.4, FC 1.0, TA 130, copper 0.1 ppm ([pool_chemistry_log.md](pool_chemistry_log.md)). So pH and copper **can** be measured today, just not at Group A's resolution — the pH and copper *alerts* in `alerting_levels.md` are still blocked (no automation wired to a manual reading), which is the real gap. Algae on the walls remains a useful secondary signal, not the only one.

⚠ **On test frequency — the fixed intervals are a placeholder, not a rule.** The 3-day / 7-day / 30-day cadences currently in the `tasks` table exist only because there is no forecasting model yet. Cadence is meant to be *predicted* from logged history — when will FC actually reach the floor — not set by calendar. **Do not add seasonal intervals** or winter logic to `jeeves/db.js`; that entrenches the placeholder the model is meant to replace.

**Winter chemistry specifics are an open question.** This is the first documented winter. Log the season and let the model learn it rather than guessing numbers now.

### 7. Sweep and cleaner

- [ ] Sweep ran on schedule (21:45–23:15) — a miss should have raised the 11:45 p.m. L3
- [ ] Polaris 280 is moving the whole pool, not parked in a corner
- [ ] **Wheel RPM 28–32**, if it is covering poorly. Measure with the pump running and the cleaner held below water, counting revolutions for one minute. Tune by wheel RPM, never by GPM. Under 28: pull the blue restrictor disc, then check the quick-disconnect filter screen, hoses, swivels, gate valve, and baskets. Full procedure in [pool_booster_interlock.md](pool_booster_interlock.md)

The Polaris runs **under the solar blanket** — the blanket stays on during the 21:45–23:15 window, and the cleaner works fine beneath it.

⚠ **90 minutes is the summer floor. Do not trim it.** Shorter summer runs let **algae form on the walls quickly** (owner-confirmed 2026-08-10). `pool_booster_interlock.md` previously suggested trying 75 then 60 minutes if the pool looked clean; that has been corrected. Runtime is wear, but algae is worse.

⚠ **If algae returns at 90 minutes, that is a chemistry finding, not a cleaning one.** Copper is the algaecide here — at 0.15–0.20 ppm with pH ≤ 7.6 the R-40 should be suppressing algae by itself, and above pH 7.6 the ions fall out of solution. **Check pH before adding cleaner runtime.** Adding hours treats the symptom of a sanitizer that has stopped working.

Winter is different: blanket on continuously, pool unused, debris load and algae pressure both collapse. **Cutting the winter run is an open candidate** — see Part 2. It has not been decided or measured.

### 8. Sensors are alive and honest

- [ ] Pad node online in HA (a 30-min outage should have raised an L3)
- [ ] Shelly EM reporting — pump reads roughly **172 W** on one leg at 1750 RPM, **< 20 W** when off
- [ ] **HX in/out probes agree to within ~0.1 °F with the pump running and heat off.** They quantize in 0.1125 °F steps, so a genuine offset shows as a persistent gap, not noise. If one appears, do **not** paper over it with `out_temp_offset_f` — that field is currently `0.0` and a non-zero value silently disarms the ΔT ≤ 0 alert. Calibrate from logged samples, never a spot reading

---

## Part 2 — The changeover (~Nov 1 and ~Apr 1)

One event, twice a year, triggered by switching the heat pump between cool and heat mode. **This is not opening or closing a pool** — see the note at the top. The pool keeps running throughout; the FPH stops, and the pump speeds come down.

### To winter mode (~Nov 1)

- [ ] Switch the heat pump to **heat mode** at the thermostat
- [ ] **Disable the FPH at its controller.** ⚠ *Record the exact control the first time you do this* — which button, menu, or switch — and replace this line with its real name. Guessing at it in advance would be worse than leaving it blank
- [ ] **Verify the disable took.** `binary_sensor.pool_pad_pool_heat_active` stays false, and the pump no longer self-starts to Program 4 when the compressor runs. This is the whole point of the step; a disable that did not take is invisible otherwise
- [ ] Lower the pump speeds — see the RPM table below
- [ ] The solar blanket now stays on continuously until spring. Nothing to switch; noted because it is what makes the reduced winter demand below reasonable
- [ ] *Optional, undecided:* consider shortening the sweep run. Blanket on 24/7 plus no swimmers means far less debris and algae pressure — but **90 min is the summer floor for a reason** (check 7), so treat any winter reduction as an experiment to watch, not a setting to trust
- [ ] Record a baseline snapshot while it is fresh: filter pressure at clean (and at which speed), pump watts at each speed, current chemistry, and the FPH setpoint as you found it
- [ ] Confirm no open alert flags are being carried into the winter
- [ ] Log anything that misbehaved over the summer while you still remember it

### To summer mode (~Apr 1)

**This is the more important of the two.** The first cooling call of the year is the first time in ~5 months that the flow switch, the 90340, the heat reclaim valve, and the bi-directional solenoid have moved. Verify the interlock deliberately, on a day you choose, rather than discovering it broken.

- [ ] Re-enable the FPH at its controller; thermostat back to cool
- [ ] Restore summer pump speeds
- [ ] Run monthly checks 3 and 8 first — filter and sensors
- [ ] Confirm the FPH setpoint and Ext. Program 4 RPM match what the autumn snapshot recorded
- [ ] **Watch one full cycle end to end:** compressor start → pump to ~2200 RPM → ~2 min purge → **condenser fan stops** → `pool_heat_active` true → outlet temp climbs above inlet
- [ ] Confirm the pump rides out the ≥10 min stop delay after the call drops, then returns to schedule
- [ ] **Re-verify the flow switch trip point.** Run the pump at 1500 RPM (~40 GPM, below the FPH5's 45 GPM floor) — the trio must drop out. Return to 2200 RPM — it must hold solidly. **A switch that will not hold a stable trip point gets replaced (~$25). Do not nurse one along, and never jumper it to test**
- [ ] Confirm nothing fired an L1 or L2 during any of the above

If the flow meter has been installed since autumn, this is also the day to calibrate it — sequential procedure in `pool_wiring_manual.md` 5.1 — and to set `FLOW_DEADHEAD_GPM` against a real reading rather than the datasheet's theoretical `0.02201`.

### Pump speeds — recorded, not prescribed

⚠ **No RPM is being legislated here, and the winter figures are guesses.** They stay guesses until the flow meter is installed and calibrated (blocked on `pool_wiring_manual.md` 5.1), because nothing in this system measures actual water movement today. Change them freely; just update this table when you do.

| | Sweep window (21:45–23:15) | Rest of the 19 h |
|---|---|---|
| **Summer — current, actual** | 2000 RPM | 1750 RPM |
| **Winter — intent, uncalibrated guess** | 2000 RPM | 1500 RPM |

Reasoning, recorded as the owner's rather than derived: colder water and no bathers need less turnover, so the daytime speed comes down while the sweep window stays put.

**Ext. Program 4 is not in this table and is not affected.** The FPH commands Program 4 at 2200 RPM directly, and the highest-numbered active external program wins — so heat recovery gets its own flow regardless of what the daily schedule is set to. Lowering the schedule speed cannot starve the heat exchanger.

Two constraints that will bound the answer **once the meter lands**. Neither is a rule today:

- **The booster probably sets the practical floor, not the electrics.** The PB4-60 draws ~24 GPM, which `pool_heat_recovery.md` calls ample margin against a 45–50 GPM baseline. The lower the daytime speed goes, the less true that becomes — though the sweep window is staying at 2000 RPM, which is where it actually matters.
- **~1000 RPM is a hard floor regardless.** The 20 W "pump running" threshold is calibrated against ~172 W at 1750 RPM (`jeeves_alerts.yaml:136-138`). Pump power falls as roughly RPM³, so somewhere near 900 RPM a *running* pump would read as off — which false-fires the L2 every night **and** makes the booster dry-run detector believe the main pump is dead. Nowhere near the speeds under discussion; written down so nobody wanders there later.

---

## Part 3 — Power down and power up

Covers planned electrical work and recovery after an outage. **Order matters, and getting it wrong is the one thing here that can destroy a pump.**

### Power down (planned)

1. [ ] Turn the sweep off first and let the booster stop. **Never leave the booster energized into a shutdown**
2. [ ] Let the main pump run a few more minutes, then stop it
3. [ ] Kill the A/C 240V at the breaker if any work touches the heat pump, FPH, or the 24VAC control wiring — **capacitors hold a lethal charge after disconnect; discharge them**
4. [ ] Note valve positions before touching anything, especially the multiport handle
5. [ ] Note that HA loses its view of everything: alerts do not fire during an outage, planned or not

### Power up ⚠

**The pump comes back before the booster. Always.** The PB4-60 is not self-priming, has no dry-run protection, and its water-lubricated seal fails within minutes of running dry — while drawing *less* current, so no breaker, overload, or high-amp alert will catch it. The manual requires the booster start **≥30 min after** the filter pump.

1. [ ] **Multiport handle is on Filter** before anything is energized. Never turn the handle with the pump running
2. [ ] Restore main pump power. Confirm it primes — watch for the basket to fill and pressure to come up. Air lock is normal after any drain-down; purge it before assuming a fault
3. [ ] **Check the IntelliFlo2's clock and schedule.** It can come back wrong after an outage. Confirm the 9 p.m.–4 p.m. window is intact, that both schedule speeds survived, and that **Ext. Program 4 is still 2200 RPM** — if Program 4 got cleared, heat recovery silently stops working with no other symptom
4. [ ] Confirm the Shelly EM is back and reading real watts, and that its **on-device ionizer script** resumed (it runs independently of HA by design — 20 W threshold, 60 s on-delay for flow establishment)
5. [ ] Confirm the pad node rejoined Wi-Fi and its entities are live in HA
6. [ ] **Wait ≥30 minutes of proven pump runtime before the booster runs.** The HA sweep schedule already enforces this and will skip the run rather than risk it — let it. Do not hand-start the sweep to "test" it
7. [ ] In winter, re-confirm the FPH is still disabled — a power cycle is exactly when a controller setting could revert
8. [ ] Run `python3 scripts/verify-alerts.py`
9. [ ] Re-check the Tuya app for a schedule (check 5) — a cloud reconnect is when odd things resurface

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
- **Never re-add a schedule in the Tuya app.** See check 5.

---

## Changelog

| Date | Change |
|---|---|
| 2026-08-08 | Document created. Monthly / seasonal / power-cycle checks, scoped to pool + heat recovery. |
| 2026-08-10 | **Seasonal model rewritten — the original was wrong.** It described a pool season with a shutdown and a startup. The pool runs **12 months a year**; the **FPH is the only thing that shuts down**, via a **disable on its own controller**, triggered by switching the heat pump to heat mode ~Nov 1. Part 2 restructured as one changeover run twice a year. Pump speeds recorded as **two-speed** (2000 RPM sweep window / 1750 RPM otherwise) — a fact that appeared in no document until now — with winter figures marked as uncalibrated guesses and **no RPM legislated** pending the flow meter. Monthly check 4 split into summer and winter forms, the winter one inverting to "`pool_heat_active` must never be true." Noted that the ΔT ≤ 0 L3 is **dormant, not broken**, Nov–Mar. Chemistry reframed: targets unchanged year-round, demand collapses, and the fixed test intervals flagged as a **placeholder pending the forecasting model** rather than a rule to build seasonal logic on. |

| 2026-08-10 | **Solar blanket recorded — it was missing from every document.** The pool is covered by a **manual** solar blanket whenever nobody is swimming, and **continuously Nov 1 – Mar 31**. The intro previously claimed the pool is "never covered," which was wrong. No motor and no HA integration, so nothing to monitor and no maintenance check earned. Its real effects are recorded where they bite: heat retention, reduced UV loss of chlorine and slower pH rise (check 6), large evaporation whenever it is off, and the cleaner running beneath it (check 7). Also recorded: **the FPH still calls regularly** despite the blanket, so monthly check 4 stays runnable as written. |
| 2026-08-10 | **90-minute sweep runtime confirmed as a floor, not a starting point.** Shorter summer runs let algae form on the walls quickly. `pool_booster_interlock.md` had explicitly advised trying 75 then 60 minutes — corrected there too. Added the corollary that **wall algae is a chemistry signal before a cleaning one** (copper is the algaecide; above pH 7.6 the ions drop out of solution), and that with no test kit in hand the algae is currently the *only* sanitizer feedback this pool produces. |

### Open questions

- [ ] **Name the FPH controller's disable** the first time it is used, and replace the placeholder line in Part 2.
- [ ] **Winter sweep runtime** — the blanket stays on 24/7 and the pool is unused, so a shorter run is plausible. Undecided and unmeasured. Watch the walls if it is tried.
- [ ] **Get the Group A test kit.** Until then pH and copper cannot be measured, both alerts stay blocked, and algae is the only sanitizer signal available.
- [ ] Filter clean baseline is stated as ~10–15 psi from the TA100D spec, **not measured on this filter.** Record the real number at the next backwash, along with the pump speed it was read at.
- [ ] Winter pump speeds are guesses. Set them from measured flow once the meter is installed and calibrated.
- [ ] Winter chemistry behaviour is unknown — first documented winter. Log it rather than predicting it.
- [ ] Monthly check 4 (summer form) needs a cooling day with the pool below setpoint, which may not fall on the first weekend of the month. Decide whether it slips to "first suitable day."
