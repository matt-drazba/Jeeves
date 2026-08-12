# Pool flow meter — DN50 vs. industrial paddlewheel

**Status: DECIDED 2026-08-10. Install the DN50 already on order. Do not buy a paddlewheel yet.**

The question: the DN50 inline turbine already purchased has plastic wetted parts. Will pool
chemicals plus continuous high flow kill it in months, and is a $500–1000 industrial
paddlewheel the right replacement?

Verdict: **install the DN50**, on true unions, and keep it out of the safety loop until a
season of logged data says whether it drifts. The upgrade path is real and priced below, but
nothing today depends on this meter, and the cheap unit's most likely failure is *slow and
measurable* rather than sudden.

---

## The chemical worry is misplaced for this pool

The sanitizer here is a **Clearwater MineralPURE R-40 copper/silver ionizer with an FC floor
of 0.4 ppm** — no shock regime, no 3–5 ppm free chlorine, pH held 7.2–7.6
([pool_data_addendum.md](pool_data_addendum.md)). Nylon/PA66 bodies, POM impellers, and
ceramic or stainless shafts are all comfortable in that water. The filter, the plumbing, and
the IntelliFlo2's own impeller are already plastic.

**The actual environmental threat is UV, not chemistry.** The pad is in direct sun — proven,
not assumed: with the pump off the HX outlet probe reads **+5.51 °F over the inlet at 16:58**,
peaking near 5pm and decaying as the sun drops ([pool_probe_calibration.md](pool_probe_calibration.md)).
An unstabilized nylon body outdoors goes chalky and brittle over a few years. Mitigation is a
shade cover or opaque wrap, not a different sensor.

## The real risk is bearing wear, and the failure mode is the bad kind

19 h/day is **~6,900 hours/year** of continuous rotation on a bearing designed for
intermittent duty. This is a genuine concern and the source brief is right to raise it.

**It will not fail cleanly.** The expected degradation is a gradual *under-read* as the
bearing wears and the impeller drags — which is worse than reading zero, because a meter
silently reporting 40 GPM when the pipe is moving 58 GPM would false-trip a booster kill or
mask a real deadhead. A meter that dies to `unavailable` is safe; one that lies plausibly is not.

### Free mitigation: drift detection at constant pump watts

**Corrected 2026-08-12.** This section previously claimed the pump is "locked to Ext. Program 4
at 2200 RPM, so true flow is near-constant by design." **That is false.** Ext. Program 4's speed
is a setting on the pump's own control pad, adjustable up to 3450 RPM; 2200 was *chosen* as the
estimated speed to clear the FPH5's 45 GPM floor. Nothing prevents it from being changed, and a
drift check anchored to an assumed setting would read a deliberate speed change as bearing wear —
or, worse, hide real wear behind a speed increase.

**Anchor the check to pump watts instead**, which are already logged from the Shelly EM Gen3 and
are a *measurement* of what the pump is doing rather than a belief about how it is configured:

> Indicated GPM trending **down** at the same pump watts and the same filter pressure is bearing
> wear, not real flow loss.

This is strictly better than the RPM version — it survives someone changing Program 4, needs no
new hardware, and needs nothing to be remembered. It is still the thing worth building *before*
spending $650.

Do **not** substitute "sample only during `pool_heat_active`" as the constant-condition trick here.
That holds RPM constant only for as long as nobody re-configures Program 4, which is the exact
assumption this correction removed.

## Head loss — the strongest argument for the paddlewheel

An inline turbine necks the bore down into a restricted impeller chamber. At the measured
55–60 GPM through 2" pipe the line is already at ~5.5–6 ft/s. The added restriction is
perhaps 1–3 psi, which the VFD pays for 19 hours a day, and it slightly reduces flow through
the FPH5 heat exchanger.

An insertion paddlewheel puts the rotor in a slot in the pipe wall and leaves the full 2"
lumen open. Its rotor is also a replaceable wear part, removable without cutting pipe.

This — not chemical attack — is the legitimate case for the upgrade.

## Priced upgrade path (verified 2026-08-10)

| Part | Price | Output | Notes |
|---|---|---|---|
| GF Signet 3-2536-P0 Rotor-X | **$642** ([Serv-A-Pure](https://www.servapure.com/GF-Signet-3-2536-P0-Rotor-X-Paddlewheel-Flow-Sensor_p_11427.html)) | Open-collector | Drops straight into GPIO12 + opto. $485–$1,229 elsewhere by config |
| Blue-White F-2000 sensor, FCXX | **$350** ([PVC Fittings Online](https://www.pvcfittingsonline.com/fcxx-blue-white-f-2000-digital-paddlewheel-sensor-w-cable.html)) | **AC sine wave** | Self-powered coil — *not* a countable pulse |

Both need an installation tee or saddle on top of the sensor price.

**The $350 option is not the cheap option.** Its AC sine output cannot be counted by an
ESP8266 directly; it needs a comparator or Schmitt-trigger conditioning stage ahead of the
optocoupler. Most of the $292 saved goes back into circuitry to design and debug.

**Realistic all-in: $400–700**, and the clean-integration choice is the $642 Signet.

## Conditions on installing the DN50

- [ ] **True unions both sides** — already on the buy list ([pool_heat_recovery.md](pool_heat_recovery.md) Parts). Makes replacement a 10-minute swap instead of a pipe cut. This is what makes the cheap-first strategy reversible.
- [ ] **Shade or wrap the body** against direct pad sun.
- [ ] **Never sole authority for a safety kill.** The booster dry-run interlock already gates on **pump watts** from the Shelly; flow was always an addition to that vote, never a replacement. The deadhead alert is deliberately unwritten (see CLAUDE.md Deferred) — when written, keep watts in the decision.
- [ ] **Log GPM alongside pump watts from day one** so the drift baseline exists before wear
      starts. Record the Program 4 speed setting in the log notes whenever it is changed — the
      baseline is per-operating-point, and the speed is user-adjustable (see above).
- [ ] Calibrate via the sequential Blue-White procedure in [pool_heat_recovery.md](pool_heat_recovery.md) — the `multiply: 0.02201` in the yaml is datasheet theory, not measurement.

**Decision rule at one season:** flow steady at fixed RPM → the DN50 stays and $642 was saved.
Measurable downward drift → buy the 2536, with data showing exactly how fast it degraded.

---

## Cross-calibrating flow against filter pressure — proposal, 2026-08-12

**Status: analysed, NOT ratified. No parts change either way.**

Owner's proposal, in four steps:

1. Calibrate the DN50 against the Blue-White gauge at the same RPM.
2. Calibrate DN50 flow against the (automatically captured) filter pressure.
3. Decide whether GPM can be predicted from filter pressure alone.
4. If yes, re-install the Blue-White only when the DN50 drifts. If no, replace or upgrade.

### Why step 3 is more likely to work than it sounds

The obvious objection is that filter pressure is confounded by filter fouling — pressure rises as
the sand loads, so pressure can't mean flow. **That objection is wrong here**, and the reason is
the pump:

> At a fixed RPM the IntelliFlo2 operates somewhere on its own head-vs-flow curve, which is a
> fixed physical property of the pump. A fouling filter doesn't invalidate that curve — it just
> **moves the operating point along it**, to higher head and lower flow.

So `(RPM, pressure) → GPM` is a real relationship, not a coincidence, and fouling is the thing
that *traces out* the curve for you rather than the thing that breaks it. Every backwash cycle
between clean and dirty is a free sweep through the operating range.

### It gives three signals for the price of one

Pump watts also sit on the pump curve — power falls with flow at fixed speed, which is why a
loading filter draws *less* power. That yields three estimates of the same quantity:

| Signal | Source | Status |
|---|---|---|
| Indicated GPM | DN50 pulse counter | on order |
| Pressure-implied GPM | filter transducer + pump curve | ordered 2026-08-12 |
| Watts-implied GPM | Shelly EM Gen3 | **already live** |

Pressure and watts are not independent of *each other* — both derive from the pump curve — but
both are independent of **the DN50's bearing**, which is the failure being hunted. A bearing
dragging produces an under-read on exactly one of the three. That turns the silent-drift problem
from "trust it and hope" into a two-out-of-three vote, with no new hardware.

It also answers step 4 more cheaply than the owner's version: **drift can be *detected* without
re-installing the Blue-White at all.** The gauge only comes back to re-establish absolute truth
once the vote says something moved.

### The two things that could sink it

- **The suction side is uninstrumented.** Filter pressure is discharge pressure, not total
  dynamic head. A loading pump or skimmer basket raises suction vacuum, which shifts the
  operating point without showing up on the filter gauge. This is the main error term, and it is
  the same blind spot [pool_data_addendum.md](pool_data_addendum.md) already notes.
- **Resolution.** 2% FS on a 60 psi sensor is ±1.2 psi. Whether that resolves to ±2 GPM or ±8 GPM
  depends on how steep the pump curve is in the operating band — unknown until measured. Likely
  fine for month-scale drift, likely too coarse for absolute BTU/hr math.

Neither is a reason not to try; both are reasons not to promise absolute GPM from pressure before
the data exists.

### What this changes about the calibration itself

**Do not take a single reading at 2200 RPM.** The original plan captured one point because 2200
was believed to be a lock; it is not (see the drift-detection correction above). While the
Blue-White gauge is in the run — the one window where ground truth exists — **sweep the speed**
and record all four values at each step:

| RPM | True GPM (Blue-White) | Filter PSI | Pump watts | DN50 pulses/min |
|---|---|---|---|---|
| 1500 | | | | *(flow switch should drop out)* |
| 1750 | | | | |
| 2000 | | | | |
| 2200 | | | | |
| 2400 | | | | |
| 2600 | | | | *(near the FPH5's 70 GPM ceiling)* |

That single afternoon produces the pump curve, the DN50's `multiply:`, the pressure↔flow model,
the watts↔flow model, and a real answer on the FPH5 flow ceiling. Taking one point throws away
almost all of it for no extra effort saved. The DN50 and the gauge can't share the run, so the
sweep gets done twice — gauge first, meter second, same speeds.

### Branch: install now, or wait for summer?

**Recommendation: install it in the off-season, and treat winter as the calibration window.**

The premise behind waiting is that the meter exists to serve heat recovery, so it idles all
winter while burning bearing life. That premise is wrong on the first half:

- **The flow meter's safety jobs are year-round.** The booster dry-run interlock guards the
  PB4-60, and the sweep runs nightly 9:45–11:15pm in January exactly as in July. Deadhead
  detection guards against the handle left in the wrong position after a backwash — also
  year-round. Heat recovery is the *BTU math* customer, not the safety customer.
- **Bearing life spent in winter is the cheap kind.** Winter runs shorter hours at lower speed
  (schedule under review in [pool_system_checks.md](pool_system_checks.md)), so wear accrues
  slower than the 6,900 h/yr worst case.
- **The calibration wants low stakes.** Sweeping the pump 1500→2600 RPM and cutting the plumbing
  twice is a much better idea when nobody is swimming and no heat recovery is running. Doing it
  in July means disturbing the system in the one season it matters most.
- **A drift baseline is only useful if it predates the wear.** Installing in summer means the
  baseline and peak-load duty start on the same day.

The honest counterpoint: every hour of winter running is bearing life spent on a meter whose
readings nobody needs yet. That is real but small, and it buys a validated three-signal model
before the season where a bad number would actually mislead a safety decision.

---

## Corrections to the source brief

The upgrade brief that prompted this (insertion paddlewheel + PC817, 2026-08-10) is directionally
right but contains three errors worth not carrying forward:

| Claim in brief | Correction |
|---|---|
| "~75 GPM / 284 L/min continuous" | **~55–60 GPM** at the current Ext. Program 4 setting of 2200 RPM. The wear argument is built on a figure ~25% high. Note this 55–60 is **extrapolated** from the one direct Blue-White reading (1750 RPM ≈ 45–50 GPM) by linear scaling, not measured at 2200 — corrected 2026-08-12 |
| "Use GPIO4 (D2)" | `pin_flow_pulse` is already **GPIO12 (D5/D6 block)** in [pool-pad.yaml](../esphome/pool-pad.yaml) — equally interrupt-capable and boot-safe. Do not move it |
| `multiply: 0.0565` | Ours is `0.02201` (12 pulses/L). **Both are placeholders**; only the sequential Blue-White calibration sets the real value |

**Worth keeping from it:** the PC817 optocoupler isolation. The IntelliFlo2 is a VFD on a long
cable run, and that is a genuinely noisy neighbor regardless of which meter is fitted. Note the
DN50's NPN open-collector output already works with GPIO12's `INPUT_PULLUP` without an external
pull-up, so the opto is for noise immunity, not level shifting.
