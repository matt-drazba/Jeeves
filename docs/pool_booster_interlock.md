# Pool Booster Pump — Dry-Run Interlock (Polaris PB4-60)

Last updated: 2026-08-05. Authority order: CLAUDE.md → this doc → coder briefs.
Companion docs: [pool_heat_recovery.md](pool_heat_recovery.md) (main pump, FPH, IntelliComm), [pool_wiring_manual.md](pool_wiring_manual.md) (as-built wiring, bonding).

**Status: DESIGN. No new hardware required — waiting on the flow meter already on order for the pad node.**

## The unit

| Item | Value | Source |
|---|---|---|
| Booster pump | **Polaris PB4-60**, pressure-side cleaner booster | Owner confirmed |
| Horsepower | 3/4 HP | Manual |
| Electrical | 230/115V, 60Hz, 1-phase — **6.4A @ 230V / 12.8A @ 115V** | Manual |
| Fusing | 15A @ 230V / 20A @ 115V | Manual |
| Min outlet pressure | 45 psi | Manual |
| Self-priming | **No** | Manual |
| Dry-run protection | **None** | Manual |
| Current control | Tuya 240V "pool sweep timer" switch, cloud-scheduled | CLAUDE.md |
| Bonding | Bonded to pad loop | pool_wiring_manual.md |

## What the manual actually requires

Direct quotes from the PB4-60 installation and operation manual:

- "The pump is not self-priming and should only be used when the pool filtration pump is on."
- "Running the booster pump without a filtration pump will damage the booster pump."
- **"Set it to turn the pump on at least half an hour after the pool filtration pump is turned on, and turn the pump off at least half an hour before the filtration pump shuts off."**
- "Never run the booster pump without water. Running the pump 'dry' for any length of time can cause severe damage to both the pump and motor and will void the warranty."
- "Never run the booster pump without the cleaner connected. Running the pump without the cleaner connected will cause damage to the pump impeller."
- "Periodically check the time clock settings to make sure they are properly synchronized."

**The 30 minutes is a manufacturer spec, not installer convention, and it applies at BOTH ends.** An earlier draft of this doc guessed it was convention — that was wrong.

Note the separate impeller hazard: running with the cleaner *detached* damages the impeller even with full water flow. Relevant any time the Polaris is pulled for winter or repair — the booster must be positively disabled, not just left on its schedule.

## Failure mode

The seal is water-lubricated and water-cooled. Run dry and the seal faces overheat within minutes; the usual result is a melted plastic lip on the impeller around the seal's porcelain face, meaning **impeller plus seal**, not just seal. Water then passes the failed seal into the bearing and motor.

**A dry-running centrifugal pump draws LESS current than a loaded one** — no water to move means a nearly unloaded motor. The breaker will not trip, the thermal overload will not trip, and any "alert on high amps" rule looks healthy right up until the pump is dead. Any monitoring here must alarm on **watts too low while commanded on**, which is inverted from every other appliance in this house.

## The plan (no new hardware)

Three pieces, in order:

### 1. Wait for the flow meter

The DN50 flow meter already on order for the pad node ([esphome/pool-pad.yaml](../esphome/pool-pad.yaml), `sensor.pool_pad_pool_flow_gpm`) is the flow proof. Nothing here starts until it's installed and calibrated against the Blue-White gauge at 2200 RPM.

Real measured flow beats any proxy. It catches the cases a "is the main pump on?" signal cannot: clogged basket, closed valve, lost prime, loaded filter, or the variable-speed pump running too slow to feed the booster.

### 2. Move the sweep timer off Tuya cloud scheduling into HA

Two required steps, and the second is the one that makes this safe:

1. Recreate the sweep schedule as an HA automation.
2. **Delete the schedule from the Tuya app.** The Tuya switch must become a dumb relay that only ever acts on command from HA.

Without step 2 the Tuya device can still turn the booster on by itself while HA is down or unreachable — which is the exact failure being engineered away. With step 2, every failure mode (HA down, network down, Tuya cloud down, Pi down) degrades to *the booster never runs*. Dirty pool, healthy pump. That is fail-safe.

### 3. HA gates the booster on flow and time

**Turn-on conditions — all must hold:**
- `sensor.pool_pad_pool_flow_gpm` above the minimum that supports the booster, sustained
- that flow sustained for **≥ 30 minutes** (manual spec)
- within the scheduled sweep window

**Turn-off conditions — any one fires, immediately:**
- flow drops below minimum
- main pump stops
- **30 minutes before the main pump's scheduled stop** (manual spec — the other half of the requirement)
- flow sensor goes unavailable or stale (unknown flow is treated as no flow)

That last one matters: a dead sensor must fail closed, not fail open.

The "30 minutes before the main pump stops" condition requires knowing the stop time in advance. That falls out naturally once HA owns the main pump schedule via the ESP → IntelliComm control in [pool_heat_recovery.md](pool_heat_recovery.md) "Pump control (L4)" stage 2. Until then, the reactive rule (main pump stops → booster off immediately) covers the safety case; the 30-minute pre-stop margin is the part that has to wait.

## Runtime and scheduling

**Main pump schedule: 9pm → 4pm next day.** 3 hrs (9pm–midnight) + 16 hrs (midnight–4pm) = **19 hours on, 5 hours off (4pm–9pm)**.

That off-window is exactly the PG&E peak period, and it is the *unique* optimum: with 19 hours on, the only 5-hour gap that fully covers a 4–9pm peak is 4–9pm itself. The schedule is already peak-optimized — no change wanted.

**Booster: 90 minutes starting 60 minutes after the main pump starts → 10:00pm–11:30pm.** Satisfies ≥30-min-after (60 min) and ≥30-min-before-stop (16.5 hrs of margin) comfortably.

| Parameter | Setting | Basis |
|---|---|---|
| Duration | 90 min/day | Industry guidance clusters at 1–2 hrs/day; 3–4 hrs only for heavy debris. Polaris 280 is specced to clean a typical pool in ~3 hrs or less. |
| Frequency | **Once daily** | Cleaner consumables (tires, backup valve, belts, bearings) wear by runtime; motor starts are the hardest duty on a motor. Splitting into two runs doubles start cycles for no cleaning benefit. |
| Main pump RPM during window | Normal baseline (1750 RPM / 45–50 GPM) | No target to hit. Booster draws ~24 GPM against 140 ft head, and Polaris specs it to run on a VS pump's low-speed setting. Ample margin. |

**Tune downward, not up.** If the pool is clean at 90 min, try 75, then 60. Runtime is wear. Increase only if debris actually accumulates. Expect seasonal variation — more in spring/fall for pollen and leaves, less in winter.

### TOU placement — the booster already avoids peak, but may sit in part-peak

At 6.4A @ 240V the booster is **~1.5 kW**, comparable to the dryer. 90 min/day ≈ 2.25 kWh/day ≈ **68 kWh/month**.

The 10:00pm–11:30pm window never touches the 4–9pm peak — that falls out automatically, since the main pump isn't even running then. Nothing to fix there.

**But it may be sitting in part-peak.** Which rate plan applies is not yet confirmed:

| Plan | Periods | Booster at 10:00–11:30pm |
|---|---|---|
| **EV2-A** | Peak 4–9pm · **Part-peak 3–4pm and 9pm–midnight** · Off-peak midnight–3pm | **Entirely part-peak** |
| E-TOU-C | Peak 4–9pm · Off-peak all other hours | Already off-peak — no change needed |

Two Teslas make EV2-A plausible, but **this has not been verified.** If EV2-A applies, shifting the booster window to **after midnight** (e.g. 12:30am–2:00am) moves all 68 kWh/month from part-peak to off-peak. On roughly a $0.20/kWh differential that is about $10–15/month — approximate, since rates change. The shift costs nothing and still satisfies both manual rules (3.5 hrs after start, 14 hrs before stop).

Ties into the parked "energy rate awareness (time-of-use)" item in CLAUDE.md.

### Cleaner-side tuning — Polaris 280

**The cleaner is tuned by wheel RPM, not by GPM.** Target is **28–32 wheel RPM**.

**How to measure:** with the pump running, hold the cleaner below water level and count wheel revolutions for one minute.

**How to adjust:**

| Symptom | Fix |
|---|---|
| Below 28 RPM | Remove the **blue** restrictor disc from the universal wall fitting (UWF). Then check the quick-disconnect filter screen, hoses/swivels for leaks, gate valve fully open, and skimmer + pump baskets. |
| Above 32 RPM | Install a restrictor disc — **blue** first, **red** to cut flow further. Only after a restrictor is installed, unscrew the pressure relief valve to trim further. |

The pressure relief valve should only be adjusted when a restrictor disc is already installed.

Note the manual's separate warning: **never run the booster with the cleaner disconnected** — that damages the impeller regardless of water flow.

## Known limitations of this approach

Stated plainly so they're decisions, not surprises:

- **HA is in the safety path.** Accepted deliberately, because step 2 above makes every failure fail-safe. This is a different risk posture than the heat-recovery interlock (pure copper, no controller) and that difference is intentional — there, failure risks the FPH and compressor; here, failure risks a dirty pool.
- **Tuya cloud adds latency to the off-command.** Reacting to an unexpected main-pump stop is a cloud round trip. Probably fine against a damage window measured in minutes, but if it proves slow or flaky, **LocalTuya via HACS** puts the switch on the LAN with no new hardware and no cloud in the loop. HACS is already installed. Fall back to this if the cloud round trip disappoints.
- **The flow meter is in the main return line, not the booster feed.** It proves the system has flow, not specifically that the booster's supply line is fed. Good enough — the realistic failure is system-wide loss of flow, not a booster-feed-only blockage.
- **No protection against running with the cleaner detached.** Nothing automatic catches this. Disable the sweep automation manually whenever the Polaris is off the line.

## Open items

- [ ] Install and calibrate the flow meter (prerequisite for everything here)
- [x] ~~Record the cleaner model~~ — **Polaris 280.** Tuning spec captured above (28–32 wheel RPM).
- [x] ~~Confirm main pump start time / peak avoidance~~ — 9pm–4pm, booster 10–11:30pm, never touches 4–9pm peak.
- [ ] **Confirm the PG&E rate plan (EV2-A vs E-TOU-C).** If EV2-A, shift the booster window past midnight to escape part-peak — ~$10–15/month for a free schedule change.
- [ ] Measure Polaris 280 wheel RPM and confirm it lands in 28–32 before tuning anything else
- [x] ~~Determine minimum main-pump GPM to feed the PB4-60~~ — non-issue. Booster draws ~24 GPM against 140 ft head and Polaris specs it to run on a VS pump's low-speed setting; the 45–50 GPM baseline has ample margin. Gate on "flow present," not on a specific GPM target.
- [ ] Recreate the sweep schedule in HA, then delete it from the Tuya app
- [ ] Confirm PB4-60 nameplate voltage as actually wired (230V vs 115V) — affects nothing in this plan, but belongs in the wiring manual
- [ ] Optional: CT on the booster circuit for runtime logging and a watts-too-low dry-run alarm (monitoring only, not required for the interlock)
- [ ] Fall back to LocalTuya (HACS) if cloud latency on the off-command proves unacceptable

## Sources

- [Polaris PB4-60 Pressure Cleaner Booster Pump Instruction Manual (manuals.plus)](https://manuals.plus/polaris/pb4-60-pressure-cleaner-booster-pump-manual)
- [Polaris PB4-60 Installation and Operation Manual (ManualsLib)](https://www.manualslib.com/manual/758368/Polaris-Pb4-60.html)
- [Polaris PB4-60 product page](https://www.polarispool.com/en/products/booster-pumps/polaris-pb4-60)
