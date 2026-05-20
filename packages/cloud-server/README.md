# @ank1015-app/cloud-server

Hosted HeySnap control plane, gateway, admin API, and release API.

This is a Hono server backed by Postgres through Drizzle. It is deployed at
`https://api.heysnap.xyz`.

## Responsibilities

- User auth with admin-created users and opaque bearer sessions.
- Computer inventory for cloud and local machines.
- EC2 provisioning and lifecycle operations for cloud machines.
- Optional Docker machine provisioning for local development.
- Machine registration, heartbeat, and release update checks.
- AI gateway proxy for EC2 Codex requests with per-user and per-machine usage logs.
- Outbound machine tunnel registry and gateway WebSocket proxying.
- Short-lived computer access sessions for gateway routes.
- Admin dashboard and admin APIs.
- Release manifests for desktop and machine-server updates.

## Local Commands

```sh
pnpm --filter @ank1015-app/cloud-server dev
pnpm --filter @ank1015-app/cloud-server dev:admin-ui
pnpm --filter @ank1015-app/cloud-server build
pnpm --filter @ank1015-app/cloud-server build:admin-ui
pnpm --filter @ank1015-app/cloud-server test
pnpm --filter @ank1015-app/cloud-server typecheck
pnpm --filter @ank1015-app/cloud-server db:migrate
pnpm --filter @ank1015-app/cloud-server test:db
```

`dev:admin-ui` runs Vite on port 5174 and proxies `/admin`, `/auth`, and
`/health` to the cloud server on port 4100. Run `dev` and `dev:admin-ui` in
two terminals to iterate on the React admin SPA.

For the full local Docker machine workflow, use the root commands documented in
`docs/local-docker-machines.md`.

## Important URLs

- `GET /health`
- `GET /admin-dashboard`
- `POST /auth/login`
- `GET /computers`
- `POST /computers`
- `POST /computers/:computerId/access-session`
- `POST /machines/register`
- `POST /machines/heartbeat`
- `WS /machines/tunnel`
- `WS /gateway/computers/:computerId/filesystem`
- `WS /gateway/computers/:computerId/browser-control`
- `HTTP /gateway/computers/:computerId/agent/*`
- `POST /llm/openai/v1/responses`
- `POST /llm/openai/v1/images/generations`
- `POST /llm/openai/v1/images/edits`
- `HTTP /firecrawl/*`
- `GET /admin/ai-usage`
- `GET /admin/ai-usage/summary`
- `GET /releases/desktop/latest`
- `GET /releases/machine-server/latest`

## Admin

Admin APIs use `Authorization: Bearer $CLOUD_SERVER_ADMIN_TOKEN`.

```sh
curl -H "authorization: Bearer $CLOUD_SERVER_ADMIN_TOKEN" \
  https://api.heysnap.xyz/admin/overview
```

Open the dashboard SPA:

```text
https://api.heysnap.xyz/admin-dashboard/
```

The admin SPA lives in `packages/cloud-server/admin-ui` (Vite + React + shadcn/ui).
It is built into static assets and served by the Hono server.

## AI Gateway

Cloud EC2 machines point Codex at `/llm/openai/v1` and send their machine token
as the `api-key` header. Cloud-server authenticates that token, replaces it with
`AI_GATEWAY_AZURE_API_KEY`, forwards to `AI_GATEWAY_AZURE_BASE_URL`, and logs
usage metadata against the owning user and computer. The Azure URL can be either
a base path or the full Responses endpoint; if it already ends in `/responses`,
Codex requests to `/llm/openai/v1/responses` are not double-appended.

Image generation clients use the same gateway prefix and same machine token:

- `POST /llm/openai/v1/images/generations`
- `POST /llm/openai/v1/images/edits`

Image requests forward to `AI_GATEWAY_AZURE_IMAGES_BASE_URL` with
`Authorization: Bearer $AI_GATEWAY_AZURE_API_KEY`. Set that URL to the Azure
GPT Image deployment base, for example
`https://...cognitiveservices.azure.com/openai/deployments/gpt-image-2?api-version=2024-02-01`,
or to one full image endpoint including its `api-version` query. The gateway strips
the OpenAI-style `model` field before forwarding because the Azure deployment is
already selected by the URL. For multipart edits, OpenAI-style repeated
`image[]` fields are normalized to Azure's `image` field.

Optional debug body capture is disabled by default. Enable it with
`AI_GATEWAY_CAPTURE_BODIES=true`; captured headers are redacted and bodies are
capped by `AI_GATEWAY_CAPTURE_BODY_MAX_BYTES`.

## Firecrawl Gateway

Cloud machines can send Firecrawl API requests to `/firecrawl/*` with their
machine token as either the `Authorization: Bearer <machine-token>` header or
the existing gateway-style `api-key` header. Cloud-server authenticates the
machine token, replaces Firecrawl credentials with `Authorization: Bearer
$FIRECRAWL_API_KEY`, forwards the original method, path, query, body, and
non-secret headers to `FIRECRAWL_BASE_URL` (default
`https://api.firecrawl.dev`), then streams the response back without AI usage
logging.

## Deployment

Run the manual deploy action:

```sh
gh workflow run deploy-cloud-server.yml --repo ank1015/heysnap --ref main
```

The workflow builds the cloud-server Docker image, pushes it to ECR, runs
Drizzle migrations on the host, and restarts the container through AWS SSM.
