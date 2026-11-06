# Changelog — v1.2.0 (audit + production gaps)

## Architecture
* Confirmed production source of truth: **Cloudflare Worker + D1 + R2** (Express/Mongo local only).
* Audit docs: `system-audit.md`, `requirements-traceability.md`, `role-permission-matrix.md`, `e2e-test-matrix.md`, `release-checklist.md`.

## Added
* Excel/XLS export for reports
* Training records, announcements, escalation rules, media metadata, notification deliveries, system events (migrate v4)
* Guest SOS (`POST /api/sos/guest`) with rate limit → Unverified queue
* Mapbox Directions + deterministic A* fallback (`GET /api/routing/plan`)
* Descriptive K-means groups in analytics
* Offline SOS IndexedDB queue (never claims “sent” while queued)
* Admin mobile navigation drawer
* Facility create API; settings announcement publisher

## Health
* Version `1.2.0`; `realtimeTransport: polling` documented honestly

---
