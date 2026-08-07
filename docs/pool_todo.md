# Pool — consolidated action list

Last updated: 2026-08-07. **This is an index, not a design doc.** Every item
points at the doc that explains it. Rationale lives there; this file only says
what to do, in what order, and what is blocking it.

Source docs: [pool_heat_recovery.md](pool_heat_recovery.md) ·
[pool_booster_interlock.md](pool_booster_interlock.md) ·
[pool_data_addendum.md](pool_data_addendum.md) ·
[pool_chemistry_logging.md](pool_chemistry_logging.md) ·
[pool_wiring_manual.md](pool_wiring_manual.md)

---

## 0. Go look at things — free, no dependencies, unblocks the rest

One trip to the pad with a phone, plus one website login. **Do this first** —
four other tiers are waiting on answers from here.

- [ ] **What filter is it** — sand, DE, or cartridge, and the model off the label.
      Blocks: clean-baseline PSI, backwash-vs-clean alert wording, whether the
      gauge port is on a rotatable multiport valve. → data_addendum
- [ ] **Confirm the filter gauge is 1/4" NPT** — same trip, 10-second look at the
      threads. → data_addendum
- [ ] **Inspect the R-40 electrode capsule: CLE-02 or CLE-51?** Determines whether
      this pool has any silver sanitation or is copper-only. → data_addendum
- [ ] **Confirm the PG&E rate plan — EV2-A or E-TOU-C.** Login to pge.com. If
      EV2-A, shifting the booster window past midnight is worth ~$10–15/month for
      a free schedule change. → booster_interlock
- [ ] **Measure Polaris 280 wheel RPM** — pump running, cleaner held below water,
      count revolutions for one minute. Target 28–32. Do this *before* touching
      restrictor discs or the relief valve. → booster_interlock
- [ ] **Confirm PB4-60 nameplate voltage as actually wired** (230V vs 115V).
      Changes nothing operationally; belongs in the wiring manual. → booster_interlock

## 1. Order parts — nothing depends on anything, buy in one go

Full spec and reasoning per line item in
[pool_data_addendum.md](pool_data_addendum.md) Part 3.

- [ ] **Chemistry group (~$228)** — Hanna HI701 + 2× HI701-25 reagent, Hanna
      **HI747** (low range copper — *not* the HI702) + HI747-25 reagent, Taylor
      K-2006, TDS pen. **Usable the day it arrives, no wiring.**
- [ ] **Pressure group (~$76)** — 0–30 PSI transducer (1/4" NPT male, 0.5–4.5V,
      5V supply, stainless), 1/4" brass street tee, PTFE tape, ADS1115, 1%
      resistors (4.7k, 3× 10k), 100 µF electrolytic + 0.1 µF ceramic, 3-conductor
      22 AWG shielded cable, WAGO 221s.
- [ ] **CT clamp (~$15)** for the Shelly EM Gen3 `IB` channel — destined for the
      **booster** circuit, not the pump's second leg. → booster_interlock

## 2. Chemistry baseline — as soon as the kit lands

No wiring, no code. This is the data the forecasting model will be fitted to.

- [ ] **Measure TDS first.** Must be 500–3000 ppm or the R-40 physically cannot
      produce ions at any dial setting. Never verified. If this is low, it
      explains any ionizer underperformance and everything else is noise.
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

- [ ] **Verify the DN50 (2") meter matches the actual return pipe.** The
      heat_recovery doc still carries "measure pipe diameter *before* ordering" —
      that item is **stale**, the meter is already on order as DN50. Confirm fit
      rather than re-deciding.
- [ ] Source true-union fittings.
- [ ] Install. Powers from the existing 5V buck rail alongside the ESP.
- [ ] **Calibrate against the Blue-White gauge at locked 2200 RPM**, sequentially
      (both cannot be in the run at once). Replace the theoretical
      `multiply: 0.02201` placeholder in `esphome/pool-pad.yaml` with the measured
      value. → heat_recovery

## 4. Booster dry-run interlock — the actual safety item

Gated entirely on tier 3. This is the one where failure destroys hardware.
→ [pool_booster_interlock.md](pool_booster_interlock.md)

- [ ] Recreate the sweep schedule as an HA automation.
- [ ] **Delete the schedule from the Tuya app.** This is the step that makes it
      safe — without it, Tuya can still start the booster while HA is down.
- [ ] HA gating: turn on only when flow is proven **and** sustained ≥30 min
      **and** inside the window. Turn off immediately on flow loss, main pump
      stop, 30 min before scheduled pump stop, or **flow sensor unavailable**
      (unknown flow = no flow, fail closed).
- [ ] Install the CT on the booster circuit → runtime logging + **watts-too-low**
      dry-run alarm. Inverted from every other appliance alert in the house.
- [ ] If EV2-A confirmed in tier 0: shift the window to ~12:30–2:00am.

## 5. Filter pressure — gated on tier 0 (filter ID) + tier 1 (parts)

→ [pool_data_addendum.md](pool_data_addendum.md) Part 1

- [ ] Plumb the street tee + transducer into the existing gauge port. **Bleed the
      filter to zero PSI first.** Keep the analog gauge on the other branch.
- [ ] Wire: ADS1115 on GPIO4/GPIO13, 4.7k/10k divider into A0, 10k/10k rail
      divider into A1, 100 µF + 0.1 µF at the transducer supply.
- [ ] Decide bonding for the brass tee + transducer body (680.26(B)(6)).
- [ ] Uncomment the ADS1115 block in `esphome/pool-pad.yaml`, flash from the Mac.
- [ ] Two-point calibrate against the analog gauge (0 PSI bled, then 2200 RPM).
- [ ] **Establish the clean-filter baseline PSI at 2200 RPM immediately after the
      next backwash/clean.** Everything downstream compares to this number.
- [ ] Add a `filter_pressure` column to `pool_heat_samples` in `jeeves/db.js`.

## 6. Chemistry logging + forecasting — software

→ [pool_chemistry_logging.md](pool_chemistry_logging.md). Needs tier 2 data and
two decisions still open.

- [ ] **Decide: log-only, or dose calculator?** Calculator needs pool volume,
      target bands, and chemical config up front — more setup, but it is the part
      that would get weekly use.
- [ ] **Ratify or reject dropping ha-poolchem** in favour of Jeeves' SQLite as
      system of record.
- [ ] Record pool volume — required for any dose math.
- [ ] Build `pool_tests` / `pool_doses` / `pool_actions` tables + poolside phone UI.
- [ ] Enforce: **reject or flag a copper reading within ~24h of a recorded shock**
      — high chlorine bleaches the test to near zero.
- [ ] Voice for verbs/doses only; screen for numbers.

## 7. Heat recovery — remaining

→ [pool_heat_recovery.md](pool_heat_recovery.md)

- [ ] **Retune `out_temp_offset_f`** (currently provisional 0.3°F, set 2026-08-05)
      against several days of data across a wider water-temp range. If the gap
      tracks temperature rather than staying flat, replace with a
      `calibrate_linear` two-point fit.
- [ ] Pool-return probe — third DS18B20, add a `dallas_temp` block.
- [ ] **Breaker-kill acceptance test — only after the flow switch is wired and
      calibrated.** Before that it creates the dangerous state with nothing to
      catch it.
- [ ] Tune Program 4 stop delay to max available on the pump UI.
- [ ] **Verify status of three possibly-stale items:** "FPH pump-call pair →
      IntelliComm input 4" and "live test: pump self-starts at 2200 RPM" are
      listed open but the system is working; CLAUDE.md still lists "relay/opto
      inputs" as remaining though the White Rodgers appears installed per the
      wiring manual. Confirm and close.
- [ ] Open question: is the IntelliFlo accessory output line-voltage or
      low-voltage? Check next time the drive cover is off.

## 8. Documentation debt

→ [pool_wiring_manual.md](pool_wiring_manual.md)

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

## Parked — do not build unless asked

- LocalTuya (HACS) fallback if Tuya cloud latency on the booster off-command
  proves unacceptable.
- ESP32 pH node — separate build, 8266 ADC too weak for analog pH. After the pad
  node is proven.
- Pool water level sensor — would feed the copper dilution model, but a much
  larger install than anything above.
- Refrigerant line-temp / ΔT BTU metering.
- Phosphate testing — only if chasing algae. Under 125 ppb.
