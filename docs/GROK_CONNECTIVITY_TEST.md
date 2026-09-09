# Grok ↔ Deep Insights — connectivity test and dummy optimization run

Hand this file to Grok (or paste the prompt in section 3). It has two jobs:
prove the connection end to end, and run one small, real research pass on
wacomme.ae so we see any issue before the write path goes live.

---

## 1. Endpoint

| | |
|---|---|
| MCP URL | `https://seo.deepinsights.space/mcp` |
| Transport | Streamable HTTP (MCP protocol `2025-06-18`) |
| Auth | API key, sent as **either** header below |
| Header option A | `Authorization: Bearer oseo_…` |
| Header option B | `x-api-key: oseo_…` |
| Pilot project | **WACOM** — `wacomme.ae` — id `fcdc9a6f-7920-4d06-890f-4802a99f830e` — market UAE (2784) / en |

**Getting the key (Walid does this, then gives the key to Grok directly):**
Deep Insights → **Settings** → **API keys** → generate. The key starts with
`oseo_`. Anonymous calls to `/mcp` return `401` by design.

Tools available today: **46 read tools** (projects, keywords, SERP, domain,
backlinks, rank tracking, site audit, Search Console, GA4, local SEO). There
are **no Optimize write tools yet** — see section 4.

A server instruction is baked into the MCP handshake: research tools spend
DataForSEO credits; ask before planned batches over 2,000 credits. This test
is capped well below that.

---

## 2. What "working" looks like

Grok should be able to, in order:

1. Complete the MCP `initialize` handshake and receive `serverInfo.name = "Deep Insights MCP"`.
2. Call `whoami` and get back `mode: "hosted"` plus the account email.
3. Call `list_projects` and see WACOM / wacomme.ae with the id above.
4. Read every module the Optimize loop depends on for WACOM, without error.
5. Produce one dummy recommendation as structured JSON in our schema (section 3), and a connectivity report.

Anything that fails at steps 1–4 is a wiring issue on our side and is exactly
what we want to find now.

---

## 3. Prompt for Grok (copy from here to the end of the block)

```
You are connecting to Deep Insights, an SEO platform, over MCP for the first
time. Your job is a CONNECTIVITY TEST plus ONE small dummy research pass. Do
not try to publish, change, or write anything anywhere — there is no write
path yet, and nothing you do should touch a live website.

CONNECTION
- MCP server: https://seo.deepinsights.space/mcp  (Streamable HTTP)
- Auth: send the API key you were given as `Authorization: Bearer <key>`
  (or `x-api-key: <key>`). The key starts with oseo_.
- First call tools/list and READ EACH TOOL'S inputSchema. Follow the schema
  exactly; do not guess parameter names from these instructions.

CREDIT CAP
- Stay under 500 DataForSEO credits for this whole run. Prefer the smallest
  limits each tool allows. If a step would exceed the cap, stop and say so.

STEP 1 — PROVE THE CONNECTION
1. Call whoami. Record mode, userEmail, scopes.
2. Call list_projects. Find the project for wacomme.ae (expected id
   fcdc9a6f-7920-4d06-890f-4802a99f830e, name WACOM). Use the id you actually
   receive from list_projects for every later call, not the expected one.
3. Call get_project_context for that project.

STEP 2 — READ THE MODULES THE OPTIMIZE LOOP RELIES ON (all for WACOM)
Call each of these once. If a tool reports "not configured" or "no data",
record that verbatim and continue — do not retry in a loop.
4. get_audit_status, then get_audit_issues and get_audit_pages for the most
   recent audit (there is a completed 50-page audit).
5. get_search_console_performance for the last 28 days, dimensions query and
   page, small row limit.
6. get_search_opportunities (striking-distance style opportunities).
7. get_ranked_keywords with target wacomme.ae, smallest limit.
8. get_domain_overview for wacomme.ae.
9. get_backlinks_overview for wacomme.ae.

STEP 3 — ONE DUMMY CONTENT OPTIMIZATION (research only)
10. From the audit pages, pick ONE real product page on wacomme.ae (a Wacom
    tablet or pen display page — not the homepage, not a category).
11. Take its current title, meta description, H1 and word count from the
    audit page data.
12. Find the 3–5 queries that page should own: use the Search Console rows
    for that URL plus research_keywords with the product name as the seed
    (limit 20, market UAE / en). Run get_serp_results for the single best
    query (UAE, depth 10) to see who ranks above wacomme.ae and why.
13. ANTI-CANNIBALIZATION CHECK (mandatory): compare your chosen primary query
    against the titles and H1s of ALL other audit pages. If another
    wacomme.ae page already targets the same intent, say so and recommend
    improving or merging that page instead of writing new content. Never
    propose a new page when an existing one covers the intent.
14. Draft ONE recommendation of type content_refresh (or merge_pages if
    step 13 found a clash) for that URL.

STEP 4 — REPORT BACK (this is your deliverable; nothing is posted anywhere)
Return two things.

A) CONNECTIVITY REPORT — a table: tool name | ok / failed | latency if known |
   error text verbatim if failed | one line on what came back. Include every
   tool you called. Also state the serverInfo.name from initialize.

B) THE DUMMY RECOMMENDATION as a single JSON object in EXACTLY this shape
   (this is the schema the write tool will accept later, so the same JSON
   will post as-is once that path is live):

{
  "type": "content_refresh",
  "priority": "p1",
  "targetUrl": "https://wacomme.ae/…",
  "primaryQuery": "…",
  "secondaryQueries": ["…", "…"],
  "evidence": [
    { "source": "gsc_striking_distance", "label": "…", "url": "…", "metric": "impressions", "value": 0 },
    { "source": "site_audit", "label": "…", "refId": "<audit page id if available>" },
    { "source": "competitor", "label": "…", "url": "https://competitor…" }
  ],
  "proposal": {
    "title": { "before": "…", "after": "…" },
    "metaDescription": { "before": "…", "after": "…" },
    "h1": { "before": "…", "after": "…" },
    "sections": [
      { "heading": "…", "action": "add", "after": "…" },
      { "heading": "…", "action": "rewrite", "before": "…", "after": "…" }
    ],
    "internalLinks": [
      { "anchor": "…", "toUrl": "https://wacomme.ae/…", "action": "add" }
    ],
    "notes": "why this, in two sentences"
  },
  "cannibalizationCheck": {
    "status": "clear",
    "method": "title_h1_overlap",
    "overlappingUrls": [],
    "notes": "which pages you compared against and what you found"
  },
  "pageSnapshot": {
    "url": "https://wacomme.ae/…",
    "fetchedAt": "<ISO timestamp>",
    "title": "…", "metaDescription": "…", "h1": "…", "wordCount": 0
  }
}

Rules for the JSON: evidence.source must be one of site_audit,
rank_tracking, gsc_striking_distance, brand_lookup, backlinks, competitor,
cannibalization. cannibalizationCheck.status must be clear, overlap_found or
merge_recommended; if you found overlap, list the URLs and set type to
merge_pages with a "merge" object { keepUrl, mergeFromUrls[], redirectPlan[] }.
Keep all "after" copy in plain text or simple HTML (p, h2, h3, ul, li, strong,
a) — no scripts, no styles.

Then, in plain English, list anything that looked wrong, slow, empty, or
confusing about the connection or the data. That list is the most valuable
part of this run.
```

---

## 4. What is NOT available yet (phase 2)

Grok cannot post into Optimize today. These MCP write tools are the next build
and will accept the JSON above unchanged:

- `create_optimize_recommendation` — posts a recommendation (pending review)
- `update_optimize_recommendation` — revises after staff request changes
- `add_optimize_comment` / `list_optimize_comments` — the in-UI thread
- `list_optimize_recommendations` / `get_optimize_recommendation`
- `analyze_intent_overlap` — server-side cannibalization scan over the crawl
- `request_module_access` / `list_accessible_modules`
- Inbound signed webhook (alternative to MCP for posting)

Until then the recommendation comes back to Walid as text. Once phase 2
ships, the same prompt gains one final step: call
`create_optimize_recommendation` with the JSON.

---

## 5. What to send back to Claude

Paste Grok's full reply (connectivity report + JSON + issues list). The
connectivity table tells us whether auth, the MCP transport and each module
integration work; the JSON tells us whether the research quality and schema
discipline are good enough to trust with the write path.
