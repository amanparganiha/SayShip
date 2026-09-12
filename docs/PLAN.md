# PromptShip — Implementation Plan

## Context

`C:\PromptShip` is empty (no git repo yet). The machine has Node 24, npm 11, git and Docker. The goal is to build **PromptShip**, the AI full-stack app builder described in the resume and build guide, as the Replit New Grad 2027 submission. **The resume bullet is the acceptance spec.** Everything it claims has to be true of the shipped app:

- A natural-language prompt goes through a schema/API/UI plan, then streamed code generation, then a file tree, code viewer and live sandboxed preview.
- Projects are saved, versions are kept, and users sign in.
- Generated apps can be published with one click and exported to GitHub.
- Playwright smoke tests exist, and the app is deployed on Replit.

**Confirmed decisions:**
- **LLM:** OpenAI, plus a mock provider for dev and tests.
- **Scope:** everything the resume claims, plus the auto-fix loop (runtime errors in the preview go back to the AI, which fixes them).
- **Export:** a ZIP of a runnable Vite project, plus "Push to GitHub" through OAuth.
- **Generated apps:** each one gets a real backend: a CRUD data API stored in Postgres, used through a `useCollection()` hook. This keeps "full-stack CRUD" honest.

## Deviations from the guide (why)

| Guide | This plan | Why |
|---|---|---|
| `client/` + `server/` workspaces; Vite on :5173 plus Express on :3000 | One root `package.json`. One Express server on `PORT` (default 3000). In dev it mounts Vite in middleware mode; in prod it serves `dist/public`. | Replit Autoscale exposes exactly **one** port, so the guide's two `[[ports]]` would fail to deploy. Replit's own full-stack template works this way. |
| Babel-standalone in the browser; imports stripped with regex | The server bundles the files with **esbuild** over a virtual in-memory file system. Generated code is never executed on the server. | Real ES modules, so the exported project runs unchanged. Build errors come back with file:line for the fixer. Each preview loads about 3 MB less. |
| React 18 from the unpkg CDN | React 19 + `@tailwindcss/browser`, bundled once when the server starts. Served from `/runtime/*` with content-hashed filenames and immutable caching. | No CDN dependency during demos and tests. The preview uses the same React version the export pins. |
| iframe `sandbox="allow-scripts allow-same-origin"` | Opaque-origin sandbox: iframe **without** allow-same-origin, plus a `Content-Security-Policy: sandbox …` response header (also sent on public pages) | With allow-same-origin on our own origin, generated code could use the logged-in user's session. |
| In-memory or localStorage app state | A `useCollection()` hook backed by the per-app data API. Preview and live data are stored separately. | Makes "full-stack" true. localStorage isn't available in an opaque origin anyway. |
| `.replit` with nix channel, `cloudrun`, no build step | `modules = ["nodejs-22","postgresql-16"]`, `autoscale`, build + run commands | openai v7 requires Node ≥ 22. Production needs the client build. |
| `gpt-4o-mini` hard-coded | `OPENAI_MODEL` env var. Chat Completions with Structured Outputs (`zodResponseFormat`) | Pick a current fast model when implementing. Also works with OpenAI-compatible base URLs (`OPENAI_BASE_URL`). |

## Architecture

```
Browser (React 19 + Vite + Tailwind v4)
  Dashboard ── Workspace: Plan · Run timeline · Versions · Refine | FileTree | CodeMirror | Preview iframe (opaque sandbox) | Data
     │ fetch + SSE (/api/*)                          │ iframe src=/preview/:id/:v  ──postMessage(errors)──▶ parent
Express 5 (single port)                              ▼
  /api/auth  /api/projects  /api/projects/:id/generate (SSE)  /api/github   ← cookie session + Origin check
  /preview/:id/:v  /p/:slug   → esbuild virtual-FS bundle → HTML shell (CSP sandbox)
  /runtime/*  (React/Tailwind bundles, CORS *)   /data/:appKey/:collection (per-app CRUD, CORS *, capability key)
  agent/: planner → file writer (streamed) → build check → self-repair · editor (iterate/fix)
  llm/: OpenAI | Mock          db/: Drizzle → PostgreSQL (Docker locally, Replit PostgreSQL in prod)
```

## Repo layout

```
package.json  tsconfig.base.json  drizzle.config.ts  vitest.config.ts  playwright.config.ts
docker-compose.yml  docker/init.sql (creates promptship + promptship_test)  .env.example  .gitignore  .gitattributes (eol=lf)
.replit  .github/workflows/ci.yml  scripts/build.mjs  README.md
shared/      schemas.ts (zod: Plan, EditPlan, GeneratedFile, path rules) · events.ts (RunEvent union) · api.ts (DTOs)
server/drizzle/            generated SQL migrations (committed)
server/src/  index.ts (prod entry) · dev.ts (dev entry + Vite middleware) · app.ts (createApp({db,llm,env}) for tests) · env.ts (zod)
  db/        schema.ts · client.ts · migrate.ts (auto-migrate on boot)
  auth/      password.ts (node:crypto scrypt) · sessions.ts · middleware.ts (loadUser, requireAuth, originCheck) · crypto.ts (AES-GCM)
  routes/    auth · projects · generate · preview · publish · data · export · github · runtime · health
  agent/     prompts.ts · planner.ts · writer.ts · editor.ts · pipeline.ts
  llm/       types.ts (LlmClient) · openai.ts · mock.ts · index.ts
  sandbox/   bundle.ts (esbuild + virtual FS plugin) · shell.ts (HTML) · runtimeAssets.ts · sdk.js (promptship module) · bridge.js (error reporter)
  export/    viteProject.ts · zip.ts (fflate) · github.ts (REST, git data API)
  lib/       sse.ts · http.ts · quota.ts · lease.ts · slug.ts
client/      index.html · vite.config.ts · src/{main.tsx, App.tsx, index.css}
  src/pages/       Login · Dashboard · Workspace
  src/components/  PromptInput · PlanView · RunTimeline · VersionHistory · RefineInput · FileTree · CodeViewer · Preview · ErrorBanner · DataPanel · PublishDialog · ExportMenu · GitHubPushDialog · Header · GuestBanner
  src/lib/         api.ts · runStream.ts (fetch + eventsource-parser) · workspaceStore.ts (zustand)
e2e/         *.spec.ts · global-setup.ts
```

The guide's prompts, Drizzle schema, preview-route idea and App shell layout are the starting point. There is no existing code to reuse.

**Libraries:**
- **Server:** express 5, cookie-parser, compression, helmet, express-rate-limit, zod 4, drizzle-orm + pg, openai 7, esbuild, fflate, react/react-dom (for the runtime bundle), @tailwindcss/browser.
- **Client:** react 19, wouter, @tanstack/react-query, zustand, eventsource-parser, @uiw/react-codemirror + @codemirror/lang-javascript + theme-one-dark, react-resizable-panels, lucide-react.
- **Dev:** tsx, typescript, vite 8, @vitejs/plugin-react, tailwindcss 4 + @tailwindcss/vite, drizzle-kit, vitest, supertest, @playwright/test.

## Data model (`server/src/db/schema.ts`)

- `users`: id, username (unique), passwordHash (nullable, for guests), isGuest, githubLogin, githubTokenEnc, createdAt
- `sessions`: id (the sha256 of the cookie token), userId → users (cascade), expiresAt
- `projects`: id, userId → users (cascade), name, prompt, plan (jsonb, nullable until planned), previewKey and liveKey (unique random capability keys), publishedSlug (unique, nullable), publishedVersion, runLeaseUntil, createdAt, updatedAt
- `generations`: id, projectId → projects (cascade), version, mode (`create|iterate|fix|restore`), instruction, summary, files (jsonb `[{path,content}]`), model, promptTokens, completionTokens, durationMs, createdAt. **unique(projectId, version)**
- `usage_events`: userId, projectId, mode, ok, tokens, createdAt. Indexed on (userId, createdAt) for daily quotas.
- `app_records`: id (bigserial), projectId (cascade), env (`preview|live`), collection, data (jsonb), createdAt, updatedAt. Indexed on (projectId, env, collection, id).

## API surface

- **Auth** (`/api/auth`):
  - `POST register|login|guest|logout|upgrade` (upgrade: guest → account)
  - `GET me` returns the user plus remaining daily runs
- **Projects** (`/api/projects`, owner-scoped in every query):
  - `GET /`, `POST /` with `{prompt}` creates the row only, `GET /:id` returns the project plus its version list, `DELETE /:id`
  - `GET /:id/versions/:v` returns the files; `POST /:id/versions/:v/restore` creates a new version
  - `POST /:id/generate` returns **SSE**. Body is `{mode:'create'} | {mode:'iterate',instruction} | {mode:'fix',error}`.
  - `POST|DELETE /:id/publish`
  - `GET /:id/versions/:v/export.zip`; `POST /:id/export/github` with `{repoName}`
  - `GET /:id/data?env=` lists collections and recent records; `DELETE /:id/data?env=preview` resets preview data
- **GitHub** (`/api/github`): `GET connect`, `GET callback`, `DELETE /` (disconnect). The feature is hidden if the GitHub env vars aren't set.
- **Public:**
  - `GET /preview/:id/:v` (owner cookie required)
  - `GET /p/:slug` (anyone)
  - `GET /runtime/:file`
  - `/data/:appKey/:collection[/:id]` (GET, POST, PATCH, DELETE, OPTIONS)
  - `GET /api/health` (checks the DB)
- Errors raised before a stream starts (auth, quota, validation, run lease) are ordinary JSON HTTP errors. The client checks `res.ok` before it parses SSE.

## Agent pipeline & streaming (`server/src/agent/*`)

- **`LlmClient` interface:**
  - `structured({schema, name, system, user, signal})`: Chat Completions `.parse` with `zodResponseFormat`. Handles `refusal`.
  - `streamText({system, user, signal})`: `stream: true`, `stream_options.include_usage`.
  - Check the call shapes against the installed openai v7 typings when implementing.
- **Create run:**
  1. **planner** (structured `Plan`: appName, description, entities, features, `files[{path,purpose}]` in dependency order with `App.jsx` last, at most 8 files).
  2. Validate and normalize the paths.
  3. For each file, the **writer** streams raw code, given the plan, the SDK docs and the files already written. Code fences are stripped.
  4. **Build check** with the same esbuild bundler the preview uses.
  5. If the build fails, **one self-repair** pass through the editor, using the errors with file:line.
  6. Save the version in a transaction.
- **Iterate / fix run:**
  1. **editor** (structured `EditPlan {summary, changes[{path, action:create|modify|delete, instructions}]}`) from the plan, the current files, and the instruction or runtime error.
  2. The writer streams a full rewrite of each changed file.
  3. Build check, then save version n+1.
  - Full-file rewrites instead of diffs: more reliable, and the files are small.
- **SSE events** (`shared/events.ts`): `run` · `status{phase: planning|writing|checking|repairing|saving}` · `plan` · `edit_plan` · `file_start{path,action}` · `file_delta{path,delta}` · `file_done{path,content}` · `file_deleted` · `check{ok,errors}` · `done{version}` · `error{message,code}`
- **Run guards:**
  - **DB lease:** an atomic `UPDATE … SET run_lease_until … WHERE lease expired RETURNING`. A second run on the same project gets 409. This is correct even with several Autoscale instances.
  - **Daily quota** from `usage_events`: `DAILY_RUN_LIMIT` (default 40) and `GUEST_DAILY_RUN_LIMIT` (default 10). Over the limit returns 429.
  - An `AbortController` fires on `res.on('close')` when `!res.writableFinished` (not `req.on('close')`), and there is an overall 5-minute timeout.
  - Heartbeat every 15 s.
  - Headers: `Cache-Control: no-cache, no-transform` (so compression skips it) and `X-Accel-Buffering: no`.
- **Mock provider** (`LLM_PROVIDER=mock`; the default when there is no key, except in production):
  - It deterministically streams a "Task board" app built on `useCollection('tasks')`.
  - A prompt containing `[broken]` yields a runtime ReferenceError, which the fix run repairs.
  - `[syntax]` yields a build error, which exercises self-repair.
  - An iterate run adds the instruction text to the UI, so E2E tests can assert on it.
  - The header shows a "Mock LLM" badge.

## Sandbox runtime (`server/src/sandbox/*`)

- **`bundleApp(files, mode)`** uses esbuild `build` with `write:false`, format iife, `jsx:'automatic'` (`jsxDev` in preview) and a virtual-FS plugin:
  - Relative imports resolve among the generated files (trying extensions `.jsx` and `.js`).
  - `react`, `react-dom/client`, `react/jsx-runtime` and `react/jsx-dev-runtime` map to the globals from the runtime bundle.
  - `promptship` maps to `sdk.js`.
  - Any other import is a clear build error ("only react and promptship are available").
  - Errors come back as `{file,line,column,message,lineText}`.
  - The plugin never touches the disk, so the server never runs user code.
- **Results are cached** in an in-memory LRU keyed by generation id and mode (generations are immutable).
- **`runtimeAssets`:** when the server starts, esbuild bundles React 19 into a dev variant (for preview, so error messages are readable for the fixer) and a prod variant (for `/p`). It also serves `@tailwindcss/browser`. Assets get content-hashed names and immutable caching, with `Access-Control-Allow-Origin: *` and `Cross-Origin-Resource-Policy: cross-origin` so opaque-origin pages can load them. The shell loads them with `<script crossorigin="anonymous">` so runtime errors aren't masked as "Script error."
- **`shell.ts`** builds the HTML page:
  - `window.__PROMPTSHIP__ = {apiBase, appKey, env}`.
  - A bridge script (`window.onerror`, `unhandledrejection`, React 19 `onUncaughtError`/`onCaughtError`, and an ErrorBoundary that reports `componentStack`) posts `{source:'promptship', type:'ready'|'runtime-error'|'build-error'}` to the parent.
  - Storage shims, in case generated code uses localStorage anyway.
  - Build errors render as an overlay and are also posted to the parent.
  - The inlined bundle is escaped (`</script` becomes `<\/script`).
- **Response headers** on `/preview` and `/p`: `Content-Security-Policy: sandbox allow-scripts allow-forms allow-modals allow-popups; connect-src <request-origin>; form-action 'none'`. `allow-forms` is required, otherwise React `onSubmit` never fires.

## Per-app backend (`routes/data.ts`, `sandbox/sdk.js`)

- **SDK:** `useCollection(name, {orderBy?, direction?})` returns `{items, loading, error, create, update, remove, refresh}`. It keeps one shared cache per collection with subscribers, so components using the same collection stay in sync. Updates are optimistic and roll back on error. The prompts document this API for the writer.
- **Keys:** the capability key picks the project and env. The preview key is only shown to the owner. The live key works only while the project is published. The data API uses no cookies and is exempt from the Origin check.
- **CRUD:** `data = data || $patch` (jsonb). Reserved fields (id, createdAt, updatedAt) are stripped. Collection names must match `^[a-z][a-z0-9_]{0,39}$`.
- **Limits:**
  - Body ≤ 16 KB.
  - ≤ 1000 records per collection and ≤ 20 collections per env.
  - Per-IP write rate limit.
- **Data panel** in the workspace: read-only view of preview or live records, plus "reset preview data".

## Auth, quotas, security

- **Passwords:** scrypt from `node:crypto` (no native build step), salted, compared with `timingSafeEqual`.
- **Sessions:** a random 32-byte token in cookie `ps_session` (httpOnly, SameSite=Lax, Secure in prod, 30 days). The database stores only its sha256.
- **Guest flow:** "Continue as guest" creates `guest_xxxxxx` so reviewers can try it without signing up. An upgrade endpoint turns a guest into a full account.
- **CSRF:** mutating `/api` requests must send an `Origin` that matches the host. Sandboxed pages send `Origin: null` and are rejected.
- **Rate limits:** express-rate-limit on auth routes and on guest creation (5 per hour per IP), so the OpenAI key can't be drained through throwaway guests.
- **Encryption:** GitHub tokens are stored AES-256-GCM encrypted, with the key derived by HKDF from `SESSION_SECRET`.
- **Proxy:** `app.set('trust proxy', 1)` for Replit's proxy.
- **Helmet** in production:
  - CSP: self, inline styles for CodeMirror, `frame-src 'self'`.
  - The CORP override on `/runtime` and `/data` is required, because the default `same-origin` blocks sandboxed pages.

## Publish & export

- **Publish:**
  - Assigns the slug `<appname>-<6 random chars>` and sets `publishedVersion`.
  - `/p/:slug` serves that version with the production React build and the live data env.
  - The dialog shows the URL (copy / open) plus "Update to vN" and "Unpublish".
  - This is the honest version of "one-click deployment".
- **ZIP export:** `fflate` packs a Vite project containing:
  - `package.json` pinned to the React version actually used in preview, plus Vite and Tailwind v4
  - `index.html`, `vite.config.js` (alias `promptship` → `/src/promptship.js`) and `src/main.jsx`
  - the generated files, unchanged
  - `src/promptship.js`: the same `useCollection` API backed by localStorage, so the project runs anywhere
  - `promptship.json` (prompt, plan, version, model) and a README
- **GitHub push:**
  - OAuth web flow with `public_repo` scope, a state cookie and an env-configured `APP_URL` callback.
  - Creates the repo with `auto_init`, then builds a tree with inline contents, a commit and a ref update. Retries while the default-branch ref lags.
  - Returns the repo URL.

## Client UI

- **Routes (wouter):**
  - `/login`
  - `/`: prompt hero, 3 example chips (habit tracker with streaks, roommate expense splitter, kanban board), project cards
  - `/projects/:id`: the workspace
- **Workspace** (resizable panels, dark neutral theme):
  - **Left:** PlanView, RunTimeline (phases with timings), VersionHistory (view / restore), RefineInput.
  - **Middle:** FileTree, with streaming and "changed in this version" markers.
  - **Right:** CodeViewer (CodeMirror, read-only, follows the file being streamed) above Preview. Preview has reload and open-in-tab buttons, plus Preview and Data tabs.
  - **Header:** version, Publish, Export menu, user menu.
- **Streaming flow:** the dashboard submit calls `POST /api/projects` and navigates to the workspace, which starts the `create` stream once the project has no versions yet. A zustand store applies the events. When the run is done, the preview switches to the new version.
- **Auto-fix loop:**
  - The Preview listens for `message` events where `e.source === iframe.contentWindow` and shows an ErrorBanner with a **Fix with AI** button.
  - An **Auto-fix** toggle (on by default) starts a `fix` run automatically.
  - At most 2 consecutive attempts; the counter resets on a clean `ready` or a manual change.

## Replit config

```toml
modules = ["nodejs-22", "postgresql-16"]
run = "npm run dev"
[[ports]]
localPort = 3000
externalPort = 80
[deployment]
deploymentTarget = "autoscale"
build = ["npm", "run", "build"]
run = ["npm", "run", "start"]
```

- The server listens on `0.0.0.0:${PORT ?? 3000}`. Vite middleware uses `allowedHosts: true` (for `*.replit.dev`) and `hmr.server = httpServer`.
- **npm scripts** (these work on both Windows and Linux: no inline env vars, and separate dev and prod entry files):
  - `dev`: `tsx watch server/src/dev.ts`
  - `build`: `node scripts/build.mjs` (vite build → `dist/public`; esbuild server → `dist/server.js`)
  - `start`: `node dist/server.js`
  - `typecheck`, `test`, `test:e2e`, `db:generate`
- Migrations run automatically on boot. That covers Replit's separate dev and prod databases.

## Milestones (each ends green + a local git commit)

1. **Scaffold:**
   - git init, configs, docker-compose Postgres, zod env, Drizzle schema, first migration and auto-migrate
   - `/api/health`, dev and prod entries, client shell with Tailwind, `.replit`
2. **Auth & projects:**
   - users, sessions, guest and upgrade flows, Origin check, rate limits
   - owner-scoped project CRUD; Login page and auth guard; supertest tests
3. **Sandbox runtime & per-app backend:**
   - runtimeAssets, `bundleApp`, the shell, the bridge, the `/preview` route with CSP sandbox
   - `/data` API and `sdk.js`, checked against a hand-written fixture generation
   - vitest for the bundler and the data API
4. **Agents & streaming:**
   - LlmClient (OpenAI + mock), prompts, planner, writer, editor, pipeline with build check and self-repair
   - SSE route with create, iterate, fix and restore; lease, quota, usage
   - pipeline event-order tests with the mock
5. **Workspace UI:** dashboard, streaming workspace, file tree, code viewer, preview, versions, refine, Data panel.
6. **Auto-fix loop:** the bridge feeds the error banner, which starts a fix run; auto-fix toggle with an attempt cap.
7. **Publish & export:** `/p/:slug` and the publish dialog; ZIP export; GitHub OAuth connect and push.
8. **Ship:**
   - full Playwright suite and GitHub Actions CI (Postgres service, typecheck, vitest, Playwright with chromium)
   - README: mermaid architecture diagram, setup, design decisions and trade-offs as interview talking points, example prompts
   - Replit deploy checklist

**Git and publishing:**
- Commits get the `Claude-Session` trailer, per this environment's attribution setting. Tell me if you want it left out.
- I won't create a GitHub repo, push, or deploy without asking first.

## Verification

- **Each milestone:**
  - `npm run typecheck`, `npm test` (vitest against `promptship_test` in Docker)
  - `npm run dev`, then check the new behavior at http://localhost:3000 (Playwright or curl)
- **Playwright E2E** (production build, `LLM_PROVIDER=mock`, port 3100):
  1. Guest sign-in; register, logout, login.
  2. Prompt → plan appears → files stream into the tree → the preview iframe shows the "Task board" heading. Add a task in the preview, reload, and the task is still there (real backend).
  3. Refine to v2, switch back to v1, restore to v3; the preview matches each version.
  4. A `[broken]` prompt shows the error banner; the fix produces v2 and the preview renders cleanly.
  5. Publish: `/p/:slug` renders in a logged-out context and its CSP header contains `sandbox`. After unpublishing it returns 404.
  6. ZIP download contains `package.json`, `src/App.jsx` and `src/promptship.js`.
  7. User B gets 404 on user A's project and data.
- **Real LLM:**
  - With `OPENAI_API_KEY` set, run the 3 example prompts end to end, including one iterate and one forced fix.
  - Unzip one export, run `npm i && npm run dev` on it, and confirm it works standalone.
- **Replit:**
  - Import the repo, add PostgreSQL and Secrets, Run, then Deploy (Autoscale).
  - Smoke-test the public URL: SSE streams without buffering, publish works, OAuth callback works.
  - If Autoscale cuts long SSE requests, switch to a Reserved VM.

## What you'll need to provide/do

- **Docker Desktop** running (Postgres for dev and tests).
- **`OPENAI_API_KEY`** in `.env` (mock mode works until then). `SESSION_SECRET` is generated.
- **GitHub OAuth apps:**
  - dev callback: `http://localhost:3000/api/github/callback`
  - prod callback: `https://<deployment-host>/api/github/callback`
- **Replit:** import from GitHub, add PostgreSQL, set Secrets, then Deploy → Autoscale.
- **Afterwards:** record the 60–90 s demo and replace the `yourusername` placeholder links on the resume.

Reference: Replit ports and Autoscale single-port rule: https://docs.replit.com/replit-workspace/ports
