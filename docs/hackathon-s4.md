# TestSprite Hackathon Season 4: rules for this repo

This file is binding for every coding agent working in
`jnzlab/lucid-hire`. Read it before writing code, opening a PR, or
touching CI. Where it says **MUST** or **NEVER**, there are no exceptions
without the owner's say-so.

Researched 2026-10-21 from the official sources listed at the end, and
re-checked against the hackathon page on 2026-10-22 (no changes, no
extension). Items marked **(unverified)** were not stated in any doc;
confirm them before relying on them.

---

## 0. Current setup (fresh start, 2026-10-22)

The first attempt was abandoned. Its repos, CI and TestSprite setup were
spread across several accounts. On 2026-10-22 the owner restarted from
scratch in this repo, with **one fixed set of accounts**.

**Accounts (owner's decision, 2026-10-22).** Use these and no others.
The supervisor holds the exact emails and IDs privately; they are kept out
of this public repo. Worker agents never touch accounts (§6b).

| Service | Account | Notes |
|---|---|---|
| GitHub | **`jnzlab`** | This repo, public. **GitHub Actions is unavailable** on this account, so Workers Builds deploys; see §7. |
| TestSprite | The owner's TestSprite account (Starter plan) | The **one** account that creates the suite, connects the GitHub App, and is named in the submission (§3a). |
| Clerk | The owner's Clerk account, app "Lucid Hire" | The live app uses the **production instance** (`clerk.lucidhire.io`); local development uses the **development instance**. See §8. |
| Cloudflare | The owner's Cloudflare account, Workers Free | Holds the `lucidhire.io` zone. The `cf` CLI is logged in through OAuth. |

**Workers and domains (owner's decision, 2026-10-22).** There is **one
live environment** and no staging:

| Worker | Serves | Domain |
|---|---|---|
| `lucidhire-app` | The frontend (static SPA) | **`https://lucidhire.io`**. `www.lucidhire.io` is attached too and permanently redirects to the apex. |
| `lucidhire-api` | The backend (Hono) | **`https://api.lucidhire.io`**. The frontend calls it cross-origin with a Clerk bearer token, so the API owns CORS. |

The owner deleted the legacy Vercel project on 2026-10-22, so the legacy
app no longer serves `lucidhire.io`.

**Starting state (checked 2026-10-22):**
- **GitHub:** the repo is empty.
- **TestSprite:** no project, no suite and no GitHub App connection yet.
- **Cloudflare:**
  - no `lucid-hire-*` Workers, D1 databases, R2 buckets, Vectorize indexes or Workers Builds connections;
  - the `lucidhire.io` zone is active. Its apex `A` and `www` `CNAME` records still pointed at the deleted Vercel project and are replaced by the Worker custom domains in the scaffold PR;
  - a leftover empty queue `lucidhire-queue` (from 2026-07, no producers or consumers) exists. Reuse it or delete it only with the owner's approval.
- **Everything** in §5 and §7 has to be set up again from zero.

---

## 1. What we are doing

LucidHire, an AI candidate screening app that is live today on Vercel, is
being **ported entirely to Cloudflare**. The work happens in this repo. The
legacy code lives in `jnzlab/lucid-hire-legacy` (locally
`~/Projects/today/lucid-hire-legacy`). Its Vercel deployment was deleted on
2026-10-22, and the new app serves `lucidhire.io` (§0).

**This is a full upgrade, not a 1:1 port** (owner's decision,
2026-10-21):
- **Fix the legacy app's bugs and issues** as we go. Don't carry a known
  bug across. Note each fix in the PR that makes it, since a test that
  catches a legacy bug makes a good red-then-green story.
- **Completely reimagine the UI and UX**: layout, information
  architecture, colour scheme, light and dark themes, typography and type
  scale, spacing, motion, empty, loading and error states. "What looks
  good actually sells." Nothing visual is copied from the legacy app.
- The bar for every screen is: **functional, fast, visually appealing,
  and easy to use.**
  - **Fast:** small bundles, route-level code splitting, prerendered
    public pages, optimistic UI where it's safe, and no layout shift.
  - **Easy:** clear primary actions, few steps per task, keyboard and
    screen-reader friendly (WCAG AA contrast), and works at phone width.
- What carries over from legacy is the **product**: its features, flows,
  data model and pricing tiers. Its look and its bugs do not.
- **The design system is LOCKED (owner, 2026-10-21):**
  `docs/design/design-system.md`, taken from the final landing page.
  Every screen is built on its tokens, motifs and component specs. No
  one-off values, and no restyling without the owner's approval. The
  first app-shell PR puts its Tailwind and shadcn/ui setup (§5 of that
  file) into the web Worker.

**Areas the owner has flagged (2026-10-21). Redesign these; don't port
them:**
- **Usage tracking:** inefficient in legacy. Rebuild it so a plan-limit
  check is a single cheap read: a per-org, per-period counter in D1,
  updated atomically. Don't count rows on every upload. Record AI token
  usage per call, but not in the request's hot path.
- **Subscriptions and billing (Polar):** buggy and not working correctly
  in legacy. Rebuild the plan state machine from Polar webhooks:
  - verify webhook signatures
  - handle each event idempotently, keyed by event ID
  - cover create, upgrade, downgrade, cancel at period end, renew, payment
    failure and refund
  - make our DB the single source of truth for plan tier and limits
  Every one of those transitions gets a TestSprite or unit test. See
  `docs/legacy-audit.md` for the specific legacy bugs.
- **Landing page: the highest-effort surface in the app.** It is
  completely reimagined, and its job is to **convert visitors into
  sign-ups**. It needs:
  - a clear value proposition above the fold
  - a demo of the product working: CV in, ranked leaderboard out
  - social proof and trust signals
  - transparent pricing
  - one strong primary call to action, repeated
  - fast loading: prerendered, with images and fonts optimised and no
    layout shift
  - good SEO and Open Graph metadata
  - **Chosen direction (owner, 2026-10-21): "Highlighter" with a
    scrollytelling story.** Paper white, ink black, yellow marker for
    matches and pink for gaps. Archivo (wide, heavy) for display and body,
    Fragment Mono for labels. The centrepiece is a pinned stage that plays
    one CV's trip as the visitor scrolls: pile → read → mark → score →
    rank → meet. **The prototype is the final, locked landing page
    (owner, 2026-10-21): build it as it is.** Prototype:
    https://claude.ai/artifact/2Ud5GXJALFR9VapxQqsPaA (version 14), with a
    standalone copy in `docs/design/landing-prototype.html` (open it in a
    browser).
    Build it with CSS `position: sticky` plus a scroll check that picks the
    step under a reading line (the prototype's approach; an
    IntersectionObserver's `rootMargin` is ignored inside cross-origin
    iframes), no scroll-jacking and no heavy animation library. Keep a
    reduced-motion version, and on
    phones pin the stage on top with the story scrolling underneath. The
    `scrollytelling` skill (installed at user level in
    `~/.claude/skills/`, not in this repo because its source has no
    licence) has the rules.
  It gets its own PRs and its own TestSprite tests: CTAs route correctly,
  pricing matches the plans, and the page renders on mobile and desktop.

The hackathon entry is the port itself: **every PR in this repo is gated by
a TestSprite check run against a live deployment.** The README and the PR
thread tell that story.

| Legacy (Vercel) | Target (Cloudflare) |
|---|---|
| Next.js 16 App Router | **Web Worker**: Vite SPA, React 19, TanStack Router and Query, shadcn/ui, Tailwind 4. The landing page is prerendered. |
| Next.js API routes | **API Worker**: Hono, with Zod validation |
| Neon Postgres | **D1**, via Drizzle |
| pgvector (768 dims, cosine) | **Vectorize** |
| GCP Cloud Storage | **R2**, with signed URLs through the S3 API |
| Trigger.dev pipeline | **Workflows**, plus **Queues** for bulk uploads |
| SSE live leaderboard | **A Durable Object per job** |
| `pdfreader` | Workers AI `toMarkdown`, or the PDF sent to Gemini directly. Do not parse PDFs on Worker CPU. |
| Turnstile | Unchanged |
| Vercel AI SDK with Gemini | Unchanged SDK, new models (see below) |
| Clerk (auth), Polar (billing) | Unchanged |

The architecture follows `~/Projects/today/tahir-pilot-school-spa`: two
Workers, Clerk bearer tokens verified in the API Worker, D1 migrations.
Unlike that project, the API has its own domain (`api.lucidhire.io`) and
the frontend calls it directly; there is no service binding between them.
Copy its patterns rather than inventing new ones, except for the tooling
below.

### Fixed decisions (owner, 2026-10-21)

**AI models**, through `@ai-sdk/google`:

| Use | Model | Rule |
|---|---|---|
| All text generation, structured (`generateObject` with Zod) and plain | **`gemini-3.8-flash`** | The **only** text model in the app. Declare it in one constant (`GEMINI_TEXT_MODEL`) and record it in usage rows. Never use `-preview` or `-latest` names. |
| All embeddings | **`gemini-embedding-2`** | Takes up to 8,192 input tokens. The Vectorize index dimension MUST match the `outputDimensionality` we send. Settle the number (768, as legacy, unless the model rejects it) before creating the index, and never mix vectors from different models in one index. |

Legacy used `gemini-3-flash-preview` and `gemini-embedding-001` (768
dims). Neither is carried over. Prices for `gemini-3.8-flash` double on
2027-01-01 ($0.75/$3.75 now, then $1.50/$7.50 per 1M tokens).

**Gemini key and tier (owner, 2026-10-22):** the legacy key's prepaid
credit is used up (HTTP 402), so the owner made a new key and chose to
**stay on the free tier** with the models above. The key lives in the
`lucidhire-api` secret `GOOGLE_GENERATIVE_AI_API_KEY` and in the owner's
`apps/api/.dev.vars`, never in the repo. What that means:
- Free-tier content may be used by Google to improve its products, so
  only sample CVs (the prototype's cast) go through it during the
  hackathon.
- Latency is high and uneven: `gemini-3.8-flash` took 11 to 112 seconds
  for a 400-word rewrite on 2026-10-22, and sometimes answered 503 "high
  demand". Calls use thinking level `low` (`minimal` is rejected), a
  90-second timeout, and the SDK's retries; the UI says a rewrite can take
  up to a minute.
- `gemini-embedding-2` accepts `outputDimensionality: 768` (checked
  2026-10-22).
- Request-facing AI calls are capped per company by the `AI_RATE_LIMIT`
  binding (10 a minute), and every call, failed ones included, writes an
  `ai_usage` row after the response (`waitUntil`).

**Cloudflare tooling: use the `cf` CLI, not wrangler.**
- The `cf` CLI (v1.0.0-beta) is installed globally and already
  authenticated with the owner's account through OAuth. Never run
  `wrangler`, and never add it as a dependency, unless a `cf` equivalent
  provably doesn't exist. If so, stop and ask the owner.
- Project configuration is **`cloudflare.config.ts`** (typed), not
  `wrangler.jsonc`. Generate it with `cf init .`, review it, and commit it,
  because in CI an uncommitted config gets auto-generated without review.
- Find commands with `cf cli search "<task>"` and docs with
  `cf docs search "<question>"`, then `<command> --help`. Never chain
  nested `--help` calls. Keep search queries anonymous: no names, domains,
  IDs or tokens.
- Known commands: `cf deploy` (`--dry-run`, `--message`, `--tag`,
  `--secrets-file`, `--provision`), `cf previews deploy`, the
  `cf d1 migrations apply|list|create` family (the database is
  identified **by ID**, and migrations use the same format as wrangler's),
  `cf workers secrets update|bulk|delete`, `cf workers versions create`,
  and `cf auth whoami`. The global `-m/--mode` flag selects a configuration
  mode; we have a single live environment, so we don't use modes for
  deploys. `--local` uses local simulations.
- Drizzle migrations: generate them with `drizzle-kit generate`, apply them
  with `cf d1 migrations apply`.
- In CI, authenticate with the `CLOUDFLARE_API_TOKEN` secret.

---

## 2. Dates (all Pacific Time)

| Date | What |
|---|---|
| Oct 16 | Season opened. Project track and CLI bonus window began. |
| **Oct 22, 11:59 PM PT** | **Project submissions close.** This is a hard deadline. |
| Oct 23–27 | Judging |
| **Oct 29, 11:59 PM PT** | CLI bonus window closes. PRs must be open and out of draft. |
| Oct 30 – Nov 3 | CLI review and allocation |
| Nov 6 | Winners announced on X and Discord |

The final schedule is whatever is posted in Discord `#📢hackathon-rules-and-announcements` (see §3a).

**Deadline rule:** from Oct 22 18:00 PT, start no new layer. Only finish,
fix, document and submit. A smaller app that works and has a green check
beats a bigger one that is half broken.

---

## 3. Submission checklist (all required unless marked optional)

**Repo (`jnzlab/lucid-hire`, public):**
- [ ] Source code
- [ ] `README.md` covering what the app is, the **live public URL**, and
      **what the TestSprite suite covers**: a list of flows and tests
- [ ] `.gitignore` in place, with **no secrets committed, ever** (see §9)
- [ ] At least one PR **carrying a TestSprite check, with tests passing**

**Account and portal:**
- [ ] The owner's TestSprite account (§0). Use the same email in the
      submission.
- [ ] A **TestSprite 3.0 test suite** in the web portal. Judges open it.
- [ ] The TestSprite **GitHub App** installed on this repo, with a PR
      trigger configured (§5). The CLI alone is not enough: Season 4 is
      about the GitHub App.

**Live app:**
- [ ] A **live public URL**. Never `localhost`, never a private IP.

**Forum post in Discord `#hackathon-s4-submissions` (template in §3a):**
- [ ] PR link
- [ ] Live public URL
- [ ] TestSprite account email and name
- [ ] Optional: a demo video. It isn't scored, but judges watch it.

"The PR thread is the submission." Judges read the story from the PR, then
check the suite in the 3.0 portal. Write PR descriptions for a judge reading
them cold (§6).

### 3a. Official rules from Discord (read 2026-10-21, binding)

These come from `#📢hackathon-rules-and-announcements` and the
"Submission Requirements" post in the `#hackathon-s4-submissions` forum.
Where they are stricter than the website, they win.

**Workflow:** Season 4 runs on the **TestSprite 3.0 web portal plus the
GitHub App**, not the Season 3 CLI loop. The intended loop: generate the
suite in the portal against the live app → connect the repo with the
GitHub App → the agent writes code → TestSprite checks the PR → the agent
fixes from the failure bundle → the check reruns on its own. **"Your proof
is the PR itself."**

**Hard requirements (missing any of them risks disqualification):**
- **Generate the suite in the 3.0 portal FIRST**, against the live app.
  Then install the GitHub App (dashboard: Settings → GitHub App). The PR
  check runs the suite that already exists.
- At least one PR, **opened during the build window (Oct 16–22)**, that
  carries a **TestSprite comment or status check**. Turning on PR blocking
  is optional but **counts toward the score**, so we turn it on.
- **The app must be reachable at a public URL throughout the build phase**,
  not only at submission. Every PR check hits that URL, and if it's down
  the checks fail. Never leave the live URL broken.
- **Account match:** the TestSprite account submitted MUST be the one that
  generated the suite **and** connected the GitHub App. A different account
  means disqualification. One owner account does everything.
- **One submission per person or team.** Several submissions means
  disqualification. List every team member.
- **Public repo** with a README covering the app, the live URL and what
  the suite covers. **A missing README means disqualification.** No
  secrets in the repo.
- **Web applications only.**
- **Eligibility:** follow TestSprite on X, and be a member of the Discord
  with a badge next to your name. TestSprite's X account is **@Test_Sprite**
  (verified, linked from testsprite.com); `@TestSprite` is an unrelated
  account. The badge is the Discord **TEST** server tag that staff and
  entrants display. Posts made only on X don't count. Entrants
  must be 18+, and nobody in a comprehensively sanctioned region can be
  paid.
- Only posts in **`#hackathon-s4-submissions`** (a forum channel) count.

**The submission post** (forum post in `#hackathon-s4-submissions`,
following the template):
1. **A link to a PR with a TestSprite check (required):** a TestSprite
   comment or status check, connected through the GitHub App, with tests
   passing. **"A PR that caught a bug first and went green after your fix
   is the best version of this."** So we keep a PR where the check went
   red, then green after the fix, and link that one.
2. **The live public URL (required).**
3. **The TestSprite email and name (required)**, so judges can find the
   suite in the 3.0 portal.
4. A demo video link (optional; not scored, but watched).

Other entries are titled "<Project>: <one-line pitch>". Ours could be
"LucidHire: AI candidate screening, ported to Cloudflare with TestSprite
holding every merge".

**After submitting:**
- **Never edit the submission post after the deadline**; it may lead to
  disqualification.
- **Keep Discord DMs open.** Winners are contacted by DM, and if they can't
  be reached within **48 hours** the prize moves to the next runner-up.
- Prizes are paid by Stripe, PayPal or bank transfer.
- Submitting gives TestSprite permission to feature the project. The work
  must be our own original work, and we keep ownership.

**Judging detail:** "Tests that run themselves" is assessed **from the
PR, the portal, and our commits**. Commit history is read too, so keep
commits clean and meaningful.

**Credits:** the free credits are meant to be enough to start. The rules
link a **hackathon credit-boost form**, and staff have sent plan-upgrade
promo codes to people who applied. If credits run low, the owner applies
through that form. Agents never fill in forms.
**The boost form only accepts participants whose credits are completely used up**, and it is open from Oct 16 to Nov 14 (PT). On 2026-10-22 the account (§0) is on the Starter plan with 550 credits, so we don't apply. Apply only once `testsprite usage` shows 0.

**What other entrants are doing** (seen in the forum, for reference): PR
triggers against preview deployments, a required merge-gate check
appearing as **`TestSprite V3`** on the default branch, push triggers
re-running the suites against production, nightly Test Lists and
Schedules, and `testsprite ci run` in Actions with JUnit reports. Expect
the required status check to be named `TestSprite V3`; confirm it on our
first PR.

---

## 4. Judging: what to optimise

Projects are scored out of 100 by human judges.

| Criterion | Points | What it means for us |
|---|---|---|
| **Project quality** | 40 | Craft, polish, completeness, and a live app that works. Never leave the live URL broken. |
| **Tests that run themselves** | 40 | It is wired up, the coverage is broad, the assertions go deep, the scenarios are well designed, the **check fires on every PR**, and it **can hold the merge**. |
| **Innovation** | 20 | Creativity in the project, or in how verification is wired into shipping. Our angle: a full rebuild on a new stack where every layer lands behind a TestSprite check, and the suite describes what users do, not how the legacy app looked. |
| Engagement bonus | open-ended | Discord polls, sharing on X, long write-ups |

Creator Picks (Ömer Göçmen, Uğur Keşkekçi, Astro K Joseph, Poyraz, Jan
Marshal) are separate and don't touch the prize pool.

Prizes: $1,500, $750, $450, $150 and $150. There is also a separate CLI
bonus (§11).

---

## 5. How the TestSprite GitHub App works

From the docs: **TestSprite does not build or deploy the app.** It listens
for a GitHub event from our own CI/CD, resolves a URL, and runs the suite
against it.

**Setup (done once, by the owner in the portal):**
1. Signed in to the owner's TestSprite account (§0): Workspace
   Settings → Connections → Integrations → GitHub → **Connect** → pick
   `jnzlab` → grant access to `lucid-hire` → **Install & Authorize**.
2. Project → **GitHub Action** tab → **Add Trigger** → **Pull Request**.
   Optionally add a **Push to Branch** trigger for `main` too.
3. Paste a sample PR URL → **Detect Events**. TestSprite lists the check
   runs, workflow runs and deploy bot comments it found on that PR.
4. **Pick the event that fires after the deployment is reachable.** Never
   pick one that fires at build start. For us that is the Workers Builds
   check run for `lucidhire-app` completing (§7).
5. Set the **Target URL pattern**. Placeholders: `{pr}`, `{branch}`,
   `{branch-slug}`, `{sha}`, `{short-sha}`. Ours is the fixed live URL
   `https://lucidhire.io` (§7). Verified on PR #1: the portal accepts a
   pattern with no placeholders.
6. **Send Test Event** on a PR → confirm a run queues → **Create Trigger**.
7. Turn on **Block PR until tests pass**. Leave "Include draft PRs" off.

**Results (seen on PR #1):** the `testsprite` bot comments on the PR and
updates the comment in place with the report. The result is a **commit
status** (not a check run) with the context **`TestSprite V3`**, so query
`commits/<sha>/status` to read it.

**Our triggers:**
- **Pull Request:** fires when the `Workers Builds: lucidhire-app` check
  completes. Target `https://lucidhire.io`, merge gate on, drafts off.
- **Push to `main`:** fires on the same Workers Builds check after
  `Deploy main`, and tests the project's default environment
  (`https://lucidhire.io`). It re-runs the suite against production after
  every merge.

**Holding the merge (done 2026-10-22):** the trigger's merge gate makes
`TestSprite V3` fail when a test fails. Branch protection on `main`
requires both `Workers Builds: lucidhire-app` and `TestSprite V3`, each
pinned to the app that posts it. Admins can bypass in an emergency.
Screenshot it for the write-up.

**Project instructions steer gate runs (verified 2026-10-22, PR #3):**
Settings → General → Extra Instructions are read by gate runs, but not by
a single test's "Save & Run". PR #3's first gate blocked the sign-in test
because the instructions still said "don't sign in", while the same test
passed alone. **Update them in every PR that ships a new layer,** with
the owner's approval of the text.

**Re-running a gate:** the dashboard can't re-run a GitHub-triggered run
("Re-run blocked" says "Could not start the run", "Re-Run All" says
"unknown environment 'github-pr-3'"), and "Re-Run Failed" skips blocked
tests. Push a commit to the PR branch instead.

**Retention:** trigger activity is kept for 30 days.

---

## 6. Git and PR workflow (MUST)

- **Never push to `main`.** Every change goes through a PR from a branch.
  Branch names are lowercase kebab-case, for example `feat/d1-schema`.
- **One layer or concern per PR**, in this order unless the owner says
  otherwise:
  1. Scaffold: two Workers, the Workers Builds deploy, the TestSprite trigger wired
     to a placeholder page. **This PR proves the loop and must land first.**
  2. Auth: Clerk on both Workers, plus onboarding
  3. D1 schema and Drizzle, with jobs CRUD
  4. R2 uploads and the public apply portal, with Turnstile
  5. Workflows pipeline: extract → structure → embed → Vectorize → rank
  6. Durable Object live leaderboard
  7. Dashboard, candidates, interview questions, charts
  8. Polar billing and webhooks
  9. Landing page, SEO and polish
- **Every PR must:**
  - pass the TestSprite check before merging. Never merge a red or
    missing check, and never disable the trigger to get a merge through.
  - add or extend TestSprite tests for what it ships. A PR that adds
    behaviour without a test covering it is incomplete.
  - have a description stating: the problem or goal, what changed, **which
    TestSprite tests cover it**, and the run result or dashboard link.
- Run local checks (`pnpm check`: lint, typecheck, unit tests) before
  pushing.
- Open PRs ready for review, not as drafts. Draft PRs don't trigger.

### 6a. Commit rules (MUST, owner, 2026-10-21)

Judges read the commit history as well as the PR and the portal (§3a), so
the history is part of the submission.

**When to commit:**
- **Commit every feature as soon as it is completely implemented. One
  feature per commit.** "Completely implemented" means:
  - it works end to end on the local dev server,
  - `pnpm check` passes,
  - its tests are in the same commit (unit tests, plus the TestSprite test
    or test plan entry that covers it, §6), and
  - there are no stubs, `TODO`s or commented-out code left for it.
- Never commit a half-built feature. No `wip`, `tmp` or "save progress"
  commits, and never bundle two features into one commit.
- Small supporting changes that aren't features (config, docs, CI) get
  their own commit with the matching type below.

**How to write the message:**
- **English only**, for commit messages, PR titles, PR descriptions and
  code comments.
- Use Conventional Commits: `type(scope): summary`. Types are `feat`,
  `fix`, `test`, `refactor`, `perf`, `style`, `docs`, `ci` and `chore`.
  The summary is in the imperative mood, lower case, has no full stop, and
  is 72 characters or fewer. Example:
  `feat(apply): accept PDF uploads to R2 behind Turnstile`.
- The body says **why**, then what changed, then **which TestSprite tests
  cover it**. When the commit fixes a legacy bug, name the item from
  `docs/legacy-audit.md`. When it fixes a TestSprite failure, name the
  failing test, e.g.
  `fix(billing): ignore late subscription.updated after revoke` with
  `Fixes TestSprite "Pro downgrade keeps limits" failure` in the body.
- **Never mention Claude, Claude Code, AI, Anthropic or any generator.**
  No `Co-Authored-By` trailer for them, and no "Generated with" footer.
  Commits are authored only by the configured git user (Jameel Ahmad).
  This matters for the account-match rule too: the owner's own accounts
  do everything.

**Hackathon rules applied to commits:**
- **Build window:** every commit is made for real during the build window
  (Oct 16–22). Never backdate or fake timestamps (no `--date`, no
  `GIT_COMMITTER_DATE`).
- **Original work, shown step by step:** never import the legacy repo's
  history, and never commit the legacy code in one dump. Port it feature by
  feature, so the history shows the work done in this window.
- **Public repo:** run `git diff --cached` before every commit and check
  that no secrets, `.env*`, `.dev.vars`, keys, test-account passwords or
  `.pnpm-store/` are staged (§9). A leaked secret has to be rotated, not
  just deleted from history.
- **Keep the red-then-green story:** when a TestSprite check fails, fix it
  in a **new** commit on the same PR. Never amend, rebase or force-push a
  PR branch after TestSprite has run on it. "A PR that caught a bug first
  and went green after your fix" is the best submission PR (§3a).
- **Merge with a merge commit, never squash**, so the feature commits and
  the fix commits survive on `main`.
- **Pushing spends credits:** each push to an open PR redeploys the live app and
  reruns the suite (§7, §10). Commit locally per feature, and push once the
  PR's layer is ready for a check run, not after every commit.
- **The live URL stays up:** never push a commit that is known to break
  the live app (§3a).
- **After the deadline** (Oct 22, 11:59 PM PT): don't push to the
  submitted PR or to `main` unless the owner says so. Judges read the
  history as it was at the deadline. (This is our policy, not an official
  rule.)

### 6b. Supervisor and worker agents (owner, 2026-10-22)

The work is split between one supervisor and several worker agents.

- **Supervisor (Claude Code):**
  - the architecture and the contracts between parts;
  - one written brief per task;
  - review of every diff, plus running the checks and the browser;
  - **all commits, pushes and PRs**, made as the configured git user;
  - anything that touches secrets, accounts, deploys or TestSprite.
- **Workers:**
  - **DeepSeek V4.1 Flash**, max effort, through `opencode run` and
    `qodercli -p`: the backend (API Worker, D1 and Drizzle, Workflows,
    Queues, Durable Objects, Polar webhooks) and its unit tests.
  - **Gemini 3.8 Flash**, high effort, through `agy -p`: the frontend
    (React components built on `docs/design/design-system.md`, and the
    port of the locked landing prototype), plus the Gemini prompts and
    Zod schemas.

**If you are a worker agent:**
- Work only in the git worktree and on the files your brief names. Read
  this file and `docs/design/design-system.md` first.
- **Never** run `git commit`, `git push`, `gh`, `cf deploy` or any other
  deploy, TestSprite commands, or `wrangler`.
- Never read or create `.env*` or `.dev.vars`, and never write a key,
  token or password into code.
- Don't add a dependency your brief doesn't list. If you need one, say so
  in your report.
- Run the commands your brief lists (`pnpm check`, tests) and fix what
  fails.
- End with a report:
  - which files changed;
  - how you verified them (the commands and their results);
  - anything unfinished or uncertain.

  Never claim that something works unless you ran it.

**Supervisor loop:**
1. The supervisor writes a brief.
2. The worker runs in its own worktree on its own branch.
3. The supervisor checks that the diff stays in scope, runs `pnpm check`,
   and exercises the feature with curl, the browser, or a side-by-side
   comparison with the prototype.
4. The supervisor either accepts the work and commits it per §6a, or
   resumes the worker's session with specific fixes. After two failed
   rounds the supervisor reassigns the task or fixes it directly.

---

## 7. Deployments: one live environment

**Decision (owner, 2026-10-22): no staging.** `lucidhire-app` and
`lucidhire-api` (§0) are the only Workers. Every PR branch deploys to them,
TestSprite tests that deployment, and `main` redeploys them after a merge.

| Worker | Domain | Config |
|---|---|---|
| `lucidhire-app` | `lucidhire.io`, `www.lucidhire.io` (301 to the apex) | `apps/web/cloudflare.config.ts`: static assets in SPA mode, plus a tiny Worker that only does the `www` redirect |
| `lucidhire-api` | `api.lucidhire.io` | `apps/api/cloudflare.config.ts`: Hono, CORS for `https://lucidhire.io` and local dev |

D1: `lucidhire-db` (`c6c2834b-6af0-4a1b-9799-9dd0a58b13d5`), primary in US
East (`enam`, owner, 2026-10-22), bound to the API as `DB`. `scripts/deploy.sh`
applies `apps/api/migrations` before it deploys the API, with the Workers
Builds token (it has D1 Write).

Consequences to respect:
- **A PR deploy changes the live site.** Never push a PR commit that is
  known to break the app (§3a, §6a). If a PR leaves the site broken, fix it
  forward at once, or redeploy `main`.
- **Only one PR can be tested at a time**, and the last deploy wins. Merge
  or close one PR before pushing to the next.
- Resources (D1, R2, Vectorize, Queues, Workflows, the DO namespace) exist
  once. Test data goes through the seed script (§8) and must be clearly
  marked as sample data.
- Don't add per-PR previews: in a preview, service bindings call the bound
  Worker's production deployment, Workflows are shared, queue consumers
  can't target a preview, and Workers with a Durable Object have no
  version URLs.

**Workers Builds (the only deploy path):** GitHub Actions is unavailable on
`jnzlab` (§0), so Cloudflare Workers Builds deploys from
`jnzlab/lucid-hire`. Its GitHub App posts a check run on every commit it
builds. Lessons from the first attempt:
- Connect `jnzlab/lucid-hire` to Workers Builds (the Cloudflare GitHub App
  on `jnzlab`, access to this repo only). The triggers sit on the
  `lucidhire-app` Worker:
  - `Deploy PR branches`: every branch except `main`.
  - `Deploy main`: `main` only.
  Both run `pnpm check`, then `scripts/deploy.sh`. The script deploys the
  API, then the app, then waits for `https://api.lucidhire.io/health` and
  the home page. The Builds container has no `/dev/stderr`.
- Connecting a repo in the dashboard creates a default trigger whose
  `npx wrangler deploy` has no config at the repo root. Replace it.
- **The `lucidhire-app` check run completing is the event the TestSprite PR
  trigger listens for.** It goes green only once the live site answers.
- The build token is managed by Workers Builds (`cf builds tokens list`).
  Inspect runs with `cf builds list --external-script-id <worker tag>` and
  `cf builds logs get <uuid>`. Create triggers with
  `cf builds triggers create --body '<snake_case json>'`; the flags give a
  400. A Worker can have at most 2 triggers.
- Keep **Worker Previews off** (`previews_enabled: false`). Preview builds
  run `npx wrangler preview`, fail without a wrangler config, and report
  under the same check name. Turning previews off deletes the non-production
  triggers, so recreate them afterwards.
- A build started with `cf builds create` deploys but posts no GitHub check
  run. Push a commit to get a fresh check on the PR.
- Secrets live in `cf workers secrets update`. Never in files.

**GitHub Actions:** no workflows. Workers Builds is the only deploy path.

---

## 8. Making the app testable by TestSprite

TestSprite's cloud browser has to get in. Constraints, from the docs:
- **Test account credentials** (username and password) work for standard
  logins. They **cannot** get past a code prompt after the password step,
  and **cannot** drive "Continue with Google".
- **OTP**: TestSprite owns a managed inbox or phone and enters the code
  itself. **It is fixed at project creation and can't be changed later.**
- **SSO**: a human logs in once and the cookies are replayed until the
  session expires.
- Bot protection or CAPTCHA can fail a login. A failed login fails the
  run; it never continues signed out.

**Rules for this repo:**
- **Clerk (owner, 2026-10-22):** the live app uses the **production
  instance**, which is bound to `lucidhire.io`. Its production keys don't
  work on `localhost`, so local development uses the **development
  instance**. The owner approved turning on **email and password sign-in**
  and turning **bot protection off** on the production instance so that
  TestSprite can sign in. Done 2026-10-22 with `clerk config patch`:
  CAPTCHA off, and **device trust off** (it asks for an emailed code on a
  new device, which TestSprite can't enter), also approved by the owner.
- The recruiter test account: the owner creates it on
  https://lucidhire.io/sign-up (we never type passwords) and puts its email
  and password in the `default` environment's Test Account, never in the
  repo. Its company is "Sprite Labs"; the sign-in test names it on its
  first run if the owner stopped at onboarding.
- **Turnstile (open):** Cloudflare's always-pass test keys (site key
  `1x00000000000000000000AA`, secret `1x0000000000000000000000000000000AA`)
  can't be used on the live site. Decide in the apply-portal PR how
  TestSprite gets past Turnstile, and ask the owner.
- A seed script creates one published job with a known slug and a few
  processed candidates, so the leaderboard and candidate pages have data as
  soon as a run starts. Mark it as sample data.
- **Test jobs (owner, 2026-10-22):** tests run as Sprite Labs on the live
  site, so they must not pile up data, and **TestSprite runs a suite's
  tests in parallel**, so no two tests may share a job. Each test owns its
  title and cleans up after itself: "Recruiter posts a job" deletes its
  "Sprite post role" after checking it, and "Recruiter deletes a job"
  creates and deletes its own "Sprite delete role". The close test reuses
  one "Sprite archive role". The AI and validation tests save nothing.
  (PR #4's first gate failed when a post test and a delete test shared
  "Sprite test role".)
- Gemini calls cost real money and add latency. Keep test CVs small. The
  test CVs in `lucid-hire-legacy/test/` can be reused.
- Use stable, accessible selectors and labels (real `<button>`, `<label>`
  and `aria-*`). TestSprite's agent reads the DOM.
- One environment, `default`, holds the recruiter test account. The agent
  signs in only when a step asks it to, so signed-out tests run there too
  (verified 2026-10-22: the signed-out redirect test passed with the
  account set). Revisit for the candidate portal if that changes.

---

## 9. Secrets and security (NEVER)

- **Never commit** `.env*`, `.dev.vars*`, keys, tokens, Clerk secrets,
  Polar secrets, GCP or Cloudflare tokens, or TestSprite API keys.
  `.gitignore` covers `.env*`, `.dev.vars*`, `.wrangler/`, `.cloudflare/`, `.testsprite/`
  (credentials and failure bundles), `node_modules/` and `dist/`.
- Public keys (the Clerk publishable key, the Turnstile site key) may go in
  `cloudflare.config.ts` vars. Secret keys go
  through `cf workers secrets update`.
- Before every commit, check the staged diff for secrets. The repo is
  public and judges read it.
- Never put test account passwords in tests, plan files or the README. They
  belong in the TestSprite environment's Test Account. The settings page
  masks them, but **the run's step log does not** (verified 2026-10-22: the
  password fill step names the password in plain text). So the TestSprite
  project stays private to the owner's workspace, the test account's
  password is used nowhere else, and run reports are never pasted
  anywhere public.

---

## 10. Using the TestSprite CLI (agents)

Installed globally: `@testsprite/testsprite-cli` v0.15.0 (pnpm global).
It needs Node 20.19+, 22.13+ or 24+.

- **Setup is the owner's job.** Agents never configure keys. If
  `testsprite auth status` fails, stop and ask the owner to run
  `testsprite setup` (non-interactive form:
  `TESTSPRITE_API_KEY=… testsprite setup --from-env --yes`).
- Pin the project in `.testsprite/config.json` (`{ "projectId": "proj_…" }`)
  or with `TESTSPRITE_PROJECT_ID`. Never guess a project.
- **Targets must be public `http(s)` URLs.** The CLI rejects `localhost`
  with exit code 5. Test against `https://lucidhire.io` after it deploys.
- **The loop:** deploy → draft the plan and **show it to the
  owner** → `testsprite test create --project <id> --type frontend
  --plan-from <file> --run --wait --output json` → on failure,
  `testsprite test failure get <id>` or `test artifact get <run> --out
  ./.testsprite/failure` → **read the evidence before changing code** →
  fix → redeploy → `testsprite test rerun <test-id> --wait`.
- Verdicts are `passed`, `failed`, `blocked` or `inconclusive`. Report each
  shipped change with its verdict and the dashboard link. If something
  can't be tested, say "shipped but unverified because X". Never imply it
  passed.
- **Credits:** reruns cost the same as fresh runs. **Never run the full
  suite (`test run --all`) without telling the owner the cost first.** The
  `testsprite-onboard` skill smoke-runs only 2–3 tests; keep it that way.
  `testsprite usage` shows the balance. Exit code 12 means out of credits:
  stop and tell the owner.
- Exit codes: 0 means passed. Any other non-zero means failed, blocked,
  cancelled or timed out. 5 means target URL rejected. 11 means rate
  limited (back off). 12 means out of credits (not retriable).
- Rate limit: 60 run triggers per minute per key.
- `--dry-run` shows the command surface with no key and no cost.

**The suite tests behaviour, not the legacy look.** The UI is being
redesigned (§1), so tests that rely on legacy layouts, copy or selectors
would break on every screen. Instead:
- Write plans in **user-intent terms** ("a recruiter creates a job and
  sees it in the list"), never in legacy UI details. The legacy app at
  `https://www.lucidhire.io` is the reference for **which flows exist and
  what they must achieve**, not for how they look.
- Per §3a, the official suite is **generated in the 3.0 portal against
  our live app**, and it grows as each layer ships.
- A legacy bug we fix gets a test that asserts the **correct** behaviour.
  Mention in the PR that the legacy app fails it.
- Never weaken a test to make a PR pass. Fix the code, or, if the redesign
  intentionally changed the behaviour, update the plan and say why in the
  PR.

**What the suite should cover** (the README must list it):
- Public: the landing page renders, the pricing is visible, and the
  sign-in and sign-up pages load.
- Public candidate portal `/jobs/<slug>`: the job renders; applying with
  an email and PDF succeeds and shows "received"; a non-PDF or missing
  email is rejected.
- Recruiter: sign in → dashboard KPIs render → create a job, including the
  AI enhancement of the description → the job appears in the list → the
  public link works.
- Pipeline: after an application, the candidate appears ranked on the
  leaderboard without a refresh, and the candidate detail page shows the
  summary, matched and missing skills, and interview questions.
- Plan limits: going over the Free plan's CV limit shows the upgrade
  prompt (429).
- Settings → Billing renders the current plan.
- API tests (backend type) for `/api/*`: auth is required, Zod rejects
  bad input with 4xx, and the happy paths return the documented shapes.

---

## 11. CLI Improvement Bonus (separate track, optional)

$1,000 pool. At least $50 for each merged PR to
`github.com/TestSprite/testsprite-cli` (Apache 2.0), scaled by substance,
with **up to 3 PRs per person**. Paid in one batch after Oct 29.

**Step by step**, from the Discord announcement the owner pasted on
2026-10-21. Everything happens on GitHub: no forms, and no need to ask in
Discord first.

0. **Set up:** install the CLI and check `testsprite --version`. Read the
   CLI repo's `CONTRIBUTING.md` and `VISION.md` before anything else.
1. **Find a real problem and open an issue.** Search existing issues
   first; if two people file the same thing, **the first to file keeps the
   credit.** Use the **"🏆 Hackathon Improvement"** issue template, and fill
   in the CLI version or commit tested, the Discord username, what's broken,
   and how to reproduce it. PRs titled `docs:` can skip the issue.
2. **Wait for a maintainer to accept it.** A maintainer adds the
   `accepted` label (or `good first issue` / `help wanted`). It can't be
   claimed before then; the bot will say so.
3. **Claim it by commenting `/assign`.** The bot assigns the issue and
   says how many claims you have open.
   - A person can hold **at most 3 open claimed issues**.
   - No linked PR after **48 hours** gets a warning from the bot. After
     **72 hours** the claim is released.
   - Once work starts, **open a draft PR with `Closes #<issue>`** in the
     description. That keeps the claim alive.
   - Comment `/unassign` to give up a claim.
4. **Open a PR that fixes it.** The description must have
   `Closes #<issue>`, the **Season 4 CLI Improvement Bonus box ticked**
   (it's in the PR template), and the **Discord username**.
   - **Lint, typecheck and tests must pass, with coverage of at least 80%.**
   - **Use Conventional Commits** (`fix:`, `feat:`, `docs:`, and so on).
   - A bot confirms the entry in a comment.

The window closes **Oct 29, 11:59 PM PT**, and the PR must be open and out
of draft by then. The draft-PR tip in step 3 only keeps a claim alive.
- A PR must be **merged and judged a genuine improvement**. It is judged
  on impact, problem definition, craft (clean merge, tests, green CI) and
  discipline (problem stated first, one concern per PR, the reporter
  credited). Up to two revision rounds.
- **Doesn't qualify:** no problem statement, typo or formatting-only
  changes, behaviour changes without tests, comment-only changes,
  unexplained dependency bumps, one change split across PRs. **Spam or
  bounty farming ends eligibility for the season.**
- Do this only when the owner asks. Bugs we hit in the CLI while using it
  here are good candidates; note them in `docs/testsprite-cli-issues.md`.

---

## 12. Engagement (bonus points, owner-driven)

- Post progress in the TestSprite Discord and on X (tag @test_sprite).
- A long write-up of the migration with TestSprite as the gate is worth
  doing near the deadline.
- Specific product feedback on the portal, CLI or MCP, posted in Discord,
  may earn extra credits. It isn't guaranteed and isn't scored.

Agents draft these when asked. **They never post them.**

---

## 13. Open questions (owner to resolve)

- [x] DNS: **the `lucidhire.io` zone is on Cloudflare**, in the same account
      the `cf` CLI is logged into, on the Free zone plan. On 2026-10-22 the
      owner deleted the Vercel project and moved the domains to the new
      Workers (§0, §7):
      - `lucidhire.io` and `www` go to `lucidhire-app` (Worker custom
        domains replace the old Vercel `A` and `CNAME` records).
      - `api` goes to `lucidhire-api`.
      - `clerk`, `accounts`, `clkmail` and the `clk*._domainkey` records
        belong to the **production Clerk instance**. Never touch them.
      - The `MX`, SPF, DKIM and DMARC records are for email. Never touch
        them.
- [x] Plan: **Workers Free** (answered 2026-10-21). That makes these
      MUST rules:
      - 10 ms CPU per invocation. Workers and Workflow steps only make
        network calls: Gemini, Workers AI `toMarkdown`, Vectorize, D1, R2.
        No PDF parsing, no heavy JSON transforms, no crypto loops on the
        Worker.
      - Keep each Workflow step small. Check the current Free limits for
        Workflows, Queues, Vectorize, D1 and Durable Objects with
        `cf docs search` before designing around them, and record them
        here.
      - Durable Objects on Free must be SQLite-backed.
- [x] Clerk (2026-10-22): the live app uses the **production instance**,
      local development the **development instance** (§8). Both belong to
      the "Lucid Hire" app in the Clerk account from §0.
- [x] Discord rules: read on 2026-10-21 from
      `#📢hackathon-rules-and-announcements` and the
      `#hackathon-s4-submissions` "Submission Requirements" post. They're
      in §3a and §11. There is no channel called `#hackathon-info`; the
      website's reference means the rules channel.
- [x] Owner eligibility (2026-10-22): follows @Test_Sprite on X, and
      shows the TestSprite **TEST** server tag on Discord (§3a). The
      owner's Discord username is **`jnzlab`**; use it wherever a form or
      template asks for one (§11).
- [x] The TestSprite PR trigger accepts a fixed target URL (§5.5).
- [x] The status check is `TestSprite V3`, a commit status; it is
      required by branch protection on `main` (§5).

---

## Sources

- Hackathon page: https://www.testsprite.com/hackathon-s4
- GitHub App: https://docs.testsprite.com/web-portal/integrations/github-integration
- Environments: https://docs.testsprite.com/web-portal/setup/environments
- UI authentication: https://docs.testsprite.com/web-portal/core/ui/ui-authentication
- CLI overview: https://docs.testsprite.com/cli/getting-started/overview
- CLI for coding agents: https://docs.testsprite.com/cli/getting-started/quickstart-for-agents
- CLI in CI/CD: https://docs.testsprite.com/cli/integrations/ci-cd
- Full TestSprite docs index: https://docs.testsprite.com/llms.txt
- CLI repo: https://github.com/TestSprite/testsprite-cli
- Cloudflare Previews: https://developers.cloudflare.com/workers/previews/
- Cloudflare Version URLs: https://developers.cloudflare.com/workers/configuration/previews/
- Discord: https://discord.com/invite/GXWFjCe4an (rules in `#📢hackathon-rules-and-announcements`; submissions in the `#hackathon-s4-submissions` forum)
