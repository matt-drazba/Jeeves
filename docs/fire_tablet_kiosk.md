# Fire HD 8 kiosk setup

Turning the Amazon Fire HD 8 into the kitchen wall display for Jeeves.

**Target: `http://192.168.0.189:3000`** — Jeeves, not Home Assistant. HA is the
backend Jeeves reads from; it is not what goes on the wall. Do not build a
Lovelace wall dashboard. The Jeeves dashboard is already purpose-built for this
tablet (tile grid, calendar, pool page, 15s auto-cycle, self-dimming at night).

## What kiosk mode is

A normal browser is one app among many — URL bar, back button, tabs, and a Home
button that lets you leave. Kiosk mode strips all of that: one app, one URL,
full screen, no way out without a PIN. An airport check-in terminal.

On Fire OS it is three separate problems, which is why it takes a dedicated app
rather than just hiding Silk's toolbar:

| Problem | What Fully Kiosk does |
|---|---|
| Browser chrome | Renders the page truly full-screen |
| User can navigate away | Blocks Home/Back/Recents, locks to one URL, PIN to exit |
| Screen sleeps, device reboots | Keeps display on, launches on boot, auto-reloads on crash |

**Kiosk Mode is a PLUS feature** — so is Remote Administration and motion
detection. PLUS features are unlimited free to try, so the whole setup can be
proven before paying. License is per device, one-time, price shown in the app.

**But the trial is not just a watermark — unlicensed Fully displays the kiosk
PIN on screen as a hint** (observed on this device 2026-08-08). Anyone who
walks up can read it and exit. Until it is licensed the lockdown is decorative,
so treat the license as the thing that makes kiosk mode real, not as a nag
removal.

## Order of operations

Get the basic chain working before adding anything: **Fire → Wi-Fi → Fully →
Jeeves.** Confirm the dashboard renders and the tile/calendar cycle runs.
Only then enable kiosk lockdown, and only then consider the HA integration.

### 1. Install Fully Kiosk

Easiest path is the Amazon Appstore — search "Fully Kiosk Browser". It installs
normally and auto-updates.

If it is not offered on this Fire OS version, sideload:

1. *Settings → Security & Privacy → Apps from Unknown Sources* → enable for Silk
2. Download the APK from `https://www.fully-kiosk.com/` **on the tablet**
3. Open the download to install

Use the official site. Not an APK mirror.

Developer Options are **not** required for any of this — that menu is only for
ADB, which is a separate exercise (see Debloating below).

### 2. Point it at Jeeves

*Settings → Web Content Settings → Start URL* → `http://192.168.0.189:3000`

No login. Jeeves is unauthenticated and LAN-only by design.

Confirm the page loads and cycles between the tile grid and the calendar before
going further.

### 3. Set the Kiosk PIN — before enabling lockdown

*Settings → Other Settings → Kiosk PIN*

**Do this first and write the PIN down.** Enabling kiosk lockdown without a PIN
set locks you out of your own tablet, and the recovery is a factory reset.

Note the PIN is shown on screen as a hint until Fully is licensed — see above.

### 4. Settings

| Section | Setting | Value |
|---|---|---|
| Web Content | Start URL | `http://192.168.0.189:3000` |
| Web Content | Enable JavaScript | On |
| Kiosk Mode | Enable Kiosk Mode | On |
| Kiosk Mode | Hide status bar / navigation bar | On |
| Kiosk Mode | Kiosk Exit Gesture | 7 taps (or preference) |
| Device Management | Keep Screen On | On |
| Device Management | Screen Brightness | ~180 / 40% |
| Device Management | Screensaver | Off |
| Device Management | Launch on Boot | On |
| Advanced Web | Hardware Acceleration | On |
| Advanced Web | Reload on Screen On | On |
| Advanced Web | Auto Reload on Idle | 3600s |
| Motion Detection | Everything | **Off** — see below |

Exact setting names drift between Fully versions.

`Auto Reload on Idle` is the crash net: if the dashboard's poll loop dies at 3am
you get a fresh page in the morning instead of a frozen one.

### 5. Fire OS side

- *Settings → Display → Sleep → 30 min* — belt and braces; Fully's Keep Screen
  On overrides it
- Disable battery optimization for Fully if Fire OS offers it. Fire OS is
  aggressive about killing background apps
- Turn off Amazon Appstore auto-updates, or Amazon will restart the wall panel
  at random

### 6. Exiting

Exit gesture, then the PIN. That is the only way out. That is the point.

## Gotchas

**Motion detection stays off.** Fully can wake the screen on motion via the
front camera, and every wall-panel guide recommends it. On a 2GB Fire HD 8 it is
the single biggest CPU and battery drain — continuous camera capture plus frame
differencing, forever. It is also a camera running in the kitchen. A kitchen
display should just stay on.

**Do not add a brightness schedule.** The dashboard already dims itself to 0.45
opacity from 10pm–6am, in JS. Layering Fully's night dimming on top makes it
unreadable.

**Battery swelling is the real long-term failure.** A Fire tablet held at 100%
charge 24/7 will puff its battery inside a year or two — this is the most common
way wall-mounted tablets die, and a swollen battery can crack the screen or the
mount. Two options: accept eventual replacement, or put the charger on one of
the Kasa outlets and cycle it (e.g. on 8am–noon only, off the rest of the day).

**Lockscreen ads** — on an ad-supported unit these mostly do not appear, because
in kiosk mode the screen never locks. Amazon will sell you the removal if they
do.

## Debloating

**Not needed here — checked 2026-08-08.** This tablet is sluggish in Silk but
the dashboard under Fully is fine, and Silk is not used. Do not debloat, and do
not chase the animation note below, on the strength of Silk being slow.

Kept only in case the symptom ever appears *under Fully*. A stock Fire HD 8
running one browser is usually fine, and changing system packages for no reason
is how you break it.

If it is slow, the fix is ADB from the Mac mini —
`adb shell pm uninstall -k --user 0 <package>` against Appstore, Silk, Kindle,
and the ad services. No root required, reversible with a factory reset. That
needs Developer Options enabled, which is the only reason to go looking for it.

Also check the page side: the dashboard's `.tile.alert` / `.tile.degraded`
pulse animates `box-shadow`, which forces a full repaint every frame and cannot
be GPU-composited. Several tiles alerting at once will make the whole UI feel
sludgy on this hardware. Fix is a static shadow on an `::after` pseudo-element
with animated `opacity`. Not done yet.

## Later: the HA Fully Kiosk integration

Fully exposes a REST interface that Home Assistant can drive — core integration,
no HACS. *Settings → Devices & Services → Add Integration → Fully Kiosk Browser.*

Gives battery level, charging state, screen on/off control, brightness, and a
load-URL service. The useful one is load-URL: HA could **push** the tablet to
the pool page when a pool alert fires, rather than waiting for someone to walk
over and tap.

Requires the Plus license (confirmed — it drives Remote Admin). Enable
*Fully → Settings → Remote Administration* with a strong password, **cloud
off**, then add the integration with the tablet IP + that password. Never expose
Remote Admin to the internet; Tailscale is already the remote-access path here.

**Deliberately deferred 2026-08-08 — the tablet stays read-only.** Alerts
already surface three ways: the alerts tile goes red on the wall, the ticker
names them, and L1/L2 hit the phone as iOS Critical Alerts. Auto-switching the
display saves a glance at a screen that is already showing the problem. Not
worth the cost until it is actually missed.

That cost, if it is ever wanted: **the dashboard has no URL routing.**
`showPoolView()` is reachable only by tapping a tile
([dashboard.html:1545](../jeeves/public/dashboard.html#L1545)), so
`fully_kiosk.load_url` pointed at the dashboard just reloads the tile grid. It
would need hash routing added (`#pool`, `#alerts`), the hash cleared when the
60s auto-return fires so a repeat alert can re-trigger, and the new entity
references added to `verify-alerts.py`'s scan. Decide overlay-vs-pool-page at
that point — living with it first is what answers that question.
