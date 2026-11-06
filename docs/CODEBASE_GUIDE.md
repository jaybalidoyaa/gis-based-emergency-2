# Codebase Guide

Barangay Sun Valley GIS-Based Emergency Dispatch and Responder Coordination System (Brigada Onse / SVFAR). Production site: `https://emergency.brigadaonse.org`.

This guide describes the repository as implemented. Dual backends exist: **Cloudflare Worker + D1 is production**. Express + MongoDB is a local/thesis comparison stack and is not the production source of truth.

---

## 1. Project Overview

### What the application does

The system is a barangay-level emergency operations platform. Dispatchers verify and assign incidents, responders update status and GPS, and citizens submit SOS reports. Maps show units, facilities, NCR hospitals, and routes. Supporting modules cover conduction (patient transport), personnel, attendance, shifts, resources, reports, analytics, notifications, and settings.

### Intended users

| Role | Shell | Typical work |
|------|--------|----------------|
| `SYSTEM_ADMINISTRATOR` | `/admin/*` | Full operations, users, settings, audit, resets |
| `CENTRAL_DISPATCHER` | `/admin/*` | Dispatch, map, incidents, workforce, reports |
| `DEPARTMENT_DISPATCHER` | `/admin/*` | Same operational shell; no `personnel:manage` on the Worker |
| `EMERGENCY_RESPONDER` | `/responder/*` | Assignments, map, team chat, GPS, status, check-in |
| `CITIZEN` | `/citizen/*` | SOS, notifications, profile |
| Guest (unauthenticated) | Public APIs only | `POST /api/sos/guest` (rate-limited); login/register |

Admin UI is shared for the three dispatcher/admin roles. Extra capabilities are enforced on the API via `hasPerm()`, not by separate React routes.

### Major modules

- Authentication and profiles
- Incident lifecycle and smart call intake
- Citizen / guest SOS
- Dispatch queue and unit assignment
- GIS map monitoring (Mapbox)
- Responder operations (accept/decline, GPS, team/unit change)
- Conduction / transports
- Personnel, attendance, leave, shifts, training
- Vehicles, equipment, checklists
- Notifications, Web Push, in-app alerts
- Reports (CSV / Excel / PDF) and analytics
- Chat (incident + responders channel)
- Settings, announcements, escalation rules, audit logs
- PWA offline shell + IndexedDB queue for SOS/status/GPS

### Major workflows

1. **Citizen SOS** → incident + SOS row → dispatcher verifies → assign unit(s) → responder accept → En Route / On Scene / Transporting → resolved/closed.
2. **Dispatcher intake** (`SmartIntakeDialog`) → `POST /api/incidents` → same dispatch path.
3. **Guest SOS** → unverified incident without a citizen account.
4. **Conduction** → scheduled transport with map pins and assigned crew/vehicle.
5. **Live ops** → Worker `GET /api/events?since=` poll invalidates React Query caches.

### Frontend architecture

React 18 SPA (Vite). Routing in `client/src/App.tsx`. Auth in Zustand (`persist` localStorage key `sv-dispatch-auth`). Server state via TanStack Query. HTTP via `client/src/services/api.ts`. Production realtime is **event polling**, not Socket.io. Socket.io client exists for local Express only (`useSocket.ts` is currently unused by pages).

### Backend architecture

- **Production:** `worker/index.ts` + `worker/extended.ts` (Hono). JWT (jose, HS256). D1 SQL. R2 for media. Web Push (`web-push`).
- **Local:** `server/src` Express, Mongoose, jsonwebtoken, Socket.io. Smaller route surface than the Worker.

### Database architecture

Production: Cloudflare D1 (SQLite). Baseline `worker/schema.sql` plus additive `worker/migrate*.sql` files applied with `node worker/apply-sql.js`. Local Mongo models live under `server/src/models/` and are not applied to D1.

### Realtime architecture

Workers cannot host sticky Socket.io the way Express does. Production uses `GET /api/events` with a `since` timestamp and `serverTime` cursor (`client/src/hooks/useLiveSync.ts`). Map fleet GPS uses a faster overlay (`useLiveMapData` + `GET /api/map/fleet`). Local Express can emit Socket.io events if `VITE_SOCKET_URL` is set.

### External services

| Service | Use |
|---------|-----|
| Mapbox GL / Styles | Basemap in the browser |
| Mapbox Directions | `GET /api/routing/plan` when a token is present; A* fallback otherwise |
| Cloudflare D1 | Primary database |
| Cloudflare R2 | Incident/SOS media blobs |
| Web Push (VAPID) | Browser push to `push_subscriptions` |
| Nominatim-style geocoding | Client `lib/geocode.ts` (OpenStreetMap) |

Firebase, Twilio, and Google Maps keys appear in `.env.example` but are **not wired** in the current Worker/client production path.

---

## 2. Technology Stack

| Technology | What it is | Why it is here | Where |
|------------|------------|----------------|-------|
| React 18 | UI library | SPA shells for three audiences | `client/src` |
| TypeScript | Typed JS | Strict client compile (`noUnusedLocals`) | client, server, worker |
| Vite 6 | Bundler / dev server | PWA build, `/api` proxy to Express in local `npm run dev` | `client/vite.config.ts` |
| React Router 7 | Routing | Role layouts and protected routes | `client/src/App.tsx` |
| TanStack Query | Server-state cache | Polling, invalidation on live events | pages + hooks |
| Zustand | Client auth store | Tokens + user persisted in localStorage | `authStore.ts` |
| Tailwind CSS 3 | Styling | Dark ops UI, navy/gold tokens | `client/src/index.css` |
| Radix + shadcn-style UI | Accessible primitives | Dialogs, tabs, dropdowns | `client/src/components/ui`, `client/components.json` |
| Lucide | Icons | Sidebar and KPI icons | layouts/pages |
| Mapbox GL + react-map-gl | Maps | Incident/unit/facility layers | `MapView.tsx`, `MonitorMapView.tsx` |
| Sonner | Toasts | API errors and confirmations | `App.tsx` |
| vite-plugin-pwa / Workbox | Service worker | Precache + Web Push handler | `client/src/sw.ts` |
| Hono | Worker HTTP | `/api/*` on Cloudflare | `worker/` |
| jose | JWT | Access 8h / refresh 7d | `worker/index.ts` |
| Cloudflare D1 | SQLite | Production data | `wrangler.jsonc` binding `DB` |
| Cloudflare R2 | Object storage | Media | binding `MEDIA` |
| web-push | VAPID push | Responder/dispatcher alerts | `worker/lib/webpush.ts` |
| Express | Local HTTP | `npm run dev` API | `server/src` |
| Mongoose | Mongo ODM | Local models | `server/src/models` |
| Socket.io | Local websockets | Local realtime only | `server/src/sockets` |
| Zod | Validation | Express controllers | `server/` |
| bcryptjs | Password hash | Express + Worker (Worker uses Web Crypto PBKDF2 in `core.ts`) | both |
| Helmet, CORS, rate-limit | Express hardening | Local API | `server/src` |
| Vitest | Unit tests | client lib, server incidents, worker libs | `*.test.ts` |
| Playwright | E2E | Smoke + dashboard screenshots | `e2e/` |
| Wrangler | Deploy | `npm run deploy` | root `package.json` |
| concurrently | Dev | Client + Express together | root `npm run dev` |

Not present: Next.js, Redux, Leaflet (README previously mentioned Leaflet; maps are Mapbox), Recharts (analytics uses CSS/SVG charts in-page), Supabase.

---

## 3. Project Folder Structure

```text
gis-based-emergency-dispatch-system/
├── client/                 React PWA
│   ├── public/             Static assets (logo, icons)
│   └── src/
│       ├── components/     Shared UI, maps, dialogs, dashboard panels
│       ├── hooks/          Query, live sync, map, GPS helpers
│       ├── layouts/        Admin / citizen / responder shells
│       ├── lib/            Domain helpers (status, GPS, geocode, validation)
│       ├── pages/          Route screens
│       ├── services/       HTTP API client
│       ├── store/          Zustand auth
│       ├── types/          Shared TypeScript models
│       ├── data/           GeoJSON-style boundary JSON
│       ├── App.tsx         Routes
│       ├── main.tsx        Bootstrap
│       └── sw.ts           PWA + push
├── worker/                 Production API
│   ├── lib/                Shared Worker logic
│   ├── data/               Hospital datasets
│   ├── scripts/            Data generation
│   ├── schema.sql          Baseline D1 schema
│   ├── seed.sql            Demo seed
│   ├── migrate*.sql        Additive migrations
│   ├── index.ts            Core routes
│   └── extended.ts         Additional routes
├── server/                 Local Express + Mongo
│   └── src/
│       ├── controllers/
│       ├── services/
│       ├── models/
│       ├── middleware/
│       ├── routes/
│       ├── sockets/
│       ├── seed/
│       └── tests/
├── docs/                   This documentation set
├── e2e/                    Playwright
├── scripts/                Brand/logo helper
├── wrangler.jsonc          Worker, D1, R2, public vars
├── package.json            Workspace root
└── playwright.config.ts
```

### Folder purposes

- **`client/src/pages`** — One screen per route (or grouped citizen/responder files).
- **`client/src/components`** — Reusable widgets; `ui/` is design-system primitives.
- **`client/src/lib`** — Pure helpers mirrored against Worker rules (incident transitions, Manila time).
- **`client/src/services`** — Single HTTP façade for application APIs.
- **`worker/lib`** — Permissions, hashing, routing, PDF, push, assignment lifecycle.
- **`worker/*.sql`** — Source of truth for production schema evolution.
- **`server/`** — Keep in sync conceptually; many Worker-only endpoints have no Express twin.
- **`docs/`** — Human documentation, not runtime.

---

## 4. File-by-File Guide

### Configuration and entry

#### File: `package.json` (root)

**Purpose:** npm workspaces (`client`, `server`), deploy, D1 migrate/seed, tests.  
**Main scripts:** `dev`, `build`, `deploy`, `db:migrate` … `db:migrate:v18`, `db:seed`, `test`, `test:e2e`.  
**Dependencies:** `hono`, `jose`, `web-push` (Worker runtime deps at repo root).  
**Modification notes:** New D1 migrations need a script + `worker/migrate-vN-*.sql`.

#### File: `wrangler.jsonc`

**Purpose:** Worker entry `worker/index.ts`, SPA assets from `client/dist`, D1 `DB`, R2 `MEDIA`, public `vars` (app name, Mapbox token, VAPID public key).  
**Secrets (not in file):** `JWT_SECRET`, `VAPID_PRIVATE_KEY` via `wrangler secret`.  
**Modification notes:** Do not put private keys in `vars`. Mapbox token in `vars` is a public `pk.` token and should be URL-restricted in the Mapbox dashboard.

#### File: `client/vite.config.ts`

**Purpose:** React plugin, PWA injectManifest, `@` alias, Mapbox optimizeDeps, proxy `/api` → `localhost:5000`, `envDir` = repo root.  
**Modification notes:** Production build reads `.env.production` so `VITE_API_URL` stays empty (same-origin).

#### File: `client/src/main.tsx`

**Purpose:** Mount React, apply stored appearance, import global CSS.

#### File: `client/src/App.tsx`

**Purpose:** QueryClient, Sonner toaster, offline banner, 8-hour inactivity logout, all routes.  
**Important logic:** `InactivityGuard` clears Zustand auth; `ProtectedRoute` gates admin vs citizen vs responder.  
**Modification notes:** New pages need both a `Route` and sidebar/nav entry.

#### File: `client/src/sw.ts`

**Purpose:** Workbox precache, navigation fallback, `push` and `notificationclick` handlers with vibration tones.

#### File: `client/src/vite-env.d.ts`

**Purpose:** Typed `import.meta.env` keys.

---

### Auth and routing

#### File: `client/src/store/authStore.ts`

**Purpose:** Persist `user`, `accessToken`, `refreshToken`, `lastActivity`.  
**Exports:** `getRoleHomePath`, `isAdminRole`.  
**Used by:** Almost every page and `api.ts` refresh flow.  
**Modification notes:** Changing persist key logs everyone out.

#### File: `client/src/components/auth/ProtectedRoute.tsx`

**Purpose:** Redirect unauthenticated users to `/login`; role mismatch to home path.  
**Inputs:** `requireAdmin` or `allowedRoles`.  
**Limitation:** Admin roles share one shell; finer RBAC is API-side.

#### File: `client/src/pages/auth/LoginPage.tsx`

**Purpose:** Email/password login; optional demo account panel if `VITE_DEMO_ACCOUNTS=true`.

#### File: `client/src/pages/auth/RegisterPage.tsx`

**Purpose:** Citizen registration with PH mobile validation and consent checkboxes.

#### File: `client/src/pages/auth/ForgotPasswordPage.tsx`

**Purpose:** Forgot + reset password UI calling Worker `/api/auth/forgot-password` and `/reset-password`.

---

### Layouts

#### File: `client/src/layouts/AdminLayout.tsx`

**Purpose:** Sidebar + header + `LiveSyncProvider` + `NotificationHost` + page error boundary.  
**Important:** Exits fullscreen and closes mobile drawer on route change.

#### File: `client/src/layouts/CitizenLayout.tsx`

**Purpose:** Citizen bottom/top nav shell.

#### File: `client/src/layouts/ResponderLayout.tsx`

**Purpose:** Responder shell, GPS posting, important alerts.

#### File: `client/src/components/layout/AdminSidebar.tsx`

**Purpose:** Grouped admin nav + Manila clock + health indicator.

#### File: `client/src/components/layout/AdminHeader.tsx`

**Purpose:** Title, live refresh, user menu, notification badge.

---

### API client

#### File: `client/src/services/api.ts`

**Purpose:** `api()` wrapper: JSON, Bearer token, 401 refresh via `/auth/refresh`, error messages.  
**Namespaces:** `healthApi`, `authApi`, `profileApi`, `dashboardApi`, `eventsApi`, `incidentsApi`, `mediaApi`, `sosApi`, `respondersApi`, `unitChangeApi`, `mapApi`, `transportsApi`, `notificationsApi`, `reportsApi`, `analyticsApi`, `personnelApi`, `trainingApi`, `attendanceApi`, `leaveApi`, `shiftsApi`, `resourcesApi`, `settingsApi`, `chatApi`.  
**Inputs:** Token + REST payloads.  
**Outputs:** `{ success, data, message }` shaped responses.  
**Modification notes:** Keep paths identical to Worker routes. Express may 404 Worker-only endpoints.

---

### Types

#### File: `client/src/types/index.ts`

**Purpose:** `User`, `UserRole`, `Incident`, `Assignment`, `SOSReport`, `MapData`, `PersonnelMember`, notification tracking types, etc.  
**Note:** IDs often use `_id` in JSON even though D1 primary keys are `id` — Worker aliases columns.

---

### Hooks

See section 15 below for hook catalog. Files: `useLiveSync.ts`, `LiveSyncContext.tsx`, `useLiveMapData.ts`, `useMapConfig.ts`, `useHealth.ts`, `useSmoothCoordMap.ts`, `useSocket.ts` (unused by pages).

---

### Library helpers

| File | Purpose |
|------|---------|
| `lib/utils.ts` | `cn()` Tailwind merge |
| `lib/liveTiming.ts` | Polling intervals (`LIVE.*`) |
| `lib/incidentState.ts` | UI status transitions (mirrors Worker `TRANSITIONS`) |
| `lib/validation.ts` | PH phone, password rules |
| `lib/timezone.ts` | Asia/Manila formatters |
| `lib/geocode.ts` | Reverse/forward geocode for pickers |
| `lib/responderGps.ts` | POST location to `/responders/me/location` |
| `lib/offlineQueue.ts` | IndexedDB queue; never claims sent while queued |
| `lib/fleetMerge.ts` | Split/merge vehicle vs personnel pins |
| `lib/mapBoundaries.ts` | Barangay/city/NCR GeoJSON loaders |
| `lib/hospitalMapLayers.ts` | NCR hospital Mapbox layers |
| `lib/appearance.ts` | Theme from settings/localStorage |
| `lib/alertSound.ts` | In-app notification tones |
| `lib/pushSubscribe.ts` | Browser push subscription |
| `lib/citizenLocale.ts` | EN/FIL citizen copy |
| `lib/opsVisuals.ts` | Status colors for ops UI |
| `lib/workforceMetrics.ts` | Personnel/attendance aggregations |

**Modification notes:** Incident transition maps must stay aligned with `worker/lib/core.ts` or dispatchers will see actions the API rejects.

---

### Admin pages

| File | Purpose |
|------|---------|
| `pages/admin/DashboardPage.tsx` | KPIs, live map, incident/unit/notification panels |
| `pages/admin/DispatchPage.tsx` | Queue, assign, verify, timeline, chat |
| `pages/admin/IncidentsPage.tsx` | Incident list/detail, media, status |
| `pages/admin/MapMonitoringPage.tsx` | Full GIS monitor (`MonitorMapView`) |
| `pages/admin/SOSReportsPage.tsx` | SOS inbox |
| `pages/admin/ConductionPage.tsx` | Transports CRUD + location picker |
| `pages/admin/NotificationsPage.tsx` | Inbox, broadcast, tracking, replies |
| `pages/admin/ReportsPage.tsx` | Report library + export |
| `pages/admin/AnalyticsPage.tsx` | Aggregates + k-means style grouping (API) |
| `pages/admin/PersonnelPage.tsx` | Users/responders, training, unit-change approvals |
| `pages/admin/AttendancePage.tsx` | Attendance + leave |
| `pages/admin/ShiftsPage.tsx` | Shift schedule |
| `pages/admin/ResourcesPage.tsx` | Vehicles, equipment, checklists |
| `pages/admin/SettingsPage.tsx` | System settings, audit, announcements, resets |
| `pages/admin/AdminModules.tsx` | Re-exports some admin pages |

---

### Citizen and responder pages

| File | Purpose |
|------|---------|
| `pages/citizen/CitizenSOSPage.tsx` | Hold-to-send SOS, photos, guest-capable flows as implemented in UI |
| `pages/citizen/CitizenPages.tsx` | Home, notifications, profile |
| `pages/responder/ResponderPages.tsx` | Home, map, chat, status, notifications, profile, team/unit change |

---

### Major components

See section 9. Additional files: `SmartIntakeDialog.tsx`, `IncidentActionDialogs.tsx`, `IncidentMediaGallery.tsx`, `IncidentStatusStepper.tsx`, `DispatchActionDialogs.tsx`, `IncidentTimeline.tsx`, `PersonnelActionDialogs.tsx`, `AttendanceActionDialogs.tsx`, `ShiftActionDialogs.tsx`, `TransportLocationPicker.tsx`, `GisNavigationGuide.tsx`, `NotificationHost.tsx`, `ImportantAlertHost.tsx`, dashboard panels under `components/dashboard/`, UI primitives under `components/ui/`.

UI primitives (`button`, `dialog`, `input`, `card`, `tabs`, `badge`, `dropdown-menu`, `label`, `KpiCard`, `PageHeader`, `QueryState`, `StatusBadge`, `ConfirmActionDialog`, `OfflineBanner`, `LocationDisplay`, `FreshnessLine`, `OpsSection`) wrap Radix/Tailwind. They accept standard React props; they do not call APIs.

---

### Worker

#### File: `worker/index.ts`

**Purpose:** Hono app, CORS, JWT `auth` / `requirePerm`, core REST (auth, dashboard, incidents, SOS, responders, map, notifications, push, personnel, attendance, leave, shifts, resources, transports, reports, settings, chat).  
**Exports:** `default { fetch }`.  
**Calls:** `registerExtended(app, auth)` at the bottom.  
**Errors:** 401/403/404 JSON; `onError` → 500 + `console.error`.  
**Modification notes:** Keep CORS origins in sync with production domains. Access JWT TTL is 8 hours (matches client inactivity).

#### File: `worker/extended.ts`

**Purpose:** Password reset, profile, incident create/patch/merge/cancel/reopen, multi-assign, resources CRUD, personnel create, departments, shifts mutations, analytics, responder me/team/unit, SOS cancel/update, transport patch, **events poll**, routing, training, announcements, escalation, media/R2, facilities, guest SOS, map facilities.  
**Modification notes:** Guest SOS rate limit is 5 / 15 minutes per IP hash.

#### File: `worker/lib/core.ts`

**Purpose:** `Env` types, `PERMISSIONS`, incident/responder transitions, UUID, sanitize, PH phone, password policy, haversine, PBKDF2 hash/verify, display IDs, audit/activity helpers, SOS heal, Sun Valley center, static facilities.

#### File: `worker/lib/assignmentLifecycle.ts`

**Purpose:** Terminal incident statuses; release assignments; keep vehicle status consistent with assignment.

#### File: `worker/lib/notify.ts`

**Purpose:** Insert `notifications` rows and send Web Push with tones and deep links.

#### File: `worker/lib/webpush.ts`

**Purpose:** VAPID send to `push_subscriptions`.

#### File: `worker/lib/routing.ts`

**Purpose:** Mapbox Directions or deterministic A* fallback.

#### File: `worker/lib/pdf.ts`

**Purpose:** Operations PDF bytes for report export.

#### File: `worker/lib/kmeans.ts`

**Purpose:** Analytics clustering helper.

#### File: `worker/lib/facilities.ts` / `ncrHospitals.ts`

**Purpose:** Facility and hospital datasets for map APIs.

#### File: `worker/lib/opsReset.ts`

**Purpose:** Settings reset-status / reset-data helpers (admin).

#### File: `worker/lib/brandLogo.ts` + `brigada-onse-logo-data.ts`

**Purpose:** Embedded logo for PDFs.

#### File: `worker/apply-sql.js`

**Purpose:** CLI to apply schema/migrate/seed against remote D1; skips duplicate-column errors. Uses `console.log` by design.

#### File: `worker/schema.sql` and `worker/migrate*.sql`

**Purpose:** Tables and additive columns. Apply in order via npm scripts.

---

### Express (local)

| File | Purpose |
|------|---------|
| `server/src/index.ts` | Express + Socket.io bootstrap, `/api/health`, `/api/config` |
| `server/src/config/index.ts` | Env config |
| `server/src/routes/index.ts` | Route map + rate limits |
| `server/src/middleware/index.ts` | JWT auth, permission, error handler |
| `server/src/constants/index.ts` | Roles, permissions, **narrower** incident transitions than Worker |
| `server/src/utils/jwt.ts` | jsonwebtoken sign/verify |
| `server/src/controllers/*.ts` | HTTP handlers |
| `server/src/services/*.ts` | Incident, timeline, notification, audit |
| `server/src/models/index.ts` + `extra.ts` | Mongoose schemas |
| `server/src/sockets/index.ts` | Emit helpers |
| `server/src/seed/index.ts` | Demo Mongo seed (`Password123!`) |

**Modification notes:** Express `INCIDENT_TRANSITIONS` is a subset of Worker `TRANSITIONS`. Prefer Worker behavior when they disagree.

---

### Tests and e2e

| File | Purpose |
|------|---------|
| `client/src/lib/*.test.ts` | Validation, incident state, timezone, offline queue, workforce |
| `server/src/tests/incident.test.ts` | Incident service tests |
| `worker/lib/*.test.ts` | core, routing, assignment lifecycle, pdf |
| `e2e/smoke.spec.ts` | Production smoke |
| `e2e/dashboard-screenshots.spec.ts` | Screenshot capture (uses demo credentials env with fallbacks) |
| `vitest.worker.config.ts` | Worker tests |

---

## 5. Components

Format for major components:

**ProtectedRoute** — File: `components/auth/ProtectedRoute.tsx` — Purpose: route guard — Props: `allowedRoles?`, `requireAdmin?` — State: none (Zustand) — Events: redirects — Used by: `App.tsx`.

**AdminSidebar** — File: `components/layout/AdminSidebar.tsx` — Purpose: admin nav — Props: `collapsed`, `onNavigate` — Hooks: `useHealth` — Rendered: grouped `NavLink`s.

**MapView** — File: `components/map/MapView.tsx` — Purpose: dashboard/incident map — Props: map data, selected unit, ref handle — Hooks: `useMapConfig`, Mapbox — Data: incidents, units, facilities, hospitals — Used by: Dashboard and related admin views.

**MonitorMapView** — File: `components/map/MonitorMapView.tsx` — Purpose: dedicated GIS monitor — Used by: `MapMonitoringPage`.

**TransportLocationPicker** — File: `components/map/TransportLocationPicker.tsx` — Purpose: pick origin/destination on map + geocode — Used by: Conduction.

**SmartIntakeDialog** — File: `components/intake/SmartIntakeDialog.tsx` — Purpose: structured incident create — API: `incidentsApi.create` — Used by: Dispatch/Incidents.

**NotificationHost** — File: `components/notifications/NotificationHost.tsx` — Purpose: poll notifications, toast/sound, push subscribe — Used by: AdminLayout.

**ImportantAlertHost** — File: `components/responder/ImportantAlertHost.tsx` — Purpose: high-priority responder alerts.

**OfflineBanner** — File: `components/ui/OfflineBanner.tsx` — Purpose: `navigator.onLine` banner.

**QueryState** — loading/error/empty wrappers for React Query.

**KpiCard / StatusBadge / ConfirmActionDialog** — display and confirm patterns used across admin pages.

Relationships:

```text
AdminLayout
  ├── AdminSidebar
  ├── AdminHeader
  ├── NotificationHost
  └── Outlet
        ├── DashboardPage
        │     ├── MapView
        │     ├── ActiveIncidentsPanel
        │     ├── UnitTrackingPanel
        │     └── …
        ├── DispatchPage
        │     ├── DispatchActionDialogs
        │     ├── IncidentTimeline
        │     └── SmartIntakeDialog
        └── MapMonitoringPage
              └── MonitorMapView
```

---

## 6. Pages and Routes

| Route | Page | Access | Purpose |
|-------|------|--------|---------|
| `/` | `RootRedirect` | Public | Login or role home |
| `/login` | `LoginPage` | Public (logged-in users bounced) | Sign in |
| `/register` | `RegisterPage` | Public | Citizen sign up |
| `/forgot-password` | `ForgotPasswordPage` | Public | Request reset |
| `/reset-password` | `ResetPasswordPage` | Public | Complete reset |
| `/admin` | redirect dashboard | Admin roles | Shell |
| `/admin/dashboard` | `DashboardPage` | Admin | KPIs + map |
| `/admin/dispatch` | `DispatchPage` | Admin | Dispatch center |
| `/admin/map` | `MapMonitoringPage` | Admin | GIS monitor |
| `/admin/incidents` | `IncidentsPage` | Admin | Incident list |
| `/admin/incidents/:incidentId` | `IncidentsPage` | Admin | Deep link |
| `/admin/conduction` | `ConductionPage` | Admin | Transports |
| `/admin/sos` | `SOSReportsPage` | Admin | SOS inbox |
| `/admin/notifications` | `NotificationsPage` | Admin | Notifications |
| `/admin/reports` | `ReportsPage` | Admin | Reports/export |
| `/admin/analytics` | `AnalyticsPage` | Admin | Analytics |
| `/admin/personnel` | `PersonnelPage` | Admin | Workforce |
| `/admin/attendance` | `AttendancePage` | Admin | Attendance |
| `/admin/shifts` | `ShiftsPage` | Admin | Shifts |
| `/admin/resources` | `ResourcesPage` | Admin | Fleet/equipment |
| `/admin/settings` | `SettingsPage` | Admin | Settings/audit |
| `/citizen` | `CitizenHomePage` | `CITIZEN` | Home |
| `/citizen/sos` | `CitizenSOSPage` | `CITIZEN` | SOS |
| `/citizen/notifications` | `CitizenNotificationsPage` | `CITIZEN` | Inbox |
| `/citizen/profile` | `CitizenProfilePage` | `CITIZEN` | Profile |
| `/responder` | `ResponderHomePage` | `EMERGENCY_RESPONDER` | Assignments |
| `/responder/map` | `ResponderMapPage` | Responder | Field map |
| `/responder/chat` | `ResponderChatPage` | Responder | Team chat |
| `/responder/status` | `ResponderStatusPage` | Responder | Duty status |
| `/responder/notifications` | `ResponderNotificationsPage` | Responder | Inbox |
| `/responder/profile` | `ResponderProfilePage` | Responder | Profile |
| `*` | Navigate `/` | — | Catch-all |

**Admin roles** (`isAdminRole`): `SYSTEM_ADMINISTRATOR`, `CENTRAL_DISPATCHER`, `DEPARTMENT_DISPATCHER`.  
**Auth:** Bearer JWT in Zustand; missing token → `/login`.  
**Permission checks:** UI may hide buttons; Worker `requirePerm` is authoritative.

---

## 7. Authentication and Authorization

### Login

1. `POST /api/auth/login` with email/password.
2. Worker checks lockout (`failed_logins` / `locked_until`), verifies PBKDF2 hash, writes `login_attempts`, issues JWT access (8h) + refresh (7d), stores refresh on `users.refresh_token`.
3. Client `setAuth` persists tokens.

### Register

Citizen-only `POST /api/auth/register`: PH phone, password policy, consent fields when provided.

### Refresh / logout / me

- `POST /api/auth/refresh` — rotate refresh.
- `POST /api/auth/logout` — clear stored refresh (auth required).
- `GET /api/auth/me` — current user.

### Password reset

`forgot-password` stores hashed token in `password_resets`; `reset-password` consumes it. Reset emails are not a guaranteed SMTP integration in this repo (request still records an audit event).

### Session

- Access token in memory + localStorage via Zustand.
- 8-hour inactivity timer in `App.tsx`.
- PWA does not use httpOnly cookies for JWT (XSS can read localStorage).

### Roles (actual)

1. SYSTEM_ADMINISTRATOR — `*` permissions
2. CENTRAL_DISPATCHER — dispatcher perm set including `personnel:manage` and `settings:manage` / `analytics:read` (Worker)
3. DEPARTMENT_DISPATCHER — dispatcher set **without** `personnel:manage`
4. EMERGENCY_RESPONDER — read incidents/SOS, operations, notifications, map, self attendance
5. CITIZEN — SOS + notifications + profile

See `docs/role-permission-matrix.md` and `PERMISSIONS` in `worker/lib/core.ts`.

---

## 8. Database

Production is D1 SQLite. Baseline tables in `schema.sql`; extra tables/columns in migrations.

### Relationship overview

```text
roles
departments
users ── role_id
  ├── responders ── department_id, assigned_vehicle_id → vehicles
  ├── citizens
  ├── incidents (reported_by, dispatcher)
  ├── notifications
  ├── chat_messages
  └── audit_logs

locations
incidents ── incident_type_id, location_id, department_id
  ├── sos_requests
  ├── assignments ── responder_id, vehicle_id
  ├── activity_logs
  ├── incident_status_history
  ├── media_attachments
  └── chat_messages

vehicles ── department_id
equipment
checklists / checklist_items
transports ── assigned_vehicle_id
shifts / teams
attendance / leave_requests / training_records / certifications
unit_change_requests
facilities
gps_tracks
push_subscriptions
notification_replies / notification_deliveries
announcements / escalation_rules / system_settings / system_events
login_attempts / password_resets / idempotency_keys / guest_sos_rate
counters (display ID sequences)
```

### Notable columns

- **users:** status, refresh_token, email_verified, phone_verified, language, consent_at, mfa_secret (column exists; Settings UI notes MFA is **not implemented**), failed_logins, locked_until, last_login_at
- **incidents:** priority, status, lock, caller/patient/vitals, master_incident_id, timestamps per phase
- **responders:** availability/operational status, lat/lng, team_name, assigned_vehicle_id
- **transports:** origin/destination text **and** lat/lng (v16)

### Indexes (baseline)

`idx_incidents_status`, `idx_users_email`, `idx_sos_status`; later migrations add GPS, status history, login attempts, facilities, unit-change, push subscriptions.

### Realtime

No D1/Supabase realtime channel. App polls `/api/events` and hot GET endpoints.

There are **no SQL triggers** in the checked schema files. Enums are TEXT conventions, not SQLite ENUM types.

---

## 9. API / Services

Convention: JSON `{ success: boolean, data?: T, message?: string }`. Auth: `Authorization: Bearer <access>` unless noted. Idempotency: header `Idempotency-Key` on selected writes.

### Public / config

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/api/health` | GET | No | DB ping, map token presence |
| `/api/config` | GET | No | Mapbox token + style for the client |
| `/api/dashboard/health` | GET | No | Health subset |
| `/api/sos/types` | GET | No | Active incident types |
| `/api/sos/guest` | POST | No | Guest SOS (IP rate limit) |
| `/api/auth/login` | POST | No | Login |
| `/api/auth/register` | POST | No | Citizen register |
| `/api/auth/refresh` | POST | Refresh token body | New access |
| `/api/auth/forgot-password` | POST | No | Reset request |
| `/api/auth/reset-password` | POST | No | Reset complete |

### Authenticated (Worker)

**Auth:** `/api/auth/logout` POST, `/api/auth/me` GET, `/api/profile` GET/PATCH, `/api/profile/delete-request` POST.

**Dashboard:** `/api/dashboard/stats` GET (`incidents:read`).

**Incidents:** GET `/`, GET `/:id`, POST `/`, PATCH `/:id`, verify, false-alarm, status, assign, assign-many, nearby-units, timeline, notes, duplicates, merge, cancel, reopen, media.

**SOS:** POST `/api/sos`, GET my-status, GET list, cancel/reopen/update by id.

**Responders:** dispatch-queue, assignments/mine, accept, decline, status, backup, me, me/status, me/location, me/units, team-change, unit-change, available, list.

**Unit change:** GET `/api/unit-change-requests`, POST `/:id/decide`.

**Map:** `/api/map/data`, `/api/map/fleet`, `/api/map/facilities`, `/api/routing/plan`.

**Notifications:** list, read, delete, read-all, dispatch-team, broadcast, tracking, reply.

**Push:** vapid-public-key, subscribe, unsubscribe.

**Ops:** personnel, attendance, leave-requests, shifts, resources (vehicles/equipment/units/checklists), transports, training, departments, facilities.

**Reports / analytics:** `/api/reports`, `/library`, `/export`; `/api/analytics`.

**Settings:** GET/PATCH `/api/settings`, audit-logs, reset-status, reset-data, ensure-ops-accounts, announcements, escalation-rules (+ evaluate).

**Chat:** `/api/chat/incident/:incidentId` GET/POST; `/api/chat/responders` GET/POST.

**Media:** POST `/api/media`, `/api/media/upload`, GET incident media, GET/DELETE `/api/media/:id`.

**Events:** GET `/api/events?since=` — poll cursor.

**Errors:** 400 validation, 401 auth, 403 permission, 404 missing, 409 conflicts (e.g. duplicate email), 429 guest SOS / Express rate limits.

**Called from:** matching objects in `client/src/services/api.ts`.

Express covers a **subset** (see `server/src/routes/index.ts`). Production clients should hit the Worker.

---

## 10. State Management

| Kind | Tool | Where |
|------|------|--------|
| Auth | Zustand persist | `authStore` |
| Server data | TanStack Query | pages/hooks; keys like `dashboard-stats`, `map-data`, `dispatch-queue` |
| Live cursor | React state in `useLiveSync` | Admin layout provider |
| URL | React Router params | `incidents/:incidentId` |
| Appearance | localStorage | `appearance.ts` |
| Offline writes | IndexedDB | `offlineQueue.ts` |
| No Redux / no Zustand besides auth | — | Local `useState` on large pages is common |

---

## 11. Custom Hooks

**useLiveSync** — File: `hooks/useLiveSync.ts` — Polls `eventsApi.poll` — Returns live/reconnecting/offline, lastUpdated, refresh — Side effect: invalidates many query keys — Used via `LiveSyncProvider`.

**useAdminLiveSync** — File: `LiveSyncContext.tsx` — Context consumer for admin header refresh.

**useLiveMapData** — File: `hooks/useLiveMapData.ts` — Full map query + 1s fleet overlay — Used by Dashboard/Map.

**useMapConfig** — File: `hooks/useMapConfig.ts` — Token from env or `/api/config`.

**useHealth** — File: `hooks/useHealth.ts` — `/api/health` for sidebar.

**useSmoothCoordMap** — File: `hooks/useSmoothCoordMap.ts` — Interpolates pin movement.

**useSocket** — File: `hooks/useSocket.ts` — Socket.io client — **Not imported by any page** (local Express leftover).

---

## 12. Utilities

Covered in the lib table (section 4). Highlights:

- Distance: `haversineKm` in Worker `core.ts`; client geocode/map helpers
- GPS stale: `GPS_STALE_MINUTES` (default 2) on Worker map payloads
- Export: `GET /api/reports/export` CSV/XLS/PDF
- Permissions: `hasPerm` Worker; `ROLE_PERMISSIONS` Express

---

## 13. Types and Interfaces

Primary client models: `User` / `UserRole`, `Incident`, `Assignment`, `SOSReport`, `MapData` / `MapUnit` / `MapFacility` / `MapRoute`, `PersonnelMember`, `NotificationItem` / `NotificationTracking`.

Worker `AppUser`: `{ userId, email, role, permissions }`.

Express `TokenPayload` in `server/src/utils/jwt.ts`.

Incident **status strings** are free-text aligned to `TRANSITIONS` in `core.ts` (richer than Express `INCIDENT_STATUSES`).

---

## 14. Environment Configuration

### Client (`VITE_*`, repo root env files)

| Variable | Required | Purpose | Used in | Example |
|----------|----------|---------|---------|---------|
| `VITE_API_URL` | No | API prefix; empty = `/api` | `api.ts`, `responderGps.ts` | *(empty in production)* |
| `VITE_SOCKET_URL` | No | Socket.io URL | `useSocket.ts` | `http://localhost:5000` |
| `VITE_APP_VERSION` | No | Display/health | example env | `1.2.0` |
| `VITE_MAPBOX_ACCESS_TOKEN` | No | Skip `/api/config` | `useMapConfig.ts` | `pk.YOUR_KEY_HERE` |
| `VITE_MAP_PROVIDER` | No | Documented; maps assume mapbox | `.env.example` | `mapbox` |
| `VITE_DEMO_ACCOUNTS` | No | Show demo logins | `LoginPage.tsx` | `false` |
| `VITE_ENABLE_GUEST_SOS` | No | In `.env.example` only; **not referenced** in client source | — | `true` |

### Server / Worker

| Variable | Required | Purpose | Used in | Example |
|----------|----------|---------|---------|---------|
| `JWT_SECRET` | Yes (prod) | Sign/verify JWT | Worker `jwtSecret` | wrangler secret |
| `JWT_REFRESH_SECRET` | Express only | Refresh sign | `server/src/config` | `change-me-...` |
| `MAPBOX_ACCESS_TOKEN` | Recommended | Config + Directions | Worker env / wrangler vars | `pk.YOUR_KEY_HERE` |
| `GPS_STALE_MINUTES` | No | Stale GPS flag | Worker | `2` |
| `VAPID_PUBLIC_KEY` | Push | Client subscribe | wrangler vars | public key |
| `VAPID_PRIVATE_KEY` | Push | Send push | wrangler secret | `YOUR_KEY_HERE` |
| `VAPID_SUBJECT` | No | `mailto:` | wrangler vars | `mailto:admin@example.com` |
| `MONGODB_URI` | Local Express | Mongo | `server` | `mongodb://127.0.0.1:27017/barangay-dispatch` |
| `PORT` | Local | Express port | `server` | `5000` |
| `CLIENT_URL` | Local | CORS origins | `server` | `http://localhost:5173` |
| `NODE_ENV` | No | Express mode | `server` | `development` |
| `E2E_BASE_URL` | E2E | Playwright target | `playwright.config.ts` | production URL |
| `E2E_ADMIN_EMAIL` / `E2E_ADMIN_PASSWORD` | E2E | Screenshot spec | `e2e/dashboard-screenshots.spec.ts` | overrides demo defaults |

Firebase/Twilio/`GOOGLE_MAPS_API_KEY` in `.env.example` are unused by current production code.

Never commit real secrets. `.env` is gitignored; `.env.example` and `.env.production` (empty Vite URLs) are tracked.

---

## 15. Data Flow

### Dispatcher assigns a unit

```text
Dispatch UI
  → incidentsApi.assign / assign-many
  → Worker requirePerm(incidents:assign)
  → D1 assignments + responder/vehicle status
  → notifyUsers (in-app + Web Push)
  → audit + activity_logs
  → JSON response
  → React Query invalidate (or next /api/events poll)
  → Queue + map + responder home update
```

### Citizen SOS

```text
CitizenSOSPage
  → sosApi.create (or offlineQueue if offline)
  → POST /api/sos
  → locations + incidents + sos_requests
  → dispatcher notifications
  → citizen my-status poll
```

### Live map

```text
useLiveMapData
  → GET /api/map/data (warm)
  → GET /api/map/fleet (1s)
  → merge pins
  → MapView / MonitorMapView
Responder GPS: watchPosition → POST /api/responders/me/location → gps_tracks + responder lat/lng
```

---

## 16. Error Handling

- **Validation:** Worker `jsonError` 400 (phone, password, missing fields).
- **Auth:** 401 invalid/expired JWT; client refresh then logout.
- **RBAC:** 403 insufficient permissions.
- **Network:** Query `retry: 1`; `QueryState` / toasts; offline banner; IndexedDB queue.
- **Admin crash:** `OutletErrorBoundary` in `AdminLayout` (`console.error`).
- **Worker:** `app.onError` 500.
- **Express:** `errorHandler` 500 + `console.error`.
- **Guest SOS:** 429.
- **Express login/SOS:** `express-rate-limit` (not the same as Worker guest limiter).

No global React error boundary wraps citizen/responder layouts.

---

## 17. Security Architecture

Implemented:

- JWT Bearer auth (jose HS256) on Worker
- Role permission lists + `requirePerm`
- Password policy + PBKDF2 hashing (`core.ts`)
- Login attempt logging and lockout fields
- `sanitizeText` on many string inputs
- PH phone normalization
- CORS allowlist on Worker
- Guest SOS IP rate limit
- Idempotency keys on some writes
- Audit logs
- Helmet + rate-limit on Express
- Settings UI can **store** 2FA preference; enrollment is **not** implemented

Not implemented / do not claim:

- Supabase RLS (no Supabase)
- HttpOnly cookie session for SPA JWT
- Full MFA
- IP restriction despite a settings flag
- Worker-wide rate limit on login (Express has one; Worker logs attempts)

Weaknesses are listed in `CODEBASE_AUDIT.md`.

---

## 18. Development Setup

### Prerequisites

- Node.js 20+
- npm
- For local Express path: MongoDB 6+
- For production-like API: Cloudflare account + Wrangler (`npx wrangler login`)
- Mapbox public token for maps/routing

### Install and local UI + Express

```bash
npm install
copy .env.example .env
# set JWT_SECRET, MONGODB_URI, MAPBOX tokens
npm run seed          # Mongo seed (server workspace)
npm run dev           # Express :5000 + Vite :5173
```

Open `http://localhost:5173`. Vite proxies `/api` to Express.

### Production data (D1)

```bash
npm run db:migrate
npm run db:migrate:v2
# … through v18 as needed
npm run db:seed
npx wrangler secret put JWT_SECRET
npx wrangler secret put VAPID_PRIVATE_KEY
```

Demo seeded password (non-production): `Password123!`. Do not enable `VITE_DEMO_ACCOUNTS=true` on the public login page.

### Commands (from root `package.json`)

| Command | Effect |
|---------|--------|
| `npm run dev` | Express + Vite |
| `npm run build` | `tsc` server + `tsc -b && vite build` client |
| `npm run deploy` | Client build + `wrangler deploy` |
| `npm test` | server vitest + client vitest + worker vitest |
| `npm run test:e2e` | Playwright |
| `npm run lint` | **Not defined** |

There is no ESLint script in the repo.
