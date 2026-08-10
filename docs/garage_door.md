# Garage Door — ratgdo32

Last updated: 2026-08-10. Authority order: CLAUDE.md → this doc → the automations.
Companion doc: [alerting_levels.md](alerting_levels.md).

Implementation lives in `homeassistant/packages/jeeves_garage.yaml`.

---

## Hardware

| | |
|---|---|
| Board | ratgdo32 (non-DISCO, ESP32-D0WD-V3), ESPHome firmware |
| IP | `192.168.0.230` — web UI at `http://192.168.0.230` |
| mDNS | `ratgdo32-d961e8.local` · **`ratgdo.local` never resolves** |
| HA link | ESPHome API, port 6053, noise encryption off, auto-discovered |
| Opener protocol | **Security+ 1.0**, ratgdo emulating the wall panel |

Confirmed wired and talking on 2026-08-10 by watching the device's own event stream:
it is putting the wall-panel polling bytes `38 / 39 / 3A` on the bus and getting
`Light state` and `Lock state` back. (An earlier note had it sitting on the bench with
"looking for security+ 1.0 wall panel" in the log — that is stale.)

### Sensor status

| Entity | Status | Used for |
|---|---|---|
| `cover.garage_door` | **Verified live** | Everything. The primary signal. |
| `binary_sensor.garage_obstruction` | **Verified working 2026-08-10** | Explaining *why* a close failed, and not driving the door into an already-blocked beam. |
| `binary_sensor Motion` | **Tested 2026-08-10 — does not report** | Nothing. |

**The obstruction sensor works.** Proven on 2026-08-10 by streaming the device's own
event feed while a hand was waved through the photo-eye beam: `OFF → ON → OFF → ON →
OFF`, two clean transitions.

An earlier revision of this doc called that wire "possibly never landed" and refused to
use the sensor. **That was wrong, and the mistake is worth keeping written down:** a
static read of `OFF` is exactly what a correctly wired, unobstructed sensor reports.
*"Working"* and *"disconnected"* are indistinguishable at rest. The only way to tell is
to make the thing it measures actually happen and watch the value change — which costs
about ten seconds.

**Motion does not work — and that is measured, not assumed.** Tested 2026-08-10 with
the same 120-second capture that proved obstruction, someone walking back and forth
under the opener: **zero transitions, one sample, `OFF`.** The obstruction run over the
identical window produced 5 samples and 2 transitions, so the capture pipeline works and
a flat line is a result rather than missing data.

That matches the expected cause — Security+ 1.0 motion comes from a motion-equipped wall
panel, and ratgdo is *replacing* the panel rather than listening to one, so nothing
sources it. **Do not build "door open but nobody's in there" logic.**

The test, for re-running after any firmware or wiring change:

```bash
curl -s --max-time 120 -N http://192.168.0.230/events | grep -a --line-buffered "binary_sensor-motion"
```

Walk under the opener while it runs. Swap `motion` for `obstruction` to check the beam.

The door state stays the primary signal regardless. A reversal shows up as the door
starting to close and never reaching `closed`, which is true whether or not the beam
sensor agrees.

### Safety note

**There is no audible warning before the door moves on auto-close.** Security+ 1.0
through ratgdo does not trigger the opener's beeper. The opener's floor-level
photo-eyes still reverse the door on anything in the way — those are code-required and
completely independent of ratgdo — but the only warning a *person* gets is the push
notification sent ten minutes earlier.

---

## What runs

### Overnight: warn, snooze, close

1. Door open five minutes past **9:15pm** → push: *"Garage is still open. Closing it
   in 10 minutes."* Two buttons — **Leave it open 1 hour** and **Close it now**.
2. Ten minutes pass, or *Close it now* is tapped → `script.garage_close_verified`
   commands the close, waits 60s for `closed`, retries once, waits again.
3. Confirmed closed → informational push naming the time. **No open-alert flag** — the
   automation fixed the problem, and a flag would make the dashboard's alert count lie.
4. Not confirmed after two tries → **L1**.

Closing by hand while the warning is up ends the sequence silently.

**Snooze is a `timer`, not an `input_boolean`, on purpose.** It expires on its own and
re-arms the whole sequence when it does. `input_boolean.pool_maintenance` was deleted
on 2026-08-08 for exactly the failure an `input_boolean` would reproduce here: a mute
that waits to be remembered and silently switches off the thing protecting you.

### Overnight: unexplained opening → L1

The door leaves `closed` between **10pm and 6am** without HA commanding it.

The only suppression is `timer.garage_expected_open`, set by a `call_service` listener
whenever HA, Siri, the Home app, CarPlay, or the dashboard asks the door to open. It
listens for the **service call**, not the state change, because the call event fires
before the ESPHome round trip — doing it the other way round is a race that loses.

**A car remote and a keypad are invisible to HA and will trip this.** Accepted
deliberately on 2026-08-10: nobody in this house opens the garage in that window, which
is exactly what makes the alert meaningful. The window is narrower than the 9:15pm
auto-close window because 9:15–10pm is still ordinary evening activity.

Both alerts can be live at once, and that is correct — an intrusion alert screams while
the auto-close shuts the door.

### Daytime: open too long → L2

Open for 15 minutes between 6am and 9:15pm. Repeats every 15 minutes for an hour, then
falls back to the 7am re-raise.

**This never moves the door.** Closing one on someone unloading a truck is the
"manual control is not a fault" trap. The overnight rule is allowed to act because at
11pm an open door is almost certainly a mistake; at 2pm it is almost certainly a person.

The 15-minute threshold is high-signal *only because of how this garage is used* — the
door is open while a car is coming or going and not otherwise (owner, 2026-08-10). In a
house where it gets propped open for yard work this would be pure nuisance.

### Controller offline → L3

`cover.garage_door` unavailable for 30 minutes. Every rule above stops protecting
anything the moment that happens, and a dead ratgdo looks exactly like a closed garage.

The `has_value()` guard on the base detector is what routes a rebooting ESP here rather
than to the open alerts. Getting that backwards would command a close against a dead
device, fail to verify it, and fire an L1 at 3am because the Wi-Fi blipped.

---

## Levels and why

| Alert | Level | Delivery |
|---|---|---|
| Unexplained opening 10pm–6am | **L1** | Critical alert every 5 min, up to 12, until acknowledged · 7am backstop |
| Auto-close could not be confirmed | **L1** | Critical alert every 5 min while still open, up to 12 · 7am backstop |
| Open >15 min during the day | **L2** | Push, repeating every 15 min ×4 · 7am re-raise |
| Controller offline >30 min | **L3** | Push · 9:15pm re-raise |

Both L1s are **"the house is not protected"** — the owner's ruling, 2026-08-10. Neither
is destruction in the pool-booster sense, and an earlier draft put the close failure at
L2 for that reason. That was wrong: an open house at 3am does not improve on its own,
only a person can fix it, and both messages name the physical action, which is the
actual L1 bar.

**L1 budget: these should fire zero times a year.** If the night-open alert starts
firing for legitimate arrivals, the fix is to narrow the window or add a suppression —
not to demote it, and not to learn to ignore it. A noisy L1 is a bug in
[alerting_levels.md](alerting_levels.md).

The critical-alert loops stop when the door reaches `closed` (the house is secure, stop
screaming) but the open-alert **flag** stays set until Acknowledge. Those are two
different questions, and the flag is what puts it in front of you at breakfast.

---

## Siri

Both paths are set up, because they do different jobs.

### Apple Home — status, CarPlay, and opening

Settings → Devices & Services → **HomeKit Bridge** → Configure → include
`cover.garage_door`. Rename it in the Apple Home app to **Garage Door**.

Apple only exposes a cover as a real GarageDoorOpener if its device class is `garage`.
Check Settings → Entities → the door cover → **Show as** → *Garage*. UI toggle, no YAML.

- "Hey Siri, open the garage door" — **expect a confirmation prompt.** That is Apple's
  rule for garage doors and locks, not a misconfiguration, and it cannot be turned off.
- "Hey Siri, is the garage door open?" — works.
- Appears in the Home app, on the Watch, and in CarPlay in the driveway.

### iOS Shortcut — closing without the confirmation tap

`script.garage_close` → an iOS Shortcut using the Home Assistant → **Run Script**
action. Phrase: **"garage down"**.

Per the Tesla lesson in CLAUDE.md, avoid a phrase containing "close the garage door" —
Apple Home claims it, and you get the Home app behaviour instead of the Shortcut.

Known gotcha, same as the Tesla scripts: if *Run Script* shows **"no options
available"**, quit and relaunch the HA Companion app.

### Gotcha: "Siri opens it an inch and it stops"

**The garage door was added to the HomeKit Bridge twice** (2026-08-10). Two accessories
means two commands per request, and a garage button is a *toggle* — first press starts
the door, second press stops it. An inch of travel is exactly what start-then-stop looks
like.

Fix: HomeKit Bridge → Configure → untick the garage door → Submit → restart HA →
Configure → tick it once → Submit.

Symptom in the logbook: the HomeKit-attributed open reaches `open` in **1 second**, where
a genuine full open takes ~13.

```bash
cd ~/homelab && curl -s -H "Authorization: Bearer $(grep '^HA_TOKEN=' .env | cut -d= -f2-)" "http://localhost:8123/api/logbook?entity=cover.garage_door" | python3 -c "import sys,json;[print(e.get('when','')[11:19], e.get('state'), '|', e.get('context_name') or 'no context') for e in json.load(sys.stdin)[-15:]]"
```

Note the `when` field is **UTC**. Also worth knowing: `[ratgdo:984]: Cancelling position
callbacks` in the device log looks like a smoking gun for position-control misbehaviour
and is **not** — it appears during normal operation. It sent this diagnosis down a wrong
path for a while.

---

`script.garage_close` is a **plain, unverified close** on purpose. Saying it out loud
means you are standing there watching, so a reversal is something you can see; routing
it through `garage_close_verified` would fire a critical alert while you are looking
straight at the problem. If it fails and you drive off anyway, the daytime and
overnight watchdogs still catch it.

---

## Runbook

| Alert | What it means | What to do |
|---|---|---|
| **GARAGE OPENED AT hh:mm** | The door left `closed` overnight and HA did not command it | Do not walk out blind. Account for everyone in the house; call 911 if you cannot. Close it from your phone once clear. If it was a legitimate remote or keypad use, acknowledge and consider narrowing the window. |
| **GARAGE WILL NOT CLOSE** | Two close commands sent, neither confirmed | **Read the message — it tells you which problem it is.** "THE SAFETY BEAM IS BLOCKED" → go clear the doorway. "The safety beam is CLEAR" → it is not something in the way; look at the opener, the door track, or the photo-eye alignment. Either way the house is open until you close it by hand. |
| **Garage has been open N minutes** | Open >15 min during the day | Close it, or confirm someone is out there. Acknowledge to stop the repeats. |
| **Garage controller offline** | ratgdo silent 30 min | `http://192.168.0.230`. If unreachable, power-cycle it. Red LED is a hardwired power indicator, not an error — blue is status. Nothing is watching the garage until it returns, including the overnight close. |

Acknowledge from the phone notification, or from the alert overlay on the kitchen
tablet — both call `input_boolean.turn_off` on the same flag.

---

## Verification

After any change to `jeeves_garage.yaml`:

```bash
cd ~/homelab && git pull && docker compose restart homeassistant
python3 scripts/verify-alerts.py
```

`check_config` passing proves nothing about whether the entities exist. As of
2026-08-10 `verify-alerts.py` scans **every** file in `homeassistant/packages/`, not
just `jeeves_alerts.yaml` — scanning one hardcoded file was itself an instance of the
blind spot the script exists to close.

The **close-failed** path is the one that cannot be tested without physically jamming
the door. Its command → verify → retry → escalate structure is copied from
`jeeves_booster_dry_run_kill`, which has been exercised. That is the honest extent of
the assurance; it has not been proven on this hardware.
