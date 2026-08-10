#!/usr/bin/env python3
"""Verify that everything the HA packages reference actually exists in HA.

Run on the Pi:   cd ~/homelab && python3 scripts/verify-alerts.py

Why this exists: on 2026-08-07 an alert shipped pointing at an entity_id that was
never created, and `check_config` passed the whole time. Config validating and
YAML parsing prove nothing about whether entities were registered or whether an
automation can fire. This reads every package under homeassistant/packages/,
extracts every entity and automation they depend on, and asks HA directly.

Exit code 0 = everything resolves, 1 = something is missing.
"""

import glob
import json
import os
import re
import sys
import urllib.error
import urllib.request

HA = os.environ.get("HA_URL", "http://localhost:8123")

# EVERY package, not just jeeves_alerts.yaml. Scanning a single hardcoded file
# recreated the exact blind spot this script exists to close: jeeves_garage.yaml
# could ship pointing at an entity that was never registered and this would have
# printed PASS. secrets.yaml is excluded — it is gitignored and holds no
# entity references.
PACKAGE_DIR = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "homeassistant", "packages",
)
PACKAGES = sorted(
    p for p in glob.glob(os.path.join(PACKAGE_DIR, "*.yaml"))
    if os.path.basename(p) != "secrets.yaml"
)

# Domains worth checking. `notify.*` is a service, not an entity, so it is
# excluded here and checked against the services API instead.
ENTITY_DOMAINS = (
    "binary_sensor", "sensor", "switch", "input_boolean", "script",
    "cover", "timer",
)

# `switch.turn_on` and friends are service calls that look exactly like entity
# ids. Without this the checker reports them as missing entities. `finished` is
# here for the `timer.finished` EVENT TYPE, which has the same shape again.
SERVICE_VERBS = {
    "turn_on", "turn_off", "toggle", "reload", "trigger",
    "select_option", "set_value", "set_datetime", "increment", "decrement",
    "open_cover", "close_cover", "stop_cover", "set_cover_position",
    "start", "cancel", "pause", "finish", "finished",
}


def token():
    """Read HA_TOKEN from the environment, or fall back to ~/homelab/.env."""
    tok = os.environ.get("HA_TOKEN")
    if tok:
        return tok
    env = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".env")
    try:
        with open(env) as fh:
            for line in fh:
                if line.startswith("HA_TOKEN="):
                    return line.split("=", 1)[1].strip()
    except OSError:
        pass
    sys.exit("HA_TOKEN not found in environment or .env")


def get(path, tok):
    req = urllib.request.Request(
        f"{HA}{path}", headers={"Authorization": f"Bearer {tok}"}
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.load(resp)
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return None
        raise


def main():
    tok = token()
    if not PACKAGES:
        sys.exit(f"no package files found in {PACKAGE_DIR}")
    # Full-line comments are dropped before scanning. These packages document
    # entities that were deliberately DELETED (input_boolean.pool_maintenance,
    # removed 2026-08-08) and explain why, and prose naming a dead entity must
    # not be reported as a broken reference — that would punish the comments
    # that make the config readable. Only whole comment lines go: a trailing
    # `#` is left alone so nothing inside a Jinja template can be truncated.
    blob = ""
    for path in PACKAGES:
        with open(path) as fh:
            blob += "\n".join(
                line for line in fh.read().splitlines()
                if not line.lstrip().startswith("#")
            ) + "\n"
    names = ", ".join(os.path.basename(p) for p in PACKAGES)

    # Two things must not be collected here:
    #   1. Service calls (switch.turn_on) — identical in shape to an entity id.
    #   2. Templated ids (input_boolean.alert_open_{{ trigger.id }}) — these
    #      cannot be resolved statically. The trailing negative lookahead makes
    #      the match fail outright rather than silently truncating to a prefix,
    #      which is what produced a bogus "missing" entry on the first run.
    refs = set()
    for domain in ENTITY_DOMAINS:
        for match in re.findall(rf"\b{domain}\.[a-z0-9_]+(?![a-z0-9_{{])", blob):
            if match.split(".", 1)[1] not in SERVICE_VERBS:
                refs.add(match)

    states = get("/api/states", tok)
    present = {s["entity_id"] for s in states}

    failures = []
    print(f"scanning: {names}\n")
    print("entities referenced by the packages:")
    for ref in sorted(refs):
        ok = ref in present
        print(f"  {'OK ' if ok else 'MISSING'}  {ref}")
        if not ok:
            failures.append(ref)

    # Automations are matched on their `id:`, not their generated entity_id,
    # since the entity_id is derived from the alias and can drift.
    declared = set(re.findall(r"^\s*-\s*id:\s*(\S+)", blob, re.MULTILINE))
    loaded = {
        s["attributes"].get("id")
        for s in states
        if s["entity_id"].startswith("automation.")
    }
    print("\nautomations declared in the packages:")
    for aid in sorted(declared):
        ok = aid in loaded
        print(f"  {'OK ' if ok else 'NOT LOADED'}  {aid}")
        if not ok:
            failures.append(f"automation id {aid}")

    # The notify service the alert scripts call.
    services = get("/api/services", tok)
    notify = {
        f"notify.{s}"
        for d in services
        if d["domain"] == "notify"
        for s in d["services"]
    }
    print("\nnotify services called by the alert scripts:")
    for ref in sorted(set(re.findall(r"\bnotify\.[a-z0-9_]+", blob))):
        ok = ref in notify
        print(f"  {'OK ' if ok else 'MISSING'}  {ref}")
        if not ok:
            failures.append(ref)

    if failures:
        print(f"\nFAIL — {len(failures)} unresolved:")
        for f in failures:
            print(f"  {f}")
        return 1
    print("\nPASS — every reference resolves.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
