# Finch Platform Starter

This repository contains a starter implementation for the software platform you described:

- **Public marketing + auth area** (`/`, `/signup`, `/login`)
- **Admin area** (`/admin`) for sign-up/user/subscription overview
- **Customer application area** (`/app`) where a signed-up organization sees Finch-connected company data

## Included backend foundations

- Session-based auth (HTTP-only cookie)
- In-memory user and organization store (demo only)
- Stripe webhook scaffold endpoint (`POST /api/stripe/webhook`)
- Finch sync scaffold endpoint (`POST /api/finch/sync`) with starter modules:
  - Organization
  - Payroll
  - Deductions

## Run locally

```bash
npm run dev
```

Open http://localhost:3000.

## Deploy to Vercel (web URL)

1. Push this repo to GitHub.
2. In Vercel, click **Add New Project** and import the repo.
3. Framework preset: **Other** (no build command needed).
4. Deploy.

After deploy, your app will be live at:

- `https://<your-project>.vercel.app`

Routes:

- `https://<your-project>.vercel.app/`
- `https://<your-project>.vercel.app/signup`
- `https://<your-project>.vercel.app/login`
- `https://<your-project>.vercel.app/admin`
- `https://<your-project>.vercel.app/app`

## Important note for production

This starter uses in-memory data. On Vercel serverless functions, memory is ephemeral, so users/sessions can reset between invocations.
Use Postgres + Redis (or durable auth storage) for production.


## One-command publish (for operators)

Run this from the repo to push + deploy + verify live:

```bash
GITHUB_OWNER=<owner> GITHUB_REPO=<repo> GITHUB_TOKEN=<github_pat> VERCEL_TOKEN=<vercel_token> npm run publish
```

Optional variables:

- `GITHUB_REPO_URL`: use explicit remote URL instead of owner/repo/token composition.
- `GITHUB_PRIVATE`: `true`/`false` (default `true`) when auto-creating repo.
- `GITHUB_CREATE_AS_ORG`: `true` to create repo under org owner.
- `VERCEL_SCOPE`: Vercel team scope.
- `VERCEL_PROJECT`: project name override for deploy command.

What this script now does automatically:

1. Creates GitHub repository via API if needed (when owner/repo/token are provided).
2. Configures `origin` if missing.
3. Ensures `main` points to current code and pushes `main` + current branch.
4. Deploys production to Vercel.
5. Runs live smoke tests (`/`, `/signup`, `/login`, and `POST /api/signup`).

## Next build steps

1. Replace in-memory stores with Postgres + migrations.
2. Add password hashing and secure auth (OAuth/SAML if needed).
3. Integrate real Stripe checkout, subscriptions, and billing portal.
4. Integrate real Finch Connect flow and API calls (`/employer/company`, `/employer/directory`, etc.).
5. Add role-based permissions and tenant isolation checks.
6. Split services (API, worker, web app) when scaling.
