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

### The filter — identified 2026-08-07

**Pentair Tagelus TA100D**, 30" top-mount **sand** filter. Owner-confirmed; specs
from Pentair/distributor listings.

| Spec | Value | Consequence |
|---|---|---|
| Type | **Sand**, top-mount | Alert wording is **"backwash"**, not "clean the cartridge" |
| Filter area | 4.9 sq ft | — |
| Sand charge | 600 lb | Media itself is a 5–7 year wear item |
| Valve | 2" multiport, 6-position Hi-Flow, with sight glass | Gauge threads into the **valve body**; the handle rotates above it |
| Design flow | 100 GPM | Pump runs 45–60 GPM — the filter is generously oversized, so pressure will climb slowly and backwash intervals will be long |
| Max operating pressure | **50 psi** | Sets the transducer overpressure requirement, below |
| Gauge port | 1/4" NPT, standard Pentair multiport thread | Owner-confirmed |

**Expected clean baseline for a sand filter of this size: roughly 10–15 psi**, with
backwash indicated at **+8–10 psi over the measured clean baseline**. Measure the
real number after the next backwash rather than trusting the range.

**Clearance check when fitting the tee:** on a Tagelus top mount the gauge is in
the multiport valve body while the handle rotates above it, so the handle sweep
is usually clear — but the tee adds bulk. Dry-fit and check against both the
handle's full travel and the adjacent plumbing before sealing threads.

### The part

| Spec | Value | Why |
|---|---|---|
| Range | **0–80 PSI** (revised twice — see below) | The commodity family only offers 10/30/80/100/150/200/300 — **there is no 60**. 80 is the first option that clears the TA100D's 50 psi rating |
| **Thread** | **1/4" NPT — verify explicitly** | **The most likely way to buy the wrong part.** Listings for "G1/4" units look identical and are BSPP: a *parallel* British thread, where NPT is tapered. They start threading, then leak or crack the plastic multiport boss |
| Thread | **1/4" NPT male** | Confirmed — matches the existing gauge port |
| Output | **0.5–4.5V ratiometric** | Commodity part, easy to scale. Avoid 4–20mA: needs a loop supply and sense resistor for no benefit here |
| Supply | **5V DC** | Confirmed available — the chimney-box buck outputs 5V |
| Body | Stainless 304/316, sealed | Wetted metal, outdoors |

Do not run a 5V ratiometric transducer from 3.3V to dodge level shifting.
Ratiometric means the output scales with supply; accuracy below the spec'd
supply voltage is undefined.

#### Range: settled at 0–80 PSI (revised twice, 2026-08-07)

**0–30 → 0–60:** the original 0–30 predated identifying the filter, chosen because
accuracy is quoted as % of full scale so a tighter range reads better across a
10–25 psi operating band. The TA100D's **50 psi maximum** changed that. The
deciding case is not a fouled filter but a **closed return valve with the pump
running** — an IntelliFlo2 dead-heading can drive well past 30 psi, leaving a
0–30 sensor rated 150% proof (45 psi) at its limit.

**0–60 → 0–80:** these commodity transducers are sold in a fixed range family —
**10 / 30 / 80 / 100 / 150 / 200 / 300 PSI. There is no 60.** So the real choice
is 30 or 80, and 80 is the first that clears 50 psi with margin.

Error budget at 0–80 and 1% FS: **±0.8 psi**. Against an 8–10 psi backwash
threshold that is 8–10%, and most of it cancels in the differential (below).
Acceptable. Do not go to 100+ — the operating band shrinks to the bottom 10–25%
of scale for no benefit.

Note these listings routinely contradict themselves: marketing bullets claim
"0.5% FS" while the spec table says "1% FS". **Budget for 1%.**

#### Sourcing trap — these listings cannot be trusted on thread or range

Two failure modes, both observed on real listings 2026-08-07:

1. **Title says `1/4" NPT`, spec table says `Thread: G1/4"`.** When they conflict,
   **believe the spec table** — titles are written for the search algorithm,
   spec tables are usually pasted from the supplier datasheet. The same listings
   also claim 0.5% FS in the bullets and 1% FS in the specs.
2. **Title lists `10/30/80/100/150/200/300PSI` but the page has no variation
   dropdown.** That range list is keyword stuffing to catch every search. Without
   a Size/Style selector there is only one part, and it is whatever the spec
   table says.

**Correction to an earlier note in this doc:** it previously said "no adapters."
That is wrong as stated. **NPT-to-NPT reducing bushings are standard and correct**
— same thread form, same taper, seals properly. The prohibition is specifically on
mating *BSPP (G1/4) to NPT*, which are different thread standards.

That makes the cleanest sourcing route:

**Preferred: a 1/8" NPT sensor + a 1/4"MNPT × 1/8"FNPT brass reducing bushing
(~$3).** The automotive oil-pressure sender market is almost entirely 1/8" NPT,
so it is large, well-documented, and unambiguously labelled. Costs one extra
threaded joint and removes the thread gamble entirely. Look for 60 or 80 psi
variants.

**Alternative: buy configurable.** Transducers Direct configure to order against a
published datasheet — thread, range, and output are chosen explicitly, $49–116.
The electrical argument for commodity parts still holds completely (differential
measurement, errors cancel); what fails is *verifiability*, and a wrong thread
cracks the filter head. That is a sourcing risk, not a performance one.

#### Candidates evaluated 2026-08-07

| | Automotive-sender type (e.g. jcarpart 150 psi) | Amphenol SSI **P51** series |
|---|---|---|
| Thread | **1/8"-27 NPT**, stated with pitch — a good sign | **1/4" NPT direct**, no bushing |
| Range offered | 150 psi (too wide; check for 60/100 variants) | 100 psi |
| Accuracy | 1.5% FS | **0.5% FS** |
| Supply | **5V** — matches the buck rail | **8–30V** — needs the existing 12V tap |
| Output | 0.5–4.5V **ratiometric** | 1–5V **regulated** |
| Burst | min 300 psi | per datasheet |
| Termination | **sealed quick-disconnect + pigtail included** | 3' cable |
| Price | ~$25 | ~$80–150 |

**A regulated output changes the circuit for the better.** If a P51-style part is
used, the ratiometric compensation described earlier becomes unnecessary: drop
the A1 rail-monitoring channel and its two resistors, keep only the divider into
A0. The 100 µF bulk cap stays as good practice but is no longer load-bearing for
accuracy. Power it from the box's existing **12V** adapter, not the 5V buck.

**On over-wide ranges.** A 150 psi sensor across a 10–25 psi working band looks
bad on paper — 1.5% FS is ±2.25 psi against an 8–10 psi decision threshold. In
practice most of that cancels: "% of full scale" is a total error band dominated
by offset and span error, both common to the baseline and the current reading and
therefore removed by the subtraction. What survives is repeatability and
hysteresis, typically 0.1–0.25% FS. A 150 psi unit is workable; a 60–100 psi unit
of the same family is strictly better for the same money.

**Decision: prefer a 5V ratiometric automotive-sender part at 60–100 psi.** The
P51 is the better instrument and this application does not need a better
instrument. If buying it anyway, check DigiKey's actual in-stock quantity — the
"10 week lead time" attribute is the factory figure, not the distributor's.

#### Why commodity beats industrial here

An Omega PX109 or Gems 3100 (~$130–170) is the correct part in every respect and
is not needed. A ~$25 commodity 1/4" NPT unit is sufficient because **this
measurement is a difference, not an absolute.**

Pressure is always compared against a clean baseline established *with the same
sensor*. Offset and gain errors are common to both terms and cancel out of the
subtraction. What survives is nonlinearity and drift, both materially smaller
than the headline accuracy figure.

Drift is further absorbed by the workflow: the clean baseline is re-established
after every backwash, so the only window that has to stay stable is the weeks
between backwashes — not a season, and not the sensor's lifetime. If it fails in
three years, replace it for $25 and re-run the two-point calibration that would
have been done anyway.

Sourcing tiers, for the record:

| Tier | Example | ~$ |
|---|---|---|
| **Commodity — chosen** | Generic 1/4" NPT, 5V in / 0.5–4.5V out, selectable range | 20–30 |
| Mid | Transducers Direct TDH30 — US company, published datasheet | 60–90 |
| Industrial | Gems 3100, Omega PX109 | 130–170 |

### Plumbing

The filter already has an analog gauge threaded into a **1/4" FPT port** on the
multiport valve body. That port is the entire install. **No pipe cutting, no
gluing, no draining beyond the filter itself.**

#### Why a tee at all — and why "street"

**The tee exists for exactly one reason: to keep the analog gauge.** The Tagelus
multiport has one gauge port, and two things want it. If the analog gauge is
expendable, the tee is not needed — thread the transducer straight in and skip
it.

**"Street" is just parts economy.** The filter port is female (FPT) and the
existing gauge is male (MPT). So the fitting needs a *male* run to go into the
valve plus *two female* branches. That is a street tee (M×F×F) — one part. The
alternative is an all-female tee plus a 1/4" close nipple: same geometry, two
parts, one extra threaded joint to seal on a 50 psi tank.

**First, check for a second port.** Some filter tanks and valve bodies carry a
spare plugged 1/4" NPT boss. If this one does, use it and the whole question
disappears — two independent ports, no tee, no shared moment arm.

Failing that, three options:

| Option | Mechanical risk | Keeps analog gauge | Cost |
|---|---|---|---|
| **A. Street tee, both instruments on the port** | Moderate — doubles the moment arm on a plastic boss | Yes | $8 |
| B. Transducer only, no tee | Lowest — same load as the gauge it replaces | **No** | $0 |
| **C. Street tee + short braided 1/4" pigtail hose**, transducer mounted to a nearby surface | **Lowest of the three** — no cantilever at all | Yes | ~$20 |

**Recommendation: A, or C if the tee looks marginal once it is dry-fitted.**

Keeping the analog gauge is worth the $8 for three reasons that are easy to
underrate:

- **It is the calibration reference.** The two-point calibration below has no
  meaning without a trusted gauge to calibrate *against*. Remove it and the only
  way to check the transducer is to reinstall it — the same sequential-swap
  awkwardness already accepted for the flow meter vs. the Blue-White gauge.
- **It works when nothing else does.** ESP down, WiFi down, Pi down, power
  outage — the analog gauge still reads. Filter pressure is a thing you want
  during exactly those events.
- **It is what a pool tech looks at.** Nobody servicing this pad is going to open
  Home Assistant.

Option B is a legitimate choice if adding brass to a plastic boss feels wrong —
it is genuinely the lowest-risk mechanical option, and the analog gauge can be
kept in a drawer for periodic calibration checks. It just costs the three points
above.

**As-decided assembly** (2026-08-07), reading outward from the filter:

```
filter multiport port ....... 1/4" FNPT
  └─ street tee (1/4" MNPT run) ──┬── 1/4" FNPT branch
  │                               │     └─ analog gauge (1/4" MNPT)  ← keep
  │                               │
  │                               └── 1/4" FNPT branch
  │                                     └─ reducing bushing (1/4" MNPT × 1/8" FNPT)
  │                                          └─ transducer (1/8" MNPT)
  │                                               │ 3 wires → chimney box
```

**Four sealed joints:** tee→filter, gauge→tee, bushing→tee, sensor→bushing.
PTFE tape on every male thread.

⚠ **Four joints is a longer, heavier stack cantilevered off a plastic boss.**
Two free mitigations: **dry-fit the entire assembly before taping anything** and
confirm it clears the multiport handle through full rotation; and **orient the
sensor down or sideways, never straight out**, with the cable strain-relieved so
it cannot tug the fitting. If the assembled stack looks long, switch to the
braided-pigtail option (C below) and move the sensor's weight onto a bracket.

*Tidier build if one can be sourced:* a **1/4"M × 1/4"F × 1/8"F reducing street
tee** eliminates the bushing and one joint. Less common than a plain tee.

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

~10 mA is being added to a rail already absorbing 300 mA peaks. Buck output is
confirmed 5V, so every load shares one rail.

#### Why lever nuts — the buck has two output taps and four loads

The buck converter exposes **two** output terminals. Both are already used: one
feeds the ESP8266, one feeds the hall flow sensor. The transducer and the ADS1115
make **four** loads on two taps, so the rail has to branch somewhere.

That is the entire job. Lever nuts are just solderless, re-openable, rated splices
to do it:

```
buck 5V  ──► [WAGO 221, 5-conductor] ──┬──► ESP8266
                                       ├──► flow sensor
                                       ├──► transducer
                                       └──► ADS1115

buck GND ──► [WAGO 221, 5-conductor] ──┴──► (same four returns)
```

**Buy 5-conductor, not 3-conductor** — one in plus four out per rail, two nuts
total. Chaining 3-conductor nuts works but stacks more connections in the box for
no benefit. WAGO 221 accepts 24–12 AWG, so the 22 AWG sensor leads are in range.

Alternatives, if preferred: a small **DIN or screw terminal strip** is tidier for
a permanent enclosure and makes future additions land somewhere obvious; soldered
and heat-shrunk splices are the most durable but not re-openable. Avoid twist-on
wire nuts at this gauge — they do not grip fine stranded wire reliably.

#### Connector durability in an outdoor box

Worth deciding deliberately, since the chimney box sees thermal cycling and
humidity. A **pre-soldered ADS1115** means male header pins, connected with
female Dupont jumpers — convenient, and the least reliable option in this
environment. Dupont crimps back out and corrode, and the failure is intermittent
rather than clean.

In order of durability:

1. **Solder leads directly to the board pads** — most reliable, and defeats the
   point of buying pre-soldered
2. **Pre-soldered header + a screw-terminal shield** — good compromise
3. **Pre-soldered header + Dupont jumpers, mechanically secured** — seat them
   fully and lock them with hot glue or silicone so nothing can back out

Option 3 is acceptable here: this is a monitoring sensor, not a safety path, and
its failure mode is "the pressure reading goes stale" — the same posture already
accepted for the White Rodgers relay. Just do not leave the jumpers loose.

**Note on STEMMA QT:** Adafruit's ADS1115 has QT/Qwiic connectors for solderless
I2C, but **A0 and A1 are not on the QT connector.** Both analog inputs are needed
here, so QT solves the half of the problem this project does not have.

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

### The R-40 is copper-only unless the silver electrode was ordered

Corrected 2026-08-07 against the R-40 Installation & Pool Care Manual. An earlier
draft of this doc stated the R-40 uses a copper/silver alloy electrode. **That is
wrong for the standard unit.**

| Part | Composition | Status |
|---|---|---|
| **CLE-02** | **Copper only** | **Ships standard** — components list p.5, reorder note p.16 ("residential copper electrode") |
| CLE-51 | 90% copper / 10% silver | **Optional upgrade** — spec sheet p.21 |

**Confirmed 2026-08-07: this pool has CLE-02 — copper only, no silver.**

### Is the CLE-51 silver upgrade worth it? — No, not now

Recommendation: **stay on CLE-02.** Three reasons, in order of weight:

1. **It changes nothing you can measure or tune.** The ion test reads copper. The
   target stays 0.15–0.20 ppm copper. Silver output is fixed by the alloy ratio
   and rides the same dial — so you would be paying more for a parameter you
   cannot read, cannot verify, and cannot adjust independently.
2. **It does not relax the chlorine requirement.** The EPA label statement
   (manual p.4) mandates ≥0.4 ppm free chlorine regardless of electrode. Silver
   buys no reduction in the oxidiser routine, which is where the actual ongoing
   effort is.
3. **Electrodes are consumable — 1–5 year life (p.16).** This is a recurring
   premium, not a one-time upgrade, and silver is the expensive half.

Silver is bactericidal where copper is algaecidal, so the theoretical case is
broader-spectrum sanitation. **Revisit only if a real problem appears** that
copper at 0.15–0.20 ppm plus 0.4–1.0 ppm FC is failing to handle. There is no
such problem on record.

Stated honestly: the incremental benefit of silver in consumer pool ionizers is
not well quantified in any documentation found. This recommendation rests on what
is controllable and measurable, not on evidence that silver is ineffective.

### The target is 0.15–0.20 ppm — CLAUDE.md was wrong

The manual states this in a boxed callout on p.14 and repeats it on p.15 and in
the Quick Chart on p.22:

> **THE DESIRED ION LEVEL IN THE POOL IS 0.15 – 0.20 ppm**

with "in very hot, humid areas, stay closer to 0.20 ppm."

CLAUDE.md previously recorded 0.2–0.4 ppm. The upper half of that range is above
the manufacturer's stated maximum. Corrected in CLAUDE.md 2026-08-07.

The manual also warns separately: **"Excessive amounts of Copper may cause
staining of pool and spa surfaces"** (p.16), and for marcite/gunite finishes
recommends a sequestering agent — but specifically one that does **not** strip
copper. Named safe: Pool Stain Treat (United Chemical), The Ionizer Stuff (Jack's
Magic). Named as interfering: Sequasol, Cop-Out, Metal Magnet, aluminium
sulfate, alum. A dose of the wrong sequestrant tanks the copper level and must be
recorded in `pool_doses` or the dilution model will read it as an unexplained
crash.

### Backwash is the primary copper-loss mechanism — and that is filter-specific

Copper does not decay like chlorine. It leaves by **dilution**: water out, fresh
water in. That is why the chemistry brief models it against the `pool_actions`
table rather than as time-based decay.

Identifying the filter as a **sand** filter sharpens this considerably. A
cartridge filter is never backwashed — it is pulled and hosed, and the pool loses
essentially no water. A 30" sand filter backwashing at 45–60 GPM for 2–3 minutes,
plus the rinse cycle, dumps on the order of **100–200 gallons per backwash**.
That is not a footnote to the copper model; on this pool it is the dominant term.

Practical consequence for the schema: **record backwash duration, not just the
fact of a backwash.** Volume scales with time, so duration plus the known flow
rate gives dumped gallons, which gives a predicted copper drop:

```
predicted_drop_ppm ≈ current_ppm × (gallons_dumped / pool_volume)
```

Fit that against the next copper test and it self-corrects. Without duration
logged, every backwash is an unexplained step change in the series.

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

All targets below are from the R-40 manual unless noted — they are **not**
conventional-pool numbers and several differ materially.

| Parameter | Target (R-40 manual) | Instrument | Cadence |
|---|---|---|---|
| **Copper** | **0.15–0.20 ppm** (p.14) | **Hanna HI747** — not in K-2006 | Weekly (manual says weekly) |
| **FC** | **≥ 0.4 ppm floor** (EPA statement, p.4) | **Hanna HI701** | 2–3× / week |
| **pH** | **7.2–7.6**, 7.2–7.4 preferred (p.13) | Taylor K-2006 | Weekly, and after heavy rain |
| TA | 80–140 ppm (p.13) | Taylor K-2006 | Monthly |
| CH | 150–350 ppm (p.13) | Taylor K-2006 | Monthly |
| CYA | **not required**; drain if > 150 ppm (p.13) | Taylor K-2006 — included free | Occasionally |
| **TDS** | **500–3000 ppm** (p.13) | TDS pen | Yearly |
| Phosphate | < 125 ppb (p.18) | pool store, or Hanna HI7134 | Only when chasing algae |
| Water temp | — | `sensor.pool_pad_hx_water_in_temp`, already logged | Every 2 min |
| Salt | not applicable | — | — |
| ORP | not applicable | — | — |

Three of these are not obvious and are easy to get wrong:

- **pH is a sanitiser-efficacy parameter here, not a comfort one.** Above 7.6 the
  copper ions fall out of solution and the R-40 stops working — the manual calls
  pH "the most important factor in the pool's water chemistry" and lists high pH
  as the usual cause of an unobtainable ion level (p.13, p.18 #6). On a
  conventional pool a pH of 7.8 is cosmetic. Here it means the sanitiser is off.
- **TDS is a hard requirement, not a nice-to-have.** The R-40 electrolyses the
  water and needs conductivity to do it. Below 500 ppm it cannot produce ions at
  any dial setting (p.13, p.18 #12). This is the parameter most likely to be
  silently out of range after a big drain-and-refill.
- **CYA needs no separate purchase and is not a driver.** An earlier draft of
  this doc claimed CYA sets the FC target — that is conventional-pool logic and
  does not apply. The manual says CYA is *not required*, and only matters as an
  upper bound (drain above 150 ppm). Free with the K-2006 regardless.

**On TDS pens.** They do not measure dissolved solids — they measure conductivity
and multiply by a conversion factor, and the common scales (0.5, 0.7, 442) can
report ppm values ~40% apart from identical water. Treat the pen as a
"am I above 500?" instrument and a trend tracker, not a lab number. The manual
notes a TDS reading "can be obtained at any pool store" — **cross-check the pen
against a pool-store reading once** to establish the offset.

Buy the **HM Digital TDS-3**, not a rebadge. Avoid any combination
pH/TDS/salinity pen: pH is already covered by the K-2006 with a reagent test that
cannot drift, cheap combo pH electrodes need calibration powder and KCl storage
solution or the bulb dies, and a silently drifting pH reading is the worst
possible failure here — it would send someone chasing a copper problem that is
actually a pH problem.

Expect TDS to be fine. It climbs steadily as chemicals are added and only drops
on a drain-and-refill, so an established pool is almost certainly well above 500
ppm. The R-40's floor mostly bites on fresh fill water. Worth $15 to confirm
because it is the one parameter that would invalidate every other reading.

**Testing trap — do not test copper after shocking.** Manual troubleshooting #7:
high free chlorine bleaches the ion test and it reads near zero. Any copper
reading taken shortly after an oxidiser dose is garbage. The logging UI should
refuse or flag a copper entry within ~24h of a recorded shock in `pool_doses`.

**Reagent shelf life.** The manual is emphatic that ion-test reagents be replaced
yearly and kept out of sunlight at room temperature (p.14, p.18 #5). The same
discipline applies to the Hanna reagents — date the packs on arrival, because a
slow reagent drift looks exactly like a slow chemistry trend and would poison the
model invisibly.

**Copper is the gap.** The K-2006 does not test it. Verified 2026-08-07: Hanna
makes **two** copper Checkers, and the obvious one is the wrong one.

| | HI702 (High Range) | **HI747 (Low Range)** |
|---|---|---|
| Range | 0.00–5.00 ppm | **0–999 ppb (0–0.999 ppm)** |
| Resolution | 0.01 ppm | **1 ppb (0.001 ppm)** |
| Accuracy @ 25 °C | ±0.05 ppm ±5% of reading | **±10 ppb ±5% of reading** |
| **Error at 0.175 ppm** (mid-target) | ±58.8 ppb → **±34%** | ±18.8 ppb → **±11%** |
| Method | Bicinchoninate | Bicinchoninate (EPA adaptation) |
| Reagent | HI702-25 (25 tests) | **HI747-25 (25 tests)**; meter ships with 6 |

All specs verified against hannainst.com 2026-08-07.

**Buy the HI747.** The HI702 is aimed at reef aquariums, where copper treatment
runs 1–3 ppm. Against the R-40's actual 0.15–0.20 ppm band the HI702's error
window is **wider than twice the entire target range** — it cannot distinguish
in-spec from out-of-spec at all, at any reading.

Be honest about the HI747 too: ±18.8 ppb against a 50 ppb-wide target band is
not luxurious either. Two things make it the right buy anyway. First, the fixed
±10 ppb term dominates, and **repeatability is better than absolute accuracy** —
the dilution model cares about *change between tests*, where a consistent bias
cancels. Second, look at what it replaces: the included CLA-41 kit is a colour
match card with exactly two reference blocks, 0.15 and 0.20. Anything numeric is
a large upgrade.

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

Three independent groups. Nothing in one blocks another; buy in any order.

**Group A — chemistry, ~$239.** Usable the day it arrives. No wiring, no code.

| Item | Spec | Qty | ~$ |
|---|---|---|---|
| **Hanna HI747** | copper **Low Range** Checker HC — **not** the HI702, see Part 2 | 1 | 50 |
| HI747-25 reagent | 25 tests; meter ships with 6 | 2 | 20 |
| Hanna HI701 | free chlorine Checker HC | 1 | 55 |
| HI701-25 reagent | DPD packets, 25 tests; meter ships with 6 | 3 | 27 |
| Taylor K-2006 | FAS-DPD kit — pH, TA, CH, CYA, plus CC and backup FC | 1 | 80 |
| **HM Digital TDS-3** pen | 0–9990 ppm, ATC — R-40 needs 500–3000 ppm to function at all | 1 | 15 |
| Distilled water | rinsing; 1:1 dilution if copper ever over-ranges | 1 gal | 2 |

Reagent quantities cover roughly the first 4–5 months at the manual's cadence
(copper weekly, FC 2–3× weekly). **Do not stock deeper** — reagents degrade and
should be replaced yearly. Ongoing reagent cost settles around **$60–70/year**.

**Group B — filter pressure sensing, ~$61.**

| Item | Spec | ~$ |
|---|---|---|
| Pressure transducer | **DECIDED:** automotive-sender type, **1/8"-27 NPT male**, 0.5–4.5V out, 5V supply, 316 SS, sealed QD + pigtail. **Request 60 or 100 psi**; 150 acceptable if that is all that is stocked. ***Never* G1/4** | 25 |
| **Reducing bushing** | **1/4" MNPT × 1/8" FNPT brass hex bushing.** An NPT *reducing bushing* is male on the large end, female on the small — one piece. **Not** a reducing *coupling*, which is female × female and will not thread into the tee | 4 |
| Brass 1/4" NPT **street tee** | male run × female × female | 8 |
| PTFE tape | standard white — **every male thread**, four joints total | 2 |
| ADS1115 breakout | 16-bit, I2C, 4-channel. **ShillehTek sells it explicitly pre-soldered** — Adafruit's ships with the header loose, and generic multipacks vary. Identical to ESPHome either way; default address 0x48. See note below on connector durability | 10–15 |
| Resistors | 4.7k ×1, 10k ×3 — **1% metal film** | 3 |
| Capacitors | 100 µF electrolytic + 0.1 µF ceramic | 2 |
| Cable | 3-conductor 22 AWG shielded, length to the chimney box | 10 |
| WAGO 221 lever nuts | **5-conductor**, ×2 — one for the 5V rail, one for GND. See "Why lever nuts" below | 5 |

**Group C — booster monitoring, ~$15.**

| Item | Spec | ~$ |
|---|---|---|
| CT clamp for Shelly EM Gen3 `IB` | Shelly-branded, matching the Gen3 input | 15 |

**Total ~$315.** For comparison, the reviewed third-party spec estimated
$1,100–2,700 for equivalent-or-worse coverage of this specific pool.

Group A is the one to buy first — it is the prerequisite for the chemistry
forecasting in [pool_chemistry_logging.md](pool_chemistry_logging.md) and needs
no hardware work. Group B waits on the flow meter regardless.

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

- [x] ~~**Identify the filter**~~ — **Pentair Tagelus TA100D**, 30" top-mount
      sand, 4.9 sq ft, 600 lb sand, 2" multiport, 50 psi max. Owner-confirmed
      2026-08-07. Alert wording is "backwash"
- [x] ~~Confirm the existing gauge is 1/4" NPT~~ — yes, standard Pentair
      multiport thread. Owner-confirmed 2026-08-07
- [x] ~~**Inspect the R-40 electrode capsule**~~ — **CLE-02, copper only.** No
      silver in this pool. CLE-51 upgrade assessed and declined; see Part 2
- [ ] **Confirm the transducer's overpressure rating is ≥ 50 psi** before
      ordering — the TA100D's max operating pressure is 50 psi and a 0–30 unit
      rated only 150% (45 psi) is under-specced
- [ ] **Check the tank / multiport for a spare plugged 1/4" NPT port.** If one
      exists, use it and skip the tee entirely — two independent ports, no shared
      moment arm on a plastic boss
- [x] ~~Confirm the Hanna copper Checker model number~~ — **HI747 (Low Range)**,
      0–999 ppb, ±10 ppb ±5%. Not the HI702, whose error window is wider than
      twice the R-40's entire 0.15–0.20 ppm target band
- [x] ~~Verify HI701 published accuracy~~ — 0.00–2.50 ppm, ±0.03 ppm ±3%, DPD
      per EPA 330.5. Confirmed at hannainst.com 2026-08-07
- [ ] **Measure TDS.** Must be 500–3000 ppm or the R-40 cannot produce ions
      regardless of dial setting. Never verified; not currently recorded anywhere
- [ ] Confirm which sequestering agent (if any) is in use — several common ones
      strip copper and would corrupt the dilution model
- [ ] Date the Hanna reagent packs on arrival; replace yearly
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
- [Clearwater MineralPURE R-40 Installation & Pool Care Manual (2024)](https://clearwaterpoolsystems.com/wp-content/uploads/R40-manual-2024.pdf)
  — source for every chemistry target in Part 2. Key pages: p.4 EPA free-chlorine
  floor, p.13 pH/TA/CH/CYA/TDS ranges, **p.14 the 0.15–0.20 ppm ion callout**,
  p.16 staining warning + sequestering agents, p.18 troubleshooting (chlorine
  bleaches the copper test; phosphate; TDS), p.21 spec sheet (CLE-02 vs CLE-51)
- Third-party "Smart Pool Laboratory Hardware Specification", reviewed 2026-08-07
