# Alerting Levels — the house alarm ladder

Last updated: 2026-08-07. Authority order: CLAUDE.md → this doc → individual
automations. Companion docs: [pool_booster_interlock.md](pool_booster_interlock.md),
[pool_heat_recovery.md](pool_heat_recovery.md).

Implementation lives in `homeassistant/packages/jeeves_alerts.yaml`.

---

## The governing idea

**A level is defined by what it asks you to do, not by how bad it feels.**

Every alerting system dies the same way: everything becomes urgent, you start
swiping notifications away without reading them, and then the one that mattered
gets swiped too. The ladder below exists to keep the top two rungs rare enough
that they still work.

Numbering follows DEFCON — **1 is the worst.**

---

## The five levels

| Level | Name | Asks you to | Delivery | Wakes you at 3am? |
|---|---|---|---|---|
| **1** | CRITICAL | Nothing — it already acted. Verify when you can. | iOS Critical Alert, repeats until acknowledged | **Yes** |
| **2** | URGENT | Intervene within hours. Nothing automatic can fix it. | iOS Critical Alert, repeats until acknowledged | **Yes** |
| **3** | ATTENTION | Deal with it today or this week. | Normal push, sent once | No |
| **4** | INFO | Nothing. Notice it when convenient. | Dashboard tile, digest email | No |
| **5** | LOG | Nothing. It's for trends and forecasting. | SQLite only | No |

### Level 1 — CRITICAL

Damage or danger **in progress**, and an automation has already taken a
protective action. The notification is a *report*, not a request.

**Entry rule: if there is no automated protective action, it is not Level 1.**
An alert that only shouts is Level 2. This distinction is what keeps Level 1
honest — it's reserved for things the house can actually defend itself against.

### Level 2 — URGENT

Something is broken **right now** and a human has to fix it, but no automation
can. Repeats until acknowledged because the whole point is that it must not be
slept through.

### Level 3 — ATTENTION

Real, needs action, but nothing gets worse in the next eight hours. Fires once
and respects Do Not Disturb. Most genuine problems live here.

### Level 4 — INFO

Worth knowing, costs nothing to ignore. Never pushes. If you find yourself
wanting a push for something here, it's probably Level 3 — or it's Level 4 and
you're bored.

### Level 5 — LOG

Never notifies. Feeds the dashboard, trends, and forecasting.

---

## Budgets — the part that keeps this working

- **Levels 1 and 2 are the only ones allowed to use iOS Critical Alerts.**
- **Combined budget: fewer than ~12 firings per year.** If either fires more
  often than roughly monthly, it is misclassified or the underlying fault needs
  fixing rather than announcing. Treat a noisy Level 1/2 as a bug in *this doc*.
- Every Level 1 and 2 requires an **Acknowledge button**, and the acknowledgement
  **auto-clears on recovery** so the next occurrence still alerts.
- **Maintenance mode (`input_boolean.pool_maintenance`) suppresses Levels 2–4.
  It never suppresses Level 1.** Muting nuisance alerts is legitimate; disabling
  hardware protection is not.

---

## What sits at each level

Status: **live** = built and verified · **planned** = designed, not built ·
**blocked** = waiting on hardware.

### Level 1 — CRITICAL

| Thing | Automated action | Status |
|---|---|---|
| Booster pump running dry (PB4-60) | Switches `switch.pool_sweep_socket_1` off | **live** |
| Water leak detected | Shut supply valve | planned — no sensors yet |
| Freeze risk at the pool pad | Force circulation | planned — winter |
| Smoke / CO | Notify, unlock doors | planned — no sensors yet |

The booster is the archetype. It qualifies because a dry PB4-60 destroys its
seal and impeller within minutes, **and** because a dry centrifugal pump draws
*less* current than a loaded one — so no breaker, overload, or high-amp rule
will ever catch it. The house has to catch it, and the house can act.

### Level 2 — URGENT

| Thing | Why no automation fixes it | Status |
|---|---|---|
| Main pump off during its 9pm–4pm window | Breaker trip or outage needs hands | **live** |
| Heat recovery pump failure while away | Physical fault | planned |
| HA / Pi offline seen from outside the house | Nothing inside can report it | **blocked** — see blind spot below |

### Level 3 — ATTENTION

| Thing | Status |
|---|---|
| Pool pad ESP node offline >30 min | planned (piece 4) |
| Shelly EM pump meter offline >30 min | planned (piece 4) |
| Filter pressure above clean baseline → backwash due | blocked — transducer |
| pH above 7.6 — ionizer stops working at this point | blocked — test kit |
| Copper outside 0.15–0.20 ppm | blocked — test kit |
| TDS below 500 ppm — R-40 cannot produce ions at all | blocked — TDS pen |
| Sprinkler zone failed to run | planned |
| Water heater alert count above zero | planned |
| Outdoor AQI above threshold | planned |
| Tesla battery low and not plugged in | planned |

Sensor-offline alerts belong here rather than lower, because every Level 1 and 2
rule silently stops protecting anything when its sensor dies. A dead sensor is
not a Level 5 curiosity.

### Level 4 — INFO

| Thing | Status |
|---|---|
| Pump running during the 4–9pm PG&E peak | planned (piece 4) |
| Laundry / dishwasher cycle done | **live** (dashboard tiles) |
| Dishwasher not started by 9:15pm | **live** (HA automation) |
| OhmHour scheduled or active | planned |
| Maintenance tickler item due | planned |
| Weekly energy and cost summary | planned |

Cost is not safety. The peak-hours alert is money, and money waits.

### Level 5 — LOG

Pump wattage · HX in/out temps and BTU/hr · appliance cycle counts and energy ·
pool chemistry test and dose history · filter pressure history.

---

## Known blind spot: the house going dark

**No level above can fire if Home Assistant itself is down.**

Power outage, Pi failure, or an internet outage takes out the pump, the Shelly,
*and* the thing whose job was to tell you — all at once. You receive silence,
and silence is indistinguishable from everything being fine. This is the exact
scenario that matters most on vacation.

Fixing it requires a watcher **outside the house**, because anything running on
the Pi or the Mac mini dies in the same outage. That means a third-party service
(a dead-man's-switch that alerts when scheduled pings *stop*), which has been
deferred pending a decision on free vs. paid tooling.

Recorded here so it is a known gap rather than a surprise.

---

## Adding a new alert

1. **What does it ask the person to do?** That answers the level. Not severity —
   the requested response.
2. **Level 1 only if an automation acts.** No action means Level 2 at best.
3. **Check the budget.** If it plausibly fires more than monthly, it is not
   Level 1 or 2.
4. **Give it a sensor of its own.** Put the logic in a template binary sensor,
   not inline in the automation, so the dashboard can show it and the rule is
   written once.
5. **Debounce it.** Match the delay to the damage rate: 30 seconds for the
   booster, 15 minutes for the pump, 30 minutes for sensor liveness.
6. **Decide the failure direction.** Fail closed for anything protective — an
   unavailable sensor should read as the dangerous state, not the safe one.
