# Pool Heat Recovery — As-Built Wiring Manual

**What this is:** the field manual for the pool heat recovery system as it is *actually wired at this house*, which is not what the HotSpot FPH manual describes. Written so that an electrician, an HVAC tech, or a neighbor who has never seen this system can open the boxes, understand what they're looking at, and troubleshoot it without me present.

Last updated: 2026-07-30.
Companion docs: [pool_heat_recovery.md](pool_heat_recovery.md) (design rationale, project status, HA/Jeeves layer) and the HotSpot FPH installer manual PDF (`~/Desktop/Hot Spot Energy FPH Free Pool Heater Manual.pdf`).
Authority order when docs disagree: **this doc** (as-built) → FPH manual (generic) → anything else.

---

## READ THIS FIRST — the one safety rule

**Refrigerant must never be diverted into the heat exchanger unless pool water is actually flowing through it.**

If the A/C compressor sends hot refrigerant into the FPH heat exchanger while the pool pump is off, the water in the exchanger boils/stagnates, and you can damage the heat exchanger and the compressor (FPH manual, printed p.25). Every piece of hardware described in this document exists to make that state physically impossible.

The protection is **hardware, not software.** No computer, no Wi-Fi, no Home Assistant, and no Raspberry Pi sits in the safety path. The Tecmark flow switch is a mechanical switch in the 24VAC control leg: no flow, no circuit, no diversion. If the network is down, the Pi is unplugged, and the house is on fire, the flow switch still works.

**Corollary for anyone troubleshooting:** do not jumper across the flow switch "just to test something." That is the exact dangerous state, with nothing left to catch it.

---

## How a cycle actually runs — the operating sequence

No single page of the FPH manual states this plainly, and it is the thing to understand before touching anything.

1. **A/C compressor starts.** Cooling only — heat recovery never runs on a heating call.
2. **The FPH controller immediately calls the pool pump**, *before* it has decided whether to heat anything. The system is still in normal liquid-to-air mode: refrigerant to the outdoor coil, fan running, valves at rest. The controller closes its terminal-4 output; the IntelliComm II sees 24VAC on Program 4; the pump spins up to Ext. Program 4 at 2200 RPM.
3. **~20-second purge delay.** The controller runs the pump to flush stagnant water out of the heat exchanger, so the PT-100 reads real circulating pool water and not a slug that has been sitting in the shell.
4. **The controller samples the PT-100** against the pool setpoint:
   - **Pool at or above setpoint** → no heating. Stays liquid-to-air and cools the house normally. Nothing diverts.
   - **Pool below setpoint** → proceed.
5. **Flow proves itself.** The pump has been running since step 2, so water is already moving. If flow is at or above the Tecmark's trip point, the flow switch closes.
6. **Diversion engages.** 24VAC reaches the 90340 coil → condenser fan off, heat reclaim valve and bi-directional solenoid on. The system is now liquid-to-liquid: compressor heat goes into the pool instead of the outdoor air. `binary_sensor.pool_pad_pool_heat_active` goes true.
7. **Temp Re-Check.** The controller periodically re-samples the PT-100 and drops the call once the pool reaches setpoint.
8. **On release**, the pump keeps running through the Program-4 stop delay (≥60 s) to flush the exchanger before stopping.

**Two consequences a troubleshooter must know:**

- **The pump does not need to already be running.** The system cold-starts it. A/C on + pool below setpoint = free heat, regardless of the pump's own schedule. This is why the IntelliComm's call is wired *upstream* of the flow switch (see Part 2) — if it were downstream, the pump could never start, because the flow switch can't close until the pump is already moving water. That would be a deadlock.
- **A running pump is not evidence that heat is being recovered.** Steps 2–4 spin the pump up on *every* A/C start, including the times the answer turns out to be "pool's warm enough." **Pump at 2200 RPM with the condenser fan still spinning is normal.** It is not a stuck relay. Judge diversion by the fan and the valves, never by the pump.

---

## Cast of characters

| Thing | What it is | Where it lives |
|---|---|---|
| **A/C unit** | Bryant 226ANA048-B, 4-ton two-stage heat pump | Side yard, outdoor unit |
| **FPH** | HotSpot FPH5 "free pool heat" unit — refrigerant-to-water heat exchanger + control box | Next to the A/C unit |
| **24VAC transformer** | 240→24V, HotSpot-supplied, fed off the load side of the A/C contactor | Inside the A/C outdoor unit |
| **The trio** | Heat reclaim valve + bi-directional solenoid + normally-closed fan relay. All three on one 24VAC pair. Energized together = "pool heat mode" | At/inside the A/C + FPH |
| **Tecmark 3010P** | Mechanical flow switch, SPNO. Closes when pool water flow is high enough | Screwed into the FPH heat exchanger's blue outlet-water port |
| **Mars/Supco 90340** | DPDT relay, 24VAC coil. Kills the condenser fan *and* powers the valves, together | In the FPH-side box |
| **Pentair IntelliFlo2 VST** | Variable-speed pool pump, 3.0 HP | Pool equipment pad |
| **Pentair IntelliComm II** | Translates a 24VAC signal into an RS-485 "run program N" command to the pump | **New box I added** at the pad |
| **White Rodgers Type 84** | 24VAC-coil relay used purely as an isolated *sensor*. Not part of the safety chain | Same new box as the IntelliComm |
| **ESP8266 (pool-pad node)** | ESPHome monitoring node — temps, flow, heat-active state → Home Assistant | Same new box as the IntelliComm |

**Nothing inside the heat pump and nothing inside the FPH was modified by us.** Both were wired by the installer per the HotSpot manual. Every change we made lives either (a) in the 24VAC control leg between the FPH controller and the trio, or (b) in the new box at the pool pad. If you are diagnosing a problem, that boundary is where to start.

---

## Part 1 — How our system differs from the FPH manual

The HotSpot manual is written for a simple case: a single-speed pool pump, one A/C unit. We have neither of those conditions cleanly, so three things in our install are **not in the manual, or contradict it.** These are the three things that confuse everyone who opens these boxes.

### Difference 1 — The Mars 90340 exists, even though the manual says it shouldn't

FPH manual, printed p.21, step 6:

> "If you have multiple A/C units (dual or triple FPH models) then you will need to wire a 90340 relay in order to separate the 24VAC from each of the units."

We have **one** A/C unit. By that sentence, we should have no 90340. We have one anyway.

**Why:** the manual's single-unit design assumes the FPH controller's pin-4 output drives the trio directly, and that the pool pump is a dumb single-speed pump switched by a contactor. Our pump is variable-speed. The manual's own words on printed p.9:

> "In the case of a variable speed pool pump, contact HotSpot technical support dept. with the complete model number of your pump."

In other words: **for our pump, the manual has no diagram.** There is no printed page that shows what we built. What we needed was a single 24VAC "pool heat is on" signal that simultaneously:

1. **cuts power to the condenser fan** (fan must stop — the refrigerant heat is going into the pool now, not into the air),
2. **applies power to the heat reclaim valve and the bi-directional solenoid** (divert refrigerant into the exchanger), and
3. **is available as a clean signal** to tell the IntelliComm II to spin the pump up to the heat-recovery speed.

That is one coil switching two poles in opposite directions, plus a signal tap. The Mars 90340 is a DPDT relay — one coil, two independent poles, one normally-closed and one normally-open set. It does all three jobs with one part. So the 90340 is here doing **double duty as the trio's switching hub**, not the multi-unit isolation job the manual describes.

**Say this out loud to any tech who asks:** *"Yes, there's a 90340. No, we don't have two A/C units. It's here because the pump is variable-speed and the manual has no diagram for that case. It switches the fan off and the valves on at the same instant."*

### Difference 2 — The flow switch is our addition, wired per p.22, into a p.9 system

The manual shows the flow switch (printed p.22) and the variable-speed/IntelliComm pool side (printed p.9) on **two different pages, in two different diagrams, that are never drawn together.** Each page shows half of our system. Part 2 of this document is the merged diagram — that merge is the single most useful thing in this file.

### Difference 3 — The White Rodgers Type 84 appears nowhere in any HotSpot document

It is not in the manual, not in the parts list, not in any diagram. **It is not part of the heat recovery system at all.**

It is a $8 relay we added for one reason: to give the ESP8266 monitoring board a completely **electrically isolated** way to see whether the 24VAC pool-heat signal is live, without the low-voltage electronics touching the 24VAC circuit. Its coil taps the 24VAC in parallel (draws a trivial amount, changes nothing); its dry contact closes a 3.3V logic signal to the microcontroller.

**If you remove the White Rodgers entirely, the pool heat recovery system continues to work perfectly.** You would only lose the dashboard indicator. Nobody troubleshooting a heating or safety problem should be looking at it. It is listed here only so that the next person who opens the box doesn't waste an hour trying to find it in the manual.

---

## Part 2 — The merged wiring diagram (manual p.9 + p.22 + our changes)

### The two 24VAC legs — the concept that makes everything else make sense

The transformer puts out 24VAC on two wires (pins 7 and 12 per manual printed p.8). Everything downstream is just a question of *which devices sit across those two legs, and what interrupts one of them.* Throughout this document:

- **COMMON LEG** — the leg that is always present whenever the transformer is powered. It runs straight out to one side of every device in the trio, and it is the leg that gets **pigtailed together in the top of the FPH control box, between the LCD and Modules A and B.** That pigtail is a junction point, not a component. If you see several wires bonded together up there under the LCD, that is this leg, and it is normal.
- **SWITCHED LEG** — the leg the FPH controller opens and closes. It leaves the transformer, enters the FPH controller at the **blue butt connector**, is switched internally by the controller (**terminal 4** — "Pin 4 controls all of the HVAC side of the valves," manual printed p.21 step 5), and comes back out of terminal 4 to drive the load.

The FPH manual's p.22 diagram shows the flow switch inserted in the SWITCHED LEG on its way back from terminal 4. That is exactly where ours is.

The manual's p.9 diagram shows the IntelliComm II hanging off the controller, with its GPM/RPM Program inputs (9–24V AC/DC, unpolarized) driven by 24VAC. Ours is on **Program 4 / input 4**.

**The merge point the two pages never show together: the switched leg splits into two branches at terminal 4.** Page 9 draws the pump-call branch. Page 22 draws the diversion branch. Neither page draws both, because neither page imagines the other's system. Ours has both, and *the order matters*:

| Branch | Path | Gated by flow switch? | Why |
|---|---|---|---|
| **A — pump call** | Terminal 4 → IntelliComm II Program 4 | **No** | The pump must be able to cold-start. Gating it on flow would deadlock: no pump → no flow → no switch closure → no pump |
| **B — diversion** | Terminal 4 → Tecmark flow switch → 90340 coil | **Yes** | Refrigerant may only divert into the exchanger once water movement is physically proven |

Both branches return through the same COMMON LEG (the yellow at coil A). The White Rodgers sensing coil sits on branch B, after the flow switch, so it reports *actual diversion* rather than merely "the controller asked."

### Master diagram — as built

```
   240VAC, load side of A/C contactor
              │
     ┌────────┴────────┐
     │ 240→24V         │   HotSpot transformer, inside the A/C outdoor unit
     │ transformer     │   (240V on pins 1&6; jumpers 2-5 and 8-11; 24VAC out on 7&12)
     └───┬─────────┬───┘
         │         │
  COMMON LEG    SWITCHED LEG (raw)
         │         │
         │         └──────────────► FPH CONTROLLER  [blue butt connector]
         │                                │
         │                          switched internally
         │                          by controller TERMINAL 4
         │                          (closes when: A/C compressor running
         │                           AND pool is below setpoint,
         │                           after a 20 s purge delay)
         │                                │
         │                    ┌───────────┴────────────┐
         │                    │                        │
         │              (branch A: PUMP CALL)    (branch B: DIVERSION)
         │              unconditional —                │
         │              this is what lets the          ▼
         │              pump COLD-START          ┌──────────────────┐
         │                    │                  │  TECMARK 3010P   │ ◄── OUR ADDITION
         │                    │                  │  flow switch     │     (manual p.22)
         │                    │                  │  (SPNO)          │     Mechanical. Closes
         │                    │                  └────────┬─────────┘     only when pool water
         │                    │                           │  WHITE wire   is actually moving.
         │                    │                           │  ("proven heat call")
         │                    │                           │
         │                    │                           ├──────► tap ──┐
         │                    │                           │              │
         │                    │                           ▼              │
         │                    │     ┌─────────────────────────┐          │
         │                    │     │  MARS/SUPCO 90340 DPDT  │          │
         │                    │     │                         │          │
         │                    │     │  COIL B (right) ◄───────┼── WHITE  │
         ├──────────────────────────┼──► COIL A (left)        │          │
         │  (via RED, on the  │     │     = YELLOW + RED      │          │
         │   trio common bus) │     │            │            │          │
         │                    │     │            └── YELLOW ──┼──► tap ──┼──┐
         │                    │     │                         │          │  │
         │                    │     │ Pole 1: T1 ●──NC──● T2  ├── to CONDENSER FAN
         │                    │     │         (T3 unused)     │          │  │
         │                    │     │ Pole 2: T4 ●──NO──● T6  ├── RED, to HEAT
         │                    │     │         (T5 unused)     │   RECLAIM VALVE +
         │                    │     └─────────────────────────┘   BI-DIR SOLENOID
         │                    │       T1 = BLACK from transformer    │  │
         │                    │       T4 = WHITE from transformer ⚠ different white!
         │                    │                                      │  │
         └──► to the other side of the trio (heat reclaim valve,     │  │
              bi-directional solenoid, NC fan relay) — the parallel  │  │
              "trio bus", pigtailed in the FPH box under the LCD     │  │
                                                                     │  │
   ═════════════ NEW BOX AT THE POOL PAD (added by us) ═════════════ │  │
                                                                     │  │
     branch A ───────────────────────────────┐        WHITE tap ─────┘  │
     (terminal 4, NOT flow-gated)            │        (flow-gated)      │
                                             │              │           │
                                             ▼              ▼           │
                              ┌────────────────────┐  ┌──────────────────┐
                              │  PENTAIR           │  │ WHITE RODGERS 84 │
                              │  INTELLICOMM II    │  │ 24VAC coil       │
                              │  GPM/RPM 4         │  │ (SENSING ONLY —  │
                              │  (Program 4 input, │  │  not safety)     │
                              │   9–24V AC/DC,     │  │                  │
                              │   unpolarized)     │  │ SPNO contact:    │
                              │                    │  │ 3.3V ─●  ●─ GPIO5│
                              └─────────┬──────────┘  └──────────────────┘
                                        │                     ▲           │
                    YELLOW tap (common) ┴─────────────────────┴───────────┘
                                        │
                                   RS-485 cable
                                        │
                                        ▼
                             PENTAIR INTELLIFLO2 VST
                             runs Ext. Program 4
                             @ 2200 RPM (~55–60 GPM)
```

### The single most important paragraph in this document

**There is one common leg and two switched points, not one signal.** FPH controller terminal 4 closes whenever the compressor runs, and it does two separate things: it calls the pump *immediately and unconditionally* (branch A → IntelliComm Program 4), and it offers 24VAC to the diversion circuit *only through the flow switch* (branch B → Tecmark → 90340 coil). The pump is therefore allowed to start with no flow — it must be, or nothing could ever start — while the valves are never allowed to move without proven flow. **The pump running tells you the compressor is on. Only the fan stopping tells you heat is actually being recovered.**

### ⚠ INFERRED — trace to confirm (does not block use)

That terminal-4 split is inferred, not traced wire-by-wire. It is the only arrangement consistent with all known facts: the yellow from coil A goes to the IntelliComm; coil B carries only the white from the flow switch; and the pump demonstrably cold-starts on A/C start before any heating decision is made — which is impossible if the IntelliComm's hot side sits downstream of the flow switch.

**The discriminating test, two minutes:** meter VAC across the IntelliComm's Program-4 input terminals during the purge phase — A/C just started, pump spinning up, flow switch not yet closed (fan still running, valves at rest).

- **~24VAC → confirmed.** Branch A is upstream of the flow switch, as documented. Delete this warning box.
- **~0V → the documentation is wrong.** The IntelliComm is fed from somewhere else entirely, and the actual pump-call source needs tracing before anyone trusts Part 2.

---

## Part 3 — Component-by-component

### 3.1 Tecmark 3010P flow switch

**Job:** prove that pool water is actually moving before anything else is allowed to happen. This is the entire safety system.

| Property | Value |
|---|---|
| Part | Tecmark 3010P, SPNO (normally open, closes on flow) |
| Cover | 25165BM |
| Location | Threaded into the FPH heat exchanger's **blue "outlet water temp" port** |
| Mounting | Titanium insert + grommet pulled from the port → 3/4" MPT × 1/8" FPT stainless reducer bushing → switch (male 1/8" MPT) into the bushing. Teflon tape on both joints |
| Electrical position | **In series in the SWITCHED LEG**, between FPH controller terminal 4 and the 90340 coil |
| Adjustment | Screw CW = requires *more* flow to close. Set to open just below the FPH5's 45 GPM minimum |
| Status | Installed, wired, **calibrated** |

**Why here and not somewhere else:** putting it in series in the switched leg means it isn't advisory — it is the circuit. Nothing downstream can energize without it. A sensor that merely *reports* no-flow to a computer would depend on the computer being alive and correct. This doesn't.

**Calibration method (for re-doing it):** run the pump at 1500 RPM (~40 GPM, below the FPH5 floor) and adjust CW until the trio drops out. Then run 2200 RPM — it must hold solidly. A used switch that won't hold a stable trip point gets replaced (~$25); do not attempt to nurse one along.

**Failure modes:**
- **Stuck open** (won't close despite real flow) → you get no free pool heat. Annoying, costs nothing, hurts nothing. Symptom: A/C running, pool cold, pump not spinning up, dashboard "Pool Heat Active" stays off.
- **Stuck closed** (closes with no flow) → **this is the dangerous one.** The safety chain is defeated and diversion can happen into stagnant water.

**⚠ What actually backstops the dangerous case today — read this, it is narrower than you'd hope:**

| Failure | Covered now? | By what |
|---|---|---|
| Flow switch closed, **pump not powered** | **Yes** | Shelly EM CT on the pump circuit. HA alerts if `pool_heat_active` is true while pump watts are near zero |
| Flow switch closed, **pump powered but water not actually moving** — blocked impeller, closed valve, air lock, clogged filter, failed switch | **No. Uncovered.** | Nothing. The flow *meter* is not installed yet |

The pump-watts check is a proxy for flow, not a measurement of it. **Until the flow meter in section 5.1 is installed, no instrument in this system measures actual water movement** — the only real flow proof is the Tecmark itself, and these are the failures where the Tecmark is the thing that failed. That is why the flow meter is a safety item, not a nice-to-have data toy, and why section 3.1's calibration discipline (replace a switch that won't hold a stable trip point, don't nurse it) matters more than it otherwise would.

### 3.2 Mars/Supco 90340 relay

**Job:** one coil, two poles, moving in opposite directions — kill the condenser fan and power the valves at the same instant.

**Terminal table (traced from the actual box, 2026-07-30):**

| Terminal | Wire | Role |
|---|---|---|
| 1 | BLACK — from transformer | Common, pole 1 |
| 2 | BLACK — to condenser fan | **NC** contact, pole 1 |
| 3 | *(unused)* | NO contact, pole 1 |
| 4 | WHITE — from transformer ⚠ | Common, pole 2 |
| 5 | *(unused)* | NC contact, pole 2 |
| 6 | RED — to heat reclaim valve + bi-directional solenoid | **NO** contact, pole 2 |
| **Coil A** (left) | YELLOW (top) + RED (bottom) | Common leg / trio bus. Yellow continues to IntelliComm + White Rodgers |
| **Coil B** (right) | WHITE (bottom) — from the flow switch | Switched leg, post-flow-switch |

⚠ **There are two different white wires on this relay.** Terminal 4's white comes from the transformer and is contact power. Coil B's white comes from the flow switch and is the control signal. They do different jobs. Confusing them is the easiest way to wire this relay wrong.

**Behavior:**

| Coil state | Pole 1 (fan) | Pole 2 (valves) | Net |
|---|---|---|---|
| **At rest** — flow switch open, no proven flow | 1–2 closed → **fan runs** | 4–5 closed, dead-ends (nothing on 5) → **valves dead** | Normal A/C, no pool heat |
| **Energized** — flow switch closed, flow proven | 1 swings to unused 3 → **fan stops** | 4 swings to 6 → **24VAC to both valves** | Pool heat mode |

Because the flow switch gates the coil, **this relay physically cannot power the valves without proven flow.**

#### ⚠⚠ The common-terminal trap — read before wiring or metering

The schematic silkscreened on the relay case draws each pole as a pivoting switch arm whose stem appears to drop to the **middle** terminal (2 for pole 1, 5 for pole 2). That drawing makes 2 and 5 look like the common terminals.

**They are not.** Per Supco's own installation sheet, the terminal pairs are explicitly:

- **1&2 = NC, 1&3 = NO** → terminal **1** is the common
- **4&5 = NC, 4&6 = NO** → terminal **4** is the common

The common is the terminal that appears in *both* pairs, regardless of where the pivot stem seems to land in the drawing. **Trust the stated NC/NO pairs over the picture.** This cost two rounds of misreading before it was traced in person; you are being told so you don't repeat it.

Source: [Supco 90340 Installation Instructions](https://www.manualslib.com/manual/1430458/Supco-90340.html)

### 3.3 White Rodgers Type 84 (monitoring only — not safety)

| Property | Value |
|---|---|
| Part | White Rodgers Type 84 fan relay, 90-290Q, 24VAC coil, SPNO |
| Purpose | Electrically isolated "is pool heat on?" signal for the ESP8266 |
| Location | New box at the pool pad, alongside the IntelliComm II |
| Coil leg 1 | Tap on the **WHITE** wire (Tecmark → 90340 coil B) — the switched, flow-proven leg |
| Coil leg 2 | Tap on the **YELLOW** wire (90340 coil A → IntelliComm II) — the common leg |
| Contact | SPNO: 3.3V from the ESP → contact → **GPIO5 (D1)**, with a **10k pulldown to GND** |
| Status | Installed and live; reading in Home Assistant |

**Why a relay instead of an optocoupler board:** an opto module would have worked electrically, but the relay is a mechanical, obvious, $8 part that any HVAC tech recognizes on sight, with a coil that taps 24VAC in parallel exactly like a thermostat would. It draws a negligible load, adds nothing to the safety path, and its failure mode is "the dashboard stops updating" — never "the pool heat misbehaves."

**Why it taps those two specific points:** because that pair *is* the definition of "heat recovery is genuinely running." Tapping the FPH controller's output instead would tell you the controller *asked* for heat; tapping after the flow switch tells you heat is actually happening, with flow proven. That distinction is the whole point of the sensor.

**Why the 10k pulldown is mandatory:** the ESP8266 has no internal pull-down resistor on any usable GPIO except GPIO16. Without the external pulldown, GPIO5 floats when the relay contact is open and reports random garbage. The resistor lives in a combined terminal-block/resistor unit in the box. **If "Pool Heat Active" in Home Assistant flickers or reads on when the system is plainly off, check that resistor first.**

### 3.4 Pentair IntelliComm II + IntelliFlo2 VST

| Property | Value |
|---|---|
| Input used | **GPM/RPM 4 (Program 4)**, 9–24V AC/DC, **voltage-driven, not dry-contact**, unpolarized |
| Fed by | **Branch A** — FPH controller terminal 4 directly, *upstream of the flow switch*, returning on the common YELLOW. Not the same point as the 90340 coil (see Part 2) |
| Output | RS-485 to the pump |
| Pump program | **Ext. Program 4, locked at 2200 RPM** (~55–60 GPM, measured against the Blue-White gauge — not estimated) |
| Stop delay | Max available / ≥60 s — flushes the heat exchanger after the FPH releases the call |
| Power | 12VDC adapter (shared with the ESP8266 — see 4.2) |

**Two things that look like faults but aren't:**

1. The pump display reads **"DISPLAY NOT ACTIVE"** while an external program runs. That is normal and expected.
2. The pump's 8 speed slots are **two separate lists** — 4 keypad presets and 4 external programs. Changing a keypad preset does *not* change what the IntelliComm runs. If someone "fixed" the speed on the keypad and nothing changed, this is why.

**Priority rule:** on the IntelliFlo2, the **highest-numbered active external program wins.** The FPH is deliberately on input 4, the highest. Any future Home Assistant control must go on a *lower* input so that it can never override or fight the heat recovery call. See Part 5.

---

## Part 4 — The ESP8266 monitoring node

**Everything in this part is monitoring only.** It cannot start the pump, cannot open a valve, and cannot affect the safety chain in any way. If the board dies, unplug it and the pool heat system is unaffected. Config lives at [esphome/pool-pad.yaml](../esphome/pool-pad.yaml).

### 4.1 Board and location

| Property | Value |
|---|---|
| Board | HiLetgo ESP8266, NodeMCU v2 profile |
| Firmware | ESPHome, OTA-updatable, talks to Home Assistant over the native API |
| Location | The **new box at the pool pad**, with the IntelliComm II and the White Rodgers. **Not** in the FPH box, **not** in the A/C unit |
| Power | **5V from a buck converter**, which steps down the 12V that the IntelliComm's adapter supplies. One 12V/2A adapter feeds both the IntelliComm and the buck converter, parallel-tapped rather than daisy-chained |

### 4.2 Pin map

| Pin | Connected to | Notes |
|---|---|---|
| **GPIO5 (D1)** | White Rodgers SPNO contact → 3.3V | **10k pulldown to GND required.** Reads HIGH = pool heat active |
| **GPIO14 (D5)** | DS18B20 one-wire bus | **4.7k pull-up to 3.3V required** — lives in the combined terminal-block/resistor unit |
| **GPIO12 (D6)** | Flow sensor pulse input | Configured `INPUT_PULLUP`. Sensor not yet installed — see Part 5 |
| **GPIO13 (D7)** | *Reserved* — future boost relay → IntelliComm input 2 | Phase 2 only, see Part 5 |
| **GPIO4 (D2)** | *Free* | Was the FPH pump-call sensor; that idea was dropped 2026-07-28 |

**Do not use GPIO0 (D3), GPIO2 (D4), or GPIO15 (D8)** — they are boot-sensitive on the ESP8266 and pulling them the wrong way at power-up prevents the board from starting.

### 4.3 Temperature probes

Two waterproof DS18B20 probes, both wired and confirmed live in HA (2026-07-27):

| Entity | Location | One-wire address |
|---|---|---|
| `sensor.pool_pad_hx_water_in_temp` | FPH blue cylinder, **inlet** port | `0xe40b244456303128` |
| `sensor.pool_pad_hx_water_out_temp` | FPH blue cylinder, **outlet** port | `0x110b244453050b28` |

Both are converted from °C to °F in the ESPHome config. A third probe for pool return temperature is planned but not installed.

**If in/out ever read backwards** (outlet colder than inlet while heat is actively running): warm one probe by hand, see which entity moves, and swap the two `address:` values in the YAML. The addresses are burned into the probes, so swapping the config is the fix — do not re-plumb anything.

### 4.4 What Home Assistant shows, and what it means

| Entity | Meaning |
|---|---|
| `binary_sensor.pool_pad_pool_heat_active` | White Rodgers contact — **true heat-recovery-is-running state**, flow already proven. 2 s on/off debounce |
| `sensor.pool_pad_hx_water_in_temp` / `..._out_temp` | Heat exchanger water in/out. The difference between them is the free heat you're getting |
| `sensor.pool_pad_pool_flow_gpm` | Flow sensor — **not yet installed**, reads nothing useful today |
| `sensor.pool_pad_pool_heat_btu_hr` | Computed: GPM × ΔT(°F) × 500. Only computed while heat is active. **Meaningless until the flow sensor is installed** |
| `sensor.shellyemg3_dcb4d9ce63a4_energy_meter_0_power` | Shelly EM Gen3, 50A CT on one leg of the pump's 240V circuit. >20W = pump running |
| `switch.shellyemg3_dcb4d9ce63a4` | Shelly relay driving the R-40 mineral ionizer. Runs from an on-device script, no HA dependency |

### 4.5 The alerts that matter

- **LIVE** — `pool_heat_active` **&&** pump not drawing power for >30 s → **critical.** The hardware interlock has failed or been bypassed. Investigate immediately.
- **NOT YET LIVE** (needs the flow meter) — `pool_heat_active` **&&** `pool_flow_gpm ≈ 0` sustained → **critical.** The flow-switch-stuck-closed case: diverting refrigerant into stagnant water while the pump spins uselessly. This alert is the entire reason the flow sensor is worth installing, and until it exists that failure is undetected. See the coverage table in 3.1.
- **LIVE** — pump off during scheduled hours → warning only.

---

## Part 5 — Future work, starting from what we know now

### 5.1 Installing the flow meter

| Property | Value |
|---|---|
| Sensor | DN50, 2" MPT **both ends male**, 10–300 L/min (~2.6–79 GPM — covers the FPH5's 45–70 GPM window) |
| Output | 12 pulses/liter, **NPN** pulse output. Works directly with GPIO12's `INPUT_PULLUP`, no external pull-up needed |
| Power | **5V DC** — take it from the existing buck converter. **Not** the 12V adapter, and **not** the ESP8266's 3.3V pin |
| Fittings needed | 2× true-union, 2" female MPT. Both sensor ends are male, so without unions, servicing the sensor means unthreading the whole pipe run |

**Calibration must be sequential** — there is not room in the run for the Blue-White gauge and the flow meter at the same time:

1. Install the Blue-White gauge. Run the pump at the locked 2200 RPM. **Record the true GPM.**
2. Swap in the flow meter at the same RPM. **Record the pulses/min** (ESPHome logs this pre-multiplier).
3. Compute `multiply:` = (true GPM) ÷ (pulses per minute) and put that in [esphome/pool-pad.yaml](../esphome/pool-pad.yaml).

The value in the config today is the datasheet theoretical: `GPM ≈ pulses/min × 0.02201`. Treat it as a placeholder — it has never been checked against reality.

### 5.2 Adding ESP control of pump speed, independent of the FPH

This is the "I want to spin the pump up for a swim, or run a schedule, without involving the FPH" feature. Everything needed is already reserved.

**The design rule, and it is not negotiable:** the FPH stays on **input 4**, the highest-priority input. Home Assistant control goes on **input 2**. Because the IntelliFlo2 gives the highest active external program priority, this guarantees that an HA request can never override, interrupt, or fight a live heat-recovery call. Software gets the lower-priority lane, permanently, by design.

**What to build:**

1. A small 3.3V-coil relay module driven by **GPIO13 (D7)** — already reserved in the config.
2. Relay dry contact wired to **IntelliComm II GPM/RPM 2 (Program 2)**. Note the IntelliComm inputs are **voltage-driven (9–24V AC/DC), not dry-contact** — so the relay must *switch 24VAC onto* the input, exactly as the FPH signal does on input 4. Source that 24VAC from the same transformer pair, not from a new supply.
3. Set Ext. Program 2 on the pump to whatever speed you want for this mode. Remember: external programs are a separate list from the keypad presets.
4. Uncomment the `switch:` block at the bottom of [esphome/pool-pad.yaml](../esphome/pool-pad.yaml) — it's already written, with `restore_mode: ALWAYS_OFF` so a power blip can never leave the pump commanded on.

**Do not** add a second RS-485 master (njsPC or similar) to the pump bus while the IntelliComm II owns it. Two masters on one bus is a guaranteed bad time.

### 5.3 Other open items

- Persist HX in/out temps and BTU/hr to the Jeeves SQLite store so heat-recovery performance can be trended across a season (HA's recorder retention is too short).
- Confirm whether the IntelliFlo's accessory output is line-voltage or a low-voltage relay signal — check when the drive cover is next open.
- Investigate whether HVAC compressor **stage** (1 vs 2) can be read, via the Resideo cloud API or a CT clamp on the compressor circuit. Low-stage runs likely explain small ΔT readings at the heat exchanger.

---

## Part 6 — Troubleshooting

### 6.1 Decision tree — "the pool isn't getting free heat"

```
Is the A/C compressor actually running?
├─ No  → Nothing is wrong. The FPH only harvests heat while the compressor runs.
│        In cooling mode only. No A/C, no free heat. Full stop.
└─ Yes
   │
   Is the pool already at/above the FPH setpoint?
   ├─ Yes → Nothing is wrong. The controller stops calling once the pool is warm enough.
   └─ No
      │
      Wait 20+ seconds. (The controller force-runs a ~20 s purge delay before
      it samples the water temperature. Judging it sooner is judging it wrong.)
      │
      Did the pool pump spin up to ~2200 RPM on its own?
      ├─ No → The PUMP CALL (branch A) is broken, so nothing downstream can
      │       ever happen. Diagnose this first — see 6.2. Nothing else in
      │       this tree matters until the pump responds.
      └─ Yes  (note: this alone does NOT mean heat is being recovered)
         │
         Is the condenser fan STILL SPINNING after ~30 s of pump run?
         ├─ No  → System is working correctly. The fan stopping is the real
         │        "heat recovery is on" indicator. Confirm at the exchanger:
         │        outlet temp should climb above inlet within a few minutes.
         │        Small ΔT is likely a stage-1 compressor run, not a fault (5.3).
         └─ Yes → Diversion (branch B) never engaged. Two innocent explanations
                  first: (a) the pool is already at/above setpoint, so the
                  controller correctly chose not to heat — check the setpoint
                  and the PT-100 reading; (b) you're still inside the purge
                  delay. If neither, continue:
            │
            Meter 24VAC across the 90340 COIL (coil A yellow ↔ coil B white).
            ├─ ~24VAC present → Coil is energized but the contacts didn't move:
            │                   the 90340 has failed. Replace it — generic HVAC
            │                   part, widely stocked. Verify with T1→T2 (should
            │                   open when energized) and T4→T6 (should close).
            └─ ~0V
               │
               Meter 24VAC across the FLOW SWITCH terminals, pump running.
               ├─ Switch OPEN (voltage across it) despite real flow
               │   → Flow switch isn't closing. Either flow is genuinely below
               │     its trip point (check the Blue-White gauge — need 45+ GPM;
               │     also check filter, valves, and for air lock), or the switch
               │     needs readjusting, or it has failed. DO NOT JUMPER IT.
               └─ Switch CLOSED (no voltage across it)
                   → Signal isn't arriving from the FPH controller at all.
                     Check controller terminal 4 and the blue butt connector.
                     Inside the FPH — installer/HotSpot territory.
                     (If the pump started, terminal 4 is closing, so suspect the
                      wiring between terminal 4 and the flow switch.)
```

### 6.2 "Pool heat is running but the pump isn't" — STOP

This is the dangerous state. **Kill the A/C at the breaker immediately**, then diagnose. Home Assistant should have alerted on this within 30 seconds.

Likely causes, in order: IntelliComm II lost power (check the 12V adapter — it also powers the ESP8266, so if the dashboard node is *also* offline, that's your answer); RS-485 cable fault between IntelliComm and pump; pump not in a mode that accepts external programs; Program 4 got cleared on the pump.

### 6.3 "The dashboard says heat is active but it obviously isn't" (or vice versa)

This is a **sensing** problem, not a heating problem. The pool system is fine; the White Rodgers path is lying. Check, in order:

1. The **10k pulldown resistor** on GPIO5 — a missing or loose pulldown makes the input float and read HIGH randomly. Most common cause.
2. The White Rodgers coil taps on the white and yellow wires — a tap that has worked loose.
3. The relay contact itself — meter continuity across it while the coil is energized.
4. The ESP8266 has power and is online in Home Assistant.

### 6.4 Expected voltages — quick reference

| Measure across | A/C off | A/C on, pool cold, flow proven |
|---|---|---|
| Transformer output (pins 7 & 12) | ~24VAC whenever the A/C contactor is closed | ~24VAC |
| Flow switch terminals | ~24VAC (open) or 0V | **~0V** (closed — it's a closed switch) |
| 90340 coil (A ↔ B) | ~0V | **~24VAC** |
| 90340 T1→T2 (fan) | closed / continuity | **open** |
| 90340 T4→T6 (valves) | open | **closed / continuity** |
| IntelliComm Program-4 input | ~0V | **~24VAC** — and also ~24VAC during the purge phase, *before* the flow switch closes. That's branch A working correctly, not a fault |
| White Rodgers contact | open | **closed / continuity** |

### 6.5 Ground rules for anyone working on this

- **Kill the 240V at the breaker before opening the A/C unit or the FPH.** Capacitors hold a lethal charge after disconnect — discharge them.
- **Never jumper the flow switch.** Not to test, not "for a second." It is the only thing preventing equipment damage.
- **Never wire anything into the safety chain that depends on a network, a computer, or software.** The Pi, Home Assistant, and the ESP8266 are all observers. Keep it that way.
- **The FPH box and the heat pump interior are untouched by us.** Anything wrong in there is an installer/HotSpot issue, not one of our modifications.
- 16AWG minimum for the solenoid valves and transformer jumpers — **not thermostat wire**, the coils draw more than it can carry (manual printed p.8). 18AWG thermostat wire is fine for signal-only runs like the IntelliComm input.
- If you replace the 90340, **re-read section 3.2's common-terminal trap first.** The printed schematic on the case is misleading.

---

## Part 7 — Equipotential bonding (NEC Article 680)

**Status: OPEN ITEM. The FPH heat exchanger is not currently bonded.** The IntelliFlo2 VST and the booster/sweep pump are bonded. This section is what a licensed electrician should be handed.

**Not legal advice, and I am not an electrician.** Article 680 is enforced by your AHJ and California amends the NEC as the CEC. Have this verified and signed off. What follows is the reasoning and the standard practice, so the conversation starts from the right place.

### Bonding is not grounding

The equipotential bond has one job: hold every conductive thing a wet person can touch at the *same* voltage, so there is no potential difference to drive current through a body. It is **not** a fault-clearing path, it does not go to the panel neutral, and it is not the equipment grounding conductor. A pad can be perfectly grounded and still lethally un-bonded.

The physical form is a **8 AWG solid bare copper** loop tying the pool shell steel, perimeter, and equipment together. Yours already exists — it's the bare copper running between the pump motors' bonding lugs.

### What needs bonding here, and why

| Component | Bond required? | Reasoning |
|---|---|---|
| **FPH heat exchanger** (the blue cylinder — copper/titanium coil in contact with circulating pool water, metal shell) | **Yes — do this one.** | 680.26(B)(6): metal parts of equipment associated with the pool water circulating system. A heat exchanger is functionally a heater in the circulating path; heaters get bonded. It is also the largest conductive surface in contact with pool water on the pad, which makes it relevant to 680.26(C)'s pool-water bond (≥9 in² of conductive surface intentionally bonded). Also: it's the one component in this system carrying refrigerant from a 240V machine into water |
| **New pad box** | **Only if it's metallic.** | A non-metallic enclosure containing only Class 2 low-voltage (24VAC control, 12V, 5V, 3.3V) has no metal to bond and no bonding requirement. If the enclosure is metal, bond it |
| **Hall-effect flow meter** (5.1, not yet installed) | **Depends on body material.** Plastic body → nothing to bond. Brass/metal body → **yes**, bond it | 680.26(B)(6) again — a powered metal component in the circulating water path. Decide when the part is in hand. Note it is a powered device, which makes the metal-body case less optional than for a passive fitting |
| **PT-100 probe** (factory, inside the FPH) | **No separate bond.** | It's a factory sensor inside the FPH assembly. If the FPH shell is bonded, address it as part of that assembly rather than as a separate item. Do not improvise a bond onto a manufacturer's sensor |
| **DS18B20 probes and the Tecmark flow switch** (metal, threaded into the HX ports) | **No separate bond**, but see caveat | These are small metal parts mechanically continuous with the HX shell, so bonding the shell addresses them. **Caveat:** the threads have Teflon tape on them, so do not *rely* on those joints as a bonding path for anything else — bond the shell itself at a proper lug |
| **24VAC control circuit, ESP8266, buck converter** | **No.** | Class 2 low-voltage circuits. Never connect the bonding conductor to the ESP's ground, the buck converter, or any signal common. Doing so injects pad currents straight into your electronics and accomplishes nothing for safety |

### How to bond the heat exchanger

1. **Kill power** at the breaker — both the A/C 240V and the pump circuits.
2. **Look for a factory bonding lug** on the FPH assembly or its mounting bracket first. If there is one, use it; that's what it's for.
3. **If there is no lug:** fit a **listed bonding/grounding lug** (brass or stainless, listed for the purpose, and **direct-burial rated** if any part of the run is buried) to clean bare metal on the HX shell or its metal mounting bracket. Scrape paint/coating to bright metal at the contact point. Stainless hardware.
4. **Run 8 AWG solid bare copper** from that lug to the existing pad bonding loop — the same bare copper that already lands on the IntelliFlo2's and the sweep pump's bonding lugs. Solid, not stranded; 8 AWG minimum; **no smaller, no splices if avoidable**, and any connection must be listed for direct burial and for the metals involved.
5. **Use anti-oxidant compound** at dissimilar-metal connections (copper to stainless/aluminum), and torque lugs to spec.
6. **Do not** run the bonding conductor to the panel, to a ground rod as a substitute, or to any low-voltage common.
7. **Verify:** with power off, measure resistance from the new lug back to the pump motor bonding lug — should be essentially zero (well under 1 Ω, ideally a fraction of that). A reading in the tens of ohms means you have a corroded or paint-insulated connection, not a bond.

### What to ask the electrician

*"The pool heat exchanger on the pad has copper/titanium in contact with circulating pool water and isn't tied into the equipotential bonding grid. The two pump motors are. Can you land an 8 AWG solid bare copper bond from the exchanger to the existing loop, and confirm it satisfies 680.26(B) and the (C) water-bond requirement for this install?"*

---

## Part 8 — Photos

Drop box photos in `docs/images/` and link them here. The ones worth having, in priority order:

1. **Mars 90340 terminal block, wires attached, labels legible** — this is the single most valuable photo in the set. It settles the common-terminal question instantly for whoever opens the box next.
2. The new pool-pad box, lid off — IntelliComm II, White Rodgers, ESP8266, buck converter, terminal block/resistor unit, all in one frame.
3. The Tecmark flow switch threaded into the FPH blue cylinder outlet port.
4. Inside the top of the FPH control box — the common-leg pigtail between the LCD and Modules A/B.
5. The white/yellow tap points feeding the White Rodgers coil and the IntelliComm input.

Link them inline in the relevant section, e.g. `![90340 terminals](images/90340-terminals.jpg)`.

---

## Part 9 — Changelog

This document claims authority over the FPH manual for this install. That claim is only worth something if changes are traceable. **Every edit that changes a fact — a wire, a terminal, a trip point, a status — gets a line here.** Cosmetic edits don't.

Status vocabulary used throughout:

| Tag | Meaning |
|---|---|
| **VERIFIED** | Physically traced or measured, in person, on this system |
| **INFERRED** | The only arrangement consistent with known facts, but not directly traced. Flagged inline with ⚠ |
| **PLANNED** | Not built yet. Nothing in the field matches it |

Page citations are to the HotSpot FPH installer manual, 44-page scanned PDF, **printed page numbers** (which run ~1–2 behind the PDF page index). Edition/revision is unmarked in the scan — if a differently-paginated copy surfaces, re-cite everything.

| Date | Change |
|---|---|
| 2026-07-30 | Document created. 90340 terminal assignments VERIFIED by tracing the box in person, resolving two earlier rounds of misreading the silkscreen (see 3.2). |
| 2026-07-30 | Tecmark 3010P recorded as installed, wired in the switched leg, and calibrated — VERIFIED. |
| 2026-07-30 | White Rodgers Type 84 recorded as installed and reading in HA — VERIFIED. |
| 2026-07-30 | **Correction:** original draft claimed one 24VAC signal drove the 90340, the White Rodgers, and the IntelliComm in parallel, all downstream of the flow switch. That is wrong — it would deadlock the pump, which cannot start when the flow switch is open. Rewritten as one common leg with **two switched branches** off controller terminal 4: pump call (not flow-gated) and diversion (flow-gated). Branch A's tap point is INFERRED; discriminating meter test written up in Part 2. |
| 2026-07-30 | Added the operating sequence section, and the consequence that a running pump does **not** indicate heat recovery — the condenser fan stopping does. Troubleshooting tree in 6.1 rebuilt around the fan rather than the pump. |
| 2026-07-30 | **Correction:** 3.1 implied HA cross-checks heat-active against measured flow. It does not — the flow meter isn't installed. Replaced with an explicit coverage table: pump-not-powered is covered by the Shelly CT; pump-powered-but-no-actual-flow is **uncovered today**. Reclassifies the flow meter from data toy to safety item. |
| 2026-07-30 | Added Part 7 — equipotential bonding. FPH heat exchanger is **not bonded**; logged as an open item for a licensed electrician. |

### Open items carried forward

- [ ] Run the branch-A meter test (Part 2) and either delete the ⚠ box or re-trace.
- [ ] Bond the FPH heat exchanger to the pad loop (Part 7).
- [ ] Install and calibrate the flow meter (5.1) — safety-relevant, see 3.1 coverage table.
- [ ] Take the Part 8 photos, 90340 terminals first.
- [ ] Copy the FPH manual PDF into the repo so this document stands alone without a `~/Desktop` path.
- [ ] Label wires physically at the 90340 and the pad box — ferrules or numbered markers — given the documented white/white collision. Prose warnings don't survive a rewire.
