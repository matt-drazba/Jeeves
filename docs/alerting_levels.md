# Alerting Levels — the house alarm ladder

Last updated: 2026-08-10. Authority order: CLAUDE.md → this doc → individual
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
| **3** | Normal push now, then a **9:15pm re-raise** if still unacknowledged. |
| **4** | No push. Dashboard tile plus the **weekend digest**. |
| **5** | SQLite only. Accumulation thresholds promote it to Level 4. |

Level 2 is the one people get wrong. "In the morning" means the alert must
*survive* the night without waking you and still be in front of you at breakfast
— which is a re-notification, not a louder notification.

Level 3 uses a **fixed 9:15pm checkpoint, not a presence trigger.** Presence was
considered and rejected: device trackers are fragile, and "did he arrive" is hard
to reason about when it misfires. 9:15pm is reliably home, and it batches with
the dishwasher reminder already answered at that hour.

The two re-raise times are the whole delivery system — **7:00am for L2, 9:15pm
for L3.** Both loop until acknowledged.

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
- **There is no global mute.** Maintenance mode was removed 2026-08-08: it
  suppressed Levels 2–4 and nothing ever turned it back off, so alerting could be
  silently disabled indefinitely. Any future mute must expire on its own.
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
| Booster still on after HA tried to kill it | **Kill the breaker for the sweep circuit** | **live** |
| Garage opened 10pm–6am with no command from HA | **Account for everyone in the house; call 911 if you can't. Close it from your phone once clear** | **live** |
| Garage auto-close could not be confirmed | **Clear the doorway and close it by hand** | **live** |
| Water leak detected | Shut the main supply valve | planned — no sensors |
| Smoke / CO | Leave the house | planned — no sensors |

**Freeze protection is deliberately absent.** This location does not get cold
enough to threaten the pad or the plumbing. Do not propose it.

The two garage entries widen Level 1 beyond destruction, and that was a
deliberate ruling (2026-08-10): **"the house is not protected" belongs here.**
Nothing is being destroyed, but an open house at 3am does not improve on its
own and only a person can fix it — which is the same shape as the booster. Both
messages name the physical action, which is the actual bar. See
[garage_door.md](garage_door.md).

The booster is the archetype and shows why verification matters. A dry PB4-60
destroys its seal and impeller within minutes, and a dry centrifugal pump draws
*less* current than a loaded one — so no breaker, overload, or high-amp rule
catches it. HA's kill goes to a **Tuya cloud** switch, so the off command is a
round trip that can be slow, fail, or be overridden by a schedule still living in
the Tuya app. Unconfirmed kill = still being destroyed = Level 1.

### Level 2 — deal with it in the morning

| Thing | Status |
|---|---|
| Booster dry run **caught and successfully killed** | **live** |
| Main pump off during its 9pm–4pm window | **live** |
| Garage door open >15 min between 6am and 9:15pm | **live** |
| AC cooling 10+ min, pool below setpoint, heat recovery never engaged | **live** |
| HA / Pi offline seen from outside the house | **not building** — see blind spot |

Both deliver as a normal push immediately, plus a 7am re-raise if still
unacknowledged. The open-alert flags clear **only** on Acknowledge, never on
recovery — so a pump that trips at 2am and self-heals by 4am still surfaces at
breakfast. A fault that fixed itself is still a fault you should know about.

### Level 3 — handle it when you get home

| Thing | Status |
|---|---|
| Pool pad ESP node offline >30 min | **live** |
| Shelly EM pump meter offline >30 min | **live** |
| Garage controller (ratgdo) offline >30 min | **live** |
| Sweep did not run tonight | **live** |
| Heat exchanger calling but ΔT ≤ 0 | **live** |
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
| Maintenance tickler item due | planned |
| OhmHour scheduled | planned |
| Anything promoted from Level 5 by accumulation | planned |
| Laundry / dishwasher cycle done | **live** (dashboard tiles) |
| Dishwasher not started by 9:15pm | **live** (HA automation) |

**Cost is not an alert.** Money never notifies — not at any level. Energy
spend, TOU placement, and rate optimization belong in reports and dashboard
tiles, where they can be looked at deliberately. An alert means something is
*wrong*, and an expensive-but-working pump is not wrong.

The one exception is when a cost signal is really a *fault* signal: pump energy
climbing 15% month over month means something is loading the pump, and that is
a problem wearing a dollar sign. See the Level 5 promotion table.

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

Fixing it properly requires a watcher **outside the house**; anything on the Pi
or the Mac mini dies in the same outage.

**Decision (2026-08-08): not building one.** PG&E already sends a text when the
power is out, which covers the most likely and most consequential cause. The
residual gap is the set of failures where power is fine but the Pi is not — SD
card corruption, a Docker or HA crash, Pi hardware death, a router failure. Those
are silent and will stay silent.

Accepted deliberately rather than left open. Revisit only if that residual class
actually bites.

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
