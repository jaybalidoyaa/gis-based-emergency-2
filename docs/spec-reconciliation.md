# Spec Reconciliation

**Source document:** [`Checking-Chapter-1-2-REVISED.pdf`](Checking-Chapter-1-2-REVISED.pdf) (Chapter I & II, 55 pages)  
**Compared against:** Build specification from project prompt + Figma UI requirements  
**Date:** 2026-09-02  
**Resolution rule:** Thesis domain rules take precedence; build prompt fills gaps where thesis is silent or simplified.

---

## 1. Alignment Summary

| Area | Thesis | Build Prompt | **Implementation Decision** |
|------|--------|--------------|----------------------------|
| Organization | Barangay Sun Valley, Parañaque; BEMO, BDRRMO, POPSMO, Brigada Onse | Same + extended dept list | Seed all thesis orgs + Fire/Medical/Police/Hospital |
| Frontend | React, Bootstrap/Tailwind, PWA | React, Tailwind, PWA | **Tailwind CSS** (user preference; thesis allows either) |
| Backend | Node.js, Express, MongoDB, Mongoose, Socket.io, REST | Same | **As specified** |
| Auth (SRS §2.3.1) | JWT, RBAC, bcrypt | JWT, RBAC, bcrypt | **JWT + bcrypt** (primary auth) |
| Auth (§2.5.1 deployment) | Firebase Authentication | JWT | **JWT primary**; Firebase **FCM only** for push |
| Database (§2.1.1) | MongoDB | MongoDB | **MongoDB + Mongoose** |
| Database (§2.5.1 deployment) | Firebase RTDB + Firestore | MongoDB | **MongoDB** — deployment section superseded by architecture/SRS |
| Maps (§2.3.1) | Mapbox API | Google or Mapbox abstraction | **`MapProvider` abstraction**, default Mapbox |
| Maps (§2.5.1) | Google Maps API | Configurable | Both supported via abstraction |
| Notifications | SMS + in-app (FCM) | SMS (Twilio) + FCM + in-app | **All three** with provider abstractions |
| Geographic scope | Barangay Sun Valley only | Same | Enforced in map bounds + validation |
| National integration | Excluded | Excluded | Not implemented |
| AI / predictive analytics | Excluded (delimitation) | Excluded | Not implemented |
| Offline PWA | Limited cache + sync on reconnect | IndexedDB queue, no silent overwrite | **Build prompt pattern** (thesis confirms offline concept) |

---

## 2. ERD Entities (Thesis §2.1.4)

All thesis entities **must be implemented**:

### Core
- **Role** — `role_id`, `role_name`
- **User** — `user_id`, `role_id`, `full_name`, `contact_number`, `email`, `password_hash`, `status`
- **Department** — `department_id`, `department_name`
- **Responder** — `responder_id`, `user_id`, `department_id`, `availability_status`
- **Citizen** — `citizen_id`, `user_id`, `address`, `emergency_contact`

### Incident
- **Incident_Type** — `incident_type_id`, `type_name`
- **Location** — `location_id`, `latitude`, `longitude`, `address_text`, `landmark`
- **Incident** — full fields per thesis + human-readable `displayId` (e.g. `INC-2026-0001`)
- **SOS_Request** — `sos_id`, `incident_id`, `citizen_id`, `trigger_time`, `auto_location_flag`

### Response
- **Assignment** — `assignment_id`, `incident_id`, `responder_id`, `assigned_by_dispatcher_id`, `assignment_status`, `assigned_at`
- **Vehicle** — `vehicle_id`, `department_id`, `unit_no`, `vehicle_type`, `status`
- **Transport_Schedule** — transport fields per thesis

### Communication
- **Notification**, **Report**, **Media_Attachment**

### Responder Management
- **Attendance**, **Shift_Schedule**, **Training_Record**

### Additional (build prompt; thesis concepts support)
- **Equipment** — operational monitoring (thesis defines Operational Checklist)
- **ActivityLog** — immutable incident timeline (thesis workflows + test "Incident Finality")
- **ChatMessage** — incident communication (thesis: digital communication module)
- **AuditLog** — §2.5.1 security/compliance requirement
- **PushSubscription / DeviceToken** — FCM delivery

---

## 3. Roles & Permissions

### Thesis ERD roles
Admin, Dispatcher, Responder, Citizen

### Build prompt extension (supported by §1.3 Significance)
**Department Dispatcher / Sub-station** — manages sub-station resources, internal unit assignment, coordinates with central dispatcher

### Implementation roles
1. `SYSTEM_ADMINISTRATOR`
2. `CENTRAL_DISPATCHER`
3. `DEPARTMENT_DISPATCHER`
4. `EMERGENCY_RESPONDER`
5. `CITIZEN`

Permissions enforced **server-side** via RBAC middleware.

---

## 4. Status Values

### Incident (thesis ERD: Open, In Progress, Resolved)

Thesis workflows (§2.1.3) describe richer states. **Use expanded state machine:**

`Pending Verification` → `Verified` → `Open` → `Assigned` → `En Route` → `On Scene` → `Transporting` → `Resolved` → `Closed` | `False Alarm`

Invalid transitions rejected server-side.

### Responder / unit availability (thesis §1.4.1)
`Available`, `En Route`, `On Scene`, `Transporting` + `Dispatched`, `Out of Service`

### Assignment (thesis ERD)
`Assigned`, `En Route`, `On Scene`, `Completed` (+ `Accepted`, `Rejected` for workflow)

### Transport (thesis ERD)
`Scheduled`, `En Route`, `Arrived` (+ `In Progress`, `Completed`, `Cancelled` from prompt)

### Vehicle
`Ready`, `Deployed`, `Maintenance`, `Out of Service`, `Unavailable`

---

## 5. Workflows (Thesis §2.1.3)

### Citizen SOS
Login → SOS → GPS auto-pin (fallback manual) → type + description → optional media → submit → dispatcher notified → citizen tracks status

### Central dispatcher
Receive SOS → verify → classify → check units → **recommend nearest** (dispatcher confirms) → assign → monitor until closed

### Department / sub-station (Personnel Management Flow)
Receive incident → evaluate resources → assign internal unit OR notify central for escalation → coordinate → on scene → complete → resolved

### Responder
Login → receive alert → view details → accept → En Route (GPS) → On Scene → assist → transport if needed → upload media/notes → mark complete → Resolved/Closed

### Incident finality (thesis test case)
When status = **Closed**, historical record is **locked** from further edits (admin override audited).

---

## 6. Functional Requirements (Thesis §2.2.1)

| Feature | Required |
|---------|----------|
| User Authentication | Yes — role-based access |
| SOS Emergency Request | Yes — GPS + manual fallback |
| Incident Management | Yes — real-time status |
| Responder Dispatching | Yes — nearest unit recommendation, manual confirm |
| GIS mapping + GPS tracking | Yes — real-time map layers |
| Notification system | Yes — SMS + in-app |
| Status update monitoring | Yes — responder status on dashboard |
| Digital documentation | Yes — incident records + media |
| Personnel management | Yes — attendance, shifts, training |
| Report generation | Yes — PDF, CSV, Excel export |

---

## 7. Non-Functional Requirements (Thesis §2.2.2)

- **Usability:** Minimal training; high-stress emergency UX (large SOS, clear status text)
- **Performance:** Updates within seconds under normal conditions
- **Security:** JWT, RBAC, bcrypt, HTTPS, Helmet, CORS, validation, audit logs
- **Availability:** 24/7 target; offline graceful degradation for PWA
- **Scalability:** Modular departments/users/features

---

## 8. Test Cases (Thesis §2.4.3)

Must pass in test suite:

- Citizen/responder registration + admin verification
- SOS trigger with GPS pin
- GPS tracking + status updates on dispatcher map
- Emergency announcements push
- Authentication guard (deny invalid/deactivated)
- Report export PDF/Excel/CSV
- Navigation/access matrix by role
- Real-time dispatch alerts to responders
- SOS offline buffer + sync integrity
- **Incident finality** — closed records locked
- Admin operational controls (activate/deactivate users, broadcast)

---

## 9. Seed Data (Demo)

Organizations from thesis:
- BEMO / BDRRMO
- POPSMO (Barangay Tanod)
- Brigada Onse Sun Valley Fire and Rescue Volunteer Group

Demo units (not hardcoded logic): FIRE 01, FIRE 02, RESCUE 02, RESCUE 04, RESCUE 05

Demo incident types: Fire, Flood, Medical Emergency, Crime + prompt list (Medical Emergency, Structural Fire, RTA, etc.)

Personnel reference: 44 total (19 BEMO + 25 POPSMO) — seed subset for demo

---

## 10. UI / Figma

Thesis design phase references **Figma mockups** (§2.1.2 Design). Implementation follows connected Figma file as primary UI reference with Tailwind spacing improvements (4–48px scale).

Admin modules (13): Dashboard, Dispatch Center, Map Monitoring, Incidents, Conduction Schedules, SOS Reports, Notifications, Documents & Reports, Personnel, Attendance, Shifts, Resources, Settings

---

## 11. Conflicts Resolved

| Conflict | Resolution |
|----------|------------|
| Firebase vs MongoDB backend | MongoDB for all structured data; Firebase for FCM push only |
| Firebase Auth vs JWT | JWT + bcrypt per SRS; no Firebase Auth dependency |
| Bootstrap vs Tailwind | Tailwind (thesis allows both; user chose Tailwind) |
| Google vs Mapbox | Abstract provider; env-configurable |
| Simple vs detailed incident statuses | Expanded machine aligned with thesis workflows and acceptance scenario |
| Thesis ERD missing Equipment/Chat/Audit | Added as implementation entities per prompt + thesis concepts |

---

## 12. Ready for Implementation

Thesis ingestion is **complete**. Phase 0 may proceed:

1. Monorepo scaffold (`client/` + `server/`)
2. MongoDB models per §2 above
3. JWT auth + 5 roles
4. Figma-faithful admin shell + citizen/responder mobile shells
5. Seed script with Barangay Sun Valley demo data

**Next action:** Switch to **Agent mode** and run Phase 0/1 scaffolding.
