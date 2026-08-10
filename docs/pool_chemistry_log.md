# Pool chemistry log

**Append-only. Newest entries at the bottom of each table.**

This is the manual stand-in for the SQLite tables described in
[pool_chemistry_logging.md](pool_chemistry_logging.md). The three sections below
mirror `pool_tests`, `pool_doses`, and `pool_actions` column-for-column, so when
those tables get built (todo tier 6) these rows seed them directly instead of
being re-keyed.

Targets and rationale live in
[pool_data_addendum.md](pool_data_addendum.md) Part 2. **They are R-40 manual
numbers, not conventional-pool numbers** — several differ materially.

## Rules for writing rows here

1. **Record what the instrument can resolve — never a value it cannot produce.**
   A number read between two gradients goes in the `est?` column marked `y`, with
   the nearest gradient in the value column. Fitting a model later depends on
   knowing which numbers are real.
2. **Name the instrument on every row.** Resolution differs by an order of
   magnitude across the kits in this house, and a reading is meaningless without
   knowing which one produced it.
3. **Tests, doses, and actions are separate rows.** Pairing them is the whole
   point — FC 4.0 Monday → 1.8 Thursday cannot distinguish decay from a dose
   unless the dose is written down separately.
4. **A copper reading within ~24 h of a shock is invalid** — high chlorine
   bleaches the ion test toward zero (R-40 manual p.18 #7). Mark it and do not
   fit it.

## Instrument resolution

| Instrument | Parameters | What it actually resolves |
|---|---|---|
| **Drop / reagent kit** | pH, FC, TA | Titrated: ~0.2 ppm per drop for FC, ~10 ppm per drop for TA. pH is a phenol-red comparator, 0.2 steps. **These are genuinely resolved values, not block interpolations.** |
| **Clearwater CLA-41** ion kit | Copper | Colour match card, eight gradients: **0.05 / 0.1 / 0.15 / 0.2 / 0.3 / 0.5 / 0.7 / 1.0 ppm**. Read *down* into the tube, not from the side; wait 3 minutes. Reagents replaced yearly, kept out of sun and at room temperature. |
| Hanna HI701 | FC | Not yet purchased — todo tier 1, Group A. |
| Hanna HI747 | Copper | Not yet purchased — todo tier 1, Group A. ±10 ppb. |
| Taylor K-2006 | pH, TA, CH, CYA | Not yet purchased — todo tier 1, Group A. |
| TDS pen (HM Digital TDS-3) | TDS | Not yet purchased. **TDS has never been measured on this pool.** |

## Tests

`ts · instrument · fc · cc · ph · ta · ch · cya · tds · copper · est? · water_temp_f · notes`

| Date | Instrument | FC | CC | pH | TA | CH | CYA | TDS | Cu | est? | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 2026-08-10 | drop kit (pH/FC/TA) + CLA-41 (Cu) | 1.0 | — | 7.4 | 130 | — | — | — | 0.1 | n | First logged test. All of pH/FC/TA in range. Cu one gradient below the 0.15–0.20 target band. Reagent age unknown for both kits. |

**Reading of 2026-08-10:** pH 7.4 sits in the manual's preferred 7.2–7.4 half, and
FC 1.0 is nowhere near shock level — which between them rule out the R-40 manual's
two most common causes of a low ion level (p.18 #6 improper pH, #7 chlorine
bleaching the test). The low copper is therefore a genuine output or conductivity
question, not a chemistry artifact. TDS is the outstanding unknown: below 500 ppm
the R-40 cannot produce ions at any dial setting (p.13, p.18 #12).

## Doses

`ts · chemical · amount · unit · notes`

| Date | Chemical | Amount | Unit | Notes |
|---|---|---|---|---|
| — | — | — | — | No doses logged yet. |

## Actions

`ts · action · notes`

| Date | Action | Notes |
|---|---|---|
| 2026-08-10 | **R-40 output dial 2 → 3** | Response to Cu 0.1. Follows the manual's documented method (p.14): low reading → up one notch → retest a couple of days later. **Retest due 2026-08-13. Do not move the dial again before then** — two changes inside one interval makes the result uninterpretable. Expect the match to land on 0.15 or higher; see the dial arithmetic in [pool_data_addendum.md](pool_data_addendum.md) Part 2. If it is flat, the dial is not the constraint — check the internal 115/230 VAC selector and measure electrode mA. |
