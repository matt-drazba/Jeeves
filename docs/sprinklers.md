# Sprinklers — Orbit B-hyve, weather-aware watering

**Status:** design in progress. Architecture decided 2026-08-12; nothing built yet.
Open questions at the bottom must be answered before code is written.

**Active work item: the rose — see §13.** It needs no code and does not wait on anything.

Goal: stop hand-adjusting the watering schedule for heat and rain. **No new hardware.**

---

## 1. The controller cannot be driven locally — this is settled, do not re-research

The HACS integration (`sebr/bhyve-home-assistant`, v4.1.2) is a **websocket to Orbit's
cloud** (`api.orbitbhyve.com`). There is no local API, no LAN protocol, no documented
local fallback. **There is no LocalTuya equivalent for B-hyve.** Do not spend time
looking for one again.

**This cuts the opposite way from the Tuya pool sweep, and the reasoning does not
transfer.** With the pool booster, stripping the vendor cloud out and making the switch
a dumb relay was strictly safer — every failure degraded to "the booster never runs,"
which is the safe direction (see `pool_booster_interlock.md`).

Here the failure direction is reversed, and so is the right answer:

- The B-hyve controller stores its program **on the box** and runs it on its own clock.
  WiFi down, internet down, Pi down, Orbit down — **it still waters.**
- Every command HA sends goes out to Orbit's cloud and back. HA cannot reach the
  controller any other way.

So the schedule-on-the-box **is** the local operation. Reducing the controller to a dumb
valve would move the only outage-proof component into the one path that requires the
cloud. The failure mode would be "nothing waters, silently, in August."

---

## 2. Architecture — decided 2026-08-12

**The program stays on the controller. HA modulates it. HA never owns the schedule.**

| Lever | Service | Scope | Survives HA/cloud outage? |
|---|---|---|---|
| Skip for N hours | `bhyve.enable_rain_delay(hours)` | whole device | Yes — self-expires back to normal |
| Scale all run times | `bhyve.update_program(budget: %)` | whole program | Yes — box keeps last budget |
| Change days / start time | `bhyve.update_program(frequency, start_times)` | whole program | Yes |
| Run one zone, any duration | `bhyve.start_watering(entity, minutes)` | per zone | **No** — cloud call per run |
| Trigger program now | `bhyve.start_program(entity)` | whole program | No |
| Stop a running zone | `bhyve.stop_watering(entity)` | per zone | No |
| Manual-run default length | `bhyve.set_manual_preset_runtime(minutes)` | per zone | n/a |
| Orbit's own smart model | `bhyve.set_smart_watering_soil_moisture(%)` | per zone | n/a — not in use, see §4 |

**Plan:** HA recomputes a water deficit each morning (ET out, rainfall in) and writes
`budget`. Actual storms fire `enable_rain_delay`. If the Pi dies, the controller keeps
watering at yesterday's budget — degraded, not stopped.

`rain_delay` is the **self-expiring** kind of suppression this house has settled on
twice already: the garage snooze `timer` and the deleted `input_boolean.pool_maintenance`.
A mute that waits to be remembered silently disables the thing protecting you. Rain delay
expires on its own. Use it; never build a boolean mute alongside it.

### Rejected: move the schedule into HA/YAML
Full per-zone control, one place to look — but every single watering run then depends on
Pi + internet + Orbit cloud, and a failure is silent. Also a multi-session rebuild of
every zone's days/times/minutes, owned forever, to replace something that already works.
Not worth it. **Do not revisit without a new reason.**

### `budget` is a percentage multiplier — proven, not assumed
Program A carries `budget: 110`. Base run times are 2 / 2 / 5 / 5 min; the zone history
sensors recorded actual runs of **2.2 / 2.2 / 5.5 / 5.5**. 110% exactly. The arithmetic
closes, so budget is confirmed as a straight percentage scaler on program run times.

**Unverified:** the accepted range and step size (app suggests 0–200% in 10% steps, not
confirmed via the API). Test the floor and ceiling empirically before relying on either.

### Known limit: budget is per-program, not per-zone
All four zones sit on Program A today, so one budget covers all of them. The bias
decision (2026-08-12) is **per-zone** — lawn can go dry and recover, plantings cannot.

**Fix, when needed:** split the zones across Program A and Program B in the B-hyve app,
then have HA set two budgets independently. Still on the box, still outage-proof. Do this
rather than reaching for `start_watering`, which trades away the offline guarantee.

---

## 3. Measured state — 2026-08-12

Device `Sprinklers`, id `65e4f8945656a853df499eaf`, 4 stations, one program (`a`).

**Program A** — `is_smart_program: false`, `start_times: ["06:00"]`,
`frequency: {"type": "even"}` (even-numbered calendar days), `budget: 110`.

| Station | Zone | Base run | At 110% | `sprinkler_type` |
|---|---|---|---|---|
| 1 | Front Yard | 2 min | 2.2 | `drip` |
| 2 | Back Planters | 2 min | 2.2 | `drip` |
| 3 | Uphill | 5 min | 5.5 | `drip` |
| 4 | Downhill | 5 min | 5.5 | **unset** |

Entities (note: **`valve.` domain, not `switch.`** — integration 4.1.2 moved them):

```
valve.sprinklers_{front_yard,back_planters,uphill,downhill}_zone
sensor.sprinklers_{...}_zone_history      # budget, run_time, status, start_time
sensor.sprinklers_next_watering           # already on the Jeeves tile, server.js:472
sensor.sprinklers_state                   # 'auto'
select.sprinklers_device_mode             # auto | off  — master kill
switch.sprinklers_rain_delay              # 'off'
switch.sprinklers_program_a_program       # holds run_times, frequency, budget
switch.sprinklers_{...}_smart_watering    # all 'on' — but see §4
binary_sensor.sprinklers_fault            # + station_faults[] — feeds the planned
                                          #   "zone failed to run" alert
update.orbit_bhyve_update                 # integration version
```

`consumption_gallons` / `consumption_litres` are **null** on every history entry — the
controller reports no flow data, so actual water delivered cannot be measured or verified.

---

## 4. Orbit's own Smart Watering is NOT running

`switch.sprinklers_*_smart_watering` reads `on` for all four zones, which looks like
ET adjustment is already active. It is not. The running program is
`is_smart_program: false`, and every zone's valve attributes report
`smart_watering_enabled: false`.

Reading: the switches reflect per-zone *eligibility*, while the active program is a plain
fixed schedule. **Today the system is dumb — fixed even-day, 06:00, 2/2/5/5 at 110%.**

The `on` switches are a trap. Do not read them as "already handled."

---

## 5. Weather data — no new hardware needed

**Open-Meteo publishes `et0_fao_evapotranspiration` daily, free, no API key.** Jeeves
already calls Open-Meteo server-side for the weather tiles, so reference
evapotranspiration is available for the cost of one extra field on an existing request.

That makes the good design reachable with zero purchases: track a running water deficit
per zone (ET out, measured + forecast rain in) and scale budget off the deficit — rather
than nudging a fixed schedule by temperature, which is a much cruder proxy. Soil moisture
sensors would only refine this; they are not required to start.

---

## 6. Plant inventory — owner, 2026-08-12

**Even-day frequency is not a water-district rule — it is just how it got set up.**
`frequency` is therefore free to change. (Confirmed 2026-08-12.)

| Zone | Contents | Emitters | Owner's read |
|---|---|---|---|
| 1 Front Yard | Shrubs, **plus one rose bush** | Drip on shrubs; rose on **one** **Hunter RWS-S**, `RWSSBC1401` — 10" tube, **0.25 GPM bubbler**, check valve | Shrubs fine. **Rose barely growing** — the actual complaint |
| 2 Back Planters | — | drip | **Don't care. Out of scope.** |
| 3 Uphill | In-ground **Pomelo** + **Eureka lemon** | RWS, believed the 2 ft version, **2 tubes per tree** | Doing OK |
| 4 Downhill | **All potted trees, in half-barrels** — kumquat, fig, tangelo, Meyer lemon bush | Kumquat: 10" RWS · Meyer lemon: 1 bubbler · Fig + tangelo: **circle of drippers** (count and GPH unmeasured — estimated) | Drains from the bottom on every run |

**The `drip` sprinkler_type in the B-hyve app is wrong for most of this.** These are
largely **bubblers, not drip emitters** — the RWS-S is rated **0.25 GPM = 15 gallons per
hour**, roughly 10–30× a typical drip emitter. Do not reason about these zones as drip.

**The RWS delivers subsurface**, into a buried perforated tube, so RWS-fed plants do not
lose much to surface evaporation. Where those plants are short of water it is a pure
volume shortfall — do not attribute it to shallow wetting or evaporation.

---

## 7. Delivered volumes — computed 2026-08-12

Even-day ≈ 3.5 runs/week. Program A at `budget: 110` → zone 1 runs 2.2 min, zones 3–4
run 5.5 min.

| Zone | Plant | Emitter | Per run | Per week | Rough August target |
|---|---|---|---|---|---|
| 1 | Rose | 1 × RWS-S 0.25 GPM | **0.55 gal** | **~1.9 gal** | 5–8 gal |
| 3 | Pomelo / Lemon | **2 ×** RWS 0.25 GPM per tree | 2.75 gal | ~9.6 gal | 15–25 gal mature |
| 4 | Kumquat | 10" RWS 0.25 GPM | 1.4 gal | ~4.8 gal | half-barrel — see §8 |
| 4 | Meyer lemon | 1 bubbler 0.25 GPM | 1.4 gal | ~4.8 gal | half-barrel |
| 4 | Fig / Tangelo | dripper circle, **count + GPH still a guess** | ~0.5 gal | ~1.9 gal | half-barrel |

**The rose is water-starved, and that is the answer to "why isn't it growing."** Under
two gallons a week against a 5–8 gal target — roughly a quarter of what it wants. **This
is a volume problem, not a fertilizer problem**: a plant short on water cannot take up
nutrients, so feeding it first would make things worse. Fix water, then feed.

**Zone 3 recomputed once the 2-tubes-per-tree count landed** — ~9.6 gal/week, not the 4.8
originally estimated. That is about half the mature-citrus target and consistent with the
owner's "doing OK." No action; revisit only if the trees show stress.

---

## 8. Zone 4 — THE ONE CHECK

> **On any odd-numbered day, push a finger 3–4 inches into the mix in each of the four
> half-barrels, mid-radius — out between the trunk and the rim, NOT next to an emitter.**
>
> **Damp → zone 4 is fine. Change nothing.**
> **Dry → the water is channeling straight through. Fix per below.**

That is the whole test. Odd days are the driest point in an even-day schedule, so it is
the moment of maximum information, and there is no timing pressure within the day.
Mid-radius matters: soil directly under an emitter is wet in every scenario and tells you
nothing.

### Why this one check, and not the drainage observation

**Correction to the earlier framing in this doc: the drainage test is NOT binary, and it
was wrong to call it unambiguous.** Zone 4 does drain from the bottom on every run
(owner-confirmed 2026-08-12) — but drainage proves water *left*, not that the root ball
was *wetted*. At these volumes it reads two opposite ways:

| Reading A — fine | Reading B — bad |
|---|---|
| The mix is already near field capacity from every-other-day watering, so anything added runs straight through. Schedule adequate. | **Channeling.** Dry or hydrophobic mix sheds water down the sides and through root channels, out the hole, wetting almost none of the root ball. |

Reading B is entirely plausible: wetting a half-barrel from moderately dry takes ~2–4 gal,
more than any zone-4 plant gets per run (§7). Only the moisture check separates them.

**If dry (Reading B):** this is hydrophobic mix, and *a longer schedule will not fix it* —
faster water channels harder. Reset it by hand once: a slow soak, or several short cycles
20 minutes apart to let the surface re-wet, or a commercial wetting agent. Once re-wetted
the mix behaves normally again, and *then* runtime is worth adjusting.

**Trowel test (rose, separate):** one hour after zone 1 runs, dig 6–8" down near the rose,
inside and outside the old root ball footprint (§13). Not yet performed — §7 makes the
shortfall clear enough to act on regardless.

---

## 9. Containers are a different regime, and this reshapes the design

Zone 4 is **all half-barrels**. A container's usable soil reservoir is small and dries out
fast in August. The correct regime is **frequent, watered to genuine drainage** — the
opposite of the deep-and-infrequent pattern that suits in-ground trees. Zone 4 is
currently on the same even-day schedule as the in-ground zones, which is the **wrong
shape**, not merely the wrong number.

Half-barrels are the forgiving end of container growing — ~25–30 gal of mix buffers far
better than a nursery can — which is consistent with these plants coping so far.

### What to know about these four specifically

1. **A half-barrel holds less water than its size suggests.** An established tree's roots
   displace much of the mix. These are old plants; treat the usable reservoir as a
   fraction of 25–30 gal, not the whole thing.
2. **For citrus, consistency beats volume.** Citrus punishes *swings* more than it
   punishes a modest deficit — fruit drop, leaf drop, split fruit. Steady moisture is the
   goal, not maximum gallons.
3. **Over- and under-watering both yellow the leaves, which is the classic trap.**
   Under: leaves cup or curl inward along the midrib, go dull, wilt by morning, fruit
   drops small. Over: yellowing starts on older inner leaves, mix smells sour, and there
   is *no* wilting. **The leaves will not settle it — the soil check will.**
4. **The fig is the outlier, and it lies.** Thirstiest of the four in summer, and
   dramatic about it. **Midday wilt on a fig is normal and means nothing.** Only a fig
   that is still wilted in the morning, before sun hits it, is actually dry.
5. **Bark/peat mix goes hydrophobic once fully dry** and then repels water — this is the
   exact mechanism by which "it drains" and "it is bone dry" are both true at once. The
   cure is one slow re-wetting by hand, not a longer schedule (§8).
6. **Salt buildup is a container-only problem.** No native soil to buffer, so fertiliser
   and tap-water salts accumulate. Symptom is leaf **tip and margin burn** on citrus. Cure
   is periodic deep leaching — a long run that flushes volume through. **This couples to
   the fertiliser schedule: more feeding means more flushing needed** (§10). Good drainage
   here is an asset for exactly this.
7. **The kumquat's RWS tube is the odd one out.** A 10" root-watering tube is designed for
   open ground; in a barrel it is a short conduit pointed at the drain hole. **If one
   zone-4 plant underperforms, suspect the kumquat first**, and consider capping the tube
   and watering the surface instead.

Consequences:

- **The program split is in-ground (zones 1+3) vs containers (zone 4)** — not an
  arbitrary A/B split. They need different frequencies *and* different budget responses
  to heat; pots swing harder and faster than soil.
- **The ET-deficit model mostly does not apply to zone 4.** Deficit modelling assumes a
  soil reservoir that buffers between waterings. Pots have almost none. Zone 4 is
  frequency-driven, closer to "daily in summer, back off in winter."
- **Zone 2 should come out of the program in the app.** The owner does not care about it,
  but it rides Program A's budget and costs water on every run.
- B-hyve supports programs A/B/C, so three budget groups are available. Two are needed.
- **Emitters are mixed within zones**, so no single runtime is right for everything on a
  valve: zone 1 has drip shrubs sharing a valve with a 15 GPH bubbler; zone 4 has 0.25
  GPM bubblers sharing with dripper circles. Runtime can only be set per program, so the
  fix is at the hardware end (match emitter output within a zone) or accept the
  compromise deliberately.

---

## 10. Fertilizer + mulch in the tickler — BUILT 2026-08-12, schema v8

Written, not yet deployed. No dashboard work was needed: the Next Up tile and the 07:00
`_addChore()` promotion already consume anything in the `tasks` table.

### The schema gap is closed
`tasks` had `interval_days` only. Roses stop feeding around Labor Day and in-ground citrus
feeds three times a year — on interval alone both would promote a chore tile every 35 days
through December, and **a tickler that nags out of season is how the tile gets ignored
entirely.** Same failure the garage snooze `timer` and the deleted
`input_boolean.pool_maintenance` were built to avoid: suppression must clear itself.

**v8 adds nullable `start_month` / `end_month` to `tasks`** (`db.js`). Outside its window a
task's `dueAt` is **deferred to the next window opening, not hidden** — so Next Up still
reads "Feed the rose · March 1" instead of the task vanishing for six months and looking
like a bug. NULL months = no window, so every pre-v8 task is unchanged. Windows may wrap
the year end. `refreshNextActions()` appends "Mar–Aug only" to the `basis` string for the
same reason.

### Seeded tasks — domain `garden`

| Key | Task | Every | Window | Notes |
|---|---|---|---|---|
| `fert_rose` | Feed the rose | 35 d | Mar–Aug | Heavy feeder. **Water first** (§13) |
| `fert_citrus_ground` | Feed pomelo + lemon | 120 d | Feb–Sep | Citrus-specific food |
| `fert_potted` | Feed potted trees | 35 d | Mar–Sep | Kumquat, tangelo, Meyer, fig. **Micronutrients (Fe, Zn, Mn)** — containers leach them |
| `mulch_beds` | Mulch the beds | 365 d | **Feb–Apr** (v9) | `last_done_at = NULL`; first due **2027-02-01** |

### v9 — mulch is a spring job. Corrected 2026-08-13.
v8 seeded `mulch_beds` with no window and a NULL `last_done_at`, i.e. due immediately.
**Two things were wrong with that, and the owner caught it:**

1. **Anchoring.** `interval_days` counts from `last_done_at`, so whenever a job first gets
   done becomes its permanent anniversary. Mulching in August would have locked **every
   future year to August**. A window pulls it back to spring no matter when it actually
   gets done — verified: mulched 2026-08-20, next due **2028-02-01**, not 2027-08-20.
2. **Climate.** In Feb–Apr the soil here is already wet from winter rain. **Mulch laid
   over dry soil keeps it dry** — it sheds light irrigation — so an August mulching must be
   preceded by a deep watering, while a February one gets that for free (§13).

**The rose still wants mulching now, in August.** That is a one-off step in the rose
remediation (§13), *not* the recurring garden job. **Conflating a one-time remediation
action with a recurring seasonal task is what produced the bad seed** — worth remembering
before adding future tickler entries.

v9 is written as an `UPDATE ... WHERE start_month IS NULL` rather than a corrected v8 seed,
so it lands whether or not v8 already ran on the database.

### Two consequences of the dates, both verified by test
- **The rose gets no fertilizer this season.** Seeded 2026-08-12 it first comes due
  2026-09-16, past its August close, so it defers to **2027-03-01**. Correct outcome: fix
  water, pull suckers, mulch, feed in spring.
- **The potted trees get one more feed, ~2026-09-16**, since September is inside their
  window. This is the near-term check that the window logic works in the real world.

Logic verified against 9 worked cases before deploy, including year-wrapping windows and
the NULL-last_done path.

### Coupling to keep in mind
**More irrigation water means more leaching, so fixing zone 4's watering *increases* how
often those pots need feeding** — and increases salt flushing needs (§9.6). Do not tune
the water and fertilizer schedules independently.

### Fig simplification
The fig is folded into `fert_potted` at 35 days rather than getting its own monthly task.
Deliberate — it avoids a fifth tile for a small difference. Split it out if the fig
underperforms.

---

## 11. Open questions

1. **Container drainage test result** (§8) — the gating measurement for zone 4.
2. **How many RWS tubes per tree in zone 3?** One or two changes the delivered volume in
   §7 by 2×. Same question for the rose.
3. **Fig and tangelo dripper circles — how many emitters, what GPH rating?** Printed on
   the emitter. Without this their delivered volume is a guess.
4. **Pot sizes in zone 4** (roughly — 15 gal? half-barrel?). Sets the container reservoir
   and therefore the watering frequency.
5. **What range does `budget` actually accept** via `update_program`? Floor matters: if it
   cannot reach a low enough value, skipping has to go through `rain_delay` instead.
6. **Downhill has no `sprinkler_type` set** — cosmetic given §6, but worth setting.

## 12. Not yet decided

- Program split mechanics: which zones move to Program B, and the frequency for each.
- Whether to correct the base run times in the app before layering budget scaling on top.
  Budget is a multiplier — a wrong base stays wrong at every budget.
- Deficit model parameters for zones 1+3: soil type, root depth, allowed depletion, crop
  coefficients.
- Seasonal-window schema for `tasks` (§10).
- Alert levels. `binary_sensor.sprinklers_fault` → "zone failed to run" is already listed
  as planned in `alerting_levels.md`. A missed watering is a slow, visible, recoverable
  failure — it is **not** an L1, and probably not an L2.
- Dashboard: the `sprinklers` tile exists (`server.js:468`) and shows next watering only.
  Whether to surface budget / deficit / last run is undecided.

---

## 13. The rose — active fix, 2026-08-12

Getting ~1.9 gal/week against a 5–8 gal target (§7). One RWS-S at 0.25 GPM, 2.2 min per
run, every other day.

### Base run times can ONLY be changed in the B-hyve app — this is structural

`bhyve.update_program` accepts **`start_times`, `frequency`, `budget`** and nothing else.
**There is no service that sets per-station `run_times`.** HA can scale the base by a
percentage, forever, but it can never set it.

Consequence for the whole project: **get the base run times right by hand, once, in the
app. A wrong base stays wrong at every budget** — 200% of not enough is still not enough.
Do this before any smart scaling is built on top.

### The change

**In the B-hyve app, raise zone 1 (Front Yard) base run time from 2 → 8 minutes.**
Per-station, so zones 3 and 4 are untouched.

| | Now | After |
|---|---|---|
| Run length at `budget: 110` | 2.2 min | 8.8 min |
| Rose, per run | 0.55 gal | **2.2 gal** |
| Rose, per week | ~1.9 gal | **~7.7 gal** |
| Shrub drip emitters, per run | ~0.04 gal | ~0.15 gal |

**Low risk to the shrubs sharing the valve.** Their drip emitters are ~1 GPH, so even at
4× the runtime they receive a rounding error. The shared-runtime conflict that normally
makes mixed emitters dangerous does not bite here because the drip side is so low-output.
The shrubs are evidently living on winter rain and deep soil moisture, not on this zone.

### Then verify — do not set and forget

One week later, trowel 6–8" down near the rose the day *after* a run. Damp = right.
Still dry = go to 12 min. Soggy/sour-smelling = back off; heavy clay plus a subsurface
bubbler every other day can stay too wet, and roses will not tolerate waterlogged roots.

### Optional, ~$15: a second RWS

Hunter specs **two** RWS units per shrub or small tree, on opposite sides. This rose has
one, so half its root ball is being watered. Adding a second is the single best physical
improvement and does not touch the controller. Not required to see improvement from the
runtime change.

### Fertilizer comes after, not with

Water first for **3–4 weeks**, then feed. A water-stressed plant cannot take up nutrients,
and fertilizing into drought stress makes things worse. Once it is watered properly:
every 4–6 weeks, stopping ~Labor Day so it does not push tender growth into fall (§10).

### History — owner, 2026-08-12. This reframes the problem.

**The rose is ~62 years old. It spent its first 60 years in a pot and has been in the
ground for 2 years.** Sun is abundant — that hypothesis is closed, it is not a light
problem.

**Revised leading hypothesis: it never established, and the water shortfall is a real but
secondary contributor.**

Six decades in a container produces a dense, circling, partly woody root mass moulded to
the pot. Planted out without scoring or teasing the roots, that mass keeps circling and
**never penetrates the native soil** — the plant goes on living inside a pot-shaped volume
of old container mix, just underground. Two years is also *not* a long recovery for a
transplant of that age; moving a 60-year-old specimen is an enormous insult and multi-year
sulking is normal.

**The critical consequence is hydraulic, and it changes where water has to go.** A
peat/bark container mix embedded in clay does not exchange water freely with the soil
around it — the texture interface blocks it in both directions. So:

- The old root ball can be **bone dry while the surrounding soil is wet**, or the reverse.
- Gallons delivered *outside* the old root ball footprint reach roots that are not there.
- **Total volume is the wrong dial if placement is wrong.** More water outside the ball
  changes nothing.

This does **not** invalidate the runtime change — 1.9 gal/week is genuinely too little on
any reading, and 8 min is right. But it raises a risk worth watching: a peat-based root
ball sitting in clay that will not drain it can be pushed **too wet** by quadrupling the
water. That failure looks like soggy, sour-smelling soil, and it is worse than dry.

### Revised trowel check — dig in two places, not one

At ~1 week, sample **inside the old root ball footprint** and **outside it**, separately.
They are effectively two different soils and will read differently.

| Inside ball | Outside ball | Reading |
|---|---|---|
| Damp | Damp | Working. Hold at 8 min. |
| Dry | Wet | **Texture-interface failure.** The classic never-established pattern. More runtime will not fix it — water is bypassing the roots. |
| Wet/soggy | Damp | Overshoot. Back off runtime. |
| Dry | Dry | Genuinely under-watered. Go to 12 min. |

### If it is the interface, irrigation tuning is not the fix

Options, roughly in order of invasiveness — none of them involve the controller:

- Heavy mulch and patience; keep water landing **on the root ball itself**.
- Vertical mulching or radial trenching to break the interface and give roots a path out.
- Perimeter root pruning to force outward growth.
- Accept it. At 62 it may simply be old, and roses do have a lifespan.

### Observations 2026-08-12 — the establishment worry is largely retired

- **Throwing new shoots from the base, and blooming** — blooms are just much smaller.
- **Roots were scored at planting.**
- **The RWS tube is inside the old root ball footprint** (pot size not recorded — standard).
- Also shooting **from the root ball itself, above the dirt line** — see the sucker check.

Read: **this plant is establishing, not declining.** Basal breaks plus bloom on a
62-year-old two years after transplant is a good prognosis, and scored roots mean the
never-established / texture-interface scenario is much less likely than feared. **Water
moves back to being the leading limiting factor** — and *small blooms on a plant that is
otherwise growing and flowering is a textbook water-deficit symptom*, which matches the
1.9 gal/week in §7 exactly. Proceed with 8 min; the two-place trowel check in the table
above is still worth doing but is now a confirmation rather than a diagnosis.

### Rootstock suckers — CONFIRMED 2026-08-12. Second real cause, fixable for free.

Owner reports the shoots coming off the root ball are **rootstock suckers**, and that they
were left in place to see whether they would flower. **They never did.**

**That is the second cause of the poor performance, alongside the water shortfall — and
the two compound each other.** The rootstock is bred to be more vigorous than the grafted
variety on top of it. Every sucker is the rootstock spending the plant's energy on itself.
Left alone the rootstock progressively takes over and the named variety weakens and
eventually dies. This is the mechanism behind every "my rose changed colour" story.

**Do not leave them to see if they flower. They will not usefully.** In California the
dominant rootstock is **Dr. Huey** — small dark crimson semi-double flowers, in **one
spring flush only**, on long arching very vigorous canes. Nothing all summer is exactly
what it does. If crimson single-flush blooms appear next spring, that confirms it.

**Why this plant suckers so heavily:** rootstock suckering is triggered by stress and by
root disturbance. A 60-year container rose that was root-scored and transplanted, then run
at a quarter of its water requirement, is close to a worst case for it. **Fixing the water
reduces future suckering** — the two interventions reinforce each other.

### Removing them — the method matters

1. **Confirm each shoot individually against the graft union** — the knobby swelling at
   the base of the canes. Above the union = keep, that is the real variety and it is good
   news. From below the union, or from roots out away from the crown = sucker.
2. Excavate soil away by hand or trowel until you can see where the sucker attaches.
3. **Tear it off at the point of attachment** — a sharp downward/sideways pull. Gloves.
4. **Do not cut flush with pruners.** A cut leaves a stub carrying dormant buds and it
   regrows as several suckers instead of one. Tearing takes the basal bud tissue with it.
5. Re-cover the excavation.

Any time of year; sooner is better. Expect to keep checking every few weeks — a stressed
plant keeps producing them.

**Also check the graft union sits at or just above soil level.** In a mild climate it
should not be buried; a buried union suckers more. Note it, but do not excavate a
62-year-old plant to fix it.

### Mulching — how, 2026-08-12

Directly useful here for two reasons: it conserves the water this plant is short of, and
it makes the native soil *outside* the old root ball hospitable, which is what encourages
roots to leave the ball.

| | |
|---|---|
| **Material** | Coarse organic — shredded bark, composted bark, or arborist wood chips (often free). Optionally 1" of compost first, then mulch over it. |
| **Avoid** | Fresh grass clippings (mat and go anaerobic), fine sawdust (crusts, ties up nitrogen), landscape fabric underneath (roots grow into it, blocks organic matter reaching the soil), rubber mulch. |
| **Depth** | **2–3 inches.** Not more — deeper over clay holds too much water and starves roots of oxygen. |
| **Area** | Out to the drip line and **past the old root ball footprint**. Extending beyond the ball is the entire point. |
| **Quantity** | A 4 ft diameter ring at 3" ≈ **3 cubic feet** — about 1½ standard 2 cu ft bags. |
| **Timing** | Any time. Mid-August is good — it carries the plant through the hot end of summer. |

**Two things that must be right:**

1. **Keep mulch off the crown.** Pull it back 3–6" from the base of the canes and clear of
   the graft union. Mulch piled against the crown causes rot. This is the single most
   common mulching mistake.
2. **Water deeply first.** Mulch laid over dry soil keeps it dry — it sheds light
   irrigation and slows wetting. Weed first as well.

**If the old root ball is sitting proud of the grade** (suggested by shoots emerging above
the dirt line), that matters: an exposed container root ball acts as a wick and dries hard
and fast. Cover it with soil or compost, then mulch — **but still keep the crown itself
clear.**

**Keep the RWS cap accessible.** Mulch around it, never over it, or access is lost and the
tube can clog.

### Still unknown

- Graft union present or not (see sucker check) — gates whether the basal shoots are good
  news or a problem.
- Whether the root ball is genuinely proud of the grade.
- Heavy clay / compaction, borers, disease — not investigated, low priority now.
