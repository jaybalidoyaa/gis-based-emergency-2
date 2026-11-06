# Accessibility audit notes (v1.1.1)

## Fixed / improved

| Area | Change |
|------|--------|
| Conduction / Personnel / Vehicle forms | Persistent visible labels, `htmlFor`/`id`, required indicators, inline errors |
| Time field | Native `type="time"` instead of unlabeled text `0800H` |
| Role display | `EMERGENCY_RESPONDER` → “Emergency Responder” |
| Status toggles | Unique accessible names include person/unit name |
| Vehicle readiness | Unique names: “Mark {unit} Out of Service / Ready” |
| Filter chips | `aria-pressed` on incident/SOS tabs |
| Citizen nav | `aria-label` on items; safe-area for focus targets |
| Dialogs | Existing Radix Dialog focus trap retained |
| Inputs on iOS | 16px font to avoid Safari focus zoom |

## Remaining gaps

* Full axe/Lighthouse run on production after deploy
* Icon-only controls elsewhere still need audit pass
* Confirm dialogs still use `window.confirm`/`prompt` (accessible but not ideal UX)
* Table → card pattern incomplete on some admin pages at 390px
