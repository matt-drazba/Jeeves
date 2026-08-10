# Alerting Runbook — what to do when your phone goes off

Last updated: 2026-08-10. This is the **operator manual**. For *why* the levels
are what they are, see [alerting_levels.md](alerting_levels.md). Implementation
is `homeassistant/packages/jeeves_alerts.yaml` and
`homeassistant/packages/jeeves_garage.yaml`. Garage specifics:
[garage_door.md](garage_door.md).

Every command below runs **on the Pi**, from `~/homelab`.

---

## If your phone is alarming right now

**Full volume, through silent mode, repeating every 5 minutes.** There are three
Level 1 alerts in the house. Read the title:

### "POOL BOOSTER RUNNING DRY"

**Do this: go kill the breaker for the sweep circuit.** Right now, before
diagnosing anything.

HA detected the booster running with no water, told the Tuya switch to shut off,
retried, and confirmed the switch is *still on*. The pump is destroying its own
seal and impeller — that takes minutes, not hours. HA has run out of ways to stop
it, which is why it woke you.

Then, once the breaker is off:

1. Find out why the main pump wasn't running — tripped breaker, lost prime, a
   closed valve, or the pump itself.
2. Fix that before restoring the sweep breaker.
3. Acknowledge the alert to stop the repeats.

### "GARAGE OPENED AT hh:mm"

**Do this: do not walk out there blind.** The garage door opened between 10pm and
6am and HA did not command it — not Siri, not the app, not the dashboard.

1. Account for everyone in the house first.
2. If you cannot, call 911. Do not go and look.
3. Once you know it's clear, close it from your phone.
4. Acknowledge to stop the repeats.

A car remote and a keypad are invisible to HA and look identical to a stranger
from here. If it was one of yours, acknowledge and consider narrowing the window
— but do **not** demote this alert. Nobody in this house opens the garage in
those hours, which is the entire reason it means anything.

### "GARAGE WILL NOT CLOSE"

**Do this: go clear the doorway, then close it by hand or with the wall button.**

HA tried twice to close the garage and could not confirm it reached closed. The
overwhelmingly likely cause is something breaking the opener's safety beam and
driving the door back open. The house is open until someone fixes it.

If the doorway is visibly clear, check the photo-eye alignment at floor level —
a knocked sensor produces exactly the same symptom.

**Everything else in the house is quiet by design and can wait for morning.**

---

## Live alerts and what each one means

### Level 2 — deal with it in the morning

Arrives as a normal push, re-raised at **7:00am** until acknowledged.

| Alert | What happened | What to do |
|---|---|---|
| **"Pool sweep shut off — booster was running dry"** | Booster was on with no pump; HA killed the switch and confirmed it. The pump is safe. | Find out why the main pump wasn't running before sweeping again. |
| **"Pool pump is off"** | Under 20 W for 15 min during the 9pm–4pm run window. | Check the breaker and the pump. No filtration or heat recovery until it's back. |
| **"Garage has been open N minutes"** | Open >15 min between 6am and 9:15pm. Repeats every 15 min, four times. | Close it, or confirm someone is out there using it. HA will never close it during the day on purpose. |

### Level 3 — handle it when you get home

Arrives as a normal push, re-raised at **9:15pm** until acknowledged.

| Alert | What happened | What to do |
|---|---|---|
| **"Pool sweep did not run tonight"** | The pump hadn't been running 30 min at 9:45pm, so the sweep was skipped on purpose. | Check the pump schedule. One skipped night is cosmetic. |
| **"Pool pad node offline"** | The ESP hasn't reported in 30 min. | Power-cycle it. HX temps, flow and BTU are dark until it's back. |
| **"Pool pump meter offline"** | The Shelly EM hasn't reported in 30 min. | Power-cycle it. **The sweep will not run** while it's down — the booster kill fails closed. |
| **"Heat exchanger is not transferring heat"** | Heat recovery is calling but the outlet is no warmer than the inlet. | Check the FPH pump and the pad valves. |
| **"Garage controller offline"** | The ratgdo hasn't reported in 30 min. | `http://192.168.0.230`, then power-cycle. **Nothing is watching the garage** until it's back — no overnight close, no left-open warning, no intrusion alert. Red LED is a power indicator, not an error. |

---

## Acknowledging

**Long-press the notification and tap Acknowledge.** That stops the repeats and
the re-raises.

Acknowledgement clears **only** by that button — never automatically on recovery.
That is deliberate: a pump that trips at 2am and recovers by 4am still surfaces
at breakfast, because a fault that fixed itself is still a fault you should know
about.

If you lost the notification, clear the flag directly:

```bash
cd ~/homelab && curl -s -X POST -H "Authorization: Bearer $(grep '^HA_TOKEN=' .env | cut -d= -f2-)" -H "Content-Type: application/json" -d '{"entity_id":"input_boolean.alert_open_pump_off"}' http://localhost:8123/api/services/input_boolean/turn_off
```

The flags, one per alert:

| Alert | Flag |
|---|---|
| Booster kill failed (L1) | `input_boolean.alert_open_booster_kill_failed` |
| Booster dry run (L2) | `input_boolean.alert_open_booster_dry_run` |
| Pump off (L2) | `input_boolean.alert_open_pump_off` |
| Sweep didn't run (L3) | `input_boolean.alert_open_sweep_skipped` |
| Pad node offline (L3) | `input_boolean.alert_open_pad_offline` |
| Pump meter offline (L3) | `input_boolean.alert_open_meter_offline` |
| HX not transferring (L3) | `input_boolean.alert_open_hx_no_transfer` |
| Garage opened overnight (L1) | `input_boolean.alert_open_garage_night_open` |
| Garage would not close (L1) | `input_boolean.alert_open_garage_close_failed` |
| Garage left open (L2) | `input_boolean.alert_open_garage_open_daytime` |
| Garage controller offline (L3) | `input_boolean.alert_open_garage_node_offline` |

See everything currently open:

```bash
cd ~/homelab && curl -s -H "Authorization: Bearer $(grep '^HA_TOKEN=' .env | cut -d= -f2-)" http://localhost:8123/api/states | python3 -c "import sys,json; [print(e['entity_id'], '=', e['state']) for e in json.load(sys.stdin) if 'alert_open' in e['entity_id']]"
```

---

## Maintenance mode — removed

There is no maintenance mode. `input_boolean.pool_maintenance` was deleted
2026-08-08 along with every condition that referenced it. **Alerts always fire.**

It was a global mute for L2–L4 that nothing ever turned off. That made its
failure mode silent and open-ended: flip it before a backwash, get distracted,
and the pool is unmonitored for days with no indication anywhere that alerting
is off. A safety system you can accidentally leave disabled is worse than one
that occasionally annoys you.

**You do not need it to run the Polaris by hand.** Press the Tuya button whenever
you like, or set a countdown in the app as usual. HA only intervenes if the sweep
is still running after 2 hours.

If servicing does turn out to generate real nuisance alerts, the fix is a mute
that **expires on its own** — a timer you cannot forget to cancel — not one that
waits to be remembered. Do not reintroduce the old behaviour.

---

## The sweep schedule

| | |
|---|---|
| Window | 9:45pm – 11:15pm daily |
| Switch | `switch.pool_sweep_socket_1` |
| Condition to start | Main pump drawing >20 W continuously for ≥30 min |
| Manual runs | Allowed at any hour, capped at 2 hours |
| Tuya app schedule | **Deleted 2026-08-08. Never re-add one.** |

A manual press is not a fault and is not treated as one. The only thing standing
between a hand-started sweep and a dry booster is the dry-run kill — which is
exactly the right protection, fires within 30 seconds, and is never suppressed.
Note the pump is off 4pm–9pm, so a sweep started then will be killed by that
interlock within about half a minute. That is the protection working, not a bug.

HA is the only thing that commands that switch. That is what makes the interlock
safe — if HA, the network, or the Tuya cloud fails, the booster simply never
runs. Dirty pool, healthy pump. A schedule living in the Tuya app could start the
booster with no idea whether the main pump is on.

**To run the Polaris manually:** just turn it on. Any hour, any method — the Tuya
button, an app countdown, an inline timer. HA only steps in at the 2-hour cap.

---

## Deploying a change

Alerts live in the repo and deploy by `git pull`:

```bash
cd ~/homelab && git pull && docker exec homeassistant python -m homeassistant --script check_config -c /config && docker restart homeassistant && sleep 45 && python3 scripts/verify-alerts.py
```

**`check_config` passing does not mean it works.** It validates syntax, not
whether entities were created or an automation can fire. `verify-alerts.py` is
the real gate — it checks every entity, automation id, and notify service the
packages reference against what HA actually has. Want `PASS`.

As of 2026-08-10 it scans **every** `.yaml` under `homeassistant/packages/`, not
just `jeeves_alerts.yaml`. Scanning one hardcoded file was itself an instance of
the blind spot the script exists to close — a second package could have shipped
pointing at an entity that was never registered and this would still have printed
`PASS`. Full-line comments are stripped before scanning, so prose is free to name
entities that were deliberately deleted.

Changes under `jeeves/` need a rebuild instead — `docker restart` will not pick
them up:

```bash
cd ~/homelab && docker compose up -d --build jeeves
```

---

## Troubleshooting

**No notifications at all.** Check the notify service still exists — it changes
if the phone is re-registered:

```bash
cd ~/homelab && curl -s -H "Authorization: Bearer $(grep '^HA_TOKEN=' .env | cut -d= -f2-)" http://localhost:8123/api/services | python3 -c "import sys,json; print('\n'.join(sorted('notify.'+s for d in json.load(sys.stdin) if d['domain']=='notify' for s in d['services'])))"
```

**Notifications arrive but Level 1 doesn't break through silent mode.** The iOS
permission was revoked. iPhone **Settings → Notifications → Home Assistant →
Critical Alerts**. This lives in iOS's settings, not the HA app's.

**An alert fires constantly.** It is misclassified or the underlying fault needs
fixing rather than announcing. L1 has a budget of ~6 firings a year; a noisy one
is a bug in [alerting_levels.md](alerting_levels.md), not a fact about the house.

**The sweep isn't running.** In order: is the pump running >20 W for 30 min
before 9:45pm; is the Shelly meter online (a dead meter blocks the sweep by
design).

**An automation seems dead.** Run `verify-alerts.py`. The classic cause is an
entity_id that never existed — HA derives a template entity's id from its `name`,
not its `unique_id`, and only at first registration, so renaming later does not
move it.

---

## Testing without waiting for a real fault

**Send a Level 1 alarm** (phone on silent — it should ring anyway):

```bash
cd ~/homelab && curl -s -X POST -H "Authorization: Bearer $(grep '^HA_TOKEN=' .env | cut -d= -f2-)" -H "Content-Type: application/json" -d '{"title":"TEST","message":"Critical alert test","tag":"test","ack_action":"ACK_PUMP_OFF"}' http://localhost:8123/api/services/script/critical_alert
```

**Send a normal (L2/L3) push:** same command with `script/normal_alert`.

**Confirm every reference resolves:** `python3 scripts/verify-alerts.py`

**Confirm heat logging is writing:**

```bash
cd ~/homelab && docker exec jeeves node -e "const db=require('better-sqlite3')('/data/jeeves.db');const r=db.prepare('SELECT COUNT(*) n, MAX(recorded_at) last FROM pool_heat_samples').get();console.log(r.n,'rows, last',r.last?new Date(r.last*1000).toLocaleString():'never')"
```

Testing the booster kill for real means stopping the main pump with the sweep on,
which is the exact damage scenario. Don't. The kill path was verified by
triggering the automation directly on 2026-08-07.

### Garage

Most of it tests for real, cheaply — just open the door and wait.

| Test | How | Expect |
|---|---|---|
| Daytime watchdog | Open it at midday, leave it | Push at 15 min, again at 30/45/60 |
| Night warning + snooze | Open it at ~9:20pm, wait 5 min | Warning push; tap **Leave it open 1 hour**; nothing moves; warning returns ~60 min later |
| Night auto-close | Same, but ignore the push | Door closes at +10 min, confirmation push naming the time |
| Closed by hand mid-warning | Same, but close it yourself | Silence — no confirmation, no alert |
| Controller offline | Unplug the ratgdo, wait 35 min | L3 push |

**The overnight intrusion L1 is the one to test carefully.** Do not open the door
with a remote at 11pm just to see it fire, unless you want the critical alert.
Test the *plumbing* instead by firing the script directly, as with the pool L1
above, using `ack_action` of `ACK_GARAGE_NIGHT_OPEN`.

To confirm the suppression works, open the door via Siri or the Home app during
the window and check the latch caught it:

```bash
cd ~/homelab && curl -s -H "Authorization: Bearer $(grep '^HA_TOKEN=' .env | cut -d= -f2-)" http://localhost:8123/api/states/timer.garage_expected_open | python3 -c "import sys,json; print(json.load(sys.stdin)['state'])"
```

`active` right after the command means an HA-initiated open will not alert.
`idle` means it will — check that the service call carried `entity_id` rather
than an area or device target.

**"Garage will not close" cannot be tested without jamming the door.** Its
command → verify → retry → escalate structure is copied from the booster kill,
which has been exercised. That is the honest extent of the assurance.
