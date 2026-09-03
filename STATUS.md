# Jeeves Status

Last reviewed: 2026-09-03

This is the current project-status index. Detailed behavior and historical reasoning
live in the focused documents linked below.

## Architecture

- Raspberry Pi 5 runs Docker Compose with Home Assistant, Jeeves, Ollama, ESPHome,
  and the local voice service.
- Fire HD 8 runs the Jeeves dashboard through Fully Kiosk Browser.
- Jeeves (`jeeves/server.js`) aggregates Home Assistant and external service data,
  serves `/api/status`, and owns the SQLite history store through `jeeves/db.js`.
- Home Assistant owns device integrations, schedules, notifications, alert detectors,
  and alert state.
- ESPHome owns the pool-pad sensor firmware. Pool heat-recovery protection remains
  hardware-first; Jeeves and Home Assistant monitor it.
- The Mac mini hosts the Apple Music bridge and is the ESPHome flashing machine.

## Working

- Dashboard tile grid, calendar view, pool view, ambient/action-driven dimming,
  overlays, voice control, local Ollama chat, and RAG manual lookup.
- Washer, dryer, dishwasher, library, books-out, batteries, home-energy, weather,
  AQI, sprinklers, Apple Music, pool temperature/pump/filter pressure, recurring
  chores, scoreboard, and weekly reports.
- Home Assistant alerting for pool/booster, garage, sensor-offline, and heat-recovery
  conditions documented in [alerting_levels.md](docs/alerting_levels.md).
- Pool-pad HX temperature sensing, heat-active sensing, filter-pressure sensing, and
  SQLite pool sample logging.
- Garage automation and ratgdo32 monitoring.

## Pending

- Record the clean-filter pressure baseline after the next backwash.
- Add the filter-pressure backwash alert and promote it to a maintenance chore.
- Install and calibrate the DN50 flow meter; then upgrade flow/deadhead monitoring
  and the booster interlock as designed.
- Complete the HX probe shielding/calibration work before re-arming the ΔT alert.
- Wire/calibrate the Tecmark flow-switch path and perform the breaker acceptance test
  only after the safety wiring is ready.
- Buy the chemistry test equipment and implement SQLite-backed pool chemistry logging.
- Resolve remaining electrical/hardware items in the pool wiring manual, including
  breaker replacement, heat-exchanger bonding, wire labels, and field photos.
- Verify the current batteries/dryer deployment state on the Pi where source-only
  verification is insufficient.

## Deferred

- Weather-aware Bhyve watering automation.
- Resideo compressor-stage investigation and dependent HVAC measurement work.
- Zigbee valve-position sensing, solar integration, TOU rate awareness, Tesla alerts,
  and other items listed in the focused design documents.
- External monitoring for whole-house outages or Home Assistant failure.

## Operational References

- [README.md](README.md): repository orientation and deployment paths.
- [CLAUDE.md](CLAUDE.md): agent rules, stable constraints, and project context.
- [pool_todo.md](docs/pool_todo.md): current pool action list.
- [pool_system_checks.md](docs/pool_system_checks.md): recurring pool verification.
- [pool_wiring_manual.md](docs/pool_wiring_manual.md): as-built pool wiring and safety.
- [alerting_levels.md](docs/alerting_levels.md): alert policy and severity.
- [alerting_runbook.md](docs/alerting_runbook.md): response and troubleshooting.

## Verification

- JavaScript: `node --check jeeves/server.js` and related source files.
- Home Assistant packages: HA `check_config`, then `python3 scripts/verify-alerts.py`
  against the live instance.
- ESPHome: validate and flash from the Mac with `uvx esphome run pool-pad.yaml` when
  hardware/configuration changes are intentional.
- Runtime: inspect Compose status, `/api/status`, SQLite schema version, HA entities,
  and the dashboard at kiosk dimensions.
