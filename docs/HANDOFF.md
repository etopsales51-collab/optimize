# Deep Insights — engineering handoff

Written 2026-09-14 at commit `b583d60` for the next engineer or coding agent
(Codex, Claude Code, Cursor). Read this whole file before changing anything.
Everything here was checked against the repository at that commit; where a
fact lives outside the repo (Railway, Twilio, WordPress), it says so.

Also read, in this order: `AGENTS.md` (repo engineering rules, identical to
`CLAUDE.md`), `.agents/PAPERCUTS.md` (known friction), then the module docs
linked below.

---

## 0. Orientation in one screen

| | |
|---|---|
| Product | **Deep Insights**, an SEO workspace for eTOP's own websites |
| Live URL | https://seo.deepinsights.space |
| MCP endpoint | https://seo.deepinsights.space/mcp |
| Repo | `etopsales51-collab/optimize`, branch `main`. Pushing to `main` deploys. |
| Local path (operator's PC) | `D:\Websites\Deep-Insights` |
| Origin | White-labelled fork of OpenSEO (MIT). Upstream history is kept; the fork's own work starts at `81d05bf` (2026-09-03). |
| Host | Railway, project `supportive-miracle`, environment `production`, service `optimize`, volume `optimize-volume` |
| Runtime | TanStack Start app served by `vite preview` inside a Node 22 container, running the Cloudflare Workers runtime (workerd/miniflare) with a **local D1 (SQLite)** database |
| Operator | Walid (walid@etopme.ae). The support email shown in the app is walid@etopme.ae. |
| Agents that use it | **Grok** (xAI) over MCP as the SEO research and communication agent. It proposes; people approve. |

### Do not confuse it with the sibling app

| Name the operator uses | URL | Repo | Stack |
|---|---|---|---|
| **SEO app** — this repo | seo.deepinsights.space | `etopsales51-collab/optimize` | TanStack Start + Drizzle + D1, Railway |
| **Leads CRM** ("Sales Insights") | leads.deepinsights.space | `WalidN1989/sales-spark-ai-97` | Lovable Cloud + Supabase edge functions, Cloudflare |

Prompts the operator pastes are often written for the CRM's Supabase stack
(edge functions, RLS, `supabase/functions/...`). If the request is for the SEO
app, translate: an edge function becomes a route under `src/routes/api/` or a
server function; RLS becomes organization/project scoping in middleware;
secrets are Railway variables read with `getOptionalEnvValue`.

---

## 1. Working agreements with the operator

These are preferences and hard-won rules. Follow them.

1. **Reply format.** Short. `✅` for done, `❌` for pending, a line on anything
   confusing, then stop. No essays.
2. **Nothing may break.** He cannot afford a rebuild. Prefer additive changes.
   Feature work must not disturb existing modules.
3. **Verification order before every push:** full `vitest run`, then
   `vite build`, then `tsc --noEmit` **last**. Push once. The container runs
   `vite build && tsc --noEmit` on boot, so a type error anywhere, including in
   a test file, takes the site down while Railway still says "deployment
   successful". This has happened.
4. **After pushing:** one `curl` for the status, then report. Do not sit in a
   polling loop watching the deploy.
5. **Secrets never enter chat.** Do not print, echo or paste keys. When a key
   is needed, generate it straight to his clipboard, for example:
   `$b=New-Object byte[] 32;[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b);(($b|%{$_.ToString('x2')})-join'')|Set-Clipboard`
6. **Do not type credentials into forms, create accounts, or sign in for him.**
   Give steps; he does it.
7. **Database writes on production are his to run.** Agents may read through
   the Railway console. When SQL must be run by hand, paste the full SQL inline
   in the reply, never a file path or a `cat` command.
8. **Independent project.** Never reuse credentials, accounts or sender domains
   from his other projects. Test emails go only to `etopseodubai@gmail.com`.
9. **Branding.** The app is his product, Deep Insights. No OpenSEO name, credit,
   Discord or community links in anything a user sees.
10. **Commit messages.** Avoid a message that contains a single quote, a
    backtick and a double quote together (see §4.3). The entrypoint now
    guards against it, but keep messages plain.
11. When a prompt is ambiguous in a way that changes the build (for example,
    which record something attaches to), ask one question with a recommended
    option, then build.

---

## 2. Local development

- Package manager: **pnpm 10.30.1** (`packageManager` in `package.json`).
  Node 22.
- Install: `pnpm install`.
- Dev server: `pnpm dev` (Vite + Cloudflare plugin; local D1 under
  `.wrangler/state`).
- Apply local migrations: `pnpm db:migrate:local`.
- Tests: `pnpm test` (Vitest). Single file: `npx vitest run path/to/file.test.ts`.
- Build: `npx vite build`. Types: `npx tsc --noEmit`. Lint: `pnpm lint`.
- Full CI gate: `pnpm ci:check` (prettier, knip, tsc, oxlint, plugin skills).
  Not run on every change so far; format and knip may report pre-existing
  issues.
- Windows note: the operator's machine is Windows 11. Git Bash and PowerShell
  are both available. In PowerShell, `curl` is an alias for
  `Invoke-WebRequest`; use `curl.exe`.

### Tests that fail only under load

`src/server/mcp/oauth-provider.test.ts` and
`src/server/mcp/oauth-refresh.e2e.test.ts` time out (5 s / 10 s) during a full
`vitest run` on this machine and pass when run alone. They are logged in
`.agents/PAPERCUTS.md`. Re-run them in isolation before concluding anything
broke. All other tests pass at `b583d60` (1310 passed).

---

## 3. Architecture

### 3.1 Stack

- **TanStack Start / Router** (file routes in `src/routes`, generated tree in
  `src/routeTree.gen.ts`, which is committed and regenerated by `vite build`;
  commit it when routes change).
- **React 19**, **TanStack Query**, **Tailwind 4 + DaisyUI 5**, `lucide-react`
  icons, `sonner` toasts.
- **Drizzle ORM** with **two dialects**: SQLite (D1, what production uses) and
  Postgres (supported upstream, not used here). Both must stay in sync.
- **Better Auth 1.6.x** for sessions, organizations, API keys.
- **Cloudflare Workers runtime** features: Durable Objects (SAM chat,
  onboarding chat, audit scratchpad), Workflows (site audit, rank check),
  KV (audit progress). In production they run inside workerd via
  `vite preview`.
- **DataForSEO** for keyword, SERP, backlink and domain data.

### 3.2 Request layering (follow it)

`TanStack server function (src/serverFunctions/*)` → `service
(src/server/features/<module>/services|*.ts)` → `repository
(src/server/features/<module>/repositories/*)`.

- Server functions use `requireProjectContext` (from
  `src/serverFunctions/middleware.ts`). The context carries `userId`,
  `userEmail`, `organizationId`, `role`, `projectId` and `project`. Access to a
  project is already checked there; handlers must not trust ids from the client
  for anything outside `context.projectId` / `context.organizationId`.
- Permission gates: `requireOrgPermission(context, { member: ["update"] })`
  from `src/server/auth/org-gate.ts` means owner or admin. Used for publishing
  credentials, WhatsApp, context autofill.
- Plain HTTP endpoints are file routes with `server.handlers`
  (see `src/routes/api/health.ts`, `src/routes/api/whatsapp/inbound.ts`).
  `/mcp`, `/agents/*` and a few others are dispatched in `src/server.ts`.
- Env/secrets: `getOptionalEnvValue(name)` / `getRequiredEnvValue(name)` in
  `src/server/lib/runtime-env.ts`. Reads `process.env` first, then the
  Workers env.

### 3.3 Database: the dual-dialect rule

Every table exists twice:

- SQLite: `src/db/<name>.schema.ts`
- Postgres: `src/db/pg/<name>.schema.ts`

and is registered in **four** places:

1. `src/db/schema.ts` (imports for both dialects, the `AppSchema` type union,
   both runtime spreads, and the named export destructure),
2. `src/db/d1/schema.ts`,
3. `src/db/pg/schema.ts`,
4. `src/db/schema-parity.test.ts` (imports and the two module lists).

`schema-parity.test.ts` fails if tables, columns, nullability, whether a column
has a default (a boolean, not the SQL), enum values, primary keys or foreign
keys differ.

Timestamps: SQLite defaults use `current_timestamp` (`YYYY-MM-DD HH:MM:SS`),
Postgres uses an ISO `to_char`. When the app compares or orders timestamps
(new code), **write them explicitly as `new Date().toISOString()`** so both
dialects agree.

#### Migrations

- Generate: `npx drizzle-kit generate` (SQLite, into `drizzle/`) and
  `POSTGRES_DATABASE_URL=postgres://x:y@localhost:5432/z npx drizzle-kit generate --config drizzle-pg.config.ts`
  (Postgres, into `drizzle-pg/`; the URL is not contacted, it just has to parse).
- **Always read the generated SQL.** drizzle-kit has proposed `DROP TABLE` and
  rebuilds of `projects`, `saved_keywords` and `rank_tracking_configs` because
  of a column-default change. On SQLite that is a data-loss rebuild. When that
  happens, hand-trim the SQLite migration to only the intended statements.
- Production applies SQLite migrations automatically at container start
  (`wrangler d1 migrations apply DB --local`). The latest are
  `drizzle/0047_greedy_masked_marvel.sql` and `drizzle-pg/0025_cute_mach_iv.sql`
  (WhatsApp tables only).

---

## 4. Deployment and operations

### 4.1 How a push becomes a running site

1. Railway builds `Dockerfile.selfhost` (Railway variable
   `RAILWAY_DOCKERFILE_PATH=Dockerfile.selfhost`): `node:22`, `pnpm install
   --frozen-lockfile`, copy source. The image contains **no build output**.
2. The container runs `docker-entrypoint.sh`:
   1. drops env values the preview env cannot serialize (§4.3),
   2. `tsx scripts/selfhost-preflight.ts` validates env and fails fast,
   3. `pnpm run db:migrate:local`,
   4. **builds** with `pnpm run build` (`vite build && tsc --noEmit`) unless a
      fingerprint of build-relevant env matches the last build,
   5. `vite preview --host 0.0.0.0 --port $PORT`.
3. The healthcheck hits `/api/health` with a 300 s start period.

A new image always rebuilds, which takes several minutes. During the swap the
site returns 502 for about a minute. That is normal.

**Build fingerprint** (only these change whether a restart rebuilds):
`VITE_*`, `AUTH_MODE`, `BYPASS_EMAIL_VERIFICATION`, `POSTHOG_PUBLIC_KEY`,
`POSTHOG_HOST`, `TURNSTILE_SITE_KEY`, `POSTHOG_SOURCEMAPS`. `ALLOWED_HOST` is
read fresh by `vite preview` and does not need a rebuild.

Data persistence: the local D1 database, Durable Object storage and KV live
under `/app/.wrangler` (see `compose.yaml`). On Railway this is the
`optimize-volume` volume. **Confirm the mount path in Railway → service →
Settings → Volumes before touching it.** Losing that volume loses every
project.

### 4.2 Railway variables (names only)

Present on the `optimize` service as of 2026-09-10:

| Variable | Purpose |
|---|---|
| `RAILWAY_DOCKERFILE_PATH` | `Dockerfile.selfhost` |
| `PORT` | Port `vite preview` binds |
| `ALLOWED_HOST` | `seo.deepinsights.space` |
| `AUTH_MODE` | `hosted` (Better Auth email/password + organizations) |
| `BETTER_AUTH_SECRET` | Session/OAuth encryption root. **Also the key for sealed publishing credentials** (§6.6). Rotating it orphans them. |
| `BETTER_AUTH_URL` | `https://seo.deepinsights.space`. Also used for deep links in WhatsApp alerts. |
| `BYPASS_EMAIL_VERIFICATION` | `true` |
| `CLOUDFLARE_INCLUDE_PROCESS_ENV` | `true`, which is why every variable reaches the preview env (§4.3) |
| `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD`, `DATAFORSEO_API_KEY` | DataForSEO |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google OAuth for Search Console / GA4 connections |
| `FIRECRAWL_API_KEY` | Context autofill (§6.8) |
| `ANTHROPIC_API_KEY`, `DEEPGRAM_API_KEY` | Present; not used by the modules described here |
| `OPENSEO_TELEMETRY_DISABLED` | `1` |
| `VITE_SHOW_DEVTOOLS` | `false` |

Not set: `OPENROUTER_API_KEY` (so SAM, the in-app chat agent, is disabled and
its nav item is removed); `AUTUMN_SECRET_KEY` (billing is off in code anyway).

WhatsApp variables to add when Twilio goes live: see §6.9.

### 4.3 Incident: a commit message took the site down

With `CLOUDFLARE_INCLUDE_PROCESS_ENV=true`, wrangler copies **every** process
env var into `dist/.dev.vars` for `vite preview`, and the Cloudflare vite
plugin's `quoteForDotenv` throws on a value containing a single quote **and** a
backtick **and** (a double quote, backslash or newline). Railway injects the
latest commit message as `RAILWAY_GIT_COMMIT_MESSAGE`. A commit message with all
of those failed the in-container build on every restart (`Unable to serialize
value to .dev.vars`) while Railway reported the image as built.

Fixed in `480da37`: the entrypoint unsets `RAILWAY_GIT_COMMIT_MESSAGE` and
`RAILWAY_GIT_AUTHOR` and drops any other variable with that shape, logging its
name. If a deploy 502s again, **read the Railway deploy log first**; the error
text names the cause.

### 4.4 Other operational facts

- **Auth mode `hosted`** turns on upstream's commercial behaviours. The fork
  has neutralised them: open registration is closed
  (`disableSignUp: true` in `src/lib/auth.ts`; sign-up returns
  `EMAIL_PASSWORD_SIGN_UP_DISABLED`), and billing is off (§5.3).
  Onboarding is invitation-only.
- **Scheduled rank checks do not run in Docker mode.** There is no cron. Checks
  run when triggered from the Rank Tracking page or the MCP tool
  `run_rank_tracker`.
- **Preview/staging:** none. `main` is production.

---

## 5. Fork-specific changes to upstream

| Change | Where | Notes |
|---|---|---|
| Rebrand to Deep Insights | `2f9d762`, `9c5f64f`, `c3f290a`, favicons `81d05bf`/`0c50770` | Theme ids renamed off `openseo`. Internal identifiers (`open-seo` package name, `OPENSEO_*` env names, `OpenSeo*` symbols) were deliberately left to keep upstream merges clean. `/support` was rebranded in place, not deleted, because a typed `<Link to="/support">` references it. |
| UAE default market | `e9581ce` | `DEFAULT_LOCATION_CODE = 2784` in `src/shared/keyword-locations.ts`. |
| Chat tab removed from sidebar | `fbbdfa2` | SAM code is intact; only the nav item is gone. |
| Registration closed | `85cf0d4` | See §4.4. |
| Billing removed | `0920878`, `d41746b` | `isBillingEnabled()` in `src/server/lib/runtime-env.ts` **returns `false` as a constant**, on purpose, so no env var can switch billing back on. Client twin: `BILLING_ENABLED: boolean = false` in `src/shared/billing.ts`. `whoami` reports credits as not metered. |
| Copy invite link | `fb73ab7` | Team page invitation menu. |
| Set a password in-app | `281315a` | Team page → generate a one-time password setup link without email. `src/server/features/auth/passwordSetupLink.ts`, `PasswordLinkModal.tsx`. |

When merging upstream, re-check each row above.

---

## 6. Modules built in this fork

### 6.1 Projects on the instance

| Project | Domain | Project id | Source |
|---|---|---|---|
| WACOM | wacomme.ae | `fcdc9a6f-7920-4d06-890f-4802a99f830e` | `docs/GROK_CONNECTIVITY_TEST.md` |
| Ubio | ubio.ae | `c7d2abb8-beac-4804-ace9-448fe25de302` | seen in app URL |
| Union Biometrics | unionbiometrics.ae | `3052bd91-ee90-4f68-98ee-6a7ea4b61cd1` | seen in app URL |
| eTOP | (etopme.ae) | not recorded | ask or call `list_projects` |

All sites are WordPress + WooCommerce + Elementor + Rank Math. Always resolve
ids with `list_projects` rather than trusting this table.

### 6.2 Optimize (Content → Optimize)

A human-approved SEO change pipeline. Grok researches and proposes over MCP;
staff read, discuss, approve and publish in the app; the app executes.

**Files**

- Contract (shared by client, server, both dialects): `src/shared/optimize.ts`
  (statuses, types, priorities, labels, state machine, Zod schemas).
- Schema: `src/db/optimize.schema.ts` + pg mirror. Tables
  `optimize_recommendations`, `optimize_comments`, `optimize_job_events`.
  JSON payloads are stored in `*_json` text columns
  (`proposal_json`, `evidence_json`, `cannibalization_check_json`,
  `execution_json`, `merge_json`, `page_snapshot_json`).
- Service: `src/server/features/optimize/services/OptimizeService.ts`.
- Repository: `.../repositories/OptimizeRepository.ts`.
- Overlap scan: `.../intentOverlap.ts`.
- Sanitizers: `.../previewSanitizer.ts` (HTML allowlist),
  `.../copySanitizer.ts` (process language, §6.4).
- Publishing: `.../publish/publishService.ts`,
  `.../publish/woocommerceAdapter.ts` (§6.5).
- MCP tools: `src/server/mcp/tools/optimize-tools.ts`.
- Server functions: `src/serverFunctions/optimize.ts`.
- UI: `src/routes/_project/p/$projectId/optimize/index.tsx` (queue),
  `.../optimize/$recommendationId.tsx` (detail), `src/client/features/optimize/`
  (`BeforeAfter.tsx`, `CommentThread.tsx`, `OptimizeBadges.tsx`).

**Vocabulary**

- Types: `on_page`, `content_refresh`, `meta`, `internal_links`, `technical`,
  `merge_pages`, `new_page_brief`.
- Priorities: `p0`–`p3` (default `p2`).
- Statuses and allowed transitions (`OPTIMIZE_TRANSITIONS`):

```
draft             → pending_approval, cancelled
pending_approval  → approved, changes_requested, dismissed
changes_requested → pending_approval, dismissed
approved          → running, cancelled
running           → succeeded, failed
failed            → approved (retry), dismissed
succeeded, cancelled, dismissed: terminal
```

`canApprove` is only `pending_approval`. `isExecutable` is only `approved`.
`failed → approved` exists because a failure is usually operational (a bad
credential) while the approval of the content still stands; the Retry publish
button uses it. It never returns to `pending_approval`.

**Invariants (enforced in the service, tested in `OptimizeService.rules.test.ts`)**

1. Nothing reaches WordPress unless a person approved it. Agents create and
   revise; only staff approve, and publish is a separate deliberate action.
2. **Part H, anti-cannibalization.** A `new_page_brief` is rejected unless
   `cannibalizationCheck.status === "clear"` **and** `overlappingUrls` is
   empty. Re-checked on every revision against the merged result.
   `intentOverlap.ts` folds synonyms (system ≈ solution ≈ software ≈ app ≈
   platform) and scores overlap against the latest audit's pages, skipping
   301 rows; thresholds `STRONG = 0.5`, `PARTIAL = 0.25`.
3. `merge_pages` requires `merge.keepUrl` and at least one `mergeFromUrls`
   that is not the keep URL.
4. A recommendation already approved or finished cannot be revised by an agent.
5. `previewHtml` and every `sections[].after` are sanitized **on write**. The
   detail page renders both with `dangerouslySetInnerHTML`, so agent HTML must
   never be stored unsanitized.

**Proposal shape** (`optimizeProposalSchema`): `title`, `metaDescription`,
`h1` as `{before, after}`; `sections[]` `{heading, action: add|rewrite|remove|keep, before?, after?}`;
`internalLinks[]`; `brand?` (manufacturer, drives the category);
`attachments[]` `{kind: catalog|datasheet|manual|certificate, label, url}`
(images rejected); `notes` (staff-only, never published).

**MCP tools**: `create_optimize_recommendation`,
`update_optimize_recommendation`, `list_optimize_recommendations`,
`get_optimize_recommendation`, `add_optimize_comment`,
`list_optimize_comments`, `analyze_intent_overlap`, plus
`list_accessible_modules` and `request_module_access` (on this single-tenant
instance access is always granted; the declaration is only logged).
`optimizePath` deep-links to `/p/<projectId>/optimize/<id>`.

**Job events** (`optimize_job_events.event_type`) seen in code: `created`,
`revised`, `copy_sanitized`, `published`, `publish_failed`, plus staff actions.
A `published` event stores each field's previous value, because WooCommerce
keeps no revision history for meta.

### 6.3 Optimize UI behaviour worth knowing

- The queue defaults to "Needs review" (`pending_approval`,
  `changes_requested`).
- Detail page actions: Approve, Request changes (body required), Dismiss,
  Retry publish (only when `failed`, with the failure reason shown), Check what
  would change (dry run, touches nothing), Publish now (confirm dialog).
- The publish panel text states what is written: SEO title, meta description,
  brand category, and draft → publish. Name, price, stock and images are never
  changed.

### 6.4 Copy sanitizer (agent notes never go live)

`src/server/features/optimize/copySanitizer.ts`, applied in create and revise.

- **Publishable:** `title`, `metaDescription`, `h1`, `sections[].heading`,
  `sections[].after`, `previewHtml`. **Staff-only, untouched:** `notes`,
  comments, evidence labels.
- Strips process language by multi-word markers: `verbatim`, `portfolio row`,
  `verify before`, `no images in this brief`, `in this brief`, `staff:`,
  `out of scope`, `conflict`, `flag for`, `walid`, `marketing still says`,
  `todo`, `fixme`, `agent note`, `could not verify`, `cannot confirm`,
  `unverified`, `needs verification`. A bare "verify" is deliberately **not** a
  marker ("verify your identity" is product copy for biometrics).
- Order: bracketed asides containing a marker, trailing dash asides after an
  em/en dash, then whole sentences. In table cells any parenthetical longer
  than 40 characters is removed even without a marker, so cells hold bare
  values. Emptied `<p>`, `<li>` and headings are removed.
- `sections[].after` goes through `sanitizePreviewHtml` first, then stripping.
- Removals are recorded as a `copy_sanitized` job event (up to 30) and returned
  to the agent.
- It cannot turn marketing prose into facts; the MCP tool description tells
  the agent to write lean copy.

### 6.5 Publishing to WooCommerce

`src/server/features/optimize/publish/woocommerceAdapter.ts` is **the only code
in the app that can change a live store**.

**Why WooCommerce REST and not the WordPress API.** Verified on wacomme.ae:
`/wp/v2/product` exposes 26 meta keys and none of Rank Math's. `/wc/v3/products`
exposes Rank Math meta in `meta_data`. WooCommerce consumer key/secret
authenticate against `wc/v3` only; they return 401 on `wp/v2`.

**Create or update is decided by the store, not by the recommendation type.**
`plan()` resolves the target URL's slug with
`GET /wc/v3/products?slug=<slug>&status=any` (drafts count, so a product this
app created earlier is found rather than duplicated).

- **Product exists → update.** Writes at most:
  - `meta_data`: `rank_math_title`, `rank_math_description`, from an allowlist
    (`WRITABLE_META`);
  - `status: "publish"`, only when the product is a draft (never the reverse);
  - `categories: [{id}]`, only when the product has no category or only
    Uncategorized.
  Never `name`, price, stock, SKU or images. Nothing to change is a **success
  with no write**, not a failure.
- **No product → create**, only when the recommendation is a `new_page_brief`
  (`allowCreate`). Creates a `simple` product with `status: "publish"` (the
  operator's decision: Approve is the review), `name` from the **H1** (never
  the SEO title), `slug` from the URL, `description` built from sections as
  `<h2>heading</h2>` + HTML, Rank Math title/description, and the brand
  category. No price, SKU, stock or images; a person adds those.
- Any other type pointing at a URL with no product is refused with a message
  naming `new_page_brief`.

**Brand categories.**

- Brand = `proposal.brand` if given, else the first word of the product name,
  cut at a hyphen that starts a model ("UBio-X Face Pro" → `UBio`), but only if
  the part before the hyphen is at least 3 characters ("AC-5000" is not "AC").
  Words like "the", "new", "buy" and pure model numbers are never a brand.
- Match against `GET /products/categories?search=<brand>&per_page=100&hide_empty=false`:
  exact name or slug first; otherwise a category containing the brand as a
  whole word, preferring the most products, then the shortest name, then the
  lowest id.
- Created with `POST /products/categories {name}` when missing; a `term_exists`
  race returns the existing id.
- A category failure never fails the publish; it is noted in `revisionHint`.
- ubio.ae at the time of writing: no ViRDi or UBio category existed; `Nitgen`
  is a parent category `nitgen-biometric-devices` (id 16, 9 products). Category
  URLs are hierarchical.

**Gates in `publishService.publishApproved`, in order:** status is `approved`;
publishing is enabled for the project; a WooCommerce connection is present and
decryptable; channel for the URL is `wp_rest` (a `/product/` path segment uses
`productsChannel`, anything else uses `pagesChannel`); then `publish()`.
Results are written to `execution_json` and a job event, and the status moves
`running → succeeded | failed`.

**Test connection** (Project settings → Publishing): GET a product to prove
read access, then `PUT /products/999999999` with `{}` to prove **write**
permission safely. A read-only key answers 401/403; a read/write key reaches
404. No real product is touched. This exists because a GET-only test once gave
false confidence.

**Site facts that affect publishing.**

- Every product renders through one shared Elementor template (`elementor-124`
  on ubio.ae), so a new product inherits layout automatically.
- **LiteSpeed Cache** serves stale pages after a publish
  (`X-LiteSpeed-Cache: hit`). Purging is manual today.
- A dedicated WordPress Editor account, `deepinsights-bot`, was set up for the
  pages/posts channel. Editor cannot reach orders, customers or settings.

### 6.5b Publishing pages and blog posts (WordPress)

- Any target URL without a `/product/` segment publishes through
  `publish/wordpressAdapter.ts` using the project's WordPress username and
  application password (Editor role). Routing is in `loadPublishTarget` in
  `publishService.ts`. The saved application password is the switch; the old
  `pagesChannel` "manual" default is ignored (no screen ever set it), and only
  `novamira` blocks.
- Resolves the last path segment as a post slug, then a page slug, drafts
  included. Existing item: writes Rank Math title, description and focus
  keyword (`primaryQuery`) via `rankmath/v1/updateMeta`, and draft to publish.
  Never its title or body.
- New brief: post if the URL sits where the site puts posts (read from its
  newest post link), top-level page otherwise, nested page refused. Title from
  the H1, body from the sections, published, filed under an existing category
  that matches the brief's words (never creates one), then Rank Math fields.
- No Rank Math: the post still publishes and the result says SEO fields were
  not written.

### 6.5c Article preview and images

- `proposal.images[]` (`shared/optimize.ts`, optional): slots with `role`
  hero, inline or gallery, `url` or `assetId`, `alt`, `caption`,
  `afterSection`, `prompt`.
- Images are copied into R2 (`optimize-images/<projectId>/<assetId>`) on
  create and update (`features/optimize/optimizeImages.ts`), served at
  `/api/optimize-images/<projectId>/<assetId>` (raster only, nosniff, sandbox
  CSP). MCP `upload_optimize_image` stores bytes or a URL.
- `shared/articleHtml.ts` builds the body with images mounted. The **Open
  article** modal (`client/features/optimize/ArticlePreview.tsx`) and the
  WordPress publisher both use it, so the preview matches what is published.
- `isArticleBrief` = new_page_brief and not a product URL. Approve is refused
  (server and UI) until it has an H1 and body (`articleMissing`).
- WordPress publish uploads images to `/wp/v2/media`, sets alt and caption,
  hero becomes `featured_media`; a failed image is reported, not fatal.

### 6.6 Publishing credentials (per project)

- Table `project_publish_settings` (`src/db/publish.schema.ts` + pg), **one row
  per project** (unique index on `project_id`). Holds both credential pairs:
  WordPress `wp_username` + `wp_app_password_sealed`, WooCommerce
  `woo_consumer_key` + `woo_consumer_secret_sealed`; `pages_channel`,
  `products_channel` (`novamira|wp_rest|manual`), `publishing_enabled`
  (default false, a safety switch). NovaMira columns exist but NovaMira is not
  implemented.
- Secrets are sealed with `src/server/lib/secret-box.ts`: AES-256-GCM via Web
  Crypto, key derived from `BETTER_AUTH_SECRET`, format
  `v1.<b64url iv>.<b64url ciphertext>`. `openSecret` returns null instead of
  throwing. **Rotating `BETTER_AUTH_SECRET` makes stored credentials unreadable**;
  the settings page then shows "Stored but unreadable — re-enter it".
- Secrets are write-only: never returned to the client, never in MCP output.
  A blank field on save keeps the stored secret.
- The settings form sets `name="di-*"` and `autoComplete="off"` /
  `"new-password"` on every field, and validates `ck_` / `cs_` prefixes. This
  was added because the browser autofilled one project's credentials into
  another; storage was always correctly scoped per project.
- Only owners/admins may save or test credentials.

### 6.7 Project context (Project settings → Context)

Upstream feature: shared memory SAM and MCP clients read before working.
Tables `project_context_sections` (typed keys `business_overview`,
`current_goal`, `positioning`, `writing_preferences`, and `custom:<slug>`),
`project_competitors`, `project_key_pages`, `project_research_log`. Prose
sections are capped at 4000 characters. MCP: `get_project_context`,
`update_project_context`.

### 6.8 Fill from website (context autofill)

Button on the Context tab. `src/server/features/project-context/services/contextAutofill.ts`
(network + orchestration) and `contextAutofillPlan.ts` (pure decisions, tested).

- Pass 1, free: the audit crawler (`crawlPage`) fetches the homepage for its
  meta description and navigation links. Nav links become up to 8 key pages
  (internal, at most 2 path segments, skipping cart, checkout, account, login,
  privacy, terms, cookie, refund, shipping, sitemap, feed, tag, search,
  wishlist, compare, matched at the start of a path segment).
- Pass 2, when `FIRECRAWL_API_KEY` is set: one `POST https://api.firecrawl.dev/v2/scrape`
  in JSON mode with a schema, returning overview, positioning, writing voice
  and key pages. One credit per press.
- **Only empty fields are written.** Current goal and competitors are never
  guessed. Written with author `user`.
- Owners/admins only.

### 6.9 WhatsApp (Content → WhatsApp)

A **team alert and approval channel**, not a customer inbox. Full setup:
`docs/WHATSAPP.md`.

**Model.** One channel per organization; one conversation per recipient (the
operator and his manager); every alert tagged with its project. The page lives
in each project with an All projects / This project filter. Owners/admins only.

**Files.**

- Schema: `src/db/whatsapp.schema.ts` + pg. Tables `whatsapp_recipients`
  (`organization_id`, `name`, `phone` digits only, `enabled`,
  `last_inbound_at`; unique per org+phone) and `whatsapp_messages`
  (`organization_id`, `project_id?`, `recipient_id?`, `direction in|out`,
  `kind alert|message`, `alert_type`, `author system|user|agent|recipient`,
  `from_number`, `to_number`, `body`, `media_url`, `message_sid`, `status`,
  `error`, `dedupe_key`, `created_by`, `created_at`).
- Pure rules, tested: `src/server/features/whatsapp/whatsappRules.ts`.
- Twilio client: `.../twilio.ts`. Repository: `.../WhatsappRepository.ts`.
  Service: `.../WhatsappService.ts`. Alert triggers: `.../whatsappAlerts.ts`.
  Webhook handler, tested: `.../whatsappWebhook.ts`; route
  `src/routes/api/whatsapp/inbound.ts`.
- Server functions: `src/serverFunctions/whatsapp.ts`. UI:
  `src/client/features/whatsapp/WhatsappPage.tsx`, route
  `src/routes/_project/p/$projectId/whatsapp.tsx`, nav item in
  `src/client/navigation/items.ts`.
- MCP: `src/server/mcp/tools/whatsapp-tools.ts` → `list_whatsapp_messages`,
  `send_whatsapp_message`.

**Alerts (one message per event; minor changes send nothing).**

| alert_type | Trigger | Hook |
|---|---|---|
| `keyword_drop` | A completed rank check vs the previous completed run for the same config: a top-20 keyword left the results, fell from page one past #10, or lost ≥ 3 places. Compared per device. | `RankCheckWorkflow.ts` finalize, after `updateConfig` |
| `audit_warning` | Site audit finished with **critical** issues; lines grouped by issue title | `siteAuditWorkflowPhases.ts` finalize step |
| `approval_needed` | Recommendation created as `pending_approval`, or revised back into it | `OptimizeService.createRecommendation` / `updateRecommendation` |
| `published` / `publish_failed` | Publish result | `publishService.publishApproved` |
| `progress` | Reserved for agent messages | — |

- Every alert has a `dedupe_key` (`keyword_drop:<runId>`, `audit:<auditId>`,
  `approval:<id>:first|<uuid>`, `publish:<id>:<uuid>`); an existing key means
  the event was already announced, so workflow retries stay silent.
- Every trigger is wrapped in `safely()`: a notification failure is logged and
  never fails the rank check, audit or publish.
- Message format: `*Project* · headline`, up to 8 bullet lines, `+N more`, then
  a deep link built from `BETTER_AUTH_URL`. Capped at 1500 characters.

**Sending.**

- Required: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`.
  Optional: `TWILIO_ALERT_TEMPLATE_SID` (Content Template `HX…` with one
  variable `{{1}}`). Inbound: `WHATSAPP_INBOUND_TOKEN`.
- With no Twilio secrets, messages are still stored with `status = not_sent`
  and an explanatory `error`. The module lights up when the variables are added.
- **WhatsApp's 24-hour rule:** free-form text only within 24 h of the person's
  last inbound message (`last_inbound_at`). Outside it, the template is used if
  configured; otherwise the send is attempted and Twilio's rejection (code
  63016) is recorded on the message with a hint.
- `StatusCallback` points at the inbound URL, so delivery status updates the
  row by `message_sid`.

**Inbound webhook** `POST /api/whatsapp/inbound?token=<WHATSAPP_INBOUND_TOKEN>`.

- Token compared in constant time; wrong or unset token → 403.
- `MessageStatus` present → delivery receipt. Otherwise an inbound message:
  sender normalised to digits and matched to recipients by the **last 9
  digits**; stored as `direction in`, `author recipient`; `last_inbound_at`
  updated. Unknown numbers are ignored (logged).
- Always 200 with `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`
  and `content-type: text/xml`, even when recording fails.

**Agent use.** Grok reads replies with `list_whatsapp_messages` (pass `since`
to get only new ones) and writes with `send_whatsapp_message` (author `agent`).
It must not approve over WhatsApp: the pattern is file the recommendation,
then message its link.

**Status at handoff:** code deployed; Twilio **not connected**; no recipients
added.

### 6.10 Grok over MCP

- Connection brief and standing routine prompt: `docs/GROK_CONNECTIVITY_TEST.md`.
- Grok authenticates with an API key created in the app (prefix `oseo_`) or
  OAuth. MCP clients cache the tool list at connect time: after adding or
  changing tools or output schemas, **reconnect the client**.
- Every tool is registered in `src/server/mcp/server.ts` (60 tools across
  projects, keywords, SERP, domain, backlinks, Brand Lookup, Prompt Explorer,
  rank tracking, local SEO, Search Console, GA4, site audit, project context,
  Optimize and WhatsApp). One token reaches all of them; nothing is hidden per
  module.
- **Module list.** `src/server/mcp/modules.ts` (`MCP_MODULES`) is what
  `list_accessible_modules` and `request_module_access` return.
  `modules.test.ts` fails if a registered tool belongs to no module, so a new
  tool cannot be silently left out.
- **AI search tools** (`tools/ai-search-tools.ts`): `run_brand_lookup` and
  `run_prompt_explorer` call the same services with the same defaults as the
  pages (Brand Lookup: location 2784, language en; Prompt Explorer: all four
  models, web search on, country US). Same parameters means the same R2 cache
  key, so opening an agent run in the UI does not charge again while fresh.
- **Agent runs** (`research_runs` table, `features/research-runs/`). After a
  research tool succeeds, `server.ts` calls `recordResearchToolCall`, which maps
  the call to page URL params (`shared/researchRuns.ts`) and logs one row per
  target. Keyword research, Domain, Backlinks, Brand Lookup and Prompt Explorer
  show these under **Agent runs** beside Recent searches (`AgentRunsSection`).
  Agents can read them back with `list_research_runs`. Logging never throws,
  so a failed insert cannot fail the tool.

### 6.11 Research history is stored in the database

- The five Research pages keep **Recent searches** in `research_history_lists`
  (one row per user, project and list). They follow the person to any PC.
- `src/client/hooks/useLocalHistoryStore.ts` keeps its old name and signature,
  so no page changed. It loads from the server. On a browser's first load it
  merges that browser's old localStorage list in, once (flag
  `<storageKey>:imported-to-db`), then saves every change as the whole list.
  localStorage is only a fallback copy for when the server cannot be reached.
- Changes made before the saved list loads are only shown, not saved, then
  merged once it loads. This stops a quick auto-search from overwriting the
  stored list.
- Saved keywords, rank tracking, audits and Optimize were already in the
  database. Still per browser, on purpose: the open search tabs
  (sessionStorage), table filters, preferred keyword location, theme and last
  active project. These are view preferences, not research data.

---

## 7. Open work and known gaps

### Optimize and publishing

- ❌ **Pages and posts** (`wp/v2`) are not implemented. Only WooCommerce
  products publish. `pagesChannel` exists but nothing executes it.
- ❌ **`merge_pages` execution** (301 redirects, content consolidation) is not
  implemented.
- ❌ **Body/section rewrites on existing products** are not written; sections
  are only used when creating a product.
- ❌ **`rank_math_focus_keyword`** is never written.
- ❌ **NovaMira** is an interface only (columns and channel value, no adapter).
- ❌ **LiteSpeed cache purge** after publish is manual.
- ❌ **Catalog/datasheet attachments** are carried on the proposal and shown on
  the card, but not uploaded to WordPress. Agreed plan: NovaMira adds a
  "Catalog Download" button on product templates that reads product meta
  `deepinsights_datasheet_url` (+ optional `deepinsights_datasheet_label`);
  the operator uploads PDFs to media; then the adapter writes that meta key on
  publish (WooCommerce key is enough). Brief: `docs/NOVAMIRA_DATASHEET_BUTTON.md`.

### WhatsApp

- ❌ Add the Twilio variables on Railway and the webhook in Twilio.
- ❌ Add recipients on the page.
- ❌ Approved template for alerts outside the 24-hour window.
- ❌ No scheduled progress digest (Docker mode has no cron). Intended: a Grok
  routine composes it and calls `send_whatsapp_message`.

### Security and housekeeping

- ❌ Rotate the MCP API key (`oseo_…`) and the WooCommerce keys that passed
  through chat during setup, if not already done.
- ⚠️ Last known: wacomme.ae's WooCommerce key was **read-only**; publishing
  there fails until it is Read/Write. Use Test connection to confirm.
- ⚠️ Two flaky OAuth tests under load (§2).

---

## 8. Recipes

**Add a table.** Write both schema files → register in the four barrels →
`npx vitest run src/db/schema-parity.test.ts` → generate both migrations →
read them (no DROP or rebuild of existing tables) → commit schema, SQL,
snapshots and journals.

**Add an MCP tool.** Define it next to its module in `src/server/mcp/tools/`
using `withMcpProjectAuth` and `mcpResponse` → register in
`src/server/mcp/server.ts` → gate writes with `requireOrgPermission` when they
touch money, credentials or phones → reconnect Grok.

**Add a page.** File route under `src/routes/_project/p/$projectId/` → nav
entry in `src/client/navigation/items.ts` (both `projectNavItems` and the
group in `getProjectNavGroups`) → `vite build` regenerates
`src/routeTree.gen.ts`; commit it.

**Add a notification.** Add a function in `whatsappAlerts.ts` that calls
`announce()` with a unique `dedupeKey`, and call it only after the event has
succeeded. Add the new `alert_type` value to the enum in **both**
`whatsapp.schema.ts` files. Drizzle `text(..., { enum })` columns are
TypeScript-only (no `CHECK` constraint, no `pgEnum`), so the SQL does not
change, but regenerate migrations anyway so the snapshots stay current.

**Ship.** `npx vitest run` → `npx vite build` → `npx tsc --noEmit` → commit
(plain message) → push once → one `curl -sI https://seo.deepinsights.space/`
after a few minutes → report.

**Diagnose a 502 after a push.** Railway → Deployments → Deploy logs. Look for
`error during build:` or `Unable to serialize value to .dev.vars` (§4.3) or a
`tsc` error. Fix forward; do not force-push.

---

## 9. Where things are

```
src/
  routes/                     file routes (pages + api)
    _project/p/$projectId/    project-scoped pages (optimize, whatsapp, settings/…)
    api/                      HTTP endpoints (auth, health, gsc/ga4 oauth, whatsapp)
  serverFunctions/            TanStack server functions (optimize, whatsapp, projectContext, …)
  server/
    features/<module>/        services, repositories, pure rules per module
    mcp/                      MCP server, auth, tools
    workflows/                RankCheckWorkflow, site audit phases
    lib/                      runtime-env, secret-box, errors, dataforseo, audit crawler
  client/
    features/<module>/        React components per module
    navigation/items.ts       sidebar
  db/                         SQLite schemas, pg/ mirrors, barrels, parity test
  shared/                     code shared by client and server (optimize contract, audit issue registry, locations)
drizzle/ drizzle-pg/          generated migrations
docs/                         HANDOFF.md, WHATSAPP.md, GROK_CONNECTIVITY_TEST.md, NOVAMIRA_DATASHEET_BUTTON.md, self-hosting docs
.agents/PAPERCUTS.md          known friction
docker-entrypoint.sh          container start sequence
Dockerfile.selfhost           Railway image
```
