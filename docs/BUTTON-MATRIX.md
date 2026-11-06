# Button / control function matrix

Status: core critical paths covered by unit gates + API guards. Expand E2E as environments allow.

| Route | Role | Control | Expected action | API | Loading | Success/Error | Permission | Mobile | Automated |
|---|---|---|---|---|---|---|---|---|---|
| /admin/dispatch | Dispatcher | Cancel | Cancel with reason; hide after | POST /incidents/:id/cancel | busy | toast | incidents:write | OK | unit + API |
| /admin/dispatch | Dispatcher | Reopen incident | Reopen with reason | POST /incidents/:id/reopen | busy | toast | incidents:write | OK | unit + API |
| /admin/dispatch | Dispatcher | Assign unit | Confirm + assign-many | POST /incidents/:id/assign-many | assigning | toast | incidents:assign | OK | API guard |
| /admin/dispatch | Dispatcher | Verify | Verify pending only | POST /incidents/:id/verify | busy | toast | incidents:verify | OK | API guard |
| /admin/sos | Dispatcher | Verify & Open | Hidden when Cancelled | POST /incidents/:id/verify | busy | toast | incidents:verify | OK | UI gate |
| /admin/sos | Dispatcher | Reopen SOS | Reason required | POST /sos/:id/reopen | busy | toast | incidents:write | OK | API |
| /admin/incidents | Dispatcher | Status filters | Includes Cancelled/False Alarm/Duplicate/Reopened | GET /incidents?status= | — | list | incidents:read | OK | API |
| /admin/sos | Dispatcher | Status filters | Cancelled/Verified/Converted/False Alarm/Duplicate/Rejected | GET /sos?status= | — | list | sos:read | OK | API |
| /admin/personnel | Dispatcher | Save | Disabled until valid | POST /personnel | saving | toast | personnel | OK | form validation |
| /admin/personnel | Dispatcher | Status toggle | Unique name + confirm | PATCH /personnel/:id | — | toast | personnel | OK | a11y name |
| /admin/resources | Dispatcher | Add vehicle | Dialog (not prompt) | POST /resources/vehicles | saving | toast | resources | OK | UI |
| /admin/resources | Dispatcher | Mark UNIT Out of Service / Ready | Confirm + reason OOS | PATCH /resources/vehicles/:id | saving | toast | resources | OK | a11y |
| /admin/conduction | Dispatcher | Save schedule | Labels + time picker | POST /transports | saving | toast | transport:manage | OK | form validation |
| /citizen/* | Citizen | Bottom nav | Safe-area padded | — | — | nav | citizen | iPhone 14 | CSS |
| Sidebar | Admin | Systems operational | Real /api/health checks | GET /health | query | status text | public | OK | health API |

## Critical action confirmations

Cancel incident, reopen incident, dispatch/assign, vehicle OOS, deactivate account, false alarm, SOS verify, SOS reopen — all require confirm and/or reason.
