# Deploy Nutterx Connect to Vercel

This repository is a pnpm monorepo. Import the repository at [vercel.com/new](https://vercel.com/new) and keep the project root set to the repository root (`.`). The root `vercel.json` builds the portal, serves its static output, routes `/api/*` to the Express function in `api/index.ts`, and sends browser routes to the SPA.

Before deploying, add these environment variables in the Vercel project settings for each environment you use:

- `MONGODB_URI`
- `NUTTERX_ADMIN_PASSWORD`
- `SESSION_SECRET`

Set their values through Vercel’s environment-variable settings; do not commit them to this repository. Then deploy the imported project. The same-origin `/api` routing keeps the portal and API on one Vercel domain.
