# System Audit — GIS Emergency Dispatch (Barangay Sun Valley)

**Live:** https://emergency.brigadaonse.org/  
**Audit date:** 2026-09-03  
**Production version (health):** 1.1.1 → target 1.2.x after this release  
**Scope:** Barangay Sun Valley, Parañaque City only. No Philippine 911 / PNP / BFP / national DB integration.

## Architecture decision (authoritative)

| Layer | Production | Local/thesis comparison |
|-------|------------|-------------------------|
| API | Cloudflare Worker (`worker/index.ts` + `extended.ts`) | Express (`server/`) |
| Database | Cloudflare D1 SQLite | MongoDB + Mongoose |
| Media | R2 bucket `barangay-dispatch-media` | Local `uploads/` |
| SPA | Vite React PWA served as Worker assets | Vite dev server |
| Realtime | Authenticated `/api/events` polling with backoff | Socket.io on Express (dev only) |

**Do not run two sources of truth.** Production remains Worker + D1. MongoDB/Firebase Auth in older thesis text are superseded. Firebase is reserved for optional FCM push only; Twilio for optional SMS.

## Health snapshot (verified)

- API: ok  
- Database: ok  
- Map: ok (Mapbox token present)  
- Notifications: ok (in-app table)  
- Realtime: **polling** (not WebSocket/Socket.io in production)

## Roles in production

`SYSTEM_ADMINISTRATOR`, `CENTRAL_DISPATCHER`, `DEPARTMENT_DISPATCHER`, `EMERGENCY_RESPONDER`, `CITIZEN`

(UI may abbreviate; DB/JWT use full names above.)

## Module status summary

| Module | Status | Notes |
|--------|--------|-------|
| Auth (login/register/forgot/reset/refresh) | Working | JWT access ~8h + refresh |
| Dashboard | Working | Live D1 counts |
| Dispatch + Smart Intake | Working | 3-panel; intake multi-step |
| Map Monitoring | Working | Boundary, clusters, filters; traffic entitlement-dependent |
| Incidents / SOS | Working | Cancelled read-only + reopen |
| Conduction | Working | Calendar/list; conflict warnings |
| Personnel / Attendance / Shifts | Partial | Training/cert tables were missing → added |
| Resources / Equipment | Working | CRUD + readiness reasons |
| Reports | Partial | CSV/PDF existed; Excel added |
| Analytics | Partial | KPIs + heatmap; K-means grouping added |
| Notifications | Partial | In-app; SMS/push providers stubbed with delivery attempts |
| PWA | Partial | Precache shell; offline SOS queue added |
| Guest SOS | Missing → added | Unverified queue + rate limit |
| Announcements | Missing → added | Publish API + citizen feed |
| Escalation rules | Missing → added | Configurable thresholds |
| Media attachments | Missing → added | Metadata + R2 hook |
| Facility admin CRUD | Partial | Static + DB read; write API added |
| A* / routing | Partial | Mapbox Directions adapter + grid A* fallback |
| Department scoping | Partial | Permission filter; enforce dept on assign |

## Security findings

| Finding | Severity | Remediation |
|---------|----------|-------------|
| Secrets in `.env` must never be committed | High | `.env.example` placeholders only; Worker secrets via `wrangler secret` |
| DEPARTMENT_DISPATCHER shared many central perms | Medium | Tighten + department-scoped queries |
| Guest SOS abuse | Medium | Rate limit + Unverified + callback required |
| Closed incident mutation | Addressed | Backend transition + reopen gates |
| Realtime channel auth | Medium | Events require JWT; no public stream |

## Responsive / UX findings

| Surface | Finding | Fix |
|---------|---------|-----|
| Admin | Fixed sidebar; weak mobile | Drawer + overlay on &lt;1024px |
| Citizen | Safe-area improved | Keep 100dvh + bottom nav padding |
| Responder | Bottom nav OK | Offline queue for status/GPS |
| Tables | Wide on phone | Cards / horizontal scroll already partial |

## Realtime strategy

Cloudflare Workers do not host sticky Socket.io like Express. Production uses a **shared event-polling layer** (`GET /api/events?since=`) with:

- Poll cursor (`serverTime`)  
- Exponential backoff  
- Query invalidation on change  
- Connection state UI  

Optional future: Durable Object WebSocket hibernation. Production realtime is HTTP polling, not a persistent WebSocket to the Worker.

## Privacy

No national integration. Precise responder GPS only to authorized dispatcher/admin roles. Audit logs append-only.
