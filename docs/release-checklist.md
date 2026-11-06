# Release Checklist

## Pre-deploy

- [ ] `npm run test -w client` and worker vitest pass  
- [ ] `npx tsc -b` in client passes  
- [ ] No secrets in git (`git status` clean of `.env`)  
- [ ] `.env.example` updated with placeholders  
- [ ] Migrations reviewed: `db:migrate:v2`, `v3`, `v4`  
- [ ] Architecture note: production = Worker + D1 only  

## Database

```bash
npm run db:migrate:v2
npm run db:migrate:v3
npm run db:migrate:v4
```

## Deploy

```bash
npm run deploy
# or push to main if Workers Builds enabled
```

Verify: `GET https://emergency.brigadaonse.org/api/health` → database/map/api ok.

## Smoke (manual, test accounts only)

1. Login as central dispatcher  
2. New intake → create incident → verify → assign  
3. Cancelled incident: no assign; reopen with reason  
4. SOS cancelled: no verify  
5. Resources: Add vehicle dialog; readiness with reason  
6. Reports: CSV + XLSX + PDF download  
7. Conduction: conflict warning  
8. Citizen: SOS hold-to-send; offline queue indicator  
9. Guest SOS (if enabled): Unverified appears in SOS queue  
10. Map: boundary, fit all, filters  
11. Announcement publish → citizen feed  
12. Mobile admin drawer &lt; 1024px  
13. iPhone 14 citizen: no horizontal scroll  

## Rollback

1. Cloudflare Workers → Deployments → previous version  
2. Leave D1 additive tables in place  
3. SPA rolls back with Worker assets  

## Do not

- Send real SMS/push in tests  
- Destroy production D1  
- Force-push main  
- Commit JWT_SECRET / Twilio / Firebase private keys  
