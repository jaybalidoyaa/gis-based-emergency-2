# Feature Guide

Developer-oriented map of features that exist in this repository. Production behavior is the Cloudflare Worker + D1 path unless noted.

---

### Feature: Authentication

**Purpose:** Sign in, citizen register, token refresh, logout, password reset, profile.  
**Frontend files:** `pages/auth/*`, `store/authStore.ts`, `components/auth/ProtectedRoute.tsx`  
**Backend files:** `worker/index.ts` (login/register/refresh/logout/me), `worker/extended.ts` (forgot/reset/profile), `server/src/controllers/auth.controller.ts`  
**Database tables:** `users`, `roles`, `citizens`, `login_attempts`, `password_resets`  
**API:** `/api/auth/*`, `/api/profile`  
**User roles:** All  
**Workflow:** Login → JWT persist → role home. Inactivity 8h clears store.  
**Business rules:** PH mobile on register; password ≥10 chars with mixed case, digit, special; Worker lockout uses `failed_logins` / `locked_until`.

---

### Feature: Role-based access

**Purpose:** Five roles share two admin/citizen/responder shells; APIs enforce permissions.  
**Frontend files:** `ProtectedRoute.tsx`, `incidentState.ts` (`ROLE_LABELS`), admin vs responder vs citizen layouts  
**Backend files:** `worker/lib/core.ts` `PERMISSIONS` / `hasPerm`, `server/src/constants/index.ts`  
**Database tables:** `roles`, `users.role_id`  
**API:** `requirePerm(...)` on Worker routes  
**User roles:** See `docs/role-permission-matrix.md`  
**Workflow:** JWT includes `role` + `permissions`; Worker re-checks `hasPerm(role, perm)` (does not solely trust JWT permission array).  
**Business rules:** Department dispatcher cannot `personnel:manage` on Worker. Citizens only operate on own SOS. Responders only mutate own assignments.

---

### Feature: Dashboard

**Purpose:** Operational KPIs, mini-map, active incidents, unit tracking, notifications snapshot.  
**Frontend files:** `pages/admin/DashboardPage.tsx`, `components/dashboard/*`, `hooks/useLiveMapData.ts`  
**Backend files:** `worker/index.ts` `/api/dashboard/stats`, `/api/map/data`  
**Database tables:** `incidents`, `vehicles`, `responders`, `sos_requests`, `notifications`  
**API:** `dashboardApi.stats`, `mapApi.data`  
**User roles:** Admin dispatcher roles  
**Workflow:** React Query `LIVE.warmMs` / map overlay `LIVE.mapLiveMs`.  
**Business rules:** Ready vs on-scene unit counts use `UNIT_READY_SQL` / `UNIT_ON_SCENE_SQL` so dashboard matches resources/map.

---

### Feature: Incident management

**Purpose:** Create, verify, assign, status, notes, merge duplicates, cancel/reopen, media.  
**Frontend files:** `IncidentsPage.tsx`, `DispatchPage.tsx`, `SmartIntakeDialog.tsx`, `IncidentActionDialogs.tsx`, `IncidentStatusStepper.tsx`, `IncidentMediaGallery.tsx`, `lib/incidentState.ts`  
**Backend files:** `worker/index.ts`, `worker/extended.ts`, `worker/lib/assignmentLifecycle.ts`  
**Database tables:** `incidents`, `locations`, `incident_types`, `activity_logs`, `incident_status_history`, `assignments`, `media_attachments`  
**API:** `/api/incidents*`  
**User roles:** Dispatchers write; responders read assigned; citizens do not use this UI  
**Workflow:** Intake → Pending Verification → Verified/Open → Assigned/Dispatched → En Route → On Scene → Transporting → Resolved → Closed.  
**Business rules:** Transitions must exist in `TRANSITIONS`. Terminal statuses release units. Duplicate merge sets `master_incident_id`.

---

### Feature: Citizen and guest SOS

**Purpose:** Fast emergency report with GPS.  
**Frontend files:** `CitizenSOSPage.tsx`, `lib/offlineQueue.ts`, `lib/validation.ts`  
**Backend files:** `POST /api/sos`, `POST /api/sos/guest`, SOS cancel/update  
**Database tables:** `sos_requests`, `incidents`, `locations`, `guest_sos_rate`  
**API:** `sosApi`, guest endpoint unauthenticated  
**User roles:** CITIZEN; guest; dispatchers list/verify  
**Workflow:** Hold-to-send (`LIVE.sosHoldMs`) → create incident+SOS → dispatcher queue. Offline: IndexedDB queue until send succeeds.  
**Business rules:** Guest requires callback number + type + lat/lng; max 5 attempts / 15 minutes / IP hash. Citizen cancel only in allowed SOS statuses (enforced in Worker).

---

### Feature: Dispatch center

**Purpose:** Work the live queue: verify, assign one or many units, timeline, chat.  
**Frontend files:** `DispatchPage.tsx`, `DispatchActionDialogs.tsx`, `IncidentTimeline.tsx`  
**Backend files:** `/api/responders/dispatch-queue`, assign / assign-many, nearby-units  
**Database tables:** `incidents`, `assignments`, `responders`, `vehicles`  
**API:** `respondersApi`, `incidentsApi`  
**User roles:** Admin roles with `dispatch:manage` / `incidents:assign`  
**Workflow:** Select incident → nearby or available units → assign → notify responders.  
**Business rules:** Do not assign if incident locked or terminal. Nearby uses haversine.

---

### Feature: GIS map monitoring

**Purpose:** Show barangay boundary, incidents, SOS, vehicles, personnel GPS, facilities, NCR hospitals, routes.  
**Frontend files:** `MapView.tsx`, `MonitorMapView.tsx`, `MapMonitoringPage.tsx`, `lib/mapBoundaries.ts`, `lib/hospitalMapLayers.ts`, `data/*.json`  
**Backend files:** `/api/map/data`, `/api/map/fleet`, `/api/map/facilities`, `/api/routing/plan`  
**Database tables:** `incidents`, `responders`, `vehicles`, `facilities`, `gps_tracks`  
**API:** `mapApi`, routing GET  
**User roles:** Admin `map:monitor`; responders have map:monitor on Worker for field map  
**Workflow:** Mapbox dark style; fleet overlay 1s; stale GPS flagged.  
**Business rules:** Routing uses Mapbox Directions if token present, else A* (`worker/lib/routing.ts`).

---

### Feature: Responder operations

**Purpose:** Accept/decline assignments, status, GPS, team/unit change, check-in.  
**Frontend files:** `ResponderPages.tsx`, `ResponderLayout.tsx`, `lib/responderGps.ts`  
**Backend files:** responder routes in `index.ts` + `extended.ts` (me, units, team-change, unit-change, backup, decline)  
**Database tables:** `assignments`, `responders`, `unit_change_requests`, `gps_tracks`, `attendance`  
**API:** `respondersApi`, `unitChangeApi`, `attendanceApi` check-in/out  
**User roles:** EMERGENCY_RESPONDER; dispatchers approve unit-change  
**Workflow:** Push/in-app alert → accept → En Route → On Scene → complete. GPS watch posts ~1s (`LIVE.gpsMs`).  
**Business rules:** `RESPONDER_STATUS_TRANSITIONS` in `core.ts`. Unit-change v18 distinguishes team vs vehicle.

---

### Feature: Conduction / transports

**Purpose:** Scheduled patient movement with map pins.  
**Frontend files:** `ConductionPage.tsx`, `TransportLocationPicker.tsx`  
**Backend files:** `/api/transports` GET/POST, PATCH in `extended.ts`  
**Database tables:** `transports` (coords v16)  
**API:** `transportsApi`  
**User roles:** `transport:manage`  
**Workflow:** Create schedule → optional origin/destination coords → assign vehicle/crew → status updates.  
**Business rules:** Coordinates persisted so map routes survive geocode changes.

---

### Feature: Notifications and Web Push

**Purpose:** In-app inbox, broadcast, dispatch-team, delivery tracking, replies, browser push.  
**Frontend files:** `NotificationsPage.tsx`, `NotificationHost.tsx`, `lib/pushSubscribe.ts`, `sw.ts`, `lib/alertSound.ts`  
**Backend files:** `worker/lib/notify.ts`, `webpush.ts`, notification routes  
**Database tables:** `notifications`, `notification_replies`, `notification_deliveries`, `push_subscriptions`  
**API:** `notificationsApi`, `/api/push/*`  
**User roles:** All authenticated  
**Workflow:** Server `notifyUsers` → DB rows + VAPID → SW shows notification.  
**Business rules:** Tracking distinguishes in-app created vs push subscribed (see deprecated `delivered` field on client type).

---

### Feature: Personnel, attendance, shifts, training

**Purpose:** Workforce roster, duty, leave, certifications.  
**Frontend files:** `PersonnelPage.tsx`, `AttendancePage.tsx`, `ShiftsPage.tsx`, related dialogs  
**Backend files:** personnel/attendance/leave/shifts/training routes  
**Database tables:** `users`, `responders`, `attendance`, `leave_requests`, `shifts`, `teams`, `training_records`, `certifications`  
**API:** `personnelApi`, `attendanceApi`, `leaveApi`, `shiftsApi`, `trainingApi`  
**User roles:** `personnel:manage` (not department dispatcher on Worker), `attendance:manage`, `shifts:manage`; responders self check-in  
**Workflow:** Create user+responder → assign team/unit → shifts → attendance/leave.  
**Business rules:** Unique attendance per responder per date.

---

### Feature: Resources (vehicles and equipment)

**Purpose:** Fleet readiness, equipment serviceability, checklists.  
**Frontend files:** `ResourcesPage.tsx`  
**Backend files:** `/api/resources/*`, checklist POST  
**Database tables:** `vehicles`, `equipment`, `checklists`, `checklist_items`  
**API:** `resourcesApi`  
**User roles:** `resources:manage`  
**Workflow:** Update status; failed critical checklist can mark vehicle out of service and notify dispatchers.  
**Business rules:** Status vocabulary includes Ready/Available vs Deployed/Assigned — SQL helpers keep counts consistent.

---

### Feature: Reports and analytics

**Purpose:** Operational reports export and descriptive analytics.  
**Frontend files:** `ReportsPage.tsx`, `AnalyticsPage.tsx`  
**Backend files:** `/api/reports`, `/library`, `/export`, `/api/analytics`, `worker/lib/pdf.ts`, `kmeans.ts`  
**Database tables:** incidents and related aggregates  
**API:** `reportsApi`, `analyticsApi`  
**User roles:** `reports:read` / `reports:export` / `analytics:read`  
**Workflow:** Filter → CSV/XLS/PDF. Analytics clusters for presentation, not ML operations.

---

### Feature: Chat

**Purpose:** Per-incident thread and a shared responders channel.  
**Frontend files:** Dispatch incident chat; `ResponderChatPage`  
**Backend files:** `/api/chat/incident/:id`, `/api/chat/responders`  
**Database tables:** `chat_messages` (responders channel uses a sentinel `incident_id`)  
**API:** `chatApi`  
**User roles:** Authenticated dispatch/responder as gated in Worker (`canUseResponderChat`)  
**Workflow:** POST message → notify other party via `notifyUsers`.

---

### Feature: Settings, announcements, escalation, audit

**Purpose:** Barangay metadata, UI prefs, announcements, escalation rules, audit log, data reset.  
**Frontend files:** `SettingsPage.tsx`  
**Backend files:** `/api/settings*`, announcements, escalation-rules, `opsReset.ts`  
**Database tables:** `system_settings`, `announcements`, `escalation_rules`, `audit_logs`  
**API:** `settingsApi`  
**User roles:** `settings:manage` (system admin primarily; Worker also grants settings:manage to central dispatcher)  
**Workflow:** PATCH key/value settings; reset endpoints are destructive — confirm in UI.  
**Business rules:** MFA/IP restriction flags may be stored without being enforced.

---

### Feature: PWA and offline

**Purpose:** Installable app, precache, push, offline SOS/status queue.  
**Frontend files:** `vite.config.ts` PWA, `sw.ts`, `offlineQueue.ts`, `OfflineBanner.tsx`  
**Backend files:** Idempotency keys on selected POSTs  
**Database tables:** `idempotency_keys`  
**API:** Same REST; retries from queue  
**User roles:** All  
**Workflow:** Offline banner; queue state never displayed as successfully sent until HTTP 2xx.

---

### Feature: Live updates

**Purpose:** Keep admin/responder views current without Socket.io on Workers.  
**Frontend files:** `useLiveSync.ts`, `LiveSyncContext.tsx`  
**Backend files:** `GET /api/events`  
**Database tables:** `incidents`, `notifications`, `system_events`  
**API:** `eventsApi.poll`  
**User roles:** Authenticated  
**Workflow:** Poll `since` → if rows, invalidate React Query keys; backoff to `LIVE.syncMaxMs`.  
**Business rules:** `transport: 'polling'` in the payload. Local Express Socket.io is optional and unused by current pages.
