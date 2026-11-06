# Developer Quick Reference

Short index. Full detail: [`CODEBASE_GUIDE.md`](CODEBASE_GUIDE.md).

## Important directories

| Path | Why |
|------|-----|
| `client/src/pages` | Screens |
| `client/src/components` | Shared UI |
| `client/src/services/api.ts` | All HTTP |
| `client/src/store/authStore.ts` | Session |
| `worker/index.ts` | Production API (core) |
| `worker/extended.ts` | Production API (rest) |
| `worker/lib/core.ts` | RBAC + transitions |
| `worker/schema.sql` | Baseline D1 |
| `worker/migrate*.sql` | Additive D1 |
| `server/src` | Local Express only |
| `docs/` | Guides |

## Major routes

Admin: `/admin/dashboard`, `/dispatch`, `/map`, `/incidents`, `/sos`, `/conduction`, `/notifications`, `/reports`, `/analytics`, `/personnel`, `/attendance`, `/shifts`, `/resources`, `/settings`  
Citizen: `/citizen`, `/citizen/sos`, `/notifications`, `/profile`  
Responder: `/responder`, `/map`, `/chat`, `/status`, `/notifications`, `/profile`  
Public: `/login`, `/register`, `/forgot-password`, `/reset-password`

## Main components

`ProtectedRoute`, `AdminLayout`, `AdminSidebar`, `MapView`, `MonitorMapView`, `SmartIntakeDialog`, `NotificationHost`, `TransportLocationPicker`

## Key services

`client/src/services/api.ts` — `authApi`, `incidentsApi`, `sosApi`, `respondersApi`, `mapApi`, `eventsApi`, …

## Important hooks

`useLiveSync` / `useAdminLiveSync`, `useLiveMapData`, `useMapConfig`, `useHealth`

## Database entry points

Apply SQL: `node worker/apply-sql.js` via `npm run db:migrate` / `db:migrate:v2` … `v18` / `db:seed`  
Inspect tables: `worker/schema.sql` + migrations  
Local Mongo: `server/src/models`, `npm run seed`

## Authentication files

- Client: `authStore.ts`, `ProtectedRoute.tsx`, `pages/auth/*`
- Worker: `worker/index.ts` (`auth`, `signTokens`), `worker/lib/core.ts` (`jwtSecret`, `hasPerm`)
- Express: `server/src/middleware/index.ts`, `utils/jwt.ts`

## Configuration files

`package.json`, `wrangler.jsonc`, `client/vite.config.ts`, `.env.example`, `.env.production`, `playwright.config.ts`

## Common commands

```bash
npm install
npm run dev
npm run build
npm run deploy
npm test
npm run test:e2e
npm run db:migrate
npm run db:seed
```

No `npm run lint` script exists.

Demo password for seeded users: `Password123!` (keep `VITE_DEMO_ACCOUNTS=false` in production).

---

## If you want to modify X, start here

| Task | Start here |
|------|------------|
| Change dashboard | `client/src/pages/admin/DashboardPage.tsx`, `worker/index.ts` `/api/dashboard/stats` |
| Change dispatch queue | `DispatchPage.tsx`, `/api/responders/dispatch-queue` |
| Change GIS map | `MapView.tsx`, `MonitorMapView.tsx`, `/api/map/data`, `/api/map/fleet` |
| Change incident statuses | `worker/lib/core.ts` `TRANSITIONS` **and** `client/src/lib/incidentState.ts` |
| Add user role | `core.ts` `ROLES`/`PERMISSIONS`, `authStore.ts` `isAdminRole`, `ProtectedRoute` / nav, D1 `roles` seed |
| Modify authentication | `worker/index.ts` auth routes, `authStore.ts`, `api.ts` refresh |
| Change database query | `worker/index.ts` or `extended.ts` (production); not Mongo |
| Add D1 column | New `worker/migrate-vN-*.sql` + root `package.json` script |
| Citizen SOS | `CitizenSOSPage.tsx`, `POST /api/sos`, `offlineQueue.ts` |
| Guest SOS | `worker/extended.ts` `POST /api/sos/guest` |
| Responder GPS | `lib/responderGps.ts`, `POST /api/responders/me/location` |
| Notifications / push | `notify.ts`, `webpush.ts`, `NotificationHost.tsx`, `sw.ts` |
| Conduction | `ConductionPage.tsx`, `/api/transports` |
| Personnel | `PersonnelPage.tsx`, `/api/personnel` |
| Reports export | `ReportsPage.tsx`, `/api/reports/export`, `worker/lib/pdf.ts` |
| Settings | `SettingsPage.tsx`, `system_settings` table, `/api/settings` |
| Live polling interval | `client/src/lib/liveTiming.ts` |
| CORS / deploy | `wrangler.jsonc`, `worker/index.ts` cors origin list, `docs/DEPLOY.md` |
| Local Express parity | `server/src/routes/index.ts` (expect gaps vs Worker) |
| PWA / push SW | `client/src/sw.ts`, `client/vite.config.ts` |
| E2E | `e2e/smoke.spec.ts`, `playwright.config.ts` |
