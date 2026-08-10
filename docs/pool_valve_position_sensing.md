# Multiport valve position sensing

**Status:** approach decided 2026-08-10, parts not ordered. Blocks nothing.

Let the house know where the Tagelus TA100D handle is, so "the pool is being
serviced" becomes a fact about the equipment instead of a promise from whoever
last touched it.

---

## The decision

**Sense two positions only: Filter and Closed.** Everything else is inferred.

| Handle is | How we know |
|---|---|
| **Filter** | Sensor A sees the magnet |
| **Closed** | Sensor B sees the magnet |
| Backwash / Rinse / Waste / Recirculate | Neither sensor sees it |

Owner's reasoning, 2026-08-10: the backwash family can be told apart by what the
water does afterwards — left Filter, wasn't Closed, then pressure drops and flow
jumps. That works once the pressure transducer and flow meter are in.

**Recirculate is the known blind spot.** It also bypasses the sand, so it looks
identical to backwashing in pressure and flow; the only difference is that no
water leaves the pool. Accepted as wrong — Recirculate has been used roughly
once in the life of the pool.

## Why not NFC tags

The first instinct was a tag tapped on the way past. Rejected: a tag records
what someone *says* they did. Tap on the way to backwash, forget to tap on the
way back, and HA believes a false thing indefinitely.

That is the exact failure of `input_boolean.pool_maintenance`, deleted
2026-08-08 for waiting to be remembered. The entire value of sensing the valve
is that it is **self-clearing** — turn the handle back and monitoring resumes
with no human in the loop. A tag cannot do that.

## Why battery, not wired

The pad node has free inputs and a $5 wired contact would work. Battery chosen
anyway: no conduit run to the filter tank, and a Zigbee coordinator was already
on the someday list. Once it exists, door/motion/temp sensors are ~$10 each
anywhere in the house, which makes this the cheap first use of a $30 radio
rather than a $70 valve sensor.

## Parts

| Item | Why this one | ~Cost |
|---|---|---|
| Sonoff Zigbee 3.0 USB Dongle Plus (MG24) | Nothing in the house speaks Zigbee yet. Local, no cloud | $30 |
| 2× Third Reality contact sensor | Takes **2× AAA**, so Eneloops work. Most rivals are CR2032 — rechargeable coin cells are a different voltage and last months, not years | $26 |
| 2× small plastic outdoor junction box | The sensors are indoor plastic; the pad is not indoors. Plastic does not block the magnet | $8 |
| 1 small disc magnet | Tidier on a rotating handle than the chunky magnet block in the box | $5 |

**One magnet serves both sensors** — it lands on A at Filter, B at Closed, and
sits between them everywhere else. Discard the magnet halves that ship in the
boxes.

## Install notes

**The handle lifts before it turns.** The Tagelus top mount is spring-loaded —
push down and rotate — so the magnet rises about half an inch on its way
around. Mount the sensors *beside* the handle's arc, not under it, so the lift
slides the magnet past the sensor instead of pulling away from it.

**Bracket clearance competes with the pressure transducer tee.**
[pool_data_addendum.md](pool_data_addendum.md) already flags that the handle
sweeps above the gauge port. Work out both mounts together or the second one
will not fit.

**Zigbee range to the pad is unproven.** If the sensors will not hold a
connection, the fix is any mains-powered Zigbee smart plug between the house
and the pool acting as a repeater. Do not buy one up front.

## What it unlocks

- **"Handle left in Backwash"** alert — a genuine drain-the-pool hazard, and
  the reason this is worth building at all. Level unratified.
- **Distinguishes handle-in-Closed from a clogged basket.** The flow meter's
  deadhead detection already catches "pump drawing current, no flow," but
  cannot say *why*. Sensor B answers that, which changes what you go do.
- **Servicing suppression** for pool alerts, self-clearing.
- **Backwash duration logging** for the copper model — low value, since a single
  backwash moves copper by under 1 ppb, below the HI747's resolution.

## Open

- Exact detent geometry and the two mounting spots — needs eyes on the handle.
- Whether the pad is exposed enough to need the junction boxes.
