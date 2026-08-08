# Pool Heat Recovery — As-Built Wiring Manual

**What this is:** the field manual for the pool heat recovery system as it is *actually wired at this house*, which has real differences and modifications compared to the HotSpot FPH manual. Written so that an electrician, an HVAC tech, a neighbor, a child of the house, or a prospective homebuyer who has never seen this system can open the boxes, use a chat assistant, understand what they're looking at, and troubleshoot it without me present.

Last updated: 2026-08-08.
Companion docs: [pool_heat_recovery.md](pool_heat_recovery.md) (design rationale, project status, Home Assistant / Jeeves custom dashboard layer) and the HotSpot FPH installer manual PDF (`~/Desktop/Hot Spot Energy FPH Free Pool Heater Manual.pdf`).
Authority order when docs disagree: **this doc** (as-built) → FPH manual (generic) → anything else.

**A note for HVAC techs:** an HVAC person will think we're crazy for what we've done here. Fair. The techs we currently use — **SVS** — are good and already know this system. **Any new tech has to be oriented to it before touching anything**, and Part 1 plus the master diagram in Part 2 are that orientation. Do not assume a standard FPH install.

---

## READ THIS FIRST — the one safety rule

**Refrigerant must never be diverted into the heat exchanger unless pool water is actually flowing through it.**

If the A/C compressor sends hot refrigerant into the FPH heat exchanger while the pool pump is off, the water in the exchanger boils/stagnates, and you can damage the heat exchanger and the compressor (FPH manual, printed p.25). Almost every piece of hardware described in this document exists to make that state physically impossible.

**The protection emphasizes hardware, not software.** Hardware means no computer, no Wi-Fi, no Home Assistant, and no Raspberry Pi sits in the safety path. The Tecmark flow switch (SPNO) is a mechanical switch in the 24VAC control leg running from the FPH controller to the valve/fan relay (the Mars 90340). **No flow through the pool pipes → the Tecmark stays open → no circuit to the valve/fan relay → no diversion.** If the network is down, the Pi is unplugged, and the pool pump and A/C disagree about what time it is after a power outage, the flow switch still works.

Think of it as a light switch that nothing but pool water can turn on: below roughly 45–50 GPM it is off, and no amount of electronics — or humans — can flip it.

⚠ **There is no software backstop for this rule.** If the flow switch itself fails closed, nothing in Home Assistant currently alerts. See the coverage table in 3.1 — it is narrower than most readers assume, and it is the reason the hardware discipline in this document is not optional.

**Corollary for anyone troubleshooting: do not jumper across the flow switch "just to test something."** This warning is here because jumpering a suspect switch is a normal, sensible diagnostic habit in HVAC work — it is how you prove whether a control circuit or the switch is at fault. On this system that habit is the one move that creates the dangerous state with nothing left to catch it. If you need to prove the switch, meter across it (Part 6.4); do not bridge it.

---

## How a cycle actually runs — the operating sequence

No single page of the FPH manual states this plainly, and it is the thing to understand before touching anything.

1. **A/C compressor starts.** Cooling only — heat recovery does not run on a heating call alone.
2. **The FPH controller immediately calls the pool pump**, *before* it has decided whether to heat anything. The system is still in normal liquid-to-air mode: refrigerant to the outdoor coil, fan running, valves at rest. The controller closes its **terminal 3** output; the IntelliComm II sees 24VAC on Program 4; the pump spins up to Ext. Program 4 at 2200 RPM (the RPM itself is configured at the pool pump's own control pad, not by the FPH).
3. **~2-minute purge delay** (configured in the FPH). The controller runs the pump to flush stagnant water out of the heat exchanger, so the PT-100 reads real circulating pool water and not a slug that has been sitting near the filter. *(The manual describes a ~20 s purge; 2 minutes is what this system actually does. Trust the observation.)*
4. **The controller samples the PT-100** against the pool setpoint (**currently 92 °F**):
   - **Pool at or above setpoint** → no heating. Stays liquid-to-air and cools the house normally. Nothing diverts.
   - **Pool below setpoint** → proceed to diversion.
5. **Flow proves itself.** The pump has been running since step 2, so water is already moving. If flow is at or above the Tecmark's trip point, the flow switch closes and 24VAC reaches the 90340 coil.
   - 🟨 **If flow never proves** — clogged filter, a Pentair or suction valve closed, valves not set to "filter" — the flow switch stays open and **the A/C simply stays in normal liquid-to-air mode.** Nothing breaks; you just get no free heat. Check the filter and valve positions first.
6. **Diversion engages.** 24VAC reaches the 90340 coil → condenser fan off, heat reclaim valve and bi-directional solenoid on. The system is now liquid-to-liquid: compressor heat goes into the pool instead of the outdoor air. `binary_sensor.pool_pad_pool_heat_active` goes true.
7. **Temp Re-Check.** The controller periodically re-samples the PT-100 and drops the call once the pool reaches setpoint.
8. **On release**, the pump keeps running through the Program-4 stop delay (**≥10 min, configurable on the pump's own screen**) to flush the exchanger before stopping. It then returns to its normal schedule — including "off," if that is what the schedule says.

**Two consequences a troubleshooter must know:**

- **The pump does not need to already be running.** The system cold-starts it. A/C on + pool below setpoint = free heat, regardless of the pump's own schedule. This is why the pump call comes off **terminal 3**, which is not flow-gated (see Part 2) — if it came off the flow-switch side, the pump could never start, because the flow switch can't close until the pump is already moving water. That would be a deadlock.
- **It is also why the FPH calls Program 4 specifically:** on the IntelliFlo2, **the highest-numbered active external program wins.** Putting the heat-recovery call on 4 means nothing else can outrank it. **This matters if programs are ever added to slots 1–3** — they will always lose to the FPH, by design. Do not "promote" anything to a higher slot without thinking through the impact on heat recovery.
- **A running pump is not evidence that heat is being recovered.** Steps 2–4 spin the pump up on *every* A/C start, including the times the answer turns out to be "pool's warm enough." **Pump at 2200 RPM with the condenser fan still spinning is normal.** It is not a stuck relay. Judge diversion by the fan and the valves, never by the pump. The pump returns to its schedule ~10 minutes after the last call from the FPH/IntelliComm.

---

## Cast of characters

| Thing | What it is | Where it lives |
|---|---|---|
| **A/C unit** | Bryant 226ANA048-B, 4-ton two-stage heat pump | Side yard, outdoor unit |
| **FPH** | HotSpot FPH5 "free pool heat" unit — refrigerant-to-water heat exchanger + control box | **On the chimney, by the pool filter** — not at the A/C unit |
| **24VAC transformer** | 240→24V, HotSpot-supplied, fed off the load side of the A/C contactor | **Inside the heat pump** |
| **The trio** | Heat reclaim valve + bi-directional solenoid + normally-closed fan relay. All three on one 24VAC pair. Energized together = "pool heat mode" | **Inside the heat pump** |
| **Tecmark 3010P** | Mechanical flow switch, SPNO. Closes when pool water flow is high enough | Screwed into the FPH heat exchanger's blue outlet-water port |
| **Mars/Supco 90340** | DPDT relay, 24VAC coil. Kills the condenser fan *and* powers the valves, together | **Inside the heat pump** |
| **Pentair IntelliFlo2 VST** | Variable-speed pool pump, 3.0 HP | Pool equipment pad |
| **Pentair IntelliComm II** | Translates a 24VAC signal into an RS-485 "run program N" command to the pump | **New box I added, on the chimney next to the FPH** |
| **White Rodgers Type 84** | 24VAC-coil relay used purely as an isolated *sensor*. Not part of the safety chain | Same new box as the IntelliComm |
| **ESP8266 (pool-pad node)** | ESPHome monitoring node — temps, flow, heat-active state → Home Assistant | Same new box as the IntelliComm |

**Note the geography — there are three enclosures, and they are all right next to each other.** The FPH and its flow switch are on the chimney by the pool filter; the heat pump sits next to the chimney; the new box is also on the chimney, beside the FPH. The 24VAC control wiring runs between the three and the runs are short. But they are still three *separate* boxes, and knowing which one a component lives in is most of the battle when tracing a wire:

| Box | What's inside |
|---|---|
| **Heat pump cabinet** | 24VAC transformer, the trio (heat reclaim valve, bi-directional solenoid, NC fan relay), **Mars 90340** |
| **FPH control box** (chimney, by the pool filter) | FPH controller — LCD, Modules A & B, terminal strip 1–6, blue butt connector. **Tecmark flow switch** is threaded into the heat exchanger just outside it |
| **New box** (added by us — chimney, next to the FPH) | IntelliComm II, White Rodgers Type 84, ESP8266, buck converter, terminal-block/resistor unit |

⚠ **Naming trap:** the ESPHome node is named **`pool-pad`** and its Home Assistant entities all begin `sensor.pool_pad_…`. That name is historical — **the board is not at the pool pad, it is in the new box on the chimney.** Don't go looking at the pad for it.

**The chimney is non-functional** (owner-confirmed 2026-08-07). It is an exterior chimney that is no longer used as a flue — purely a mounting surface for the FPH box and the new box. **There is no heat, no combustion, and no flue gas to design around**, which is why mounting electronics, a buck converter, and temperature-sensitive parts flat against it is fine. Anyone new to this system will assume otherwise on sight; they should not.

**Nothing inside the heat pump and nothing inside the FPH was modified by us.** Both were wired by the installer per the HotSpot manual. Every change we made lives either (a) in the 24VAC control leg between the FPH controller and the trio, or (b) in the new box on the chimney. If you are diagnosing a problem, that boundary is where to start.

---

## Part 1 — How our system differs from the FPH manual

The HotSpot manual is written for a simple case: a single-speed pool pump, one single-stage A/C unit. We have neither — a **two-stage heat pump** and a **variable-speed pool pump** — so three things in our install are **not in the manual, or contradict it.** These are the three things most likely to confuse someone opening these boxes.

### Difference 1 — The Mars 90340 exists, even though the manual says it shouldn't

FPH manual, printed p.21, step 6:

> "If you have multiple A/C units (dual or triple FPH models) then you will need to wire a 90340 relay in order to separate the 24VAC from each of the units."

We have **one** A/C unit. By that sentence, we should have no 90340. We have one anyway.

**Why:** the manual's single-unit design assumes the FPH controller's pin-4 output drives the trio directly, and that the pool pump is a dumb single-speed pump switched by a contactor or an external timer — not the pump's own timer. Our pump is variable-speed. The manual's own words on printed p.9:

> "In the case of a variable speed pool pump, contact HotSpot technical support dept. with the complete model number of your pump."

In other words: **for our pump, the manual has no diagram.** HotSpot did send one — a variable-speed diagram that is *literally taped onto the bottom of printed page 9* in the physical copy, with page 10 removed. **But even that diagram is wrong for us, because the Mars 90340 does not appear on it.** So there is no printed page anywhere, factory or supplied-after-the-fact, that shows what we actually built. That is what Part 2 of this document is for. What we needed was one flow-proven 24VAC signal that simultaneously:

1. **cuts power to the condenser fan** (fan must stop — the refrigerant heat is going into the pool now, not into the air), and
2. **applies power to the heat reclaim valve and the bi-directional solenoid** (divert refrigerant into the exchanger).

That is one coil switching two poles in *opposite* directions at the same instant — one contact set opening, the other closing. The Mars 90340 is a DPDT relay: one coil, two independent poles, one NC set and one NO set. It does both jobs with one part. So the 90340 is here doing **double duty as the trio's switching hub**, not the multi-unit isolation job the manual describes.

**A note on a job the 90340 does *not* do:** an earlier draft of this document listed "provide the signal that tells the IntelliComm to spin the pump up" as a third job for this relay. That was wrong. The pump is already running by the time this relay ever energizes — the FPH calls the pump from terminal 3 the moment the compressor starts, well before the flow switch closes. The pump call never touches the 90340. See Part 2 for the wiring, and the operating sequence above for why the order has to be that way.

**Say this out loud to any FPH or HVAC tech who asks:** *"Yes, there's a 90340. No, we don't have two A/C units. It's here because the pump is variable-speed and the manual has no diagram for that case. It switches the fan off and the valves on at the same instant."*

For exactly how it is wired, see the terminal table in **section 3.2** and the master diagram in **Part 2**.

### Difference 2 — The flow switch is our addition, wired per p.22, into a p.9 system

The manual gives a wiring diagram for the flow switch (printed p.22) and a separate wiring diagram for the variable-speed / IntelliComm pool side (printed p.9), on **two different pages, never drawn together** — even though both diagrams hang off the same 24VAC pair — the one that arrives at the blue butt connector in the FPH control box and pigtails there. Each page shows half of our system, and nobody drew the other half. **Part 2 of this document is that merge**, and it is one of the most useful things in this file.

### Difference 3 — The White Rodgers Type 84 appears nowhere in any HotSpot document

It is not in the manual, not in the parts list, not in any diagram. **It is not part of the heat recovery system at all.** It has no physical control over anything — it exists to drive software.

It is an $8 relay we added for one reason: to give the ESP8266 monitoring board a completely **electrically isolated** way to see whether the 24VAC pool-heat signal is live, without the low-voltage electronics touching the 24VAC circuit. Its coil taps the 24VAC in parallel (draws a trivial amount, changes nothing); its dry contact closes a 3.3V logic signal to the microcontroller. From that one signal we derive the dashboard state and the heat-recovery metrics — because a closed White Rodgers means *both* that the FPH is calling for heat *and* that the Tecmark has proven flow. There is no simpler way to know the system is running as designed. An optocoupler would have worked electrically; we chose the relay because it is a mechanical part any HVAC tech recognizes on sight, and less to go wrong.

**If you remove the White Rodgers entirely, the pool heat recovery system continues to work perfectly.** You would only lose the dashboard indicator and the metrics. Nobody troubleshooting a heating or safety problem should be looking at it. It is listed here only so that the next person who opens the box doesn't waste an hour trying to find it in the manual.

---

## Part 2 — The merged wiring diagram (manual p.9 + p.22 + our changes)

### The two 24VAC legs — the concept that makes everything else make sense

The transformer puts out 24VAC on two wires (pins 7 and 12 per manual printed p.8). Everything downstream is just a question of *which devices sit across those two legs, and what interrupts one of them.* Throughout this document:

### First, a thing you do NOT need to figure out

**It does not matter which transformer leg is "hot" and which is "common."** This is 24VAC off an isolated transformer secondary — it is AC, there is no hot/neutral in the household sense, and every load in this system is unpolarized. Relay coils don't care about direction, and the IntelliComm's input is explicitly rated *"9–24V AC/DC, unpolarized."* Swapping the two conductors at the transformer would change nothing.

### ⚠⚠ …but a thing you absolutely DO need to get right: yellow to yellow, green to green

The paragraph above is about **polarity**, and polarity genuinely does not matter. **Which conductor lands on which terminal is a completely different question, and it matters absolutely.**

**At the IntelliComm II, the control conductors are not interchangeable: YELLOW must go to yellow, GREEN must go to green.**

Swap them and the 24VAC circuit back to the 90340 coil never completes. The failure is **silent and deeply misleading**:

- the FPH LCD reads **"Heating"** — the controller thinks it is doing its job
- the pump spins up to 2200 RPM on Program 4 — terminal 3 is unaffected
- **but the Mars 90340 never energizes**, so the condenser fan keeps spinning and the valves never move
- no heat is recovered, and nothing anywhere reports an error

There is no symptom that points at the wiring. It looks exactly like a dead 90340, a stuck flow switch, or a failed FPH output, and a troubleshooter following the fan-based logic in 6.1 will chase all three before thinking of it. **VERIFIED — hit in the field on this system.** If diversion is not engaging, check this before opening the FPH box or condemning a part; it costs thirty seconds.

The reason "polarity doesn't matter" and "colors matter" are both true at once: polarity is about the *direction* of an AC waveform, which no load here cares about. Color is about *topology* — which node a conductor is bonded to. Yellow is the shared-return node (also 90340 coil A and the trio bus). Land it in the wrong place and you have not reversed a signal, you have broken a circuit.

### What matters is routing

So this document names the two legs by where they go, not by polarity:

- **CONTROLLER LEG — the one that goes into the FPH.** It leaves the transformer and lands in the FPH control box at the **blue butt connector**, where it **pigtails/splits in the top of the box, between the LCD and Modules A and B.** That pigtail is a junction point, not a component — several wires bonded together under the LCD is normal and correct. From there it feeds the controller's two switched outputs, **terminal 3** and **terminal 4**. **Terminal 3 goes to the IntelliComm / pool pump. Terminal 4 returns to the 90340's coil B by way of the Tecmark flow switch.** It also supplies contact power to the 90340's two commons (T1 black, T4 white).
- **SHARED-RETURN LEG — the one that never enters the FPH controller.** It runs from the transformer **directly to the IntelliComm II**. This is the **yellow** wire in the new box. It is the same electrical node as the 90340's **coil A**, the trio's bus (the red), and the second side of the White Rodgers coil. Nothing switches it; it is simply present whenever the transformer is powered.

*(If you ever do want to know which one the manufacturer designated "C": with power on, meter from each secondary conductor to the cabinet chassis. The one reading near 0V is the bonded common. It's a curiosity, not a troubleshooting step — nothing in this document depends on the answer.)*

### The two switched outputs — this is the merge the manual never draws

Page 9 draws the IntelliComm. Page 22 draws the flow switch. Neither page imagines the other's system, so neither shows what we actually have: **the FPH controller has two independent switched outputs, and they are gated differently.**

| | **Terminal 3 — PUMP CALL** | **Terminal 4 — DIVERSION** |
|---|---|---|
| Path | Terminal 3 → IntelliComm II | Terminal 4 → Tecmark flow switch → 90340 coil B |
| Flow-gated? | **No** | **Yes** |
| Why | The pump must be able to cold-start. Gating this on flow would deadlock: no pump → no flow → switch never closes → pump never starts | Refrigerant may divert into the exchanger only once water movement is physically proven |
| Manual quote | — | "Pin 4 controls all of the HVAC side of the valves" (printed p.21 step 5) |

Both return on the **SHARED-RETURN LEG** (the yellow). The White Rodgers coil sits across the terminal-4 branch *after* the flow switch, so it reports **actual diversion**, not merely "the controller asked."

### ⚠ Naming collision — the two different "3" and "4"

This reliably trips AI assistants, and it may trip people too, so say it out loud before metering anything:

- **Terminal 3 / Terminal 4** are inside the **FPH controller** — two of the six terminals in its strip.
- **Program 4 / GPM-RPM 4** is on the **IntelliComm II** — which of the pump's four external speed programs to run.

**FPH terminal 3 drives IntelliComm Program 4.** The numbers do not match, and they are not supposed to. If you hear "it's on 4," ask *whose* 4. Terminal 4 has nothing to do with the pump.

### Master diagram — as built

```
   240VAC, load side of A/C contactor
              │
     ┌────────┴────────┐
     │ 240→24V         │   HotSpot transformer, inside the A/C outdoor unit
     │ transformer     │   (240V on pins 1&6; jumpers 2-5 and 8-11; 24VAC out on 7&12)
     └───┬─────────┬───┘
         │         │
  SHARED-RETURN  CONTROLLER LEG
   (YELLOW)      (into the FPH)
         │       │
         │       └──────────► FPH CONTROL BOX
         │                    [BLUE BUTT CONNECTOR]
         │                     pigtail/split in the top of the box,
         │                     between the LCD and Modules A & B
         │                            │
         │              ┌─────────────┴──────────────┬────────────────┐
         │              │                            │                │
         │      switched by                  switched by         raw feed to
         │      TERMINAL 3                   TERMINAL 4          90340 commons
         │      (PUMP CALL)                  (DIVERSION)         T1 (BLACK)
         │      not flow-gated               "Pin 4 controls     T4 (WHITE) ⚠
         │              │                     the HVAC side           │
         │              │                     of the valves"          │
         │              │                            │                │
         │              │                            ▼                │
         │              │                  ┌──────────────────┐       │
         │              │                  │  TECMARK 3010P   │ ◄── OUR ADDITION
         │              │                  │  flow switch     │     (manual p.22)
         │              │                  │  (SPNO)          │     Closes only when
         │              │                  └────────┬─────────┘     water is moving
         │              │                           │  WHITE wire
         │              │                           │  ("proven heat call")
         │              │                           ├──────► tap ──┐
         │              │                           ▼              │
         │              │     ┌─────────────────────────┐          │
         │              │     │  MARS/SUPCO 90340 DPDT  │          │
         │              │     │                         │          │
         │              │     │  COIL B (right) ◄───────┼── WHITE  │
         ├────────────────────┼──► COIL A (left)        │          │
         │  (also RED, on the │     = YELLOW + RED      │          │
         │   trio common bus) │            │            │          │
         │              │     │            └── YELLOW ──┼──► tap ──┼──┐
         │              │     │                         │          │  │
         │              │     │ Pole 1: T1 ●──NC──● T2  ├── to CONDENSER FAN
         │              │     │         (T3 unused)     │          │  │
         │              │     │ Pole 2: T4 ●──NO──● T6  ├── RED, to HEAT
         │              │     │         (T5 unused)     │   RECLAIM VALVE +
         │              │     └─────────────────────────┘   BI-DIR SOLENOID
         │              │       ⚠ T4's WHITE (contact power, CONTROLLER LEG)
         │              │         is NOT coil B's WHITE (from the flow switch)
         │              │                                      │  │
         └──► also to the other side of the trio (heat reclaim │  │
              valve, bi-dir solenoid, NC fan relay) — the      │  │
              parallel "trio bus"                              │  │
                                                                │  │
   ═════════ NEW BOX ON THE CHIMNEY, BY THE FPH (added by us) ═ │  │
                                                                │  │
     TERMINAL 3 ─────────────────────────────┐   WHITE tap ─────┘  │
     (pump call, NOT flow-gated)             │   (flow-gated)      │
                                             │              │      │
                                             ▼              ▼      │
                              ┌────────────────────┐  ┌──────────────────┐
                              │  PENTAIR           │  │ WHITE RODGERS 84 │
                              │  INTELLICOMM II    │  │ 24VAC coil       │
                              │  GPM/RPM 4         │  │ (SENSING ONLY —  │
                              │  (Program 4 input, │  │  not safety)     │
                              │   9–24V AC/DC,     │  │                  │
                              │   unpolarized)     │  │ SPNO contact:    │
                              │                    │  │ 3.3V ─●  ●─ GPIO5│
                              │ ⚠ YELLOW→yellow,   │  └──────────────────┘
                              │   GREEN→green.     │        ▲      │
                              │   NOT swappable    │        │      │
                              └─────────┬──────────┘        │      │
                                        │                   │      │
      SHARED-RETURN / YELLOW ───────────┴───────────────────┴──────┘
      (straight from the transformer — never enters
       the FPH controller; also = 90340 coil A)

      ⚠ Swapping the IntelliComm's yellow and green breaks the 24VAC
        return to the 90340 coil. FPH reads "Heating," pump runs,
        fan never stops, nothing reports an error. VERIFIED failure.
                                        │
                                   RS-485 cable
                                        │
                                        ▼
                             PENTAIR INTELLIFLO2 VST
                             runs Ext. Program 4
                             @ 2200 RPM (~55–60 GPM)
```

### The single most important paragraph in this document

**Two switched outputs, one shared return — not one signal.** The FPH controller's **terminal 3** calls the pump immediately and unconditionally when the compressor starts (→ IntelliComm Program 4). Its **terminal 4** offers 24VAC to the diversion circuit *only through the flow switch* (→ Tecmark → 90340 coil). Both return on the **SHARED-RETURN LEG** — the yellow that runs straight from the transformer to the IntelliComm without ever entering the controller. The pump is therefore allowed to start with no flow — it must be, or nothing could ever start — while the valves can never move without proven flow. **The pump running Program 4 tells you the compressor is on. Only the condenser fan stopping tells you heat is actually being recovered.**

### Still INFERRED (small, does not block use)

The wire-by-wire routing of the **90340's contact power** — T1 (black) and T4 (white) — is documented above as coming off the CONTROLLER LEG, and the trio's return as riding the shared-return / coil-A bus. That's the only arrangement consistent with the verified terminal assignments, but it wasn't traced end to end.

It changes nothing operationally: contact power only matters once the coil has already been energized through the flow switch, so no error here could defeat the interlock. Confirm opportunistically the next time the box is open.

Also not yet written down: **which IntelliComm terminal the green conductor lands on.** The color rule above is field-verified and is what you act on; the terminal number is a documentation gap. Capture it with the Part 8 photo of the chimney box.

---

## Part 3 — Component-by-component

### 3.1 Tecmark 3010P flow switch

**Job:** prove that pool water is actually moving before the heat pump is allowed to switch into pool-heat mode. This is the entire safety system.

| Property | Value |
|---|---|
| Part | Tecmark 3010P, SPNO (normally open, closes on flow) |
| Tecmark cover | 25165BM |
| Location | Threaded into the FPH heat exchanger's **blue "outlet water temp" port** |
| Mounting | Factory plastic cap removed, then two adapters daisy-chained: **¾" FPT × ¾" FPT**, then **¾" MPT × ⅛" FPT**, with the switch threading into the last one. Teflon tape on all joints |
| Electrical position | **In series in the terminal-4 branch**, between FPH controller terminal 4 and the 90340 coil. Terminal 3 / the pump call does not pass through it |
| Adjustment | Screw CW = requires *more* flow to close. Set to open just below the FPH5's 45 GPM minimum |
| Status | Installed, wired, **calibrated** |

**Why here and not somewhere else:** putting it in series in the switched leg means it isn't advisory — it is the circuit. Nothing downstream can energize without it. A sensor that merely *reports* no-flow to a computer would depend on the computer being alive and correct. This doesn't.

**Calibration method (for re-doing it):** run the pump at 1500 RPM (40 GPM, below the FPH5 floor) and adjust CW until the trio drops out. Then run 2200 RPM — it must hold solidly. A used switch that won't hold a stable trip point gets replaced ($25); do not attempt to nurse one along.

**Failure modes:**
- **Stuck open** (won't close despite real flow) → you get no free pool heat. Annoying, costs nothing, hurts nothing. Symptom: A/C running, pool cold, pump not spinning up, dashboard "Pool Heat Active" stays off.
- **Stuck closed** (closes with no flow) → **this is the dangerous one.** The safety chain is defeated and diversion can happen into stagnant water.

**⚠ What actually backstops the dangerous case today — read this, it is narrower than you'd hope:**

| Failure | Covered now? | By what |
|---|---|---|
| Flow switch closed, **pump not powered** | **No — detectable, but not detected.** | The *signals* exist: the Shelly EM CT reads pump watts and `binary_sensor.pool_pad_pool_heat_active` reads the White Rodgers. **No automation consumes them together.** Software-only work; see 4.5 |
| Flow switch closed, **pump powered but water not actually moving** — blocked impeller, closed valve, air lock, clogged filter, failed switch | **No — not even detectable.** | The flow *meter* is not installed, so no signal exists to alert on |

**⚠ Do not read the live booster dry-run alert as covering either row.** `jeeves_booster_dry_run_kill` guards the **Polaris PB4-60 booster** (`switch.pool_sweep_socket_1`) against the main pump being off. Different pump, different fault, different equipment at risk. It has nothing to do with refrigerant diverting into the FPH heat exchanger, and it will not fire for anything in this table. An earlier revision of this section conflated the two and claimed the first row was covered — it was not, and it still is not.

**Nothing alerts on either row today.** The difference is that the first needs only software, while the second also needs hardware. And the pump-watts check, once built, is still only a proxy for flow, not a measurement of it. **Until the flow meter in section 5.1 is installed, no instrument in this system measures actual water movement** — the only real flow proof is the Tecmark itself, and these are precisely the failures where the Tecmark is the thing that failed. That is why the flow meter is a safety item, not a nice-to-have data toy, and why this section's calibration discipline (replace a switch that won't hold a stable trip point, don't nurse it) matters more than it otherwise would.

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

Because the Tecmark flow switch gates the coil, **this relay physically cannot power the valves without proven flow.**

#### ⚠⚠ The common-terminal trap — read before wiring or metering

The schematic silkscreened on the relay case draws each pole as a pivoting switch arm whose stem appears to drop to the **middle** terminal (2 for pole 1, 5 for pole 2). That drawing makes 2 and 5 look like the common terminals.

**They are not.** Per Supco's own installation sheet, the terminal pairs are explicitly:

- **1&2 = NC, 1&3 = NO** → terminal **1** is the common
- **4&5 = NC, 4&6 = NO** → terminal **4** is the common

The common is the terminal that appears in *both* pairs, regardless of where the pivot stem seems to land in the drawing. **Trust the stated NC/NO pairs over the picture.** This cost two rounds of misreading before it was traced in person.

Source: [Supco 90340 Installation Instructions](https://www.manualslib.com/manual/1430458/Supco-90340.html)

### 3.3 White Rodgers Type 84 (monitoring only — not safety)

| Property | Value |
|---|---|
| Part | White Rodgers Type 84 fan relay, 90-290Q, 24VAC coil, SPNO |
| Purpose | Electrically isolated "is pool heat on?" signal for the ESP8266 |
| Location | New box on the chimney, alongside the IntelliComm II |
| Coil leg 1 | Tap on the **WHITE** wire (Tecmark → 90340 coil B, downstream of the Tecmark closing) — the switched, flow-proven leg |
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
| Fed by | **FPH controller terminal 3** (not 4 — see the naming-collision note in Part 2), returning on the shared-return leg (the yellow). Not flow-gated, and not the same point as the 90340 coil |
| **Wire colors** | ⚠ **YELLOW→yellow, GREEN→green. Not interchangeable.** Swapped, the 24VAC return to the 90340 coil never completes and the whole diversion side dies silently while the FPH still reads "Heating." VERIFIED failure — see Part 2 |
| Output | RS-485 to the pump |
| Pump program | **Ext. Program 4, configured at 2200 RPM** (~55–60 GPM, measured against the Blue-White gauge — not estimated) |
| Stop delay | **≥10 min**, set on the pump's own screen — flushes the heat exchanger after the FPH releases the call, then the pump returns to its normal schedule |
| Power | 12VDC adapter (shared with the ESP8266 — see 4.2) |

**Two things that look like faults but aren't:**

1. The pump display reads **"DISPLAY NOT ACTIVE"** while an external program runs. That is normal and expected.
2. The pump's 8 speed slots are **two separate lists** — 4 keypad presets and 4 external programs. Changing a keypad preset does *not* change what the IntelliComm runs. If someone "fixed" the speed on the keypad and nothing changed, this is why.

**Priority rule:** on the IntelliFlo2, the **highest-numbered active external program wins.** The FPH is deliberately on input 4, the highest. Any future Home Assistant control must go on a *lower* input so that it can never override or fight the heat recovery call. See Part 5.

**If programs are ever added to slots 1–3, they will always lose to the FPH.** That is intentional. If something on a lower slot "doesn't work" while heat recovery is running, it is not broken — it is being outranked. Do not fix it by moving it to a higher slot without thinking through the impact on heat recovery.

---

## Part 4 — The ESP8266 monitoring node

**Everything in this part is monitoring only.** It cannot start the pump, cannot open a valve, and cannot affect the safety chain in any way. If the board dies, unplug it and the pool heat system is unaffected. Config lives at [esphome/pool-pad.yaml](../esphome/pool-pad.yaml).

### 4.1 Board and location

| Property | Value |
|---|---|
| Board | HiLetgo ESP8266, NodeMCU v2 profile |
| Firmware | ESPHome, OTA-updatable, talks to Home Assistant over the native API |
| Location | The **new box on the chimney**, with the IntelliComm II and the White Rodgers. **Not** in the FPH box, **not** in the heat pump, and — despite the node name — **not at the pool pad** |
| Power | **5V from a buck converter**, which steps down the 12V that the IntelliComm's adapter supplies. One 12V/2A adapter feeds both the IntelliComm and the buck converter, parallel-tapped rather than daisy-chained |

### 4.2 Pin map

| Pin | Connected to | Notes |
|---|---|---|
| **GPIO5 (D1)** | White Rodgers SPNO contact → 3.3V | **10k pulldown to GND required.** Reads HIGH = pool heat active |
| **GPIO14 (D5)** | DS18B20 one-wire bus | **4.7k pull-up to 3.3V required** — lives in the combined terminal-block/resistor unit |
| **GPIO12 (D6)** | Flow sensor pulse input | Configured `INPUT_PULLUP`. Sensor not yet installed — see Part 5 |
| **GPIO13 (D7)** | *Free* | Was reserved for a pump-control relay → IntelliComm input 2; dropped 2026-08-05, not built. See 5.2 |
| **GPIO4 (D2)** | *Free* | Was the FPH pump-call sensor; dropped 2026-07-28 — the failure it watched for costs only lost free heat, no equipment risk |

**Do not use GPIO0 (D3), GPIO2 (D4), or GPIO15 (D8)** — they are boot-sensitive on the ESP8266 and pulling them the wrong way at power-up prevents the board from starting.

### 4.3 Temperature probes

Two waterproof DS18B20 probes, both wired and confirmed live in HA (2026-07-27):

| Entity | Location | One-wire address |
|---|---|---|
| `sensor.pool_pad_hx_water_in_temp` | FPH blue cylinder, **inlet** port | `0xe40b244456303128` |
| `sensor.pool_pad_hx_water_out_temp` | FPH blue cylinder, **outlet** port | `0x110b244453050b28` |

Both are converted from °C to °F in the ESPHome config. A third probe for pool return temperature is planned but not installed.

The outlet probe carries a zero-offset (`out_temp_offset_f`), **currently 0.0** — see the note under 4.5 for why that number is load-bearing.

**If in/out ever read backwards** (outlet colder than inlet while heat is actively running): warm one probe by hand, see which entity moves, and swap the two `address:` values in the YAML. The addresses are burned into the probes, so swapping the config is the easiest fix. Swapping them physically is also fine — they sit in labeled stainless steel thermowells in the blue FPH heat exchanger and pull straight out.

### 4.4 What Home Assistant shows, and what it means

| Entity | Meaning |
|---|---|
| `binary_sensor.pool_pad_pool_heat_active` | White Rodgers contact — **true heat-recovery-is-running state**, flow already proven. 2 s on/off debounce. Display only, plus one condition inside the ΔT detector — **nothing alerts on it directly** |
| `sensor.pool_pad_hx_water_in_temp` / `..._out_temp` | Heat exchanger water in/out. The difference between them is the free heat you're getting |
| `sensor.pool_pad_pool_flow_gpm` | Flow sensor — **not yet installed**, reads nothing useful today |
| `sensor.pool_pad_pool_heat_btu_hr` | Computed: GPM × ΔT(°F) × 500. Only computed while heat is active. **Meaningless until the flow sensor is installed** |
| `sensor.shellyemg3_dcb4d9ce63a4_energy_meter_0_power` | Shelly EM Gen3, 50A CT on one leg of the pump's 240V circuit. >20W = pump running |
| `switch.shellyemg3_dcb4d9ce63a4` | Shelly relay driving the R-40 mineral ionizer. Runs from an on-device script, no HA dependency |

### 4.5 The alerts

Live alerts are in `homeassistant/packages/jeeves_alerts.yaml`. Severity uses the response-deadline ladder from [alerting_levels.md](alerting_levels.md) — L1 means act now, wherever you are, whatever the hour; L2 means by morning; L3 means when you get home. Delivery, acknowledgement, and troubleshooting are in [alerting_runbook.md](alerting_runbook.md).

**⚠ Read the Status column carefully. Some of what this section used to promise is not built.**

| Alert | Level | Status | Meaning |
|---|---|---|---|
| **`pool_heat_active` && pump under 20 W, sustained** | — | **NOT BUILT — signals exist** | **The heat-recovery interlock check. The flow-switch-stuck-closed case: refrigerant diverting while the main pump is unpowered.** Both inputs report into HA today and nothing consumes them together. Software-only work — see 3.1 and 5.3 |
| `pool_heat_active` && `pool_flow_gpm ≈ 0` sustained | — | **Not built — also needs the flow meter** | Pump powered but water not moving. Also covers the deadhead (pump running against a closed valve). No signal exists yet; blocked on 5.1 |
| Booster on && pump under 20 W for 30 s | **L1 / L2** | **Live** — `jeeves_booster_dry_run_kill` | ⚠ **Polaris PB4-60 booster, not the FPH.** Dry-run kill: shuts the sweep off, retries, re-checks. Kill confirmed = L2; kill unconfirmed = L1 ("go kill the breaker"). Fails closed — an unavailable meter reads as pump-off and still kills |
| Pump **off** during its 9pm–4pm window, 15 min | **L2** | **Live** — `jeeves_pump_unexpectedly_off` | Schedule not running, or the pump lost its clock after a power outage |
| Pad node offline / Shelly meter offline, 30 min | **L3** | **Live** — `jeeves_pool_sensor_offline` | Monitoring itself has failed. A dead meter also blocks the scheduled sweep, by design |
| Heat exchanger calling but ΔT ≤ 0, 20 min | **L3** | **Live** — `jeeves_pool_equipment_fault` | See the offset note below — this alert was inert until 2026-08-08 |
| Sweep did not run tonight (11:45pm check) | **L3** | **Live** — `jeeves_sweep_missed_check` | The scheduled 9:45pm start was skipped, usually because the pump had not run ≥30 min |
| Sweep running longer than 2 h | *informational* | **Live** — `jeeves_sweep_max_runtime` | Turns the sweep off. No open-alert flag and no Acknowledge button, because there is nothing to acknowledge. Replaces the old outside-window guard, so manual runs work at any hour |

**⚠ The top row is the one that matters for this document.** Every other live alert concerns the pool pump's schedule, the booster, or sensor liveness. **Nothing watches the heat-recovery interlock.** If the Tecmark fails closed while the main pump is off, the FPH will divert into stagnant water and no notification will be sent to anyone. You are the detector. Building this is the top item in 5.3.

**⚠ The HX alert was silently disarmed for its first day.** It fires on ΔT ≤ 0, and the outlet probe carried a `+0.3 °F` calibration offset, so a heat exchanger that had completely stopped transferring would still have read positive and never alerted. The offset was zeroed 2026-08-08 against 102 logged samples that put the raw probes a median 0.00 °F apart. It is genuinely armed now for the first time. If it starts firing on legitimate low-stage compressor runs that quantize to zero, the fix is a threshold clearly *below* zero, not at it — do not simply widen it back into inertness.

**"Pump on during unscheduled hours" was deliberately dropped.** It was originally paired with "pump off during scheduled hours" as the same power-outage clock fault seen from two directions. In practice heat recovery legitimately calls the pump outside its window, so the alert would fire on correct behaviour. The off-during-window direction catches the clock drift on its own.

Manual runs are not faults. Pressing the Tuya sweep switch by hand works at any hour; the 2-hour runtime cap is the only thing that intervenes, and the dry-run interlock stays armed throughout. There is no maintenance mode — see the runbook for why it was removed.

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

### 5.2 ESP control of pump speed — DROPPED 2026-08-05, not built

**This was designed, then cut. Do not go looking for the hardware or the config; neither exists.** GPIO13 (D7) is free, and the `switch:` block that an earlier revision of this document told you to uncomment **has been deleted from `esphome/pool-pad.yaml`.** The findings survive only as comments at the bottom of that file, kept in case this is ever revisited.

**Why it was cut:** the motivating risk — a pump running unattended at the wrong time — turned out on review to be a *booster* problem, not a main-pump one, and the booster is addressed properly by the dry-run interlock in [pool_booster_interlock.md](pool_booster_interlock.md). The main pump running at an odd hour is a billing annoyance, not a hazard. That did not justify putting an ESP8266 in a position to command a 3 HP pump.

The two original use cases (spin up for a swim by voice; recover from a post-outage clock reset while away) remain unserved. Fixing the pump's clock still means physically pressing buttons on the pump.

**If this is ever revisited, the design rule is not negotiable:** the FPH stays on **input 4**, the highest-priority input, and any Home Assistant control goes on a *lower* one — input 2 was the planned slot. Because the IntelliFlo2 gives priority to the highest active external program, this guarantees a software request can never override, interrupt, or fight a live heat-recovery call. Software gets the lower-priority lane, by design. Two further constraints recorded at the time:

- The IntelliComm inputs are **voltage-driven (9–24V AC/DC), not dry-contact** — a relay must *switch 24VAC onto* the input, exactly as the FPH signal does on input 4. Source it from the same transformer pair, not a new supply.
- GPIO13 idles LOW through boot and reset, which is incompatible with a common active-LOW relay module. See the note at the bottom of `esphome/pool-pad.yaml` before choosing a part.

**Do not** add a second RS-485 master (njsPC or similar) to the pump bus while the IntelliComm II owns it. Two masters on one bus is a guaranteed bad time. This holds whether or not 5.2 is ever built.

### 5.3 Other open items

- **Build the heat-recovery interlock alert** (`pool_heat_active` && pump under 20 W, sustained) — the top row of 4.5, and the highest-value item on this list. Both signals already report into HA; nothing consumes them. Add it to `jeeves_alerts.yaml`, extend `scripts/verify-alerts.py` coverage, and test it before trusting it. **Until this ships, 3.1's first row is a silent failure and this document must keep saying so.**
- Persist HX in/out temps and BTU/hr to the Jeeves SQLite store so heat-recovery performance can be trended across a season (HA's recorder retention is too short).
- Confirm whether the IntelliFlo's accessory output is line-voltage or a low-voltage relay signal — check when the drive cover is next open.
- Investigate whether HVAC compressor **stage** (1 vs 2) can be read, via the Resideo cloud API or a CT clamp on the compressor circuit. Low-stage runs likely explain small ΔT readings at the heat exchanger.
- Record which IntelliComm terminal the green conductor lands on (Part 2) — the color rule is verified, the terminal number is not written down.
- Track pool chemical inputs and test readings over time, and generate predictive dosing recommendations from the trend.

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
      WAIT ~2 MINUTES. The FPH is configured for a ~2-minute purge delay and
      will not sample the water temperature until it expires. (The printed
      manual says ~20 s. This system does 2 minutes — trust the observation.)
      Judging any of the tests below sooner is judging it wrong.
      │
      Did the pool pump spin up to ~2200 RPM on its own?
      ├─ No → The PUMP CALL (terminal 3 branch) is broken, so nothing downstream can
      │       ever happen. Diagnose this first — see 6.2. Nothing else in
      │       this tree matters until the pump responds.
      └─ Yes  (note: this alone does NOT mean heat is being recovered)
         │
         Is the condenser fan STILL SPINNING once the purge has expired?
         ├─ No  → System is working correctly. The fan stopping is the real
         │        "heat recovery is on" indicator. Confirm at the exchanger:
         │        outlet temp should climb above inlet within a few minutes.
         │        Small ΔT is likely a stage-1 compressor run, not a fault (5.3).
         └─ Yes → Diversion (terminal 4 branch) never engaged. Two innocent explanations
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
                   │
                   → ★ CHECK OUR OWN BOX FIRST, before condemning the FPH.
                     Open the chimney box and confirm the IntelliComm II control
                     wires are landed YELLOW→yellow and GREEN→green. Swapped,
                     the 24VAC return to the 90340 coil never completes and the
                     symptom is EXACTLY this: FPH reads "Heating", pump runs on
                     Program 4, fan never stops, coil reads 0V. VERIFIED failure
                     on this system — see Part 2. Costs 30 seconds to rule out.
                   │
                   → If the colors are correct: the signal isn't arriving from
                     the FPH controller at all. Check controller terminal 4 and
                     the blue butt connector. Inside the FPH — installer/HotSpot
                     territory.
                     (The pump starting only proves TERMINAL 3 is closing.
                      Terminal 4 is a separate output and can fail on its own.)
```

### 6.2 "Pool heat is running but the pump isn't" — STOP

This is the dangerous state. **Kill the A/C at the breaker immediately**, then diagnose.

⚠ **Nothing will have told you.** No alert watches for this — see 3.1 and the top row of 4.5. You found it by looking, and that is currently the only way it gets found. Do not wait for a notification that is not coming, and do not assume the absence of one means the system is fine.

Likely causes, in order: IntelliComm II lost power (check the 12V adapter — it also powers the ESP8266, so if the dashboard node is *also* offline, that's your answer); RS-485 cable fault between IntelliComm and pump; pump not in a mode that accepts external programs; Program 4 got cleared on the pump.

### 6.3 Symptom index — what you actually see, and where to go

| What you observe | Most likely | Section |
|---|---|---|
| **FPH LCD says "Heating" but the condenser fan keeps spinning** | IntelliComm yellow/green swapped — the 24VAC return to the 90340 coil never completes. Check this before condemning the 90340 or the flow switch | Part 2, 6.1 |
| A/C running, pool cold, pump never spins up | Terminal 3 / pump call broken | 6.1, 6.2 |
| Pump at 2200 RPM, fan still spinning, inside the purge window | **Normal.** Wait ~2 minutes | Operating sequence |
| Pump at 2200 RPM, fan still spinning, pool above setpoint | **Normal.** Controller correctly chose not to heat | Operating sequence |
| Pool heat running, pump not running | **Danger — kill the A/C at the breaker** | 6.2 |
| Dashboard disagrees with reality | Sensing fault, not a heating fault | 6.4 |

### 6.4 "The dashboard says heat is active but it obviously isn't" (or vice versa)

This is a **sensing** problem, not a heating problem. The pool system is fine; the White Rodgers path is lying. Check, in order:

1. The **10k pulldown resistor** on GPIO5 — a missing or loose pulldown makes the input float and read HIGH randomly. Most common cause.
2. The White Rodgers coil taps on the white and yellow wires — a tap that has worked loose.
3. The relay contact itself — meter continuity across it while the coil is energized.
4. The ESP8266 has power and is online in Home Assistant.

### 6.5 Expected voltages — quick reference

| Measure across | A/C off | A/C on, pool cold, flow proven |
|---|---|---|
| Transformer output (pins 7 & 12) | ~24VAC whenever the A/C contactor is closed | ~24VAC |
| Flow switch terminals | ~24VAC (open) or 0V | **~0V** (closed — it's a closed switch) |
| 90340 coil (A ↔ B) | ~0V | **~24VAC** |
| 90340 T1→T2 (fan) | closed / continuity | **open** |
| 90340 T4→T6 (valves) | open | **closed / continuity** |
| IntelliComm Program-4 input | ~0V | **~24VAC** — and also ~24VAC during the purge phase, *before* the flow switch closes. That's terminal 3 working correctly, not a fault |
| White Rodgers contact | open | **closed / continuity** |

**⚠ The signature of a yellow/green swap at the IntelliComm:** the flow switch reads **closed** (~0 V across it) — so terminal 4 *is* being offered — yet the 90340 coil reads **~0 V** instead of 24VAC, and the fan keeps running. A genuinely failed 90340 reads the opposite: **~24VAC across the coil** with the contacts not moving. Those two are easy to confuse and the fix is completely different, so meter the coil before ordering a relay.

### 6.6 Ground rules for anyone working on this

- **Kill the 240V at the breaker before opening the A/C unit or the FPH.** Capacitors hold a lethal charge after disconnect — discharge them.
- **Never jumper the flow switch.** Not to test, not "for a second." It is the only thing preventing equipment damage — and as 3.1 documents, there is currently no software backstop behind it.
- **Never wire anything into the safety chain that depends on a network, a computer, or software.** The Pi, Home Assistant, and the ESP8266 are all observers. Keep it that way.
- **The FPH box and the heat pump interior are untouched by us.** Anything wrong in there is an installer/HotSpot issue, not one of our modifications.
- **Respect wire colors at the IntelliComm** — yellow to yellow, green to green. See Part 2.
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
| **New box on the chimney** | **Only if it's metallic.** | A non-metallic enclosure containing only Class 2 low-voltage (24VAC control, 12V, 5V, 3.3V) has no metal to bond and no bonding requirement. If the enclosure is metal, bond it |
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

**These supplement the master diagram in Part 2 — they do not replace it.** The Part 2 logic diagram is what explains *why* the system behaves as it does: which leg is interrupted by what, and in what order. Photos show which screw a wire lands on. A reader needs both, and the logic diagram stays.

**Planned: a photo + annotated diagram for each of the three enclosures** — the new chimney box, the FPH control box, and the heat pump cabinet. One overview shot and one close-up of the terminals per box, each paired with a labeled drawing keying the wires to the tables in Part 3. That set, plus the master diagram in Part 2, is what makes this document usable by someone who has never opened these boxes.

Drop them in `docs/images/` and link them inline. Priority order:

1. **Mars 90340 terminal block, wires attached, labels legible** (heat pump cabinet) — the single most valuable photo in the set. It settles the common-terminal question instantly for whoever opens the box next.
2. **New chimney box, lid off** — IntelliComm II, White Rodgers, ESP8266, buck converter, terminal-block/resistor unit, all in one frame. **Get the IntelliComm's terminal strip in focus** — this is the shot that documents which terminal the green conductor lands on, currently the one unrecorded detail of the yellow/green rule.
3. **FPH control box, lid off** — LCD, Modules A & B, terminal strip 1–6, and the blue butt connector / pigtail in the top of the box.
4. The Tecmark flow switch threaded into the heat exchanger's blue outlet port.
5. The white/yellow tap points feeding the White Rodgers coil and the IntelliComm input.
6. A wide shot showing the three enclosures and their proximity to each other — orientation for anyone who has never stood there.

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

⚠ **Do not maintain this file by exporting it to a word processor and pasting it back.** Two round trips have now damaged it: the export strips the ``` fences off the Part 2 master diagram and the 6.1 decision tree (the two highest-value pages here), escapes `+` and `=` as `\+` and `\=`, and rewrites relative links as `http://`. A 2026-08-08 round trip additionally reverted three days of content. Edit it in the repo, or paste *new material only*.

| Date | Change |
|---|---|
| 2026-07-30 | Document created. 90340 terminal assignments VERIFIED by tracing the box in person, resolving two earlier rounds of misreading the silkscreen (see 3.2). |
| 2026-07-30 | Tecmark 3010P recorded as installed, wired in the switched leg, and calibrated — VERIFIED. |
| 2026-07-30 | White Rodgers Type 84 recorded as installed and reading in HA — VERIFIED. |
| 2026-07-30 | **Correction:** original draft claimed one 24VAC signal drove the 90340, the White Rodgers, and the IntelliComm in parallel, all downstream of the flow switch. That is wrong — it would deadlock the pump, which cannot start when the flow switch is open. Rewritten as one shared return with two differently-gated switched branches. |
| 2026-07-30 | **Correction (leg topology), VERIFIED:** the previous "COMMON LEG / SWITCHED LEG" description had the two transformer legs backwards. Corrected to: **LEG 1** enters the FPH at the blue butt connector and pigtails under the LCD to feed controller **terminal 3** (pump call → IntelliComm) and **terminal 4** (diversion → flow switch → 90340 coil); **LEG 2** (yellow) runs straight from the transformer to the IntelliComm, never entering the controller, and is the shared return, the 90340 coil-A node, the trio bus, and the White Rodgers' second coil leg. This also **resolves the previously ⚠ INFERRED pump-call tap** — it is terminal 3, a separate controller output, not a branch of terminal 4. |
| 2026-07-30 | Added the terminal-3-vs-Program-4 naming-collision warning: **FPH terminal 3 drives IntelliComm Program 4**, and the numbers deliberately don't match. |
| 2026-07-30 | Added the operating sequence section, and the consequence that a running pump does **not** indicate heat recovery — the condenser fan stopping does. Troubleshooting tree in 6.1 rebuilt around the fan rather than the pump. |
| 2026-07-30 | **Correction:** 3.1 implied HA cross-checks heat-active against measured flow. It does not — the flow meter isn't installed. Replaced with an explicit coverage table. Reclassifies the flow meter from data toy to safety item. |
| 2026-07-30 | Added Part 7 — equipotential bonding. FPH heat exchanger is **not bonded**; logged as an open item for a licensed electrician. |
| 2026-08-05 | Field corrections from the owner, merged: purge delay is **~2 min** observed (manual says ~20 s); pool setpoint **92 °F**; Program-4 stop delay **≥10 min**, set on the pump screen, after which the pump resumes its normal schedule; equipment locations corrected — **FPH + flow switch are on the chimney by the pool filter; transformer, trio, and 90340 are all inside the heat pump**; added the "highest external program wins / slots 1–3 always lose" rule; added the flow-never-proves case (clogged filter, valve closed or off "filter") and its benign outcome. |
| 2026-08-05 | Difference 1 corrected: HotSpot supplied a variable-speed diagram **taped onto printed p.9** (p.10 removed), but it omits the 90340 — so no diagram anywhere depicts this install. Also struck the claim that the 90340 supplies the IntelliComm signal; the pump is already running from terminal 3 before this relay ever energizes. |
| 2026-08-05 | Explained *why* the do-not-jumper warning exists (jumpering a suspect switch is normal HVAC practice and is the one move that creates the dangerous state here), and corrected a draft sentence that stated the flow switch closes on *no* flow. |
| 2026-08-05 | 90340 location confirmed: **inside the heat pump cabinet.** |
| 2026-08-05 | Renamed the two 24VAC legs from "LEG 1 / LEG 2" (and, before that, "COMMON / SWITCHED") to **CONTROLLER LEG** and **SHARED-RETURN LEG**, and added a note that identifying which leg is "hot" is unnecessary — 24VAC off an isolated secondary, all loads unpolarized. Naming now describes routing, which is what troubleshooting actually depends on. |
| 2026-08-05 | Corrected a geography error introduced in the previous edit: the heat pump, pool pad, and chimney are **adjacent**, not spread across the property. Replaced with a three-enclosure table listing what lives in each. Added per-box photo + annotated-diagram plan to Part 8. |
| 2026-08-05 | Owner review of Parts 1–5 merged. Key factual corrections: **the new box is on the chimney next to the FPH, not at the pool pad** (the ESPHome node keeps the historical name `pool-pad` — naming trap now flagged in the Cast section and 4.1); Tecmark mounting is a ¾"FPT×¾"FPT plus ¾"MPT×⅛"FPT adapter pair, not a single reducer bushing; DS18B20s sit in labeled stainless thermowells and can be swapped physically as easily as in config; purge delay is FPH-configured; pump RPM is set at the pump's own control pad. Added the HVAC-tech orientation note (SVS know this system; new techs must be briefed). |
| 2026-08-05 | **Section 4.5 rewritten — no alerts exist yet.** All four marked not built. Section 3.1's coverage table corrected to match: the pump-not-powered case is **detectable but not detected**. Building the alerts added to 5.3 as the next task. |
| 2026-08-07 | Chimney recorded as **non-functional** — an exterior chimney no longer used as a flue, purely a mounting surface. No heat, combustion, or flue gas to design around. |
| 2026-08-08 | **Section 4.5 rewritten again — the pool alerting package shipped.** Six automations live in `homeassistant/packages/jeeves_alerts.yaml` on the L1–L5 response-deadline ladder, replacing the old Critical/Warning wording. Recorded that the HX ΔT ≤ 0 alert was **inert for its first day** behind a `+0.3 °F` probe offset, since zeroed against 102 samples. "Pump on during unscheduled hours" dropped — heat recovery legitimately calls the pump outside its window. Sweep manual control freed from the old outside-window guard (now a 2-hour runtime cap) and maintenance mode removed entirely. |
| 2026-08-08 | **⚠ Correction to the entry above — it over-claimed coverage.** That revision marked 3.1's "flow switch closed, pump not powered" row as **covered**, citing the new alerts. It is not. The live alert it pointed at is `jeeves_booster_dry_run_kill`, which guards the **Polaris PB4-60 booster** against the main pump being off — a different pump, a different fault, and unrelated to refrigerant diverting into the FPH exchanger. Verified repo-wide: `binary_sensor.pool_pad_pool_heat_active` is consumed only by `jeeves/server.js` (display) and as one condition inside the ΔT detector. **No automation watches the heat-recovery interlock.** 3.1 reverted to "detectable, but not detected"; 4.5 gained an explicit NOT BUILT row at the top plus the missing `jeeves_sweep_max_runtime` row; 6.2's "HA should have alerted within 30 seconds" struck; the interlock alert reinstated as the top item in 5.3. Same class of error as the +0.3 offset — a document asserting protection that was never armed. |
| 2026-08-08 | **IntelliComm yellow/green conductors are NOT interchangeable — VERIFIED in the field.** Yellow to yellow, green to green. Swapped, the 24VAC return to the 90340 coil never completes: the FPH LCD reads "Heating," the pump runs on Program 4, the condenser fan never stops, and nothing reports an error. Added as a Part 2 subsection distinguishing *polarity* (genuinely irrelevant) from *topology* (critical), marked on the master diagram, added to the 3.4 table and 6.5's ground rules, given a metering signature in 6.4 that separates it from a failed 90340, and — most importantly — inserted into the 6.1 decision tree ahead of the branch that previously sent the troubleshooter into the FPH box for a fault that is in our own. Which terminal the green lands on is not yet recorded; logged in 5.3 and as a Part 8 photo target. |
| 2026-08-08 | **Section 5.2 rewritten as DROPPED.** It had instructed the reader to "uncomment the `switch:` block at the bottom of pool-pad.yaml — it's already written." That block was deleted 2026-08-05 and GPIO13 is free, which 4.2 already said — the document contradicted itself. Rewritten with the actual reason for the cut (the motivating risk was a booster problem, addressed by the dry-run interlock), keeping the input-4 priority rule and the GPIO13 idle-LOW constraint for any future revisit. GPIO4's history added to 4.2 to match the config. |
| 2026-08-08 | **6.1 purge delay corrected from ~20 s to ~2 min.** The tree still carried the printed manual's figure and told the reader to judge the condenser fan "after ~30 s" — inside the purge window, before the controller has sampled anything. It was misdiagnosing working hardware. Added 6.3, a symptom index keyed to what the reader actually observes. |

### Open items carried forward

- [ ] **Build the heat-recovery interlock alert** (`pool_heat_active` && pump under 20 W) — 3.1's first row is a silent failure until this ships. Extend `scripts/verify-alerts.py` to cover it.
- [ ] Opportunistically confirm the 90340 contact-power routing (Part 2, "Still INFERRED") next time the box is open.
- [ ] Record which IntelliComm terminal the green conductor lands on (Part 2, Part 8 photo #2).
- [ ] Bond the FPH heat exchanger to the pad loop (Part 7).
- [ ] Install and calibrate the flow meter (5.1) — safety-relevant, see 3.1 coverage table.
- [ ] Take the Part 8 photos and draw the three per-box annotated diagrams (chimney box, FPH box, heat pump cabinet). 90340 terminals first.
- [ ] Copy the FPH manual PDF into the repo so this document stands alone without a `~/Desktop` path.
- [ ] Label wires physically at the 90340 and the chimney box — ferrules or numbered markers — given the documented white/white collision and the yellow/green rule. Prose warnings don't survive a rewire.
