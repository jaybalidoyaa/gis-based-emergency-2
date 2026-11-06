# Architecture

## High-level architecture

Production is a single Cloudflare Worker that serves the Vite-built SPA from assets and handles `/api/*` against D1 (and R2 for media).

```mermaid
flowchart TD
  Users[Dispatchers / Responders / Citizens]
  SPA[React PWA in browser]
  SW[Service Worker + Web Push]
  Worker[Cloudflare Worker Hono]
  D1[Cloudflare D1 SQLite]
  R2[Cloudflare R2 media]
  MB[Mapbox GL and Directions]
  OSM[OSM geocoding in client]

  Users --> SPA
  SPA --> SW
  SPA -->|HTTPS JSON Bearer JWT| Worker
  SPA --> MB
  SPA --> OSM
  Worker --> D1
  Worker --> R2
  Worker -->|VAPID| SW
  Worker --> MB
```

Local `npm run dev` is a **different** topology:

```mermaid
flowchart LR
  Vite[Vite :5173] -->|proxy /api| Express[Express :5000]
  Express --> Mongo[MongoDB]
  Express --> SIO[Socket.io]
  Vite -.->|optional VITE_SOCKET_URL| SIO
```

Do not assume production uses MongoDB or Socket.io.

---

## Process and deploy

```mermaid
flowchart LR
  Src[client/ + worker/]
  Build[npm run build:client]
  Dist[client/dist assets]
  Wdeploy[wrangler deploy]
  Src --> Build --> Dist --> Wdeploy
```

`wrangler.jsonc`: `run_worker_first: ["/api/*"]`, SPA `not_found_handling`. Custom domain `emergency.brigadaonse.org`.

Optional `render.yaml` describes an Express Docker service; that is **not** the documented production path in `docs/DEPLOY.md`.

---

## Authentication

```mermaid
sequenceDiagram
  participant C as SPA
  participant W as Worker
  participant D as D1
  C->>W: POST /api/auth/login
  W->>D: users + login_attempts
  W-->>C: accessToken 8h + refreshToken 7d
  C->>C: Zustand persist sv-dispatch-auth
  C->>W: Authorization Bearer access
  W->>W: jose jwtVerify
  alt 401
    C->>W: POST /api/auth/refresh
    W->>D: match users.refresh_token
    W-->>C: new tokens
  end
```

Role home paths: citizen `/citizen`, responder `/responder`, else `/admin/dashboard`.

---

## Live updates (production)

```mermaid
flowchart TD
  Poll[GET /api/events?since=]
  Cursor[serverTime cursor]
  Inv[Invalidate React Query keys]
  UI[Dashboard / Dispatch / Map / Inbox]
  Poll --> Cursor --> Inv --> UI
  GPS[GET /api/map/fleet 1s] --> Map[Map pins]
```

Express Socket.io rooms (`dispatch`, `user:id`, `incident:id`) exist only on the local server.

---

## Incident data flow

```mermaid
flowchart TD
  Src[Citizen SOS / Guest SOS / Dispatcher intake]
  Loc[locations row]
  Inc[incidents row]
  Sos[sos_requests optional]
  Q[Dispatch queue]
  Asn[assignments]
  R[responders + vehicles status]
  N[notifications + push]
  T[timeline activity_logs + status_history]

  Src --> Loc --> Inc
  Inc --> Sos
  Inc --> Q --> Asn --> R
  Asn --> N
  Inc --> T
```

---

## Database relationships

```mermaid
erDiagram
  USERS ||--o| RESPONDERS : "user_id"
  USERS ||--o| CITIZENS : "user_id"
  ROLES ||--o{ USERS : "role_id"
  DEPARTMENTS ||--o{ RESPONDERS : "department_id"
  DEPARTMENTS ||--o{ VEHICLES : "department_id"
  INCIDENT_TYPES ||--o{ INCIDENTS : "incident_type_id"
  LOCATIONS ||--o{ INCIDENTS : "location_id"
  USERS ||--o{ INCIDENTS : "reported_by"
  INCIDENTS ||--o{ SOS_REQUESTS : "incident_id"
  INCIDENTS ||--o{ ASSIGNMENTS : "incident_id"
  RESPONDERS ||--o{ ASSIGNMENTS : "responder_id"
  VEHICLES ||--o{ ASSIGNMENTS : "vehicle_id"
  INCIDENTS ||--o{ ACTIVITY_LOGS : "incident_id"
  INCIDENTS ||--o{ CHAT_MESSAGES : "incident_id"
  USERS ||--o{ NOTIFICATIONS : "recipient"
  RESPONDERS ||--o{ GPS_TRACKS : "responder_id"
  RESPONDERS ||--o{ ATTENDANCE : "responder_id"
  VEHICLES ||--o{ TRANSPORTS : "assigned_vehicle_id"
```

---

## Frontend module map

```mermaid
flowchart TB
  App[App.tsx routes]
  Admin[AdminLayout + LiveSync]
  Cit[CitizenLayout]
  Res[ResponderLayout]
  Api[services/api.ts]
  Store[authStore Zustand]
  Q[TanStack Query]
  App --> Admin
  App --> Cit
  App --> Res
  Admin --> Q
  Cit --> Q
  Res --> Q
  Q --> Api
  Api --> Store
```

---

## Worker module map

```text
worker/index.ts          core REST + JWT + CORS
worker/extended.ts       extra REST (events, media, guest SOS, …)
worker/lib/core.ts       RBAC, transitions, crypto, IDs
worker/lib/notify.ts     in-app + push fanout
worker/lib/webpush.ts    VAPID
worker/lib/assignmentLifecycle.ts
worker/lib/routing.ts
worker/lib/pdf.ts
worker/schema.sql + migrate-v*.sql
```

---

## Trust boundaries

| Boundary | Mechanism |
|----------|-----------|
| Browser → API | HTTPS, CORS allowlist, JWT |
| API → D1 | Worker binding, parameterized SQL |
| API → R2 | `MEDIA` binding, auth on upload/get |
| Maps | Public Mapbox token (restrict by URL in Mapbox) |
| Push | VAPID keys; private key must be a Worker secret |

SPA JWT in localStorage is reachable by XSS. Treat input sanitization and CSP (if added later) as relevant; Helmet CSP applies to Express only, not the Worker SPA.
