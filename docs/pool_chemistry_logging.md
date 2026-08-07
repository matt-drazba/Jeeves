# Pool chemistry + maintenance logging — design brief

**Status:** Parked, not started. Design discussion only — no code written.
**Filed:** 2026-08-05
**Related:** `docs/pool_heat_recovery.md`, `esphome/pool-pad.yaml`, `jeeves/db.js`

## Goal

Capture manual pool maintenance — test results and chemical doses — so Jeeves can
forecast chemistry rather than just display it. Target outputs: "FC hits 2 ppm
Thursday," "add 40 oz of acid," "copper is drifting low since the last backwash."

## Why now

Three prerequisites landed that weren't there when this was first sketched:

- **SQLite is real** — `jeeves/db.js` owns cycles, energy, errors, and chore credits.
- **Voice pipeline works** — `voice/main.py` (faster-whisper `base.en` + Piper),
  dispatched through `dispatchVoice()` in `jeeves/server.js`.
- **Pool water temp is being logged** — `pool_heat_samples`, every 2 minutes
  (added 2026-08-05). Chlorine burn is temperature-driven, so this is the
  regressor that makes a pool-specific decay model possible instead of a
  generic lookup table.

## Core modeling decision — two tables, not one

Pool maintenance is two distinct event types, and the forecast value comes
entirely from **pairing** them:

- **Tests** — what the water measured (FC, CC, pH, TA, CH, CYA, copper, temp).
- **Doses & actions** — what was done to it (chemicals added, backwash, brush,
  filter clean, mineral cartridge change).

Collapsing these into one "pool log" table destroys the ability to compute
anything. FC 4.0 Monday → 1.8 Thursday is meaningless alone: decay, or was it
shocked Tuesday? Only *test → known dose → next test* yields a decay rate.

Copper needs the actions table specifically — it doesn't decay like chlorine, it
dilutes via backwash, splash-out, and rain. Different model entirely.

## Voice vs. UI — split by verbs and numbers

They are good at opposite halves and are **not** interchangeable:

- **Voice for verbs/doses.** "Jeeves, I added a gallon of liquid chlorine."
  Short, closed vocabulary, misfires are obvious and harmless. Fits the existing
  regex tier in `dispatchVoice()` — no LLM needed.
- **Screen for numbers.** Spoken readings through `base.en`, outdoors, near
  moving water, will produce wrong numbers *silently*. A bad FC value doesn't
  look bad — it just poisons the decay model undetectably. Numbers must be
  visually confirmed before commit.

**Optional hybrid (decide later):** voice as a form pre-filler — speak the
readings, the form shows them parsed into fields, glance and tap Save. Speed
without silent corruption. Meaningfully more work; not required for v1.

## Decided

- **Entry point: phone at poolside.** Test kit is read at the pool; the Fire HD 8
  is in the kitchen. Jeeves is already LAN-reachable and on Tailscale, so a phone
  browser works today with no new infrastructure.
- **Layout: reuse the current dashboard layout.** Owner's call — the existing
  tile/panel styling reads well on both phone and tablet, so no separate
  phone-specific UI. Avoids duplicated work in the single-file dashboard.

## Proposed reversal — drop ha-poolchem

CLAUDE.md currently commits to **ha-poolchem via HACS**, with values as HA
`input_number` entities. Recommend dropping it:

- Chemistry in HA lives in HA's recorder — short retention, already trimmed.
- Forecasting would have to read history back out of HA instead of owning it.
- Two stores to keep in sync, for no gain.

**Jeeves' SQLite should be the system of record.** If current values are wanted
inside HA for automations, mirror them *outward* to input_numbers, one-way.

Not yet ratified — flagged here so it's a deliberate fork, not an accident.

## Schema sketch

```
pool_tests    (id, ts, member_id, source['ui'|'voice'], water_temp_f,
               fc, cc, ph, ta, ch, cya, salt, copper, notes)

pool_doses    (id, ts, member_id, source, chemical, amount, unit, note)

pool_actions  (id, ts, member_id, action)   -- backwash, brush, filter clean,
                                            -- baskets, cartridge change
```

- Chemicals defined in a small config file (`jeeves/pool_chemicals.json`),
  mirroring the `chores.json` pattern, with default units — read by both the
  voice dispatcher and the UI so vocabulary stays in one place.
- **Pool volume** is a required one-time config value for any dose math.
- `member_id` reuses the existing `members` / PIN plumbing, so pool tasks can
  feed the chore scorecard for free.

## Open questions

1. ~~**Test kit type?**~~ **ANSWERED 2026-08-07** — see
   [pool_data_addendum.md](pool_data_addendum.md) Part 2. Three instruments, not
   one: **Hanna HI701** for FC (this pool runs 0.4–1.0 ppm, where a drop kit
   quantizes at 0.2 ppm/drop), **Hanna HI747** for copper (target is
   **0.15–0.20 ppm**, not the 0.2–0.4 previously recorded), and **Taylor K-2006**
   for pH/TA/CH/CYA. Plus a TDS pen — the R-40 needs 500–3000 ppm to produce ions
   at all, which nothing in this repo had captured.

   Two constraints this puts on the schema: copper readings are **invalid within
   ~24h of a shock** (chlorine bleaches the test), and pH here is a
   sanitiser-efficacy parameter, not comfort — above 7.6 the copper ions fall out
   of solution and the ionizer stops working, so pH belongs in the forecast as a
   driver of copper loss, not just as a logged value.
2. **Log only, or dose calculator?** Recording "I added a gallon" is
   straightforward. "Tell me how much to add" needs pool volume, target bands,
   and current readings configured up front — more setup, but it's the part
   that'd get weekly use.
3. Ratify or reject the ha-poolchem reversal above.

## Forecast targets (what this is all for)

- **FC decay** — ppm/day learned from this pool, adjusted by water temp from
  `pool_heat_samples`.
- **Self-correcting dose sizing** — start from volume math, refine against what
  past doses actually achieved. Real pools never match label math.
- **pH rise rate** — plaster + aeration drive it predictably; yields an acid
  interval without thinking about it.
- **Copper tracking** for the Clearwater MineralPURE R-40 (target 0.2–0.4 ppm),
  modeled on dilution events rather than decay.
