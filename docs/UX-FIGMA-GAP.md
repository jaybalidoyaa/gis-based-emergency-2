# UX ↔ Figma gap analysis & acceptance

**Live product:** https://emergency.brigadaonse.org  
**Figma:** [Barangay Sun Valley Dispatch System](https://www.figma.com/design/0rNMaAEm2pB3G0ZQTsW3MF/Barangay-Sun-Valley-Dispatch-System)  
**Constraint:** Colors, palette, gradients, and branding are locked. Changes cover IA, hierarchy, layout, spacing, typography scale, component consistency, responsive behavior, accessibility, labels, states, and workflows only.

Figma was not machine-readable in this environment (WebGL). Mapping uses `docs/spec-reconciliation.md` §10 (admin modules) plus the product’s written operational-console goals. Semantic screen names replace generic Figma layer names such as “Citizen App” and “Responder App.”

---

## 1. Route ↔ Figma / semantic screen mapping

| Live route | Semantic screen | Status after UX pass |
|---|---|---|
| `/admin/dashboard` | Ops Dashboard | Freshness + KPI labels aligned with Dispatch |
| `/admin/dispatch` | Dispatch Center | 3-pane queue / details+timeline / units; confirm dialogs; intake CTA |
| `/admin/map` | Map Monitoring | Queue context strip + Dispatch deep-link; freshness |
| `/admin/incidents` (+`:id`) | Incidents | PageHeader + Dispatch link |
| `/admin/sos` | SOS Reports | QueryState, freshness, navy chrome, confirm + Dispatch link |
| `/admin/conduction` | Conduction Schedules | PageHeader |
| `/admin/notifications` | Notifications | PageHeader + QueryState + ops chrome |
| `/admin/reports` | Documents & Reports | Nav + page label normalized |
| `/admin/analytics` | Analytics | Kept under Coordination group |
| `/admin/personnel` | Personnel | PageHeader |
| `/admin/attendance` | Attendance | PageHeader |
| `/admin/shifts` | Shifts | PageHeader |
| `/admin/resources` | Resources | PageHeader |
| `/admin/settings` | Settings | PageHeader |
| `/citizen/*` | Citizen Emergency | SOS guided flow + tracking glossary |
| `/responder/*` | Responder Field | Active-assignment hero + gated status |

---

## 2. Gaps addressed (by role)

### Dispatcher
- Flat 14-item nav → grouped **Operations / Coordination / Workforce / System** (all modules retained)
- Dispatch missing timeline, accessible confirms, shared freshness → added
- Intake progress / draft / deliberate create CTA → polished
- Map lacked queue context → side panel with priority, GPS age, next action
- SOS list used light/generic chrome → ops console patterns + QueryState

### Responder
- Equal cards → primary **Active assignment** hero
- Raw coords as primary location → `LocationDisplay` (place name primary)
- En Route before Accept → gated; confirms for consequential steps
- Offline status not queued → offline queue for accept/status/backup/GPS
- Layout weaker than citizen → safe-area + connection line parity

### Citizen
- Thin step chrome → named progress + hotline always visible
- Tracking required prior `latest` → offline queued tracking UI fixed
- Weak status meaning → glossary + assigned feedback
- Update/cancel via `prompt` → ConfirmActionDialog

---

## 3. Updated structure

```
client/src/components/
  layout/AdminSidebar.tsx              # grouped nav
  ui/PageHeader.tsx
  ui/ConfirmActionDialog.tsx
  ui/LocationDisplay.tsx
  ui/FreshnessLine.tsx
  dispatch/IncidentTimeline.tsx
  intake/SmartIntakeDialog.tsx         # progress + Create & open for dispatch
pages/admin/DispatchPage.tsx
pages/admin/IncidentsPage.tsx          # MapMonitoring queue strip
pages/admin/AdminModules.tsx           # SOS + module headers
pages/responder/ResponderPages.tsx
pages/citizen/CitizenSOSPage.tsx
layouts/ResponderLayout.tsx
layouts/CitizenLayout.tsx
```

---

## 4. Acceptance criteria

### Dispatcher
- [ ] All 14 modules reachable from grouped sidebar; none removed
- [ ] Dispatch Center: three panes on xl; stacks on mobile; select → details + timeline + units
- [ ] New intake: 4 steps with progress; validation blocks Next; Save draft feedback; Review CTA **Create & open for dispatch**
- [ ] Live queue / Pending SOS / Units available labels consistent with Dashboard semantics; freshness visible
- [ ] Map Monitoring retains filters and shows queue context + link to Dispatch
- [ ] Verify / assign / cancel / false alarm / reopen use ConfirmActionDialog (not only browser dialogs)

### Responder
- [ ] Active assignment dominates home; place name primary, coords secondary
- [ ] Status path: Assigned → Acknowledge → En Route → On Scene → Transporting/Complete; confirms + timestamps
- [ ] Backup/notes contextual with success/failure toasts; offline queue for status updates
- [ ] Loading / empty / map-unavailable / poor-connectivity states present
- [ ] Layout usable one-handed with 48px targets and connection status

### Citizen
- [ ] SOS: type → location → details → review/hold-send → tracking
- [ ] Hotline always clear; ~1.2s hold prevents accidental send without long delay
- [ ] Tracking shows status meaning, help-coming when assigned, updates path; offline queue surfaced
- [ ] Types load/error/empty handled; mobile-first a11y on steps and hold-to-send

---

## 5. Non-changes (intentional)

- No color / palette / branding edits
- No route, role, permission, or data-model removals
- Analytics retained (beyond Figma’s 13-module list) under Coordination
