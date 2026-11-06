# Codebase Audit

Audit date: 2026-10-02. Scope: repository cleanup and documentation. Functionality was not redesigned.

Inspected: npm workspaces (`client`, `server`), `worker/` (42 TS/JS/SQL files), `client/src` (103 TS/TSX files), `server/src` (23 TS files), `docs/`, config (`wrangler.jsonc`, Vite, Playwright), env examples, e2e.

---

## Debug code removed

No application `console.log` / `debugger` statements were stripped from request handlers.

**Kept on purpose:**

- `console.error` in `AdminLayout` error boundary, Worker `onError`, Express `errorHandler`
- `console.log` in `worker/apply-sql.js`, `server/src/index.ts` startup, `server/src/seed/index.ts`, `scripts/gen-brand-logo.js`, `worker/scripts/gen-ncr-hospitals.js` (CLI)

---

## Dead code found

Not deleted (could be local-dev or future wiring; removing would not change current SPA behavior but might surprise maintainers):

| Item | Notes |
|------|--------|
| `client/src/hooks/useSocket.ts` | Socket.io helper; **no page imports it** |
| `VITE_ENABLE_GUEST_SOS` | In `.env.example` only; guest SOS is a Worker endpoint regardless |
| Firebase / Twilio / Google Maps env keys | Documented in `.env.example`, unused in production Worker/client path |
| `server/` vs `worker/` | Express implements a **subset** of Worker APIs (no events poll, guest SOS, media/R2, analytics, etc.) |
| `client/src/pages/admin/AdminModules.tsx` | Re-export barrel; still imported by `App.tsx` for Settings/Resources |

`DevModeLock.tsx` and `worker/devlock.ts` (the “IN DEVELOPMENT MODE” gate) were **removed**.

---

## Duplicate code

| Area | Detail |
|------|--------|
| Incident transitions | `worker/lib/core.ts` `TRANSITIONS` vs `client/src/lib/incidentState.ts` vs narrower `server/src/constants` `INCIDENT_TRANSITIONS` |
| Permission maps | Worker `PERMISSIONS` vs Express `ROLE_PERMISSIONS` (not identical — e.g. Worker grants `settings:manage` / `analytics:read` to central dispatcher) |
| Password / phone rules | `worker/lib/core.ts` and `client/src/lib/validation.ts` |
| Admin donut/chart CSS | Repeated `cursor` percent loops on Personnel, Attendance, Shifts, Resources, Reports, Analytics |
| Notification query invalidation | Long key lists duplicated in `useLiveSync` and `LiveSyncProvider.refresh` |
| Dual backends | Two sources of truth for “the API” |

Do not “fix” by merging backends in this cleanup pass.

---

## Security concerns

### Critical

None confirmed as remotely exploitable without further review. JWT secret absence throws at runtime (`jwtSecret`).

### High

- **SPA tokens in localStorage** (`sv-dispatch-auth`) — XSS can steal sessions.
- **Login rate limit on Worker** is weaker than Express (`express-rate-limit` 30/15min). Worker records `login_attempts` and lockout fields but does not use the same limiter middleware.

### Medium

- **Mapbox public token in `wrangler.jsonc` `vars`** — expected for `pk.` tokens; must be URL-restricted in Mapbox. Do not copy this value into docs.
- **VAPID public key in `vars`** — acceptable; private key must remain a Wrangler secret.
- **Seed/demo password `Password123!`** in seed SQL and e2e fallbacks — acceptable for demo D1; production login page should keep `VITE_DEMO_ACCOUNTS=false`.
- **MFA column / settings flags without enforcement** — UI can imply 2FA that is not implemented (`SettingsPage` notes this).
- **Guest SOS IP hash** is a short hex slice of IP bytes, not a cryptographic hash.
- **CORS** includes the `*.workers.dev` origin as well as the custom domain.

### Low

- Express `errorHandler` may return `err.message` to clients.
- No ESLint/CSP on the Worker-served SPA.
- Playwright screenshot spec defaults to demo email/password if env unset.

Secrets were not copied into this document.

---

## Maintainability issues

- `worker/index.ts` and `worker/extended.ts` are very large route files.
- Large page components (Dispatch, Conduction, Settings, ResponderPages) mix UI and API calls.
- Client types use Mongo-style `_id` while D1 uses `id` (aliased in SQL).
- Two databases (D1 vs Mongo) and two realtime models confuse new contributors.
- `noUnusedLocals` on client helps; server tsconfig does not enable the same unused checks.
- No root lint script.
- Settings `sessionTimeout` vs hardcoded 8h inactivity in `App.tsx` may disagree.

---

## Recommended improvements

### Immediate

- Restrict the Mapbox token by production URL.
- Confirm `VAPID_PRIVATE_KEY` and `JWT_SECRET` exist only as Wrangler secrets.
- Keep `VITE_DEMO_ACCOUNTS=false` on production builds.

### Short-term

- Extract a shared `TRANSITIONS` / permissions module or generate client constants from Worker to stop drift.
- Add Worker login rate limiting comparable to Express.
- Mount or delete `useSocket` intentionally (local Express leftover).
- Add ESLint + a `lint` script.
- Align Express routes or mark `server/` as local-only in README (README now states this).

### Long-term

- Split Worker routes by domain module.
- Consider Durable Object WebSockets if polling is insufficient.
- HttpOnly cookie or BFF session instead of localStorage JWT.
- Implement MFA if the settings flag remains.
- Reduce Mongo/Express dual-stack once local Worker/`wrangler dev` is the default.

Major architecture work was **not** implemented in this pass.

---

## Documentation created

- `docs/CODEBASE_GUIDE.md`
- `docs/FEATURE_GUIDE.md`
- `docs/ARCHITECTURE.md`
- `docs/DEVELOPER_QUICK_REFERENCE.md`
- `docs/CODEBASE_AUDIT.md` (this file)

---

## Validation (2026-10-02)

| Check | Result |
|-------|--------|
| TypeScript (`tsc` server + `tsc -b` client via `npm run build`) | Passed |
| Vite production build + PWA injectManifest | Passed (chunk size warnings: Mapbox ~1.8 MB, app ~2.0 MB) |
| Lint | **No `lint` script** in the repository |
| Unit tests `npm test` | Passed: server 5, client 17, worker 17 |
| Playwright `npm run test:e2e` | **Not run in this pass** — config default `E2E_BASE_URL` is the live production site |

Broken imports: none (production build succeeded). Routes compile as part of the client bundle.

---
