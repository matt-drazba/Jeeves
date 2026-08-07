# Pool Data Addendum — filter pressure, chemistry instrumentation, and what to buy

Last updated: 2026-08-07. Authority order: CLAUDE.md → this doc → coder briefs.
Companion docs: [pool_heat_recovery.md](pool_heat_recovery.md), [pool_booster_interlock.md](pool_booster_interlock.md), [pool_chemistry_logging.md](pool_chemistry_logging.md), [pool_wiring_manual.md](pool_wiring_manual.md).

**Status: DESIGN + shopping list. Nothing ordered, nothing wired. The ESPHome
additions below are written but should stay commented out in
[../esphome/pool-pad.yaml](../esphome/pool-pad.yaml) until the parts are in hand,
same pattern as the flow meter placeholder.**

## Origin

A third-party "Smart Pool Laboratory Hardware Specification" was reviewed
2026-08-07. It was written for a generic pool, not this one. This doc keeps the
parts that survived that review and discards the rest explicitly, so the
rejections are decisions rather than oversights.

### Rejected, with reasons

| Proposed | Why not |
|---|---|
| ORP probe + ORP dashboards | Already removed on purpose. Meaningless with copper/silver ions and deliberately low free chlorine |
| Conductivity / salt probe, salt trend | Not a salt pool. Sanitizer is a Clearwater MineralPURE R-40 ionizer |
| Weather station hardware | Open-Meteo already provides temp/wind/solar server-side, free, no key |
| CT clamp energy monitor (as new) | Shelly EM Gen3 is installed on the pump leg and logging to SQLite |
| ESP32 rebuild of the pad node | ESP8266 is flashed, OTA-capable, working. ESP32 is justified only for the separate pH node already planned |
| MQTT → InfluxDB → Grafana | Banned by CLAUDE.md hard rules. SQLite is the system of record; the Jeeves dashboard is the UI. Grafana could not host the poolside entry form anyway |
| LaMotte WaterLink Spin Touch | ~$900 to avoid a 10-minute test. See chemistry section for the cheaper split |
| Ethernet / RS-485 on the pad node | No device on the pad speaks RS-485 except the pump, which the IntelliComm II already owns |

The spec also had no safety layer at all — nothing on booster dry-run, nothing on
heat-recovery interlock. It monitors a pool; it does not protect one.

## Part 1 — Filter pressure

### Why, given a flow meter is already on order

Flow is the better **outcome** metric — turnover is what actually matters, pool
pressure gauges drift ±2–3 PSI and eventually clog, and raw pressure is
meaningless on a variable-speed pump without knowing RPM. If only one sensor
were possible, flow wins.

They are not redundant. Pressure is the **disambiguator**:

| Fault | Pressure | Flow |
|---|---|---|
| Dirty filter (discharge-side restriction) | **↑** | ↓ |
| Clogged skimmer / pump basket, lost prime (suction-side) | **↓** | ↓ |

Flow alone reports "something is restricted" without saying which end. The two
faults move pressure in opposite directions while moving flow the same way, so
pressure is the only thing that separates them.

That is not academic. "Flow drops below minimum" is a turn-off trigger in the
booster interlock ([pool_booster_interlock.md](pool_booster_interlock.md)), and a
suction-side blockage is exactly the failure that would strand the PB4-60.
Pressure upgrades that event from "flow low, booster off, cause unknown" to
"flow low **and** pressure dropped — check the baskets."

It also closes the case the wiring manual currently lists as undetectable:
flow switch closed, pump powered, water not actually moving.

**One thing in this system's favor:** Ext. Program 4 is locked at **2200 RPM** —
constant *speed*, not constant flow. A constant-flow VS pump would raise RPM to
compensate for a fouling filter and mask the flow drop entirely. This one will
not. Both signals stay honest.

**Staging is fine.** Nothing in the pressure plan depends on ordering. Install
and calibrate the flow meter first if preferred; add pressure after.

### The part

| Spec | Value | Why |
|---|---|---|
| Range | **0–30 PSI** | Pool filters run 10–25 PSI. A 0–100 PSI unit spends 75% of its resolution on pressures that will never occur |
| Thread | **1/4" NPT male** | Confirmed — matches the existing gauge port |
| Output | **0.5–4.5V ratiometric** | Commodity part, easy to scale. Avoid 4–20mA: needs a loop supply and sense resistor for no benefit here |
| Supply | **5V DC** | Confirmed available — the chimney-box buck outputs 5V |
| Body | Stainless 304/316, sealed | Wetted metal, outdoors |

Do not run a 5V ratiometric transducer from 3.3V to dodge level shifting.
Ratiometric means the output scales with supply; accuracy below the spec'd
supply voltage is undefined.

### Plumbing

The filter already has an analog gauge threaded into a **1/4" FPT port** on the
filter head. That port is the entire install. **No pipe cutting, no gluing, no
draining beyond the filter itself.**

```
        filter head 1/4" FPT port
                 │
        ┌────────┴────────┐
        │ 1/4" brass tee  │   street tee: male run × female × female
        └──┬───────────┬──┘
           │           │
    stock analog    0–30 PSI
       gauge        transducer
                        │ 3 wires → chimney box
```

**Procedure:**

1. **Pump OFF at the breaker.** Open the filter's manual air relief valve and
   bleed to zero. Confirm the analog gauge reads 0 before touching anything — a
   filter tank at 20 PSI will launch a fitting.
2. Unscrew the stock gauge (usually finger-tight-plus).
3. Thread in the **1/4" NPT brass street tee**, 2–3 wraps of PTFE tape on the
   male threads.
4. **Reinstall the stock analog gauge into one branch — keep it.** It is the
   calibration reference, it works when the ESP is down, and it is what a pool
   tech will look at.
5. Transducer into the other branch.
6. Hand-tight plus 1–2 turns with a wrench. **The filter head is plastic** —
   over-torquing brass into it cracks the boss, and that is a tank replacement,
   not a fitting replacement.
7. Re-open air relief, restart pump, bleed air, check both joints for weeping.

**Geometry:** the tee doubles the moment arm on a plastic port. Orient the
transducer hanging down or sideways rather than cantilevered, and strain-relieve
the cable so it cannot pull on the fitting. If the port sits on a multiport
valve that rotates for backwash, confirm the tee clears the handle through the
full sweep.

**Bonding:** brass tee plus stainless body adds wetted metal in the circulating
path. Same 680.26(B)(6) question the wiring manual already applies to the flow
meter. Difference: this is a *passive* fitting on a body already grounded
through the filter, so it is the more optional case. Decide with the parts in
hand.

### Power — the buck converter

Adding the transducer is a terminal-count problem, not a capacity problem:

| Load | Current |
|---|---|
| NodeMCU ESP8266 | ~80 mA average, ~300 mA TX bursts |
| Hall flow sensor | ~15 mA |
| **Pressure transducer** | **~10 mA** |
| **ADS1115** | **~0.2 mA** |

~10 mA is being added to a rail already absorbing 300 mA peaks. A WAGO 221 or a
small screw terminal block off the existing 5V output pair is the whole fix.
Buck output is confirmed 5V, so all three loads share one rail.

### Power fix 1 — bulk capacitance (do this)

**The problem:** the transducer is *ratiometric* — its output is a fixed
percentage of its supply voltage (0.5V at 10% of 5V, 4.5V at 90%). When the ESP
fires a WiFi transmit burst it pulls ~300 mA for a few milliseconds and sags the
shared 5V rail. The transducer's output sags with it. The reading moves even
though the pressure did not.

**The fix:** a local energy reservoir at the transducer's power pins, so the
short burst is supplied by the capacitor instead of pulling the rail down.

- **100 µF electrolytic** — the bulk reservoir. Handles the millisecond-scale
  TX burst. **Polarized:** the stripe on the can marks the **negative** leg,
  which goes to GND. Backwards, it eventually vents.
- **0.1 µF ceramic** — in parallel with the electrolytic. Not polarized, either
  way round. Handles high-frequency noise the electrolytic is too slow for.
  Standard practice to pair them; both are pennies.

Wire both **across V+ and GND**, physically as close to the transducer's supply
connection as practical. Mounting them inside the chimney box at the terminal
block is acceptable and far easier to weatherproof than potting them at the
sensor body.

```
  5V ──┬──────────┬────────► transducer V+ (red)
       │          │
     100µF      0.1µF
   (stripe↓)      │
       │          │
 GND ──┴──────────┴────────► transducer GND (black)
```

### Power fix 2 — true ratiometric compensation (free upgrade)

Capacitors reduce rail sag. This eliminates the error from it entirely, and the
parts are two resistors, because the ADS1115 has three unused channels.

**The idea:** if the transducer's output is always a fixed *percentage* of its
supply, then measuring the supply at the same instant and dividing makes the
supply voltage cancel out of the math. Rail at 5.0V or 4.7V — the computed
pressure is identical.

Measure the 5V rail through a 10k/10k divider into **A1**, alongside the
pressure signal on **A0**:

```
  transducer OUT ──┬── 4.7k ──┬──► ADS1115 A0
                   │          │
                  GND       10k
                              │
                             GND        ratio 0.680

  5V rail ──┬── 10k ──┬──────────► ADS1115 A1
            │         │
           GND      10k
                     │
                    GND                 ratio 0.500
```

Sanity check at both endpoints:

| Condition | A0 | A1 | fraction | PSI |
|---|---|---|---|---|
| 0 PSI (out = 0.5V) | 0.34V | 2.50V | 0.100 | 0.0 |
| 30 PSI (out = 4.5V) | 3.06V | 2.50V | 0.900 | 30.0 |

where `fraction = (A0 / A1) × (0.500 / 0.680)` and
`PSI = (fraction − 0.10) × 37.5`.

Use 1% metal film resistors — the divider ratios are inside the accuracy
budget, and 5% carbon film would add roughly ±1 PSI of pure error for a
three-cent saving.

### ESPHome

I2C pins: **GPIO4 (D2)** freed 2026-07-28, **GPIO13 (D7)** freed 2026-08-05.
Both currently unused.

```yaml
i2c:
  sda: GPIO4      # D2
  scl: GPIO13     # D7

sensor:
  - platform: ads1115
    multiplexer: A0_GND
    gain: 4.096
    id: press_adc
    update_interval: 10s
    internal: true
    filters:
      - median: {window_size: 5, send_every: 5}

  - platform: ads1115
    multiplexer: A1_GND
    gain: 4.096
    id: rail_adc
    update_interval: 10s
    internal: true
    filters:
      - median: {window_size: 5, send_every: 5}

  - platform: template
    name: "Filter Pressure"
    id: filter_pressure
    unit_of_measurement: "PSI"
    accuracy_decimals: 1
    update_interval: 30s
    lambda: |-
      float a0 = id(press_adc).state;
      float a1 = id(rail_adc).state;
      if (isnan(a0) || isnan(a1) || a1 < 1.0f) return NAN;
      float frac = (a0 / a1) * (0.500f / 0.680f);
      return (frac - 0.10f) * 37.5f;
```

**Calibrate against the stock analog gauge, not the datasheet** — same
discipline as the flow meter's sequential calibration. Two points: pump off with
air relief open = 0 PSI; pump running at the locked 2200 RPM Program 4 setting =
whatever the analog gauge reads. If the computed value is off, the correction
goes in as a `calibrate_linear` on the template sensor rather than by editing
the constants above, so the derivation stays readable.

### What the automation keys on

**Raw pressure is not the signal.** With a variable-speed pump, pressure at 1750
RPM and 2200 RPM differ by several PSI on the same clean filter. An absolute
threshold would false-alarm every time heat recovery drives the pump into
Program 4.

The metric is **pressure at a known operating point versus the clean baseline at
that same point.**

1. **Sample only while `pool_heat_active` is true.** That binary sensor already
   means the pump is locked at 2200 RPM. Same RPM every sample, directly
   comparable. Backwash or clean when pressure has risen **8–10 PSI over the
   clean baseline** — the standard rule, and the number the filter manufacturer
   will also state.
2. **Later, once flow is calibrated: pressure ÷ GPM.** RPM-independent, works at
   any pump speed. Better long-term; needs both sensors live and trusted first.

Log to the existing `pool_heat_samples` table on the same 2-minute poll — one
more column alongside HX temps and BTU/hr. That is the multi-month trend HA's
recorder cannot hold, and the reason [pool_chemistry_logging.md](pool_chemistry_logging.md)
argues for SQLite as system of record.

**Falls out for free:** pressure *dropping* below baseline at a known RPM means
suction-side restriction — clogged skimmer or pump basket, or losing prime. That
is the leading indicator for the condition that would strand the booster pump,
and it plugs into the interlock as a second independent signal.

## Part 2 — Chemistry instrumentation

### The R-40 does copper AND silver

The Clearwater MineralPURE R-40 uses a copper/silver alloy electrode. Copper is
the algaecide, silver the bactericide. **The ratio is fixed by the alloy**, so
they are not independently adjustable — the only control is the ionizer's output
dial, which moves both together.

**Test copper only.** Target 0.2–0.4 ppm. There is no consumer-grade silver test
at the sub-ppm levels involved, and no action could be taken on the number if
there were. Silver is inferred from copper.

Copper does not decay like chlorine — it leaves via backwash, splash-out, rain
overflow, and filter media. That is why the chemistry brief models it against the
`pool_actions` table rather than as time-based decay.

### Why the HI701 beats a drop kit here specifically

A 0.00–2.50 ppm ceiling is useless on a conventional pool targeting 4–8 ppm FC.
**It is the right range for this pool**, because the R-40 does the sanitizing
work and free chlorine is deliberately held low — roughly 0.5–1.0 ppm.

At that level a drop kit is bad at its job. FAS-DPD resolves 0.2 ppm per drop
with a 25 mL sample, so an 0.8 ppm reading is 4 drops — ±12% quantization before
any technique error. The HI701 is spec'd around ±0.03 ppm ±3% of reading
(verify against current Hanna documentation). For a decay model fitted against
water temperature from `pool_heat_samples`, that is the difference between a
usable regression and fitting noise.

**It measures free chlorine and nothing else.** It is a precision instrument for
the one parameter that needs precision, not a replacement for a full kit.

### Coverage — what tests what

| Parameter | Instrument | Cadence |
|---|---|---|
| **FC** | **Hanna HI701** | 2–3× / week |
| CC | Taylor K-2006 (FAS-DPD) | Weekly |
| pH | Taylor K-2006 | Weekly |
| TA | Taylor K-2006 | Monthly |
| CH | Taylor K-2006 | Monthly |
| **CYA** | **Taylor K-2006** — already included | Monthly |
| **Copper** | **Separate test — not in K-2006** | Every 2 weeks initially, monthly once drift is known |
| Water temp | `sensor.pool_pad_hx_water_in_temp`, already logged | Every 2 min |
| Salt | not applicable | — |
| ORP | not applicable | — |

**CYA needs no separate purchase** — the K-2006 includes the melamine turbidity
test with the black-dot view tube. CYA still matters on an ionizer pool: it
protects the low FC residual from UV, and it sets the minimum FC target. It only
moves when stabilizer is added or water is diluted, so monthly is ample.

**Copper is the gap.** The K-2006 does not test it. Verified 2026-08-07: Hanna
makes **two** copper Checkers, and the obvious one is the wrong one.

| | HI702 (High Range) | **HI747 (Low Range)** |
|---|---|---|
| Range | 0.00–5.00 ppm | **0–999 ppb (0–0.999 ppm)** |
| Resolution | 0.01 ppm | **1 ppb (0.001 ppm)** |
| Accuracy @ 25 °C | ±0.05 ppm ±5% of reading | **±10 ppb ±5% of reading** |
| Error at the 0.3 ppm target | ±0.065 ppm → **±22%** | ±0.025 ppm → **±8%** |
| Method | Bicinchoninate | Bicinchoninate (EPA adaptation) |
| Reagent | HI702-25 (25 tests) | **HI747-25 (25 tests)**; meter ships with 6 |

**Buy the HI747.** The HI702 is aimed at reef aquariums, where copper treatment
runs 1–3 ppm. The 0.2–0.4 ppm target here sits in the bottom 8% of the HI702's
scale, which is where a colorimeter performs worst — roughly 3× the error of the
low-range unit.

The HI747's ceiling is a useful accident: 0.999 ppm is essentially the industry
limit above which copper begins staining plaster. An in-range reading means
safe; an over-range reading means "dial the ionizer output back." The one value
worth flagging is flagged structurally rather than by a threshold rule. If a
number above 1 ppm is ever needed, dilute 1:1 with distilled water and double
the result.

Test more often at first than the cadence above. The point of the first month is
to learn this pool's actual decay and drift rates; once the model has them, the
cadence can relax.

## Part 3 — Buy list

| Item | Spec | ~$ |
|---|---|---|
| Pressure transducer | 0–30 PSI, 1/4" NPT male, 0.5–4.5V, 5V supply, stainless | 25 |
| Brass 1/4" NPT **street tee** | male run × female × female | 8 |
| PTFE tape | standard white | 2 |
| ADS1115 breakout | 16-bit, I2C, 4-channel | 6 |
| Resistors | 4.7k, 10k ×3 — **1% metal film** | 3 |
| Capacitors | 100 µF electrolytic + 0.1 µF ceramic | 2 |
| Cable | 3-conductor 22 AWG shielded, length to the chimney box | 10 |
| WAGO 221 lever nuts | 3-way, to split the 5V rail | 5 |
| Hanna HI701 | free chlorine Checker HC | 55 |
| HI701-25 reagent | DPD packets, 25 tests — 2 packs | 18 |
| Taylor K-2006 | FAS-DPD kit — covers CC, pH, TA, CH, CYA | 80 |
| **Hanna HI747** | copper **Low Range** Checker HC — **not** the HI702, see Part 2 | ~50 |
| HI747-25 reagent | copper reagent, 25 tests — meter ships with 6 | ~10 |
| CT clamp for Shelly EM Gen3 `IB` | Shelly-branded, matching the Gen3 input | 15 |

**~$255.** For comparison, the reviewed third-party spec estimated $1,100–2,700
for equivalent-or-worse coverage of this specific pool.

If the street tee is hard to source, a 1/4" FPT tee plus a 1/4" close nipple
gives the same result with one more joint to seal.

### On the CT clamp

The Shelly EM Gen3's second (`IB`) channel is free. CLAUDE.md notes it could
carry a second CT on the pump's other 240V leg for true two-leg wattage.
**Put it on the booster circuit instead.** That is open item "optional: CT on the
booster circuit" in [pool_booster_interlock.md](pool_booster_interlock.md), and
it is worth more: the pump's second leg only refines a number already
approximable, while the booster CT gives runtime logging plus the
**watts-too-low dry-run alarm** — the inverted alert that catches the one failure
mode no breaker or overload will.

## Open items

- [ ] **Identify the filter — sand, DE, or cartridge, and model.** Does not
      change the transducer, tee, or wiring. Does change the clean baseline PSI,
      whether the alert says "backwash" or "pull and hose the cartridge," and
      whether the gauge port sits on a rotatable multiport valve
- [ ] Confirm the existing gauge is 1/4" NPT — reported yes, verify on removal
- [x] ~~Confirm the Hanna copper Checker model number~~ — **HI747 (Low Range)**,
      0–999 ppb, ±10 ppb ±5%. Not the HI702, which is high-range reef-aquarium
      gear and ~3× less accurate at this pool's 0.2–0.4 ppm target
- [ ] Verify HI701 published accuracy against current Hanna documentation
- [ ] Establish the clean-filter baseline PSI at 2200 RPM immediately after the
      next backwash/clean — everything downstream compares against it
- [ ] Decide bonding for the brass tee + transducer body (680.26(B)(6))
- [ ] Add `filter_pressure` column to `pool_heat_samples` in `jeeves/db.js`
- [ ] Uncomment the ADS1115 block in `esphome/pool-pad.yaml` once parts arrive

## Sources

- [Hanna HI701 Free Chlorine Checker HC](https://hannainst.com/hi701-free-chlorine.html) — 0.00–2.50 mg/L
- [Hanna HI747 Copper Low Range Checker HC](https://hannainst.com/hi747-copper-lr.html) — 0–999 ppb, ±10 ppb ±5%
- [Hanna HI702 Copper High Range Checker HC](https://hannainst.com/hi702-copper-hr.html) — 0.00–5.00 ppm; **rejected**, wrong range for this pool
- Taylor K-2006 FAS-DPD test kit — FC, CC, pH, TA, CH, CYA
- Clearwater MineralPURE R-40 — copper/silver ionizer
- Third-party "Smart Pool Laboratory Hardware Specification", reviewed 2026-08-07
