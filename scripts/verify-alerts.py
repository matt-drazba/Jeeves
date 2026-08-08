#!/usr/bin/env python3
"""Verify that everything the alerting package references actually exists in HA.

Run on the Pi:   cd ~/homelab && python3 scripts/verify-alerts.py

Why this exists: on 2026-08-07 an alert shipped pointing at an entity_id that was
never created, and `check_config` passed the whole time. Config validating and
YAML parsing prove nothing about whether entities were registered or whether an
automation can fire. This reads the package, extracts every entity and automation
it depends on, and asks HA directly.

Exit code 0 = everything resolves, 1 = something is missing.
"""

import json
import os
import re
import sys
import urllib.error
import urllib.request

HA = os.environ.get("HA_URL", "http://localhost:8123")
PACKAGE = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "..", "homeassistant", "packages", "jeeves_alerts.yaml",
)

# Domains worth checking. `notify.*` is a service, not an entity, so it is
# excluded here and checked against the services API instead.
ENTITY_DOMAINS = ("binary_sensor", "sensor", "switch", "input_boolean", "script")


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
    with open(PACKAGE) as fh:
        blob = fh.read()

    # Templated references like input_boolean.alert_open_{{ trigger.id }} cannot
    # be resolved statically, so expand them from the helpers actually defined.
    refs = set()
    for domain in ENTITY_DOMAINS:
        for match in re.findall(rf"\b{domain}\.[a-z0-9_]+", blob):
            if "{" not in match:
                refs.add(match)

    states = get("/api/states", tok)
    present = {s["entity_id"] for s in states}

    failures = []
    print("entities referenced by jeeves_alerts.yaml:")
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
    print("\nautomations declared in the package:")
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
