# E2E Test Matrix

Base URL: `https://emergency.brigadaonse.org` or local Worker.  
Runner: Playwright (`npm run test:e2e`) + Vitest unit suites.

| # | Scenario | Role | Automated | Notes |
|---|----------|------|-----------|-------|
| 1 | Login page loads | public | ✓ smoke | |
| 2 | Health checks | public | ✓ | `/api/health` |
| 3 | Admin route guard | anon | ✓ | redirect login |
| 4 | Citizen route guard | anon | ✓ | redirect login |
| 5 | iPhone 14 overflow | public | ✓ | 390×844 |
| 6 | Viewport matrix | public | ✓ | 320–1366 |
| 7 | Incident state gates | unit | ✓ | `incidentState.test.ts` |
| 8 | Phone/password validation | unit | ✓ | |
| 9 | Transition rules | unit | ✓ | `core.test.ts` |
| 10 | A* / route adapter | unit | ✓ | `routing.test.ts` |
| 11 | K-means grouping | unit | ✓ | `kmeans.test.ts` |
| 12 | Offline queue idempotency | unit | ✓ | `offlineQueue.test.ts` |
| 13–40 | Full authenticated flows | multi | Partial | Require seeded demo accounts + `E2E_USER_*` secrets in CI; not run against prod citizen PII |

## Manual release checks (must pass before marking complete)

See `docs/release-checklist.md` items for SOS, assign, ack, map GPS, export xlsx, guest SOS, offline queue sync, reopen, announcements.

## Performance targets (measure in staging)

| Metric | Target |
|--------|--------|
| Common API p95 | &lt; 500 ms |
| SOS → dispatcher visible | &lt; 2 s (poll ≤4 s worst case) |
| Assign → responder alert | &lt; 2–4 s via poll |
| Map refresh | &lt; 3–10 s poll |
| Offline sync after reconnect | &lt; 10 s |
