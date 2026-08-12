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
