# Feature completion status

## Completed

### Prior pass
- Cancelled/terminal read-only + Reopen (incident & SOS)
- Expanded incident/SOS filters
- Personnel/vehicle/conduction form a11y + validation
- Citizen iPhone safe-area PWA shell
- Health checks wired to real services

### Large-scope pass
- **Smart Intake**: multi-step Caller → Location → Details → Review; Mapbox autocomplete + reverse geocode; draft save; unsaved warning; success screen with incident number; Sun Valley boundary hint
- **Dispatch Center**: three-panel layout (queue · details/map · recommended units with ETA/GPS)
- **Conduction**: calendar / day / week / list; conflict warning; vehicle assign; cancel/complete; recurring + reminder fields; missed status
- **Map Monitoring**: search, type/unit/facility filters, boundary/facilities/traffic toggles, layer styles, locate Sun Valley, fit markers, clustering, legend
- **Reports**: date/status/priority filters, CSV + PDF export, print/preview with report number + signatories
- **Analytics**: labelled dates, cancelled/false-alarm KPIs, peak hours chart, category, heatmap points, response trend panel
- **Equipment**: list/create/edit (assign unit, qty, inspection, expiration, missing/damaged)
- **E2E**: Playwright smoke + viewport overflow checks (`npm run test:e2e`)
- Docs: button matrix, a11y audit, deploy/rollback

## Environment-dependent
- Mapbox traffic tiles require Mapbox Traffic entitlement
- Live iPhone Safari screenshots: use Playwright `iphone-14` project against production after deploy
- Realtime remains authenticated polling (`/api/events`)
