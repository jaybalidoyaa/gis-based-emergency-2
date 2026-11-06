# Requirements Traceability Matrix

Source: Approved GIS Emergency Dispatch thesis / build requirements vs production Worker+D1 app.  
Geographic scope: **Barangay Sun Valley only**. No claim of Philippine 911 integration.

Legend: W=Working · P=Partial · M=Missing · B=Broken · R=Risk · F=Fixed/this release

| ID | Requirement | Before | After | Evidence / fix |
|----|-------------|--------|-------|----------------|
| R01 | Multi-role RBAC | P | P→F | `worker/lib/core.ts` PERMISSIONS; frontend route guards |
| R02 | Citizen SOS + GPS/manual pin | W | W | CitizenSOSPage + hold-to-send |
| R03 | Guest emergency report | M | F | `POST /api/sos/guest` → Unverified |
| R04 | Dispatcher smart intake | W | W | SmartIntakeDialog |
| R05 | Verify / false alarm / cancel / reopen | W | W | APIs + Dispatch UI |
| R06 | Duplicate detect / merge | P | P | Intake duplicates; merge API exists |
| R07 | Multi-unit assign + ack | W | W | assign-many + accept/decline |
| R08 | Incident timeline | W | W | activity_logs |
| R09 | Closed immutable | P | F | Transitions + reopen reason/audit |
| R10 | Live map + boundary | W | W | MapView + sun-valley.json |
| R11 | Facilities layers | P | F | CRUD `/api/facilities` |
| R12 | Routing / shortest path | P | F | Mapbox Directions adapter + A* fallback |
| R13 | K-means descriptive groups | M | F | Analytics `kmeansGroups` |
| R14 | Realtime events | P | P | Polling event bus (not Socket.io prod) |
| R15 | Offline SOS queue | M | F | IndexedDB + sync |
| R16 | In-app notifications | W | W | notifications table |
| R17 | SMS/Push delivery tracking | M | F | `notification_deliveries` + mock provider |
| R18 | Escalation rules | M | F | `escalation_rules` + evaluate endpoint |
| R19 | Announcements | M | F | announcements API + UI feed |
| R20 | Conduction / transport | W | W | Calendar + conflict checks |
| R21 | Personnel + training/certs | P | F | `training_records` API |
| R22 | Vehicles/equipment/checklists | W | W | Resources module |
| R23 | Reports CSV/PDF/Excel | P | F | export `csv|pdf|xlsx` |
| R24 | Analytics KPIs | P | F | Peak hours, heatmap, K-means |
| R25 | Audit logs | W | W | audit_logs |
| R26 | Media attachments | M | F | media_attachments + R2 |
| R27 | PWA installable | W | W | vite-plugin-pwa |
| R28 | iPhone 14 layout | P | P | safe-area; continue E2E |
| R29 | Out-of-jurisdiction warning | P | F | geocode boundary + dispatcher note |
| R30 | No dual DB truth | R | F | Documented Worker+D1 only |

## Planned tests proving completion

See `docs/e2e-test-matrix.md` and Vitest unit suites under `client/src/lib/*.test.ts`, `worker/lib/core.test.ts`.
