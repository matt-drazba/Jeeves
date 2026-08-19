# Pool pad subpanel — brief

**Status: decision made, parts not bought.** Written 2026-08-17 to be self-contained for
someone with no prior context.

## What prompted this

The IntelliFlo2 pool pump reported **Low Voltage**, **tripped breaker**, and **internal
error** on 2026-08-15. Root cause investigation (full write-up in
[pool_wiring_manual.md](pool_wiring_manual.md) §3.5) found the pump is fed by **two
independent single-pole breakers with no common trip**. When one opened, the pump stayed
energized through the other at ~120V — which is what the drive was reporting. The pump
itself is fine.

Fixing that properly turned into a subpanel question, because GFCI is also required here
and was never installed.

## The existing panel

| | |
|---|---|
| Model | **Square D QO612L100**, Series G1 |
| Capacity | **6 spaces / 12 circuits**, max 6 tandems (all spaces accept them) |
| Rating | 100A main lugs, 120/240V, 1-phase, 3-wire |
| Mains | **Main lugs only — no main breaker in this box** |
| Enclosure | **NEMA Type 1 (indoor-rated)** ⚠ see open questions |
| Fed by | **50A 2-pole breaker** in the main panel |
| Serves | The pool pad only |

## Loads

| Load | Draw |
|---|---|
| IntelliFlo2 VST 3 HP, max RPM | ~2300–2550 W ≈ **10.6 A @ 240V** |
| Polaris PB4-60 booster | ~1.5 kW ≈ **6.3 A @ 240V** |
| R-40 ionizer | Small; 240V, selector on 230 |
| Shelly EM Gen3 | Negligible |
| Pad outlets, pad lights | Small |

Both pumps run together during the nightly sweep window, so peak is **~17 A against a
50 A feed** — ample headroom. The constraint is spaces and breaker type, never amps.

## Decision: replace the load center with Siemens

**Two GFCI breakers are required and one of them must tolerate a VFD.**

**NEC 680.21(C)** requires GFCI protection for pool pump motors on single-phase
120–240V branch circuits rated 15 or 20 A, whether by receptacle or direct connection.
That covers **both** pumps. GFCI breakers are full-width only — there is no tandem GFCI.

**Square D's QO GFCI is the wrong breaker for a variable-speed pump.** VFD harmonics leak
enough to ground to trip a 5 mA Class A device, and the QO220GFI is repeatedly named in
that failure. The commonly recommended alternatives are **Siemens** and Pentair's
**PA220GF** — and **neither fits a QO panel.** Breakers are brand-specific, so the brand
choice *is* the fix.

**The Siemens QF220A is marketed by the manufacturer for pool pumps** ("reliable GFCI
protection for replacement Pool Pumps") and costs **less** than the Square D part it
replaces.

### The cost argument is what makes this decisive

Prices vary widely by source — check eBay and electrical suppliers, not just big-box.

| Path | Rough cost |
|---|---|
| **Stay on QO:** 2 × QO220GFI + 2 tandems | **~$250–290**, with a known nuisance-trip risk and zero spare spaces |
| **Go Siemens:** 12-space load center + 2 × QF220A + 2 tandems | **~$280–350**, works as intended, spare spaces |

Two QO GFCI breakers alone cost about the same as an entire Siemens panel plus its
breakers. **Paying more for the part with the documented defect is the worse deal.**

### Proposed layout

| Spaces | Circuit |
|---|---|
| 2 | Main pump — 2-pole 20 A GFCI (Siemens QF220A) |
| 2 | Booster — 2-pole 20 A GFCI (Siemens QF220A) |
| 1 | Tandem — Shelly EM + spare |
| 1 | Tandem — pad outlets + pad lights |
| — | Use a **GFCI receptacle** at the pad rather than spending a breaker on the outlet |

A 12-space panel leaves genuine spare capacity. Note that **none of the planned pad
additions need a breaker** — the flow meter, pressure transducer and valve sensors all
run on low voltage off the existing buck converter, the ESP's 12 V adapter, or batteries.
So spare spaces are insurance, not a requirement.

### The R-40 stays where it is

**Corrected 2026-08-17.** An earlier draft recommended moving the R-40 onto its own
circuit and switching it to 120 V. That was asserted without an argument and is withdrawn.

The R-40 is wired to the same conductors as the pump. The **only** legitimate concern is
that its conductors are protected by a breaker sized for the pump. **That matters only if
its wire is smaller than 12 AWG.** If it is 12 AWG, nothing is wrong and it should not be
touched. Measure before proposing any change.

Its internal 115/230 selector is confirmed correctly set to **230** on a 240 V feed, so
the silent-half-output failure described in
[pool_data_addendum.md](pool_data_addendum.md) is ruled out.

## Open questions

1. **⚠ Where is this panel physically?** The QO612L100 is **NEMA Type 1, indoor-rated.**
   If it is mounted outdoors at the pad, that is wrong independent of everything else and
   forces a **NEMA 3R** enclosure. This single answer may decide the whole thing.
2. **What gauge is the wire to the R-40?** Decides whether it needs anything at all.
3. **What gauge is the wire to the pump?** Confirms 20 A was the right size. Printed on
   the insulation.
4. **What is currently in all 6 spaces?** Needed to plan the transfer.
5. **Will the GFCI hold?** Even Siemens can nuisance-trip on a VFD. Commission the pump
   circuit on its own and watch it before assuming the job is done.
6. **Watch the R-40 on GFCI specifically.** It deliberately passes current into pool
   water. If it trips the GFCI, treat that as **possibly genuine leakage**, not nuisance —
   that is exactly what the device exists to detect.

## What this does not settle

**Why the original breaker tripped is still unresolved.** Best remaining theory: the pump
was on one half of a **tandem**, and both halves of a QO tandem share a single bus stab.
A ~10.6 A continuous motor load plus whatever shared that stab concentrates heat at one
contact, tripping the breaker below its rating. Consistent with every observation,
including that moving it to a different position stopped it.

Tandems are permitted in all six spaces of a QO612, so "wrong breaker for the slot" is
ruled out. Inspect the old stab for browning or pitting when the panel comes out — that
would confirm it.

**The owner has declined to force a max-RPM backwash to reproduce the fault**, which is
reasonable: the two-pole breaker makes the root cause far less urgent, since a common trip
turns any future trip into a clean stop rather than a half-voltage fault.

## Related open item on the same visit

**The FPH heat exchanger is not bonded** — [pool_wiring_manual.md](pool_wiring_manual.md)
Part 7, spec at lines 624–644. Unrelated cause, same pad, should be done at the same time.

## Sources

- [NEC 680.21(C) GFCI for pool pump motors — EC&M](https://www.ecmweb.com/national-electrical-code/qa/article/20900028/stumped-by-the-code-nec-requirements-for-gfci-protection-of-swimming-pool-pump-motors)
- [Siemens QF220A — pool pump GFCI](https://gfiwarehouse.com/siemens-qf220a)
- [VS pump GFCI nuisance tripping — Trouble Free Pool](https://www.troublefreepool.com/threads/here-we-go-again-variable-speed-pump-and-gfci-breaker-tripping-again.144662/)
- [QO612L100RB spec — Schneider Electric](https://www.se.com/us/en/product/QO612L100RB/load-center-qo-1-phase-6-spaces-12-circuits-100a-fixed-main-lugs-nema3r/)
- [Amp draw on 3 HP IntelliFlo at various RPMs — Trouble Free Pool](https://www.troublefreepool.com/threads/amp-draw-on-3hp-pentair-intelliflo-at-various-rpms.180418/)
