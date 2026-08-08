# Alerting Levels — the house alarm ladder

Last updated: 2026-08-07. Authority order: CLAUDE.md → this doc → individual
automations. Companion docs: [pool_booster_interlock.md](pool_booster_interlock.md),
[pool_heat_recovery.md](pool_heat_recovery.md).

Implementation lives in `homeassistant/packages/jeeves_alerts.yaml`.

---

## The governing idea

**A level is defined by when you have to respond.** Not by how bad it feels, and
not by how the system classifies it internally.

Every alerting system dies the same way: everything becomes urgent, you start
swiping notifications away without reading them, and then the one that mattered
gets swiped too. The ladder exists to keep the top rung rare enough that it still
works.

Numbering follows DEFCON — **1 is the worst.**

---

## The five levels

| Level | You act | Owner's definition |
|---|---|---|
| **1** | **Now** | Wherever you are, whatever time it is, whatever timezone you're in. Something is being destroyed and only you can stop it. |
| **2** | **In the morning** | Broken, but contained or degrading slowly. Sleep is allowed. |
| **3** | **When you get home** | Needs hands on it. Nothing worsens meanwhile. |
| **4** | **Over the weekend** | Maintenance, cost, optimization. |
| **5** | **Never — system only** | Logged for trends. Enough of them escalates to Level 4. |

### How each level is delivered

The delivery mechanism follows from the deadline. This is the whole point of the
ladder — each level arrives *when you can act on it*, not the instant it happens.

| Level | Delivery |
|---|---|
| **1** | iOS Critical Alert — full volume through the silent switch and Do Not Disturb. Repeats every 5 min until acknowledged. |
| **2** | Normal push immediately, then a **7am re-notification** if still unresolved. Never breaks through DND. |
| **3** | Normal push, sent once. Re-notified **on arrival home** if still open. |
| **4** | No push. Dashboard tile plus the **weekend digest**. |
| **5** | SQLite only. Accumulation thresholds promote it to Level 4. |

Level 2 is the one people get wrong. "In the morning" means the alert must
*survive* the night without waking you and still be in front of you at breakfast
— which is a re-notification, not a louder notification.

Level 3's presence trigger matters for the same reason: an alert that fires while
you're at work is an alert you've already forgotten by the time you could act.

---

## Rules

- **Level 1 is the only level allowed to use iOS Critical Alerts.**
- **Level 1 budget: fewer than ~6 firings per year.** More often than that and it
  is misclassified, or the underlying fault needs fixing rather than announcing.
  A noisy Level 1 is a bug in *this doc*.
- **Level 1 must name the physical action.** "Go turn off the breaker in the
  garage" — not "booster fault." If you can't state what the person does at 3am,
  it isn't Level 1.
- Levels 1 and 2 require an **Acknowledge button**, and the acknowledgement
  **auto-clears on recovery** so the next occurrence still alerts.
- **Maintenance mode (`input_boolean.pool_maintenance`) suppresses Levels 2–4.
  It never suppresses Level 1.** Muting nuisance alerts is legitimate; disabling
  protection against destruction is not.
- **Fail closed.** Anything protective treats an unavailable sensor as the
  dangerous state, never the safe one.

### The automation-succeeded demotion

When an automation successfully protects the hardware, **the alert drops a
level** — the emergency is over and only the diagnosis remains.

The corollary is the important half: **a protective action that cannot be
confirmed must escalate.** If HA commands a switch off and cannot verify it went
off, that is Level 1, because the damage is still in progress and the house has
run out of ways to stop it.

---

## What sits at each level

Status: **live** = built and verified · **planned** = designed, not built ·
**blocked** = waiting on hardware.

### Level 1 — act now, anywhere, any hour

| Thing | The physical action | Status |
|---|---|---|
| Booster still on after HA tried to kill it | **Kill the breaker for the sweep circuit** | planned — verification step not yet built |
| Water leak detected | Shut the main supply valve | planned — no sensors |
| Freeze risk at the pool pad | Force circulation, or drain | planned — winter |
| Smoke / CO | Leave the house | planned — no sensors |

The booster is the archetype and shows why verification matters. A dry PB4-60
destroys its seal and impeller within minutes, and a dry centrifugal pump draws
*less* current than a loaded one — so no breaker, overload, or high-amp rule
catches it. HA's kill goes to a **Tuya cloud** switch, so the off command is a
round trip that can be slow, fail, or be overridden by a schedule still living in
the Tuya app. Unconfirmed kill = still being destroyed = Level 1.

### Level 2 — deal with it in the morning

| Thing | Status |
|---|---|
| Booster dry run **caught and successfully killed** | **live** (delivery needs adjusting to L2) |
| Main pump off during its 9pm–4pm window | **live** (delivery needs adjusting to L2) |
| Heat recovery pump failure | planned |
| HA / Pi offline seen from outside the house | **blocked** — see blind spot |

Both live alerts currently deliver as Level 1 critical alerts. Under this ladder
they should not — neither one is worth waking you, because in both cases the
damage has already stopped.

### Level 3 — handle it when you get home

| Thing | Status |
|---|---|
| Pool pad ESP node offline >30 min | planned |
| Shelly EM pump meter offline >30 min | planned |
| Filter pressure above clean baseline → backwash due | blocked — transducer |
| pH above 7.6 — the ionizer stops working at this point | blocked — test kit |
| Copper outside 0.15–0.20 ppm | blocked — test kit |
| TDS below 500 ppm — R-40 cannot produce ions at all | blocked — TDS pen |
| Sprinkler zone failed to run | planned |
| Water heater alert count above zero | planned |
| Tesla battery low and not plugged in | planned |
| Outdoor AQI above threshold | planned |

Sensor-offline belongs here, not lower: every Level 1 and 2 rule silently stops
protecting anything the moment its sensor dies.

### Level 4 — over the weekend

| Thing | Status |
|---|---|
| Pump running during the 4–9pm PG&E peak | planned |
| Maintenance tickler item due | planned |
| OhmHour scheduled | planned |
| Weekly energy and cost summary | planned |
| Anything promoted from Level 5 by accumulation | planned |
| Laundry / dishwasher cycle done | **live** (dashboard tiles) |
| Dishwasher not started by 9:15pm | **live** (HA automation) |

Cost is not safety. Peak-hours pump runtime is money, and money waits.

### Level 5 — system only

Pump wattage · HX in/out temps and BTU/hr · appliance cycle counts and energy ·
pool chemistry test and dose history · filter pressure history.

**Accumulation promotes to Level 4.** A single event here is noise; a pattern is
a finding. Proposed thresholds:

| Pattern | Promotes to |
|---|---|
| 3+ sensor dropouts in a week | L4 — "the pad node is becoming unreliable" |
| Filter pressure trending up 3 weeks running | L4 — "backwash is not restoring baseline" |
| Copper below target on 3 consecutive tests | L4 — "check pH, the ions are falling out" |
| Pump energy up >15% month over month | L4 — "something is loading the pump" |

---

## Known blind spot: the house going dark

**No level above can fire if Home Assistant itself is down.**

A power outage, Pi failure, or internet outage takes out the pump, the Shelly,
*and* the thing whose job was to tell you — all at once. You receive silence, and
silence is indistinguishable from everything being fine. This is exactly the
scenario that matters most on vacation, and it is a Level 1 event delivered as
nothing at all.

Fixing it requires a watcher **outside the house**; anything on the Pi or the Mac
mini dies in the same outage. That means a third-party service — a dead-man's
switch that alerts when scheduled pings *stop* — deferred pending a decision on
free vs. paid tooling.

Recorded here so it stays a known gap rather than a surprise.

---

## Adding a new alert

1. **When must the person act?** That is the level. Now / morning / home /
   weekend / never.
2. **State the physical action.** If you can't write the sentence telling them
   what to do, the level is too high.
3. **Check the budget.** Plausibly fires more than a few times a year? Not
   Level 1.
4. **Did an automation already fix it?** Then drop a level — unless the fix
   can't be confirmed, in which case raise it.
5. **Give it a sensor of its own.** Logic goes in a template binary sensor, not
   inline in the automation, so the dashboard can show it and the rule is
   written once.
6. **Debounce to the damage rate.** 30 seconds for the booster, 15 minutes for
   the pump, 30 minutes for sensor liveness.
7. **Decide the failure direction.** Protective rules fail closed.
