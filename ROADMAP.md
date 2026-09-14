# Jeeves — Tech Debt & Improvement Roadmap

> Source: codebase analysis 2026-09-07. Organized by priority. Nothing here is
> mandatory — pick up items as time and motivation allow.

---

## 🔴 High Priority

### 1. ~~XSS via chore name injection~~ ✅ Done
- **Where:** `jeeves/server.js` `/api/chores` POST → `jeeves/public/dashboard.html` renders `p.name`/`p.icon` as raw HTML
- **Fix:** Sanitize chore names/icons before DB insert AND/OR escape on render. `name` should be plain text only (strip HTML tags), `icon` should be validated against the known set or limited to emoji Unicode ranges.
- **Effort:** ~30 min
- **Completed:** 2026-09-07 — Chore name/icon sanitized to prevent XSS (commit 97dc1d8).

### 2. ~~Remove or guard the test endpoint~~ ✅ Done
- **Where:** `jeeves/server.js:1752` — `POST /api/test/done/:appliance`
- **Issue:** Anyone on the LAN can force appliance Done states with no auth.
- **Fix:** Gate behind `process.env.NODE_ENV !== 'production'` or an `ENABLE_TEST_ROUTES` env var. Remove entirely if unused.
- **Effort:** ~10 min
- **Completed:** 2026-09-09 — Gated behind `ENABLE_TEST_ROUTES=true` env var. Route is not registered unless explicitly enabled.

### 3. ~~Startup environment validation~~ ✅ Done
- **Where:** `jeeves/server.js` bottom — `app.listen` fires regardless of whether `HA_TOKEN`, `PURPLEAIR_API_KEY`, etc. are set.
- **Issue:** Server starts degraded with no clear signal. Silent failures in polling loops.
- **Fix:** Add a startup check that logs missing critical env vars and either exits or runs in a clearly-degraded mode.
- **Effort:** ~20 min
- **Completed:** 2026-09-11 — Startup env validation logs ✓/✗ for each feature's env var, clearly showing which features are degraded.

---

## 🟡 Medium Priority

### 4. Decompose `server.js` into domain modules
- **Where:** `jeeves/server.js` — 1,928 lines, ~20 module-level mutable state vars, all polling/routing/business logic interleaved.
- **Proposed structure:**
  ```
  jeeves/
    src/
      server.js            # Express app + route mounting only
      config.js            # env vars, constants, startup validation
      state.js             # centralized cache (replace module-level globals)
      routes/
        api.js             # /api/status, /api/dismiss, etc.
        chores.js          # chore CRUD routes
        chat.js            # Ollama proxy
        voice.js           # voice dispatch
      services/
        ha.js              # fetchHAState, fetchHAStates, callHAService
        weather.js         # Open-Meteo
        aqi.js             # PurpleAir
        library.js         # BiblioCommons
        music.js           # Mac Music bridge
      appliances/
        poller.js          # generic appliance poller (replaces washer/dryer/dishwasher duplication)
        washer.js
        dryer.js
        dishwasher.js
      lib/
        errors.js          # logError/resolveError helpers
  ```
- **Migration path:** Do it incrementally. Extract `config.js` and `state.js` first (no behavior change), then move routes, then services. Each step is independently committable.
- **Progress:** ✅ Phase 1 done — `src/config.js` extracted (all env vars, constants, startup validation). ✅ Phase 2 done — `src/state.js` extracted (cachedStatus, appliance state, pool, promotion, biblio, chores, reports). `server.js` reduced from 1,989 → 1,758 lines.
- **Effort:** 1–2 days incremental

### 5. Generic appliance poller (DRY)
- **Where:** `fetchWasher()`, `fetchDryer()`, `fetchDishwasher()` — near-identical restart-recovery, cycle-tracking, and state-mutation patterns.
- **Fix:** Create an `AppliancePoller` factory/class that takes a config object (entity IDs, thresholds, state machine) and handles the common pattern. Reduces ~300 lines to ~100.
- **Effort:** ~2 hours

### 6. Circuit breakers / retry for external calls
- **Where:** All `fetch()` calls to HA, Open-Meteo, PurpleAir, BiblioCommons, Ollama, voice service.
- **Issue:** If HA is down, requests still fire every 30s with no backoff. No stale-cache serving.
- **Fix:**
  - Add a simple circuit-breaker wrapper (3 failures → 2 min cooldown).
  - Serve stale cache with a `stale: true` flag in the API response.
  - Dashboard already handles staleness visually — just needs the data.
- **Effort:** ~half day

### 7. Consistent error handling
- **Where:** Mix of `Promise.allSettled`, sequential `await` + try/catch, and `.catch()` chains across `server.js`.
- **Issue:** `logError`/`resolveError` used for some sources but not all.
- **Fix:** Standardize: every external call uses `Promise.allSettled`, every rejection goes through `logError`, every success goes through `resolveError`. Create a `withErrorTracking(source, fn)` helper.
- **Effort:** ~1 hour (follows from #4)

---

## 🟢 Low Priority / Polish

### 8. Add `tsconfig.json` + enable type checking
- **Where:** `// @ts-check` comments exist in every `.js` file but there's no `tsconfig.json` and no `npm` script to run the checker.
- **Fix:** Add `tsconfig.json` with `checkJs: true`, add `npm run typecheck` script. Fix the type errors that surface (there will be many — do it in batches).
- **Effort:** ~1 hour setup, ongoing for fixes

### 9. Structured logging
- **Where:** All logging is `console.log`/`console.error`.
- **Fix:** Adopt a minimal approach: JSON lines to stdout (`{level, msg, service, ts}`), parseable by `docker logs` or a future log aggregator. No need for a library — a 10-line `log()` helper suffices.
- **Effort:** ~30 min

### 10. ESPHome build artifacts in git
- **Where:** `esphome/.esphome/` contains compiled libsodium, ESP-IDF sources, etc.
- **Fix:** `git rm -r esphome/.esphome`, confirm `esphome/.gitignore` has `.esphome/`. Reduces repo bloat significantly.
- **Effort:** ~10 min

### 11. Hardcoded configuration
- **Where:** Lat/long (`37.48, -122.25`), `CHAT_MODEL`, `DISHWASHER_WATTS_THRESHOLD`, `FROM_EMAIL`, etc.
- **Fix:** Move to env vars with sensible defaults. At minimum: `LAT`, `LON`, `CHAT_MODEL`, `FROM_EMAIL`.
- **Effort:** ~20 min

### 12. Voice command dispatch is regex-based
- **Where:** `dispatchVoice()` in `server.js` — brittle regex matching, no fuzzy matching or confidence scoring.
- **Fix:** For the current scope (3 appliances × 2 commands), this is fine. Revisit if adding more commands. Consider keyword extraction + intent matching over regex.
- **Effort:** Revisit when needed

### 13. RAG improvements
- **Where:** `jeeves/rag.js` — token-overlap scoring, no TF-IDF, no semantic matching.
- **Fix:** Probably unnecessary. The doc library is small; keyword matching works. If it becomes inadequate, consider embedding-based retrieval (Ollama can generate embeddings).
- **Effort:** Revisit when needed

### 14. Database resilience
- **Where:** `jeeves/db.js` — single synchronous `better-sqlite3` connection, no error handling at the connection level.
- **Fix:** Wrap DB operations in try/catch with a fallback that logs and continues. Consider `readonly` mode for read-heavy endpoints.
- **Effort:** ~30 min

### 15. No CI / automated checks
- **Where:** No GitHub Actions, no pre-commit hooks, `verify-alerts.py` is the only automated check.
- **Fix:** Start small — add a GitHub Actions workflow that runs `node --check` on all JS files and the `verify-alerts.py` script. Expand from there.
- **Effort:** ~1 hour for basic setup

---

## Explicitly NOT Breaking Up the Monorepo

Analysis confirmed: this should stay a monorepo. Reasons:
- Single deploy target (one Pi, one `docker compose up`)
- Tight coupling between server, dashboard, and HA configs is by design
- Single maintainer — no parallel development to coordinate
- Cross-cutting concerns (alerting) span the repo
- The only arguable split (voice service) is too small and coupled to justify it

---

## How to Use This File

- Pick one item. Finish it. Check the box. Move on.
- Items are ordered roughly by impact/effort ratio, not by dependency.
- Items #4 and #5 have a natural dependency (do #5 inside #4's refactor).
- Nothing here is urgent — the system works. This is about making it better over time.
