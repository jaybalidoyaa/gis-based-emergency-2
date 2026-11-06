# User guide — Barangay Sun Valley dispatch

System: [https://emergency.brigadaonse.org](https://emergency.brigadaonse.org)

## Dispatcher

1. Sign in with your official email. Demo passwords are not shown on the production login page.
2. **Dashboard** counters come from the live database. If a card fails, use Retry — do not treat a dash as zero.
3. **Dispatch Center** → **New intake (N)** for phone/radio calls. Drag the map pin inside the gold Sun Valley boundary.
4. Verify pending SOS (V), then assign the nearest listed responder. Confirm the prompt; the unit must acknowledge.
5. Cancelling, false alarm, or reassignment requires a typed reason (audit log).
6. **Map Monitoring** shows the barangay outline, incidents (red), available units (green), assigned/en route (gold), and facilities.
7. Keyboard: `N` new intake, `V` verify selected, `Esc` clear selection. Critical actions still ask for confirmation.

## Responder

1. Open the Responder portal on your phone (PWA can be installed from the browser).
2. Time in on **Status**. Large buttons require confirmation before En Route / On Scene.
3. Incoming dispatches: **Acknowledge** within the countdown window, or **Decline** with a reason.
4. Use **Navigate** for turn-by-turn. GPS updates while you are on assignment.
5. If the signal drops, status/GPS are queued and sent when you reconnect.
6. Request backup or send an operational note to dispatch from the assignment card.

## Citizen

1. Register with a Philippine mobile number (`09XXXXXXXXX`), matching passwords, and consent checkboxes.
2. **SOS**: pick the emergency type → confirm the map pin / address → describe victims and hazards → **hold** the red button to send.
3. You receive a reference number and live status only. Responder locations are not shown.
4. You may send more information or cancel with a reason. False reports are prohibited.
5. If the app cannot send, call **117** or the Barangay Sun Valley BDRRMO hotline.
6. **Profile** stores address, emergency contact, optional medical alerts, and language.

## Shared rules

* Sessions expire after long inactivity. Sign in again if redirected to login.
* Citizens cannot open `/admin` or `/responder`. Responders cannot open dispatcher administration.
* Unauthorized API calls return 401 or 403.
