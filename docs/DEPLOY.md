# Production deployment (Cloudflare Worker API + D1 + SPA)

## Architecture

| Piece | Where |
|-------|--------|
| Frontend (React PWA) | Same Cloudflare Worker + custom domain `https://emergency.brigadaonse.org` |
| API | Same Worker under `/api/*` (Hono + D1) |
| Database | Cloudflare D1 `barangay-dispatch-db` |
| Media (optional) | Cloudflare R2 `barangay-dispatch-media` |

Local development still uses Express + MongoDB (`npm run dev`). Production uses the Worker API.

---

## Cloudflare frontend env (Workers Builds)

Leave these **empty** (or unset) so the app uses same-origin `/api`:

| Variable | Value |
|----------|--------|
| `VITE_API_URL` | *(empty)* |
| `VITE_SOCKET_URL` | *(empty)* |

Do **not** put a Render URL or the Worker URL into `VITE_API_URL`.

---

## One-time database setup

```bash
npm install
npx wrangler login   # if needed
npm run db:migrate
npm run db:seed
npx wrangler secret put JWT_SECRET
```

Demo password for all seeded users: `Password123!`

Do **not** set `VITE_DEMO_ACCOUNTS=true` on the production Cloudflare build. Demo emails stay in D1 for training but are not printed on the login page.

---

## Schema updates (existing data preserved)

```bash
npm run db:migrate:v2
```

This runs `worker/migrate.sql` (ALTER TABLE / new tables). Duplicate-column errors are skipped.

Optional type cleanup (disables duplicate Patient Transport categories):

```bash
npm run db:migrate:v3
```

---

## Deploy

GitHub push triggers Workers Builds (`npm run build` → `npx wrangler deploy`), or deploy locally:

```bash
npm run deploy
```

## Rollback

1. Cloudflare dashboard → Workers → `gis-based-emergency-dispatch-system` → Deployments → roll back to the previous successful version.
2. D1 additive columns are safe to leave in place. Do not DROP columns in production.
3. SPA is atomic with the Worker deploy (`wrangler deploy` after `npm run build:client`).

Health check: `https://emergency.brigadaonse.org/api/health` (must report `database: ok`).

---

## Optional: Express + MongoDB Atlas + Render

The `server/` package, `render.yaml`, and Docker files remain for local/thesis comparison. Prefer the Worker API for production on Cloudflare.
