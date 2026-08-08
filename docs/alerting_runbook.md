# Alerting Runbook — what to do when your phone goes off

Last updated: 2026-08-08. This is the **operator manual**. For *why* the levels
are what they are, see [alerting_levels.md](alerting_levels.md). Implementation
is `homeassistant/packages/jeeves_alerts.yaml`.

Every command below runs **on the Pi**, from `~/homelab`.

---

## If your phone is alarming right now

**Full volume, through silent mode, repeating every 5 minutes** — that is the
only Level 1 alert in the house:

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

Everything else in the house is quiet by design and can wait for morning.

---

## Live alerts and what each one means

### Level 2 — deal with it in the morning

Arrives as a normal push, re-raised at **7:00am** until acknowledged.

| Alert | What happened | What to do |
|---|---|---|
| **"Pool sweep shut off — booster was running dry"** | Booster was on with no pump; HA killed the switch and confirmed it. The pump is safe. | Find out why the main pump wasn't running before sweeping again. |
| **"Pool pump is off"** | Under 20 W for 15 min during the 9pm–4pm run window. | Check the breaker and the pump. No filtration or heat recovery until it's back. |

### Level 3 — handle it when you get home

Arrives as a normal push, re-raised at **9:15pm** until acknowledged.

| Alert | What happened | What to do |
|---|---|---|
| **"Pool sweep did not run tonight"** | The pump hadn't been running 30 min at 9:45pm, so the sweep was skipped on purpose. | Check the pump schedule. One skipped night is cosmetic. |
| **"Pool pad node offline"** | The ESP hasn't reported in 30 min. | Power-cycle it. HX temps, flow and BTU are dark until it's back. |
| **"Pool pump meter offline"** | The Shelly EM hasn't reported in 30 min. | Power-cycle it. **The sweep will not run** while it's down — the booster kill fails closed. |
| **"Heat exchanger is not transferring heat"** | Heat recovery is calling but the outlet is no warmer than the inlet. | Check the FPH pump and the pad valves. |

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

See everything currently open:

```bash
cd ~/homelab && curl -s -H "Authorization: Bearer $(grep '^HA_TOKEN=' .env | cut -d= -f2-)" http://localhost:8123/api/states | python3 -c "import sys,json; [print(e['entity_id'], '=', e['state']) for e in json.load(sys.stdin) if 'alert_open' in e['entity_id']]"
```

---

## Maintenance mode

Turn this on **before backwashing or working on the pad**, or the routine work
fires alerts.

```bash
cd ~/homelab && curl -s -X POST -H "Authorization: Bearer $(grep '^HA_TOKEN=' .env | cut -d= -f2-)" -H "Content-Type: application/json" -d '{"entity_id":"input_boolean.pool_maintenance"}' http://localhost:8123/api/services/input_boolean/turn_on
```

Swap `turn_on` for `turn_off` when you're done. **Remember to turn it off** —
nothing turns it off for you, and while it's on you are running unmonitored.

What it does and does not do:

| | |
|---|---|
| Suppresses | All L2 and L3 alerts, and both re-raises |
| Suppresses | The 2-hour sweep runtime cap — for a long manual session at the pad |
| Does **not** suppress | The Level 1 booster alarm |
| Does **not** prevent | The booster kill itself from firing |

**You do not need maintenance mode to run the Polaris by hand.** Press the Tuya
button whenever you like, or set a countdown in the app as usual. HA shuts it off
only if it is still running after 2 hours. Maintenance mode is only for running
it *longer* than that. This changed 2026-08-08 — the old window guard killed any
manual run within 15 minutes, which made the switch look broken.

Muting nuisance alerts is fine. Disabling protection against destruction is not.

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

**To run the Polaris manually:** turn on maintenance mode first, or the
outside-window guard shuts it off within 15 minutes.

---

## Deploying a change

Alerts live in the repo and deploy by `git pull`:

```bash
cd ~/homelab && git pull && docker exec homeassistant python -m homeassistant --script check_config -c /config && docker restart homeassistant && sleep 45 && python3 scripts/verify-alerts.py
```

**`check_config` passing does not mean it works.** It validates syntax, not
whether entities were created or an automation can fire. `verify-alerts.py` is
the real gate — it checks every entity, automation id, and notify service the
package references against what HA actually has. Want `PASS`.

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
design); is maintenance mode stuck on.

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
