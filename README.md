# GIS-Based Emergency Dispatch System

**Barangay Sun Valley** — BDRRMO Emergency Dispatch and Responder Coordination System with Real-Time Incident Monitoring.

## Stack

- **Client:** React 18, TypeScript, Vite, Tailwind CSS, Mapbox GL, PWA
- **Production API:** Cloudflare Worker (Hono) + D1 + R2 — [`docs/DEPLOY.md`](docs/DEPLOY.md)
- **Local API (optional):** Express + MongoDB + Socket.io (`npm run dev`)
- **Maintainer docs:** [`docs/CODEBASE_GUIDE.md`](docs/CODEBASE_GUIDE.md) · [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

## Prerequisites

- Node.js 20+
- MongoDB 6+ (local or Atlas)

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
copy .env.example .env

# 3. Seed demo data
npm run seed

# 4. Start dev servers (API :5000, Client :5173)
npm run dev
```

Open http://localhost:5173

## Demo accounts (non-production)

Seeded D1/Mongo users use `Password123!`. They are **not displayed** on https://emergency.brigadaonse.org unless `VITE_DEMO_ACCOUNTS=true`.

## Project Structure

```
client/          React PWA (admin + citizen + responder)
worker/          Production API (Hono) + D1 schema/migrations
server/          Local Express API + Socket.io (not production source of truth)
docs/            Maintainer and thesis documentation
```

## Development Phases

All phases implemented:

- **Phase 1:** Auth, RBAC, shells, seed data, dashboard KPIs
- **Phase 2:** GIS map (Mapbox GL), incidents module, map monitoring
- **Phase 3:** Citizen SOS flow, dispatch center, responder workflow, assignments
- **Phase 4:** Socket.io real-time events, GPS tracking, notifications, chat API
- **Phase 5:** Conduction schedules, personnel, attendance, shifts, resources
- **Phase 6:** Reports export (CSV), settings, audit logs
- **Phase 7:** PWA service worker, offline banner, unit tests

## API Endpoints

See `server/src/routes/index.ts` for full route map including:

- `/api/incidents/*` — CRUD, verify, assign, status, timeline
- `/api/sos/*` — Citizen SOS, list, status
- `/api/responders/*` — Dispatch queue, assignments, GPS, status
- `/api/map/data` — Geo map bundle
- `/api/transports`, `/api/personnel`, `/api/attendance`, `/api/shifts`
- `/api/resources/*`, `/api/notifications`, `/api/reports`, `/api/settings`
- `/api/chat/incident/:id`

## Deploy (production)

Same Cloudflare Worker serves the PWA and `/api/*` (D1). Custom domain: `https://emergency.brigadaonse.org`.

```bash
npm run db:migrate:v2   # additive D1 migration, keeps existing rows
npm run deploy
```

Rollback and health checks: [`docs/DEPLOY.md`](docs/DEPLOY.md)

## License

Capstone project — Barangay Sun Valley, Parañaque City.
