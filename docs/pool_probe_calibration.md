# HX Probe Calibration and Solar Shielding

Last updated: 2026-08-10. Authority order: CLAUDE.md → this doc → coder briefs.
Companion docs: [pool_heat_recovery.md](pool_heat_recovery.md) (HX, FPH, IntelliComm) ·
[alerting_levels.md](alerting_levels.md) (why the HX alert exists) ·
[pool_todo.md](pool_todo.md) (action list).

**Status: OPEN. The HX heat-recovery alert is disarmed and will not fire.**
Two independent problems, in the order they must be fixed.

---

## The finding

Measured 2026-08-10 against 468 logged samples (08-07 20:16 → 08-10 05:56, no
gaps, no nulls) plus a live check after reflashing the pad node.

With the **pump running and heat recovery off** — both probes sitting in the
same moving water, which is the definition of a zero-delta condition — the
outlet probe reads **+0.3 °F above the inlet**.

| Condition | Median ΔT (out − in) |
|---|---|
| Pump running, heat off, overnight | **+0.34** |
| Pump running, heat off, 1–3pm | +0.06 |
| Pump running, heat **active** | +0.79 |
| Pump **off**, 08-08 16:58 | **+5.51** |
| Live, 2026-08-10 06:31, offset confirmed `0.0` | **+0.3 to +0.4** |

### Why this disarms the alert

`jeeves_alerts.yaml` fires the HX L3 on **ΔT ≤ 0**. That threshold is correct in
principle — stage-1 compressor runs produce legitimately small HX gains, so a
"ΔT is small" threshold would fire constantly (see CLAUDE.md).

But a **completely dead heat exchanger now reads +0.3**, not ≤ 0. The alert
cannot fire under any circumstance. This is the same failure CLAUDE.md records
as fixed on 2026-08-08. It was not fixed.

### Correcting the 2026-08-08 record

The 08-08 note in `esphome/pool-pad.yaml` claims the raw probes "already agree
to within one LSB" and zeroes `out_temp_offset_f` on that basis. **That
conclusion is wrong.**

It inferred raw agreement by *subtracting* an offset it assumed was live on the
device, rather than measuring with the offset actually set to zero. Verified
2026-08-10 by reflashing (`OTA successful`, live readings confirmed updating,
not stale): with `out_temp_offset_f: "0.0"` genuinely running, the probes differ
by +0.3 °F.

Note the reflash reused a cached binary — `build_time_str=2026-08-08`, compile
took 3.19 s — so the 08-08 firmware was built correctly; the config was never
the problem. The probes simply disagree.

**This is normal.** The DS18B20 is spec'd ±0.5 °C absolute, so two of them may
legitimately differ by up to 1.0 °C (1.8 °F). A 0.3 °F gap is well inside part
tolerance and is not a fault. It just has to be calibrated out, because ΔT is a
*difference* measurement and a fixed offset is indistinguishable from real heat.

---

## Problem 2 — the outlet probe is in the sun

**Confirmed by direct observation 2026-08-10 (owner).** Raised as a hypothesis,
then verified at the pad. The data below was what suggested it and remains the
baseline to measure the fix against.

### These are two independent problems

Worth being explicit, because it is tempting to assume the sun explains the
offset too. It does not.

The pump-running, heat-off baseline is **+0.34 °F overnight**, with no sun on
anything. If the +0.3 were solar it would collapse after dark. It does not.

- **Problem 1 (probe offset, +0.3 °F)** — sensor tolerance. Present day and
  night. Fixed by calibration.
- **Problem 2 (solar, up to +5.5 °F)** — radiative load on the outlet leg.
  Daylight only, and **only when flow stops**. Fixed by shielding.

Both are real, they are additive, and neither fix substitutes for the other.

### Evidence

**With flow, the probes agree.** The pump-running baseline is flat across the
day and if anything drifts *down* in the afternoon (+0.34 overnight → +0.06 at
1–3pm). There is no upward solar bias on the outlet while water is moving —
~50 GPM swamps any radiative load on the pipe.

**With no flow, they decouple violently.**

```
08-08, pump stops ~16:00 (heat recovery OFF the whole time)
15:58   in 80.60  out 80.82   +0.22
16:28   in 79.81  out 83.97   +4.16
16:58   in 79.36  out 84.88   +5.51   <- peak, late-afternoon west sun
17:18   in 79.03  out 82.62   +3.60
18:28   in 80.38  out 80.49   +0.11   <- recoupled
```

The outlet climbs 4 °F in 50 minutes while the inlet *falls*. It peaks around
5pm and decays as the sun drops — the signature of a radiative load, not of
process heat. On 08-09 after sunset the mirror image appears: both probes fall
~3 °F together with the outlet staying 1–2 °F warmer, consistent with an outlet
leg that soaked up more heat during the day and is still shedding it.

### The qualifier that matters

**This does not contaminate the heat-recovery numbers.** Heat recovery only runs
with the pump on, and with the pump on the probes track each other. The measured
HX performance stands:

| | Value |
|---|---|
| ΔT, heat active | +0.79 °F |
| ΔT, baseline | +0.30 °F |
| **True HX gain** | **+0.49 °F** |
| At 55–60 GPM | **13,500–14,700 BTU/hr** |
| Contribution to the 08-09 pool rise | ~10% (rest is sun + solar blanket) |

Consistent with the stage-1 compressor theory in
[pool_heat_recovery.md](pool_heat_recovery.md).

### Why fix it anyway

1. The no-flow excursion is a large recurring artifact in logged data. Anything
   that later regresses ΔT against runtime, weather, or COP has to special-case
   it.
2. It is free diagnostic signal: a big positive ΔT with the pump off is a
   **no-flow detector** that needs no flow meter. Worth keeping clean.
3. If a future automation ever reads ΔT without checking pump state, +5.5 °F
   reads as spectacular heat recovery at 5pm on a day the FPH never ran.

Mitigated in software already (2026-08-10): `/api/pool/history` returns
`pump_watts`, and the dashboard ΔT chart drops samples where the pump is off —
gated on measured watts, never on clock hours, because the pump demonstrably ran
past its scheduled 4pm stop on 08-09.

---

## Fix, in order

**Do not calibrate before shielding.** Insulating or re-seating a probe changes
its offset. Calibrating first bakes in a bias you are about to remove, and you
would have to do it twice.

### Step 1 — shield both legs identically

The single rule that decides whether this works: **treat both legs the same** —
same material, same wall thickness, same length, same jacket. ΔT is a
difference, so a symmetric environmental load cancels. Shielding only the outlet
trades a known asymmetry for a new, unmeasured one.

Cover the **thermowell and fitting**, not just the pipe. The metal fitting is a
thermal shortcut to ambient and is the usual culprit.

Prefer a **reflective outer surface** (foil or white jacket, not black foam).
Insulation only delays a solar soak; reflectivity prevents it. Published solar
radiation error on an exposed sensor runs up to 1 °C, which brackets the +5.5 °F
excursion observed here.

Shade beats both, if a piece of aluminium flashing or Coroplast can block the
late-afternoon west sun on that section.

#### Products

Pipe is **2" return** (confirmed against the flow meter sizing in
[pool_heat_recovery.md](pool_heat_recovery.md)).

| Product | Spec | Note |
|---|---|---|
| [PexUniverse self-seal foam, 2" ID × ½" wall, 6 ft](https://pexuniverse.com/2-id-x-1-2-wall-self-seal-pipe-insulation) | fits pipe OD to 2" | Closed-cell PE, PSA both seam faces. **Correct size for this pipe.** ~$8 |
| [Amazon self-sealing NBR, 20 mm wall, 5.9 ft](https://www.amazon.com/Sealing-Insulation-Fireproof-Outdoor-Thickened/dp/B0BN6394R7) | ¾"–4" | Thicker, more weather-tolerant than PE |
| [Express Insulation PVC jacket](https://expressinsulation.com/products/pvc-insulation-jacket-for-indoor-outdoor-pipe-insulation-jacket) | pre-formed, self-sealing tape | **The UV layer.** Bare foam crumbles outdoors in a season |
| [AP Armaflex unslit tube](https://www.coppertubingsales.com/collections/2-wall-ap-armaflex-unslit-tubes-black) | 3/8"–2½" | Pro elastomeric; still needs a jacket outdoors |
| [Armacell ArmaTuff / Tuffcoat](https://www.armacell.com/en-US/exterior-insulation-insight), K-Flex Clad / Solar HT | factory metal-clad | Purpose-built external grade. Overkill for two feet of pipe |

**Buy:** PexUniverse 2" self-seal + PVC jacket or foil tape. ~$20 total.

Closed-cell only. **Never a towel or any woven fabric** — it wicks, stays wet on
a pool pad, and becomes an evaporative cooler, replacing a solar warming bias
with a humidity- and wind-dependent cooling bias that is strictly harder to
model.

### Step 2 — verify the shield worked

No instrumentation needed. Watch the **no-flow excursion** on the next sunny
afternoon: pump stops, sun is still up. Before shielding it hit +5.51 °F. If it
collapses toward the ~0.3 °F probe offset, radiation was the driver.

This is a good test precisely because the effect is large — one afternoon
answers it, no statistics required.

### Step 3 — two-point calibration (ice bath + boiling)

Only after Step 2. Both probes must be shielded and in final position first.

#### Read this before doing it

For **ΔT you need the probes to agree with each other, not with the SI kelvin**.
Absolute accuracy is irrelevant here — a shared 0.4 °F error cancels completely
in `out − in`. So the highest-value measurement is actually the third one below
(both probes in the same stirred bath at pool temperature), and the ice/steam
points are a linearity check around it.

This matters because ice (32 °F) and steam (212 °F) bracket a pool operating
range of **75–90 °F** very asymmetrically. A two-point fit anchored at 0 °C and
100 °C and extrapolated into the middle can be *less* accurate near 80 °F than a
single-point offset measured at 80 °F. Take all three points; weight the 80 °F
one.

**Check the probe rating first.** DS18B20 silicon is rated to +125 °C, but the
cable-to-probe junction on inexpensive waterproof probes frequently is not, and
boiling is a common way to kill one. If the junction is heat-shrink over a
solder joint, keep it out of the water and consider skipping the steam point —
the ice point plus the 80 °F bath is enough for this application.

#### Ice point — 0.00 °C / 32.0 °F

1. Fill an insulated container with **crushed or shaved ice**, then add
   distilled water until it is a dense slush.
   - Cubes floating in water do **not** give 0 °C. It must be mostly ice with
     just enough water to fill the voids.
2. Stir, wait 2–3 minutes, keep stirring gently throughout.
3. Suspend the probe **mid-depth**, at least 2 cm from the sides and bottom.
   Touching the container reads the container.
4. Record both probes simultaneously. Log 20+ readings and take the median —
   the 12-bit LSB is 0.0625 °C (0.1125 °F) and single readings quantize.

#### Steam point — altitude-corrected, **not** 100 °C

Water boils at 100 °C only at 1013.25 hPa. **Look up the pad's actual elevation
and the day's barometric pressure and correct** — the naive assumption is the
most common error in this procedure.

Approximate correction: **−1 °C per ~285 m (935 ft)** of elevation.

Measure in the **steam just above** the rolling boil rather than in the liquid;
the vapour is at the saturation temperature and is not superheated by contact
with the pan bottom. Same rule as the ice point: many readings, take the median.

#### Pool-temperature point — the one that actually matters

1. Fill a bucket with water at **~80 °F**, close to real operating temperature.
2. Put **both probes in the same bucket**, mid-depth, not touching each other or
   the wall.
3. **Stir continuously.** Unstirred water stratifies by several tenths of a
   degree and you will measure the stratification instead of the probes.
4. Log for 10+ minutes with the pad node in its normal reporting mode.
5. The median of `out − in` **is** the offset to cancel.

#### Applying the result

`out_temp_offset_f` is **added to the outlet reading** in `esphome/pool-pad.yaml`
after the °C→°F lambda, so it is in °F.

- If the outlet reads **high** by 0.3 °F → `out_temp_offset_f: "-0.3"`
- If the gap is **constant** across all three points → a single `offset:` filter
  is correct and sufficient.
- If the gap **tracks temperature** → replace the `offset:` filter with
  `calibrate_linear` and a two-point fit. Flagged as a possibility in the
  existing config comment; the three points above are what decides it.

Deploy from the Mac, never via the Pi:

```bash
cd "/Users/mattdrazba/Code Repos/Jeeves/esphome" && uvx esphome run pool-pad.yaml
```

### Step 4 — confirm the alert is actually armed

The whole point of Steps 1–3. `check_config` passing proves nothing.

1. With the pump running and heat off, confirm ΔT now sits at **0.00 ± one LSB**
   (±0.11 °F), not +0.3.
2. Re-read the HX L3 threshold in `jeeves_alerts.yaml`. CLAUDE.md already
   anticipates the residual risk: *"if a real low-stage run quantizes to 0.00 or
   −0.11 for 20 min it will fire, and the fix would be a threshold clearly below
   zero rather than at it."* With the offset genuinely removed, a threshold a
   little below zero (≈ −0.15 °F, one LSB clear) is likely correct so that
   quantization noise on a legitimate low-stage run cannot trip it.
3. Run `python3 scripts/verify-alerts.py`.

---

## Open questions

- **Is the offset constant across temperature?** Only ~3.5 hours of data across
  a narrow 79.1–79.6 °F band existed when this was first raised, and it is still
  unresolved. Step 3 answers it directly.
- ~~Which probe is sun-exposed?~~ **Closed 2026-08-10 — the outlet, confirmed
  visually at the pad.** Matches the no-flow signature (outlet heats faster,
  retains heat longer). Both legs still get shielded identically: the goal is
  symmetry, and shielding only the exposed one leaves a different asymmetry.
- **Pump state was inferred, not measured, for the historical analysis.** The
  documented 9pm–4pm schedule does not hold: `heat_active` was still 1 at 16:36
  on 08-09, and since that sensor reads the trio circuit *downstream of the flow
  switch*, a closed flow switch means there really was flow. The pump ran past
  4pm. Future analysis should use the `pump_watts` column now returned by
  `/api/pool/history`.
