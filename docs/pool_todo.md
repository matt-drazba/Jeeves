# Pool — consolidated action list

Last updated: 2026-08-07. **This is an index, not a design doc.** Every item
points at the doc that explains it. Rationale lives there; this file only says
what to do, in what order, and what is blocking it.

Source docs: [pool_heat_recovery.md](pool_heat_recovery.md) ·
[pool_booster_interlock.md](pool_booster_interlock.md) ·
[pool_data_addendum.md](pool_data_addendum.md) ·
[pool_chemistry_logging.md](pool_chemistry_logging.md) ·
[pool_wiring_manual.md](pool_wiring_manual.md) ·
[pool_valve_position_sensing.md](pool_valve_position_sensing.md)

**Recurring checks are not in this file.** One-time build tasks live here;
monthly, seasonal, and power-cycle verification lives in
[pool_system_checks.md](pool_system_checks.md).

---

## 0. Go look at things — mostly closed 2026-08-07

- [x] ~~**What filter is it**~~ — **Pentair Tagelus TA100D**, 30" top-mount
      **sand**, 4.9 sq ft, 600 lb sand, 2" multiport, 100 GPM design flow, 50 psi
      max. Alert wording is "backwash." Expect a clean baseline around 10–15 psi
- [x] ~~**Confirm the filter gauge is 1/4" NPT**~~ — yes, standard Pentair
      multiport thread
- [x] ~~**Inspect the R-40 electrode capsule**~~ — **CLE-02, copper only.** The
      CLE-51 silver upgrade was assessed and **declined** — it changes nothing
      measurable or tunable, does not relax the 0.4 ppm chlorine floor, and is a
      recurring cost since electrodes are consumable. → data_addendum Part 2
- [x] ~~**Confirm PB4-60 nameplate**~~ — 3/4 HP, 3450 RPM, 230/115V, SF amps
      6.4/12.8. Dual-voltage nameplate, so this states capability not
      configuration; 230V/~1.5 kW inferred from the 240V Tuya switch
Tier 0 is **closed.** Three residual owner's-call items moved to "Whenever you
feel like it" at the bottom — they are not blocking anything and should not be
raised again unasked.

## 1. Order parts — nothing depends on anything, buy in one go

Full spec and reasoning per line item in
[pool_data_addendum.md](pool_data_addendum.md) Part 3.

- [ ] **Group A — chemistry (~$239)** — Hanna **HI747** (low range copper, *not*
      the HI702) + 2× HI747-25, Hanna HI701 + 3× HI701-25, Taylor K-2006,
      **HM Digital TDS-3** pen, 1 gal distilled water. **Usable the day it
      arrives, no wiring. Buy this one first.**
- [x] ~~**Group B — pressure sensing, main parts**~~ — **BOUGHT 2026-08-07:**
      automotive-sender transducer **150 psi**, 1/8"-27 NPT male, 0.5–4.5V on 5V,
      316 SS, 300 psi burst, sealed QD + pigtail · **1/4"MNPT × 1/8"FNPT brass
      reducing bushing** · 1/4" brass street tee · **ShillehTek pre-soldered
      ADS1115**.
- [ ] **Group B remainder — passives and wiring, ~$20.** Both the resistors and
      the capacitors are **required**, not optional — reasoning in
      data_addendum "Are the passives actually necessary?".
      - 1% metal film: **4.7k ×1, 10k ×1** (signal divider). Add **10k ×2** if
        doing the optional A1 rail compensation.
      - **100 µF electrolytic + 0.1 µF ceramic** — mounted at the *transducer's*
        supply pins, not the ADC.
      - 3-conductor 22 AWG shielded cable, **2× 5-conductor WAGO 221**, PTFE tape.
- [ ] **CT clamp (~$15)** for the Shelly EM Gen3 `IB` channel — destined for the
      **booster** circuit, not the pump's second leg. → booster_interlock

## 2. Chemistry baseline — started 2026-08-10, not waiting on the kit

No wiring, no code. This is the data the forecasting model will be fitted to.

**Testing is already underway** with a drop-reagent kit and the CLA-41 ion kit
that shipped with the R-40 — the Group A purchase improves resolution, it was
never a prerequisite for starting. Readings go in
[pool_chemistry_log.md](pool_chemistry_log.md) until the SQLite tables in tier 6
exist.

### Open thread — copper reads low, dial moved 2 → 3 on 2026-08-10

First logged test: pH 7.4, FC 1.0, TA 130 — all in range — with **copper 0.1 ppm**
against a 0.15–0.20 target. pH and chlorine being in range already rule out the
R-40 manual's two most common causes (p.18 #6, #7), so this is a real output or
conductivity question. → data_addendum Part 2 for the dial table and the ordered
cause list.

- [ ] **Retest copper 2026-08-13.** Expect the match at 0.15 or higher; setting 3
      should add ~0.037 ppm/day at best. **Do not move the dial again before the
      retest** — two changes inside one interval makes it uninterpretable.
- [ ] **If the retest is flat: check the internal 115/230 VAC selector.** Set to
      230 on a 115 V supply, the R-40 runs at **half output**, permanently and
      silently. Never verified on this unit.
- [ ] **If still unexplained: measure electrode current** (p.19 #13) — multimeter
      in series with one electrode lead, chamber full, pump running. ~500 mA at
      setting 5. **One test discriminates the voltage switch, dirty electrodes,
      and low TDS.**
- [ ] Date the CLA-41 reagents, or replace them. Age is currently unknown, and
      stale reagents read low — which is this exact symptom.

- [ ] **Measure TDS first.** Must be 500–3000 ppm or the R-40 physically cannot
      produce ions at any dial setting. Never verified. If this is low, it
      explains any ionizer underperformance and everything else is noise.
      **Now the leading suspect for the low copper above.**
- [ ] **Full baseline panel** — copper (target **0.15–0.20 ppm**), FC (floor 0.4
      ppm), pH (**7.2–7.6**, and this is a sanitiser-efficacy parameter here, not
      comfort), TA 80–140, CH 150–350, CYA (only matters if > 150).
- [ ] **Confirm which sequestering agent is in use, if any.** Several common ones
      strip copper and would read as an unexplained crash in the dilution model.
      Safe: Pool Stain Treat, The Ionizer Stuff. Not safe: Sequasol, Cop-Out,
      Metal Magnet, alum.
- [ ] Date the reagent packs on arrival. Replace yearly.
- [ ] Test more often than the target cadence for the first month — the point is
      to learn *this* pool's decay and drift rates.

## 3. Flow meter — the choke point

**Three separate workstreams are blocked on this.** Highest-leverage hardware
task on the list.

- [x] ~~Verify the DN50 (2") meter matches the actual return pipe~~ —
      **2" confirmed** 2026-08-07. DN50 is correct, and it matches the TA100D's
      2" multiport valve. Stale "measure before ordering" item removed from
      heat_recovery.
- [ ] Source true-union fittings.
- [ ] Install. Powers from the existing 5V buck rail alongside the ESP.
- [ ] **Calibrate against the Blue-White gauge at locked 2200 RPM**, sequentially
      (both cannot be in the run at once). Replace the theoretical
      `multiply: 0.02201` placeholder in `esphome/pool-pad.yaml` with the measured
      value. → heat_recovery

## 4. Booster dry-run interlock — the actual safety item

Gated entirely on tier 3. This is the one where failure destroys hardware.
→ [pool_booster_interlock.md](pool_booster_interlock.md)

- [x] ~~Recreate the sweep schedule as an HA automation.~~ **Done** — 9:45–11:15pm,
      gated on the pump having genuinely run ≥30 min. Verified running 2026-08-08.
- [x] ~~**Delete the schedule from the Tuya app.**~~ **Done 2026-08-08. Never
      re-add one.** HA is now the only thing that commands the switch, which is
      what makes the interlock safe: every failure path (HA down, network down,
      Tuya cloud down) degrades to "the booster never runs."
- [x] ~~Dry-run interlock~~ **Live** — booster on + pump under 20 W for 30 s kills
      the sweep, retries, re-checks. Kill confirmed = L2, kill **unconfirmed = L1**.
      Fails closed: an unavailable meter reads as pump-off and still kills.
      Currently gates on **watts, not flow** — see the interim note below.
- [x] ~~Manual sweep control~~ — the original outside-window guard killed any
      hand-started run within 15 minutes, silently, which read as a broken
      switch. Replaced 2026-08-08 with a **2-hour runtime cap** (the owner's max
      for this pool size; normal runs are 90 min). Field-verified: a 90-minute
      manual run completed with no silent kill. The dry-run interlock stays armed
      throughout, so safety is unchanged.
- [ ] **Upgrade the interlock from watts to measured flow.** Blocked on tier 3.
      Watts prove the pump is energized, not that it is moving water. Turn off
      immediately on flow loss, main pump stop, 30 min before scheduled pump
      stop, or **flow sensor unavailable** (unknown flow = no flow, fail closed).
- [ ] Install the CT on the booster circuit → runtime logging + **watts-too-low**
      dry-run alarm. Inverted from every other appliance alert in the house.
- [ ] If EV2-A confirmed in tier 0: shift the window to ~12:30–2:00am.

## 5. Filter pressure — gated on tier 0 (filter ID) + tier 1 (parts)

→ [pool_data_addendum.md](pool_data_addendum.md) Part 1

- [ ] **Dry-fit the whole stack before taping anything** — tee → bushing →
      transducer is four sealed joints on a plastic multiport boss. Check
      clearance through the multiport handle's full rotation.
- [ ] Plumb it. **Bleed the filter to zero PSI first** (pump off at the breaker,
      air relief open, confirm the analog gauge reads 0). Keep the analog gauge
      on the other tee branch. PTFE on every male thread. Hand tight + 1–2 turns
      — the boss is plastic. Orient the transducer **down or sideways**, never
      straight out, and strain-relieve the cable.
- [ ] Wire: **ADS1115 powered at 3.3V** (ESP 3V3 pin — this is what makes the
      divider mandatory and the I2C levels correct), SDA GPIO4 / SCL GPIO13,
      4.7k/10k divider into A0, optional 10k/10k rail divider into A1,
      100 µF + 0.1 µF at the **transducer's** supply pins. 5V for the transducer
      comes off the buck via the new WAGO splices.
- [ ] Decide bonding for the brass tee + transducer body (680.26(B)(6)).
- [ ] Uncomment the ADS1115 block in `esphome/pool-pad.yaml`, flash from the Mac.
      **Scale constant 187.5** for the 150 psi sensor.
- [ ] Two-point calibrate against the analog gauge (0 PSI bled, then 2200 RPM).
- [ ] **Establish the clean-filter baseline PSI at 2200 RPM immediately after the
      next backwash/clean.** Everything downstream compares to this number.
- [ ] Add a `filter_pressure` column to `pool_heat_samples` in `jeeves/db.js`.

## 6. Chemistry logging + forecasting — software

→ [pool_chemistry_logging.md](pool_chemistry_logging.md). Needs tier 2 data and
two decisions still open.

**Both former open questions are now decided** (owner-confirmed 2026-08-07):
SQLite is the system of record — **ha-poolchem is not being installed** — and
**log-only ships first, dose calculator is phase 2.**

- [x] ~~**Record pool volume**~~ — **28,800 gallons** (owner estimate
      2026-08-07, ±10%). R-40 is correctly sized (rated 40k). Turnover ≈2×/day.
      **No prerequisites left — this tier is unblocked once the Group A kit
      arrives.**
- [ ] Build `pool_tests` / `pool_doses` / `pool_actions` tables + poolside phone UI.
- [ ] Enforce: **reject or flag a copper reading within ~24h of a recorded shock**
      — high chlorine bleaches the test to near zero.
- [ ] Voice for verbs/doses only; screen for numbers.

## 7. Heat recovery — remaining

→ [pool_heat_recovery.md](pool_heat_recovery.md)

- [x] ~~**Retune `out_temp_offset_f`**~~ — **the 2026-08-08 conclusion was
      wrong, see §7c.** The probes do not agree; they differ by +0.3°F. The
      offset is genuinely 0.0 on the device and the HX L3 is still disarmed.
- [ ] Pool-return probe — third DS18B20, add a `dallas_temp` block.
- [ ] **Breaker-kill acceptance test — only after the flow switch is wired and
      calibrated.** Before that it creates the dangerous state with nothing to
      catch it.
- [ ] Tune Program 4 stop delay to max available on the pump UI.

## 7c. HX probe calibration + solar shielding — OPEN, alert is disarmed

→ **[pool_probe_calibration.md](pool_probe_calibration.md)** — full evidence,
procedure, and product list. Do these **in order**; shielding changes the
offset, so calibrating first means doing it twice.

- [ ] **Step 1 — shield both legs identically.** Closed-cell only, reflective
      outer jacket, cover the thermowell and fitting, not just the pipe. **Same
      material and length on inlet and outlet** — ΔT is a difference, so a
      symmetric load cancels and an asymmetric one is the whole problem.
      **Never a towel or any woven fabric**: it wicks, stays wet on a pool pad,
      and becomes an evaporative cooler. Buy: [PexUniverse 2" self-seal
      foam](https://pexuniverse.com/2-id-x-1-2-wall-self-seal-pipe-insulation)
      (~$8) + a PVC jacket or foil tape. ~$20 total.
- [ ] **Step 2 — verify the shield worked.** No instruments needed. On the next
      sunny afternoon watch the no-flow excursion after the pump stops: it hit
      **+5.51°F at 08-08 16:58 with heat recovery off**. If it collapses toward
      the ~0.3°F probe offset, solar radiation was the driver. Large effect —
      one afternoon answers it.
- [ ] **Step 3 — two-point calibration, ice bath + boiling.** Only after Step 2,
      probes shielded and in final position. Three points, full procedure in the
      doc:
      - **Ice point (0.00°C / 32.0°F)** — crushed-ice slush in distilled water,
        *not* cubes floating in water. Stir, probe mid-depth, 2 cm clear of the
        walls, log 20+ readings and take the median (12-bit LSB is 0.1125°F).
      - **Steam point — altitude-corrected, NOT 100°C.** Look up the pad's
        elevation and the day's barometric pressure; roughly −1°C per 935 ft.
        Measure in the steam above the boil, not in the liquid. **Check the
        probe's cable junction rating first** — the DS18B20 die is good to
        125°C but the heat-shrink joint on cheap waterproof probes often is
        not, and boiling is a common way to kill one. Skippable.
      - **~80°F stirred bath — the one that actually matters.** Both probes in
        the same bucket, stirred continuously (unstirred water stratifies by
        tenths and you measure the stratification). The median of `out − in`
        **is** the offset. For ΔT the probes only need to agree with each
        other, not with SI — a shared absolute error cancels — and ice/steam
        bracket a 75–90°F operating range so asymmetrically that a two-point
        fit extrapolated to the middle can be worse than a single-point offset
        taken at 80°F. Take all three; weight this one.
- [ ] **Step 4 — apply it and confirm the alert is armed.** `offset:` is added
      to the outlet in °F, so outlet reading high by 0.3 → `"-0.3"`. If the gap
      tracks temperature instead of staying flat, switch to `calibrate_linear`.
      Then verify ΔT reads 0.00 ± one LSB pump-running/heat-off, consider moving
      the HX L3 threshold to ≈ −0.15°F so quantization noise on a legitimate
      low-stage run cannot trip it, and run `verify-alerts.py`.
      `check_config` passing proves none of this.
- [ ] Pool-return probe — third DS18B20, add a `dallas_temp` block.
- [ ] **Breaker-kill acceptance test — only after the flow switch is wired and
      calibrated.** Before that it creates the dangerous state with nothing to
      catch it.
- [ ] Tune Program 4 stop delay to max available on the pump UI.
- [x] ~~Verify status of three possibly-stale items~~ — **all three closed
      2026-08-07.** FPH pump-call pair → IntelliComm input 4: done. Live test,
      pump self-starts at 2200 RPM: done. White Rodgers relay installed, **no
      optocouplers** — CLAUDE.md corrected.
- [ ] Open question: is the IntelliFlo accessory output line-voltage or
      low-voltage? Check next time the drive cover is off.
- [ ] **Re-derive HX output once calibrated.** Current best estimate from
      2026-08-09, the only two logged heat-recovery runs (280 min + 26 min):
      true HX gain **+0.49°F** (0.79 active − 0.30 baseline) = **13,500–14,700
      BTU/hr** at 55–60 GPM, contributing **~10%** of that day's pool rise; the
      rest is sun and the solar blanket. Consistent with stage-1 compressor
      operation. Both the baseline and the flow figure are provisional — recheck
      after §7c and after the flow meter lands.

## 7b. Dashboard + alerting — shipped 2026-08-08

→ [alerting_runbook.md](alerting_runbook.md), [alerting_levels.md](alerting_levels.md)

- [x] ~~Six alerts live~~ — dry-run kill (L1/L2), pump off in window (L2), pad
      node offline (L3), meter offline (L3), HX not transferring (L3), sweep
      skipped (L3). Acknowledge via iOS Critical Alert action or the tablet.
- [x] ~~Pool page on the dashboard~~ — hero readings, 24h schedule timeline,
      two stacked history charts, pad readout. Tap a pool tile; auto-returns.
- [x] ~~Alert management from the tablet~~ — overlay lists open alerts with age,
      the runbook line, and **whether the underlying detector is still active**.
      Open flags never clear on recovery, so "still open" and "still broken" are
      different questions the phone notification cannot answer.
- [x] ~~`pool_heat_samples` logging actually running~~ — the code predated the
      deployed container and had never executed. Writes every 2 min while heat
      recovery is active, 10 min otherwise.
- [x] ~~Maintenance mode removed~~ — a global L2–L4 mute that nothing ever turned
      off. Any future suppression must **expire on its own**.
- [ ] **Extend `verify-alerts.py` to scan `jeeves/server.js`.** It only reads
      `jeeves_alerts.yaml` today, so the `ALERT_REGISTRY` added 2026-08-08 —
      seven flag entities and six detector sensors — is unchecked. That is
      exactly the silent-failure mode the script was written for. Roughly a
      three-line change; would retroactively cover every HA entity Jeeves touches.
- [ ] Nothing can alert when HA itself is down — it kills the pump, the meter,
      and the messenger together. Needs a watcher outside the house. Unresolved.

## 8. Documentation debt

→ [pool_wiring_manual.md](pool_wiring_manual.md)

- [x] ~~Manual section 4.5 said "no alerts exist yet"~~ — corrected 2026-08-08,
      along with the 3.1 coverage table.
- [ ] Bond the FPH heat exchanger to the pad loop (Part 7).
- [ ] **Label wires physically at the 90340 and the chimney box** — ferrules or
      numbered markers, given the documented white/white collision. Prose warnings
      don't survive a rewire.
- [ ] Take the Part 8 photos; draw the three per-box annotated diagrams. 90340
      terminals first.
- [ ] Copy the FPH manual PDF into the repo so the doc stands alone without a
      `~/Desktop` path.
- [ ] Opportunistically confirm the 90340 contact-power routing next time the box
      is open.

## 9. Multiport valve position — Filter and Closed

→ [pool_valve_position_sensing.md](pool_valve_position_sensing.md)

Approach decided 2026-08-10. Blocks nothing, and nothing blocks it — buy whenever.
Sense **Filter** and **Closed** only; the backwash family is inferred from
"left Filter, wasn't Closed, then pressure dropped and flow jumped."

- [ ] **Order (~$70)** — Sonoff Zigbee 3.0 USB Dongle Plus · 2× Third Reality
      contact sensor (**AAA, not coin cell** — rechargeables actually work) ·
      2× small plastic outdoor junction box · 1 small disc magnet.
- [ ] Stand up the Zigbee coordinator on the Pi (ZHA). First Zigbee device in
      the house.
- [ ] Find the two mounting spots on the handle. **The handle lifts ~½" before it
      turns** — mount beside the arc, not under it. Clearance competes with the
      transducer tee (→ data_addendum).
- [ ] Confirm Zigbee reaches the pad. If not, one mains-powered Zigbee plug
      between house and pool as a repeater. Do not buy up front.
- [ ] Write the **"handle left in Backwash"** alert. Level unratified — it is a
      drain-the-pool hazard, so probably L1, but L1 budget is under ~6/year.

## Whenever you feel like it — owner's call, nothing blocked, do not re-raise

These are real but optional. Nothing downstream waits on them. **Do not surface
these unprompted.**

- **PG&E rate plan — EV2-A or E-TOU-C?** One login at pge.com. If EV2-A, shifting
  the booster window past midnight moves ~68 kWh/month from part-peak to
  off-peak, worth roughly $10–15/month for a free schedule change. If E-TOU-C,
  there is nothing to do. → booster_interlock
- **Polaris 280 wheel RPM.** Pump running, cleaner held below water, count wheel
  revolutions for one minute. Target 28–32. Only matters if the cleaner is
  underperforming — and if it is, measure this *before* touching restrictor discs
  or the relief valve. → booster_interlock
- **Booster's actual wired voltage** at the breaker or switch. The nameplate is
  dual-voltage so 230V/~1.5 kW is currently inferred from the 240V Tuya switch.
  Affects only the precision of the TOU math.

## Settled — decided, do not re-litigate

Recorded so these do not get reopened years later. Each has full reasoning in the
linked doc; this is the index.

| Decision | Verdict | Date | Why, in one line |
|---|---|---|---|
| **CLE-51 silver electrode upgrade** | **Declined** | 2026-08-07 | The ion test reads copper, the target is copper, and silver rides the same dial — you cannot read, verify, or tune it. Does not relax the 0.4 ppm chlorine floor. Electrodes are consumable, so it is a recurring premium. Revisit only on a real sanitation failure. → data_addendum Part 2 |
| Copper meter: HI702 vs **HI747** | **HI747** (low range) | 2026-08-07 | HI702's error window is wider than twice the entire 0.15–0.20 ppm target band. It cannot tell in-spec from out-of-spec. → data_addendum Part 2 |
| Photometer (LaMotte Spin Touch) | **Declined** | 2026-08-07 | ~$900 to avoid a 10-minute test that HI701 + HI747 + K-2006 cover for ~$239 |
| Combination pH/TDS/salinity pen | **Declined** | 2026-08-07 | pH is covered by the K-2006 with a reagent test that cannot drift. A silently drifting pH pen is the worst failure available here — it presents as a copper problem |
| ORP probe | **Declined** | pre-existing | Meaningless with copper ions and deliberately low free chlorine |
| Salt / EC / conductivity probe | **Declined** | 2026-08-07 | Not a salt pool. TDS is a once-a-year pen check, not a live sensor |
| MQTT → InfluxDB → Grafana | **Declined** | 2026-08-07 | Banned by CLAUDE.md hard rules. SQLite is system of record, Jeeves is the UI, and Grafana could not host the poolside entry form anyway |
| ESP32 rebuild of the pad node | **Declined** | 2026-08-07 | ESP8266 is flashed and working. ESP32 is justified only for the separate pH node |
| Transducer range | **150 PSI — purchased.** Spec had moved 0–30 → 0–60 → 0–80; availability settled it | 2026-08-07 | Wider than ideal but acceptable: "% of full scale" is dominated by offset and span error, which cancel in a differential against a self-established baseline. Residual is repeatability/hysteresis, ~±0.2–0.4 psi. Burst 300 psi. **ESPHome scale constant 187.5** (`FS_psi / 0.80`). If ever replaced, prefer 60–100 psi and change that one number |
| Transducer thread | **NPT only — never BSPP/G1/4** | 2026-08-07 | G1/4 is BSPP, a *parallel* thread; NPT is tapered. Forcing one into the other leaks or cracks the plastic multiport boss. **NPT-to-NPT reducing bushings are fine** — an earlier "no adapters" note was too absolute |
| Transducer sourcing | **1/8" NPT sensor + 1/4"M × 1/8"F brass bushing**, or buy configurable from Transducers Direct | 2026-08-07 | Amazon listings contradict themselves — title "1/4 NPT" vs spec "G1/4", and title range lists that are keyword stuffing with no variation dropdown. The 1/8" NPT automotive sender market is large and unambiguously labelled. Commodity electrical performance was never the issue; **verifiability** is |
| Transducer grade: commodity vs industrial | **Commodity (~$25)** | 2026-08-07 | The measurement is a difference against a self-established baseline, so offset and gain errors cancel. Baseline is re-established after every backwash, so only weeks of stability are needed. Omega PX109 / Gems 3100 are correct but ~6× the price for no gain here |
| Keep the analog filter gauge | **Yes — tee it** | 2026-08-07 | It is the calibration reference for the transducer, it reads when the ESP/power is down, and it is the only thing a pool tech will look at. $8 |
| **ha-poolchem vs SQLite** | **Drop ha-poolchem. Jeeves' SQLite is the system of record** | 2026-08-07 | HA's recorder retention is short and already trimmed for SD-card wear, so chemistry entered there is purged in days. Forecasting needs seasons of history. ha-poolchem would save writing a form — the easy part — and cost the retention, which is the whole point. Mirror current values *outward* to HA input_numbers one-way if automations want them |
| **Log-only vs dose calculator** | **Both — log-only ships first, calculator is phase 2** | 2026-08-07 | Not either/or, an ordering. Label dose math is unreliable on real pools; the version worth having is self-correcting against what past doses actually achieved, which requires logged history to exist first. Log → few weeks of data → calibrate the calculator against reality |
| Spare CT: pump's 2nd leg vs **booster** | **Booster** | 2026-08-07 | The pump's second leg only refines a known number; the booster CT enables the watts-too-low dry-run alarm |
| Main pump control via IntelliComm | **Dropped** | 2026-08-05 | The motivating problem was booster dry-run, solved by flow meter + HA with no pump control. Findings kept in `esphome/pool-pad.yaml` |

All rows above are **owner-confirmed.** Nothing in this table is open.

## Parked — do not build unless asked

- LocalTuya (HACS) fallback if Tuya cloud latency on the booster off-command
  proves unacceptable.
- ESP32 pH node — separate build, 8266 ADC too weak for analog pH. After the pad
  node is proven.
- Pool water level sensor — would feed the copper dilution model, but a much
  larger install than anything above.
- Refrigerant line-temp / ΔT BTU metering.
- Phosphate testing — only if chasing algae. Under 125 ppb.
