# Role–Permission Matrix

Enforced in `worker/lib/core.ts` via `hasPerm()` on API routes. Hiding UI alone is insufficient.

| Capability | SYSTEM_ADMINISTRATOR | CENTRAL_DISPATCHER | DEPARTMENT_DISPATCHER | EMERGENCY_RESPONDER | CITIZEN | Guest |
|------------|:---:|:---:|:---:|:---:|:---:|:---:|
| System health / settings | ✓ | read stats | limited | — | — | — |
| Manage users / roles | ✓ | personnel create* | — | — | — | — |
| Departments / facilities | ✓ | ✓ | own dept view | read map | — | — |
| Incident types / priorities | ✓ | ✓ | — | — | — | — |
| Announcements publish | ✓ | ✓ | — | — | read | read public |
| Audit logs | ✓ | — | — | — | — | — |
| Escalation rules | ✓ | ✓ | — | — | — | — |
| Create/verify/assign incidents | ✓ | ✓ | dept-scoped | read assigned | — | — |
| Close / reopen (w/ reason) | ✓ | ✓ | limited | — | — | — |
| SOS list / verify | ✓ | ✓ | ✓ | — | own | submit only |
| Dispatch queue / map | ✓ | ✓ | ✓ | map self | — | — |
| Transport/conduction | ✓ | ✓ | ✓ | — | — | — |
| Reports / analytics export | ✓ | ✓ | read | — | — | — |
| Personnel / shifts / attendance | ✓ | ✓ | attendance | self check-in | — | — |
| Training / certifications | ✓ | ✓ | own dept | read own | — | — |
| Vehicles / equipment | ✓ | ✓ | own dept | read | — | — |
| Accept/decline assignment | — | — | — | ✓ | — | — |
| GPS share / status | — | — | — | ✓ | — | — |
| Profile / deletion request | self | self | self | self | ✓ | — |
| Guest SOS (Unverified) | — | process | process | — | — | ✓ rate-limited |

\* Central dispatcher may create operational accounts; cannot grant SYSTEM_ADMINISTRATOR without admin role.

## Object-level rules

- Citizens only cancel/update **own** SOS while Pending/In Progress.  
- Responders only accept assignments for **their** responder_id.  
- Department dispatchers must not mutate other departments’ vehicles/personnel (enforced where `department_id` present).  
- Closed/Cancelled/False Alarm/Duplicate: no assign/verify until reopen.
