# Legacy audit, re-verified (lucid-hire-legacy @ c8caf3fd)

Verified on 2026-10-21. I checked the code at legacy `HEAD` `c8caf3fd` against `CODEBASE_AUDIT.md` (dated 2026-09-03). The roughly 88 fix commits all landed on 2026-09-03, after the audit was written. Each finding was checked against the current code, not against commit messages.

All paths are relative to `~/Projects/today/lucid-hire-legacy`. `file:line` refers to that commit. Nothing in the legacy repo was modified or run. The only commands run were `tsc --noEmit` and `eslint src scripts`, and both were clean.

## 1. Summary

**Status counts** (audit sections 2-5, 78 items):

| Status | Count |
|---|---|
| FIXED | 64 |
| PARTIALLY FIXED | 13 |
| STILL PRESENT | 0 |
| CAN'T VERIFY | 1 (Low: public JD nested scroller, needs a visual check) |

Sections 6-8 (performance, dead code, hygiene) are mostly fixed. What remains is listed in section 4.

**Where things stand:**
- **Billing.** The five critical Polar bugs from the audit are fixed:
  - snake_case field mapping
  - the `cancelled` spelling
  - `payload.id` used for idempotency
  - debug exfiltration
  - unknown product mapped to `free`

  Two new structural bugs remain, and either can still give the wrong plan:
  - **B1:** `subscription.updated` arriving after `subscription.revoked` grants the paid tier again.
  - **B2:** an upgrade opens a second Polar subscription instead of changing the existing one, and the org row can only track one.
- **Usage.** Quotas now come from an append-only ledger (`org_usage_events`), so deleting rows no longer resets them. Remaining problems:
  - Job-creation metering is best-effort and racy.
  - The AI pipeline, which is the main cost, is never written to `ai_usage`.
  - Several paths spend AI with no metering at all: retry, description edits, and unbounded description length.
  - Every hot-path check re-reads the organization row.
- **Surprise.** `.pnpm-store/` is tracked in git: 16,334 files, about 266 MB, since `7e1793eb`, and it is not in `.gitignore` (`git ls-files .pnpm-store | wc -l`). Do not copy it into the rebuild.

---

## 2. Billing / subscriptions (Polar)

### 2.1 Audit findings

| ID | Status | Commit | Evidence |
|---|---|---|---|
| C1 snake_case fields → every org mapped to `free` | FIXED | 3cbe2a9e, 3f56c9ff | Typed fields used: `src/app/api/webhooks/polar/route.ts:85-88,111-121`. An unmapped product returns 500 (`:210-220`). `planTierForPolarProduct` returns null and never guesses (`src/lib/server/polar-products.ts:45-57`). |
| C2 cancel/revoke never handled | FIXED (see B1) | 3cbe2a9e | Handled events at `src/db/enums.ts:38-46`. Revoked: `route.ts:91-99`. Canceled: `:100-106`. Past due: `:107-109`. Migration `src/db/migrations/0008_polar_event_types.sql` rebuilds the enum. |
| C3 idempotency no-op | FIXED | 3cbe2a9e | Reads `webhook-id`, falling back to `svix-id` (`route.ts:162-165`). The row is inserted before the org is changed (`:178-196`). A unique violation is treated as a duplicate (`:189-191`). Unique index at `src/db/schema.ts:304`. |
| C4 debug exfiltration to 127.0.0.1:7260 | FIXED | e223e51d | `grep -rn "127.0.0.1\|7260" src` finds nothing. The `.cursor` debug log is untracked but still in history (see M35). |
| H10 billing UI: no post-checkout, portal, status or role gating | PARTIALLY FIXED | 9d2f123b, 8d740225 | See the next table. |
| M4 env mismatch silently maps to `free` | FIXED | 3f56c9ff | `polar-products.ts:15-37` reports missing or duplicate ids. Checkout refuses to start while ids are misconfigured (`src/app/api/billing/checkout/route.ts:61-65`). |
| Low: unset `POLAR_WEBHOOK_SECRET` gives 500 on every webhook | FIXED | e0691a02 | Returns 503 with a clear log (`route.ts:126-136`). Boot check at `src/lib/server/env.ts:113-124` and `src/instrumentation.ts`. |
| Low: raw Polar error shown to the browser | FIXED | 2eb69b4e | The error is only logged. The user is redirected with a generic message (`checkout/route.ts:94-97`). |
| Low: billing UI duplicates `PLAN_CONFIG` | FIXED in billing; STILL PRESENT on landing | e5b78e2d | The billing page reads `PLAN_CONFIG` (`settings/billing/_components/billing-panel.tsx:52-61`). The landing pricing is hand-copied (`src/components/landing/pricing-section.tsx:26-69`). |
| Low: webhook debug table shown to users | FIXED | e5b78e2d | Removed. Stale copy remains: "optional billing debug tools" (`src/app/(dashboard)/dashboard/settings/page.tsx:131`). |

**What is fixed and what remains in H10:**
- Fixed:
  - `?checkoutId` triggers polling (`billing/page.tsx:27-30`, `billing-panel.tsx:95-104`).
  - Portal route (`src/app/api/billing/portal/route.ts`).
  - Status column `subscriptionStatus` (`schema.ts:73`, migration 0010).
  - Admin-only checkout and portal (`checkout/route.ts:43-45`, `portal/route.ts:13-15`).
  - Duplicate same-tier purchase blocked (`checkout/route.ts:52-57`).
  - Errors redirect back to the billing page (`src/lib/server/billing.ts:18-26`).
- Remaining:
  - Upgrades still open a second subscription (B2).
  - The activation banner is wrong in several states (B7).
  - Job and candidate deletes are not admin-gated (B10).

### 2.2 New billing findings (not in the audit)

| # | Sev | Finding | Evidence |
|---|---|---|---|
| B1 | **High** | **A revoke can be undone.** Polar fires `subscription.updated` for every change, including revoke. Two problems in the handler: (1) `updated` goes to the default branch, which maps `productId` to the paid tier and writes `planTier: pro/max` with status `canceled`; (2) nothing compares event order (`modifiedAt` or the payload `timestamp`). If `updated` is processed after `revoked`, the org keeps the paid tier forever, because no later event arrives to correct it. | Default branch: `route.ts:110-121`. Revoke branch: `:91-99`. Polar SDK doc: `node_modules/@polar-sh/sdk/dist/esm/models/components/webhooksubscriptionupdatedpayload.d.ts:6` ("fires for all changes … including renewals"). `Subscription.modifiedAt` exists but is unused (`subscription.d.ts:29`). |
| B2 | **High** | **Upgrading creates a second subscription.** The checkout guard only blocks the same or a lower tier, so Pro→Max (and canceled Pro→Max) opens a new Polar subscription while the old one keeps billing. The org row stores a single `polarSubscriptionId`, and events from either subscription overwrite it. When the old Pro is later revoked, the org is set to `free` even though Max is active. | `checkout/route.ts:50-57` (the guard), `:85-92` (always `checkouts.create`). Upgrade button: `billing-panel.tsx:256-260`. Revoke branch: `route.ts:91-99`. |
| B3 | Medium | No branch checks that the event's subscription id equals `organization.polarSubscriptionId`. Any subscription that maps to the org can rewrite its tier. | `route.ts:81-124`, with `resolveOrganization` at `:36-54` matching on metadata, external id or customer id. |
| B4 | Medium | Status mapping is wrong for some states. `incomplete` and `incomplete_expired` fall through to `"active"` and grant the tier. `unpaid` maps to `past_due` and keeps the tier with no end date. | `route.ts:61-73`. Statuses in the SDK: `subscriptionstatus.d.ts` (incomplete, incomplete_expired, trialing, active, past_due, canceled, unpaid). |
| B5 | Medium | `planExpiresAt` is display-only. Access ends only when a `revoked` event arrives. If that webhook is lost, a canceled org keeps the paid tier indefinitely, because the effective tier never checks `planExpiresAt`. | Limits read `planTier` only (`src/lib/server/plan-limits.ts:7-13`). The expiry is shown at `billing-panel.tsx:142-144`. |
| B6 | Medium | An event whose org cannot be resolved returns 200 and the row stays `processed=false`. Polar does not retry it and nothing replays it. | `route.ts:198-208`. |
| B7 | Medium | The activation banner and polling are keyed on `returnedFromCheckout && subscriptionStatus !== "active"`. As a result: (a) an already-active org that upgrades never polls and sees the old tier; (b) `trialing` or `canceled` orgs with `?checkoutId` in the URL show "Payment received. Activating…" forever; (c) polling stops after 30 s but the banner stays. | `billing-panel.tsx:95-104,163-174`. |
| B8 | Low | Refunds and orders are ignored: `order.refunded`, `order.paid`, `customer.state_changed` and `benefit_grant.*` are not handled. A refund removes access only if Polar also revokes the subscription. | `enums.ts:38-46`. The SDK emits all of these events. |
| B9 | Low | `polarCustomerId` is set only by the webhook, so the portal is unusable until the first event has been processed. Checkout already sets `externalCustomerId = org.id`, which could be used instead. | `portal/route.ts:21-26`, `checkout/route.ts:88`. |
| B10 | Low | Role checks exist only for checkout, portal and member-role changes. Deleting a job or candidate needs only membership. There are also no invites, so in practice every org has a single admin. The last-admin check is check-then-act. | `src/app/api/dashboard/jobs/[id]/delete/route.ts:10`, `src/app/api/dashboard/candidates/[id]/delete/route.ts:13`, `src/components/dashboard/team-members-card.tsx:46-49`, `src/app/api/dashboard/org/members/[memberId]/route.ts:42-46`. |
| B11 | Low | Historic data: before 3cbe2a9e, every paid org was written as `free`. Migration 0010 backfills `subscriptionStatus` only for orgs that are not `free`, so mis-downgraded paying orgs were not repaired. CAN'T VERIFY the database contents. | `src/db/migrations/0010_org_subscription_status.sql`. |
| B12 | Low | Unused dependency `@polar-sh/nextjs`. There are no tests for the webhook, checkout or portal routes; the only test is `polar-products.test.ts`. | `package.json:15`, `src/lib/server/polar-products.test.ts`. |

### 2.3 Billing: rebuild requirements

1. Verify signatures with the Standard Webhooks scheme (`webhook-id`, `webhook-timestamp`, `webhook-signature`) over the raw body, and reject stale timestamps. Return 503, not 500, when the secret is missing.
2. Idempotency: insert `(webhook-id)` into a unique-keyed table **before** any side effect, in the same transaction as the org update where possible.
3. Do not derive the tier from a single event. Treat each webhook as "something changed": either fetch the subscription or customer state from Polar (`customer.state_changed`, or `subscriptions.get`), or store each subscription's latest state keyed by subscription id and ignore events whose `modifiedAt` is older than the stored value. This fixes B1 and B3.
4. Model subscriptions as their own table (`subscription_id, org_id, product_id, status, current_period_end, cancel_at_period_end, ended_at, modified_at`). Compute the org's effective tier as the highest tier among subscriptions that are `active`, `trialing` or `past_due` (within grace) and not ended. Never store the tier as an independent field that events overwrite.
5. Upgrades and downgrades must **change the existing subscription** (Polar subscription update, or the customer portal), not open a new checkout. Allow a new checkout only when the org has no live subscription. This fixes B2.
6. Map statuses explicitly: `incomplete` and `incomplete_expired` grant nothing; `unpaid` ends access after a set grace period; `canceled` with `cancelAtPeriodEnd` keeps access until `currentPeriodEnd`.
7. Enforce expiry server-side: if `ended_at` or `current_period_end` (plus grace) is in the past, the tier is `free`, whatever webhook did or did not arrive. This fixes B5.
8. Handle `order.refunded` (at least log and flag it; revoke if the refund policy says so) and `subscription.revoked`.
9. Unresolvable org: return non-2xx so Polar retries, or keep a dead-letter list that an admin can replay.
10. Unknown product id: return 500 and never downgrade (keep the legacy behaviour from `route.ts:210-220`).
11. Checkout: admin-only; `externalCustomerId = org.id`; `metadata.orgId`; success URL with `{CHECKOUT_ID}`; redirect back to billing with a message on error. Refuse to start when product ids are misconfigured (`checkout/route.ts:61-65`).
12. Portal: create the customer session by `externalCustomerId`, so it works before the first webhook.
13. Billing UI: a "pending" state for after checkout, driven by whether the effective tier changed, with a timeout message. Show these statuses: trial, past due (with a portal call-to-action), cancels on {date}, ended. Read all plan copy from the single plan config, including the landing page.
14. Gate destructive actions (delete job or candidate) and billing on the admin role. Do the last-admin check atomically.
15. Tests: a signature failure, a duplicate delivery, `revoked` followed by `updated` in both orders, an upgrade, cancel-then-uncancel, and an unknown product.

---

## 3. Usage tracking and plan enforcement

### 3.1 How it works now

- **Ledger.** `org_usage_events(orgId, kind ∈ {job_created, cv_ingested}, jobId, createdAt)`. It is append-only, `jobId` is deliberately not a foreign key, and it is indexed `(orgId, kind, createdAt)` and `(jobId, kind)` (`schema.ts:312-333`, `src/db/queries/org-usage-events.ts`). Migration 0009 backfilled it from live rows, so CVs and jobs deleted before the migration are not counted.
- **Jobs per month.** The ledger is counted per UTC calendar month (`plan-limits.ts:28-38`, `src/lib/dates.ts:58-60`). The check runs in `requireJobCreationSlot` (`src/lib/api/job-limit.ts:9-18`), called from `POST /api/jobs` (`src/app/api/jobs/route.ts:46`) and from duplicate (`src/app/api/dashboard/jobs/[id]/duplicate/route.ts:37`). The usage row is written after the job is created (`src/lib/server/pipeline.ts:66-71`).
- **CVs per job.** Lifetime count per job, never reset. `reserveCvSlot` inserts a row, counts its position, and releases the row if it is over the limit (`src/lib/api/cv-limit.ts:45-62`, `org-usage-events.ts:59-95`). It is used by public apply (`src/app/api/jobs/by-slug/[slug]/apply/route.ts:104`) and bulk finalize (`bulk-upload/finalize/route.ts:50`). The signed-URL route only runs an advisory pre-check (`bulk-upload/urls/route.ts:24`).
- **AI requests.** Rolling 60-minute count over `ai_usage` per org (`src/lib/api/ai-quota.ts:33-45`). It applies only to `POST /api/jobs/enhance` (`enhance/route.ts:56`) and interview questions (`src/app/api/candidates/[id]/interview-questions/route.ts:50`). `ai_usage` **is now written**, with tokens and model, but only by those two routes (`enhance/route.ts:62-68`, `interview-questions/route.ts:58-64`, `src/db/queries/ai-usage.ts:24-40`).
- **Queue priority.** By plan (`src/lib/server/queue-priority.ts`, `pipeline.ts:39-48`).

### 3.2 Audit findings

| ID | Status | Commit | Evidence |
|---|---|---|---|
| H4 quotas reset by hard delete | PARTIALLY FIXED | 87d9f53e | The ledger survives deletes (`schema.ts:312-333`) and limits count it (`plan-limits.ts:36,57`). Remaining issues: U1, U3, U5. |
| M2 no AI rate limit; `aiUsage` has no writers | PARTIALLY FIXED | d5c6d198 | The quota and the writes exist for enhance and interview questions. The pipeline is not metered (U2). |
| M3 CV limit check-then-act | FIXED (small residual race, U4) | 8724fb23 | `org-usage-events.ts:59-90`. |
| C8 / H3 quota-related leftovers | see section 4 | | |

### 3.3 New usage findings

| # | Sev | Finding | Evidence |
|---|---|---|---|
| U1 | Medium | Two gaps in job metering: (1) it is check-then-act, so concurrent `POST /api/jobs` calls all pass the count and exceed the monthly limit; (2) the `job_created` row is written after the job is inserted, and failures are swallowed, so a ledger error gives away a free job. | `plan-limits.ts:28-38`, `jobs/route.ts:46-55`, `pipeline.ts:66-71`. |
| U2 | Medium | The pipeline's AI calls are never written to `ai_usage`: CV extraction, CV embedding, per-candidate scoring, and job extraction plus embedding. These are most of the token spend, so cost per org is invisible, and the hourly AI limit does not cover them. | No `recordAiUsage` call in `src/trigger/*.ts` (grep). The calls are in `src/lib/server/ai.ts:248-296,319-391`. |
| U3 | Medium | Several paths spend AI with no limit: (1) retrying a failed CV re-runs the whole pipeline with no quota and no retry cap; (2) each description edit re-runs `process-job`; (3) `descriptionRaw` has no maximum length on create or PATCH, while enhance caps it at 20,000 characters. A job can also be repurposed by editing it, without spending a job slot. | `src/app/api/dashboard/candidates/[id]/retry/route.ts:13-41`, `src/app/api/dashboard/jobs/[id]/route.ts:26,105-111`, `jobs/route.ts:19`, `src/lib/constants.ts:13`. |
| U4 | Low | CV reservation is two autocommit statements with no transaction. Ordering by `(createdAt, id)` with `createdAt = now()` can let two writers both land at or under the limit when commit order differs from timestamp order (off by one at most). `release` deletes ledger rows, which contradicts the "never delete" note. | `org-usage-events.ts:59-95`. |
| U5 | Low | Failed CVs still consume a slot, which is reasonable, but the copy says "non-failed uploads". | `src/lib/plans.ts:10`, `billing-panel.tsx:308`. |
| U6 | Medium | A slot can be spent on a CV that never becomes a candidate. If the enqueue fails after `createCandidate`, the row stays `pending` forever with its slot spent. Retry only accepts `failed`, and a resubmitting applicant gets 409. | `apply/route.ts:126`, `finalize/route.ts:71`, `retry/route.ts:20-22`. |
| U7 | Low | The AI quota is check-then-act (bursts overshoot). Only successful calls are recorded, although the comment says every attempt is. | `ai-quota.ts:33-45`, `enhance/route.ts:56-70`, `ai-usage.ts:16-23` (comment). |
| U8 | Low | Hot-path cost: `getOrganizationById` is re-read even though the auth context already has the org. This happens in `requireAiQuota` (`ai-quota.ts:34`), in `getCvLimitForOrg` and `checkJobCreationLimit` (`plan-limits.ts:7-13`), and in `getQueuePriorityForOrg` on every enqueue (`queue-priority.ts:20-22`). Public apply therefore makes about 2 org reads, plus an insert, a count and possibly a delete, before its upload. The billing and settings pages each run a GROUP BY across every job joined to the ledger (`src/db/queries/jobs.ts:75-98`). The SSE route reads every candidate row of a job every 2 s per open tab, even when idle (`src/app/api/jobs/[id]/events/route.ts:15,76-80`). |
| U9 | Info | Periods: jobs reset on the UTC calendar month, not the billing cycle. CVs per job never reset. AI uses a rolling hour. There is no org-wide monthly CV cap, so the effective Free limit is 10 jobs × 10 CVs = 100 CVs per month. A new Clerk account gets a new Free org. The CSV export is not gated by plan. | `plans.ts:31-56`, `dates.ts:58`. |
| U10 | Info | On a downgrade, existing data that is over the new limit is left as is. Uploads to that job are blocked, and billing and settings show "over limit". | `billing-panel.tsx:117,352-357`, `settings/page.tsx:113-122`. |

### 3.4 Usage: rebuild requirements

1. Keep one append-only usage ledger: `(org_id, kind, job_id?, units, period_key, created_at, idempotency_key)`. Never decrement it by deleting rows; a refund is a negative row with a reason.
2. Make "check and consume" one atomic step: a conditional insert, a per-org counter row updated with `UPDATE … SET used = used + 1 WHERE used < limit RETURNING`, or a Durable Object per org. Use it for job creation, CV ingest, and AI calls.
3. Write the job-creation usage row **in the same transaction** as the job insert, never best-effort.
4. Meter **every** AI call, pipeline included: `ai_usage(org_id, user_id?, operation, model, prompt_tokens, completion_tokens, total_tokens, candidate_id?, job_id?, attempt, ok)`. Record failed attempts too. Declare the model in one constant.
5. Put limits on cost paths: retries (count or cap per CV), job re-indexing on edit (debounce, and count it), and a maximum length on job descriptions and on extracted CV text sent to the model.
6. Define the periods explicitly. Jobs per month: decide between the UTC calendar month and the billing period, then document it. CVs per job: lifetime. AI: rolling window. If billing-period resets are wanted, base `period_key` on the subscription's `current_period_start`.
7. Read the plan or tier once per request from the auth context and pass it down. Do not re-read the org row for quota, priority and limits separately.
8. Never strand a slot: enqueue in the same unit of work as the candidate insert (an outbox, or a queue send with a compensating `failed` status), so a lost enqueue becomes a retryable `failed` row.
9. Usage UI: show jobs this period against the limit, the CV count per job (and the busiest job), and AI requests in the window, all from the same ledger the limits use.
10. Live updates should not poll the database while the job is idle. Push events from the pipeline instead (a Durable Object per job, or Realtime).

---

## 4. Other findings still present (non-billing, non-usage), by severity

### High
None.

### Medium
- **C6 leftover.** `rank-candidates` has no `onFailure`. If the job embedding never arrives, every waiting candidate stays in `ranking` forever. `process-job` has no failure status either. (`src/trigger/rank-candidates.ts:251,297-314`, `src/trigger/process-job.ts`)
- **New: description edits leave stale scores.** Old candidates keep scores computed against the old description, because only rows with `matchScore IS NULL` are re-scored. (`src/app/api/dashboard/jobs/[id]/route.ts:105-111`, `src/db/queries/candidates.ts:292`)
- **H7 leftover.** The AI SDK `maxRetries` is never set (default 2). Worst case is 3 × 5 = 15 provider calls for extraction or embedding, and 3 × 3 = 9 for scoring. (`src/lib/server/ai.ts:367`, `rank-candidates.ts:143`, `trigger.config.ts:19-28`)
- **C8 leftover.** A bulk CV uploaded without an email takes the LLM-extracted email. A duplicate on the same job then hits the unique index, which sits outside the abort `try`, so the task retries 5 times and fails with a raw DB error. (`src/trigger/process-cv.ts:79-86`, `schema.ts:227`)
- **Repo hygiene.** `.pnpm-store/` is tracked (16,334 files) and not ignored. CV PDFs and the `.cursor` debug log are still in git history (commits b4436881, b75b3a03, 7e1793eb). (M35)

### Low
- **The edit form overwrites the raw description.** It always sends `descriptionRaw: description`, so on an enhanced job a title-only edit replaces the raw text and triggers a paid `process-job`. (`edit-job-form.tsx:76-77`)
- **Finalize can be replayed.** There is no unique index on `gcpFilePath`, so the same path can create 2 candidates and spend 2 slots. If the second fails, it deletes the object the first one uses. Email is not validated. (`schema.ts:175`, `finalize/route.ts:15,65`)
- **M1 leftover.** Abandoned signed uploads (CVs, covers) stay in the bucket until the job is deleted; there is no lifecycle rule. (`finalize/route.ts:32-45`)
- **H3 leftover.** Concurrent onboarding submits can create two orgs (no transaction). A stale `users` row with the same email blocks onboarding with "Contact support", because the takeover branch is unreachable. (`src/app/onboarding/actions.ts:97-107,124-127`)
- **H8 minor.** Every attempt sets status `processing`, so a row briefly flips back from `ranking`. (`process-cv.ts:153`)
- **H11 residue.** The billing panel, a client component, calls `toLocaleString()` without a locale, a hydration risk. (`billing-panel.tsx:55`)
- **H12 minor.** The 50-file cap counts files that already succeeded. (`use-bulk-upload.ts:122`)
- **Ranks are not renumbered after a candidate is deleted.** (`src/app/api/dashboard/candidates/[id]/delete/route.ts`)
- **The client sort differs from the stored rank.** It skips the `vectorScore` tie-break. (`src/lib/candidates.ts:56-63` vs `candidates.ts:231`)
- **The SSE baseline is seeded at connect time**, so changes between page render and connect are missed. There is no `maxDuration` export. (`events/route.ts:66-73`)
- **M7 leftover.** The journal skips idx 4. `0013` uses `DROP INDEX` without `IF EXISTS`. (`src/db/migrations/0013_drop_unused_embeddings_and_indexes.sql:1-8`)
- **M33 leftover.** Navigation still waits for a 0.55 s cover animation. (`src/components/navigation/morph-link.tsx:66`)
- **`x-forwarded-for` fallback for the Turnstile `remoteip`.** (`src/lib/api/request.ts:45-53`)
- **Naming drift has come back** ("applicants" vs "Candidates"). (`leaderboard-toolbar.tsx:35,56`, `bulk-cv-upload.tsx:77`)
- **Performance leftovers:**
  - The leaderboard returns every row; paging is client-side only (`candidates-leaderboard.tsx:34,157`).
  - `getCandidateById` selects the full row, including CV text and the embedding (`candidates.ts:10-11`).
  - Ranking does one UPDATE per candidate with no transaction (`candidates.ts:223-241`).
  - Public apply still buffers the body in the request; a chunked body skips the length precheck (`apply/route.ts:44-47`).
  - The root `ClerkProvider` wraps every page (`src/app/layout.tsx:53`).
  - The dashboard layout runs a serial `getUploadTargetJobId` on every navigation (`(dashboard)/layout.tsx:13`).
- **`void recordOrgActivityEvent(...)` runs without `after()`**, so it can be cut off on serverless. (`jobs/route.ts:57`)
- **No CI.** Tests cover only pure helpers. (`vitest.config.mts`; no `.github/`)
- **Stale docs.** The README still says to create both `.env` and `.env.local`. (`README.md:176`)
- **Pricing duplication.** The landing pricing is a hand copy of `PLAN_CONFIG`. (`pricing-section.tsx:26-69`)

---

## 5. Fixed since the audit

| Item | Commit |
|---|---|
| C1 field mapping, C2 event types, C3 idempotency | 3cbe2a9e |
| C4 debug exfiltration | e223e51d |
| C5 SSE: DB-polled stream with heartbeat, `onerror` no longer closes it, `sse.ts` and `sse-emit` deleted (`src/app/api/jobs/[id]/events/route.ts`) | 9215b79e |
| C7 drafts hidden, closed jobs return 410 (`src/db/queries/jobs.ts:61-68`, `apply/route.ts:85-87`) | accb9cc6 |
| H1 `/api/public` is public; H2 onboarding redirect exempts public routes (`src/proxy.ts:16,42`) | 417eb886 |
| H3 idempotent onboarding (with leftovers) | 417eb886 |
| H5 finalize bound to path, size and type; content-length-range on signed PUTs (`src/lib/server/storage.ts:79,94`) | 48f75a6f |
| H6 `sse-emit` removed | 9215b79e |
| H8 `AbortTaskRunError`, resumable steps, `onFailure` (`process-cv.ts:44-167`) | 4974f8e7 |
| H9 job edit, status PATCH, stale AI text cleared | 0b4ffff3, 0bd63599 |
| H11 hydration in the jobs table | 34e51bbc |
| H12 bulk-upload tally and 50-file cap | 6c622d44 |
| H13 hero visible without JS | eeab11e1 |
| M3 atomic CV slot | 8724fb23 |
| M4 unknown product never maps to free | 3f56c9ff |
| M5 membership-verified org context, JSON 401/403 in APIs (`src/lib/server/auth-org.ts:95-167`) | 0219ae65 |
| M6 unscoped signed-URL endpoint removed | 2733a5d0 |
| M8 test bypass requires membership | e5d08d22 |
| M9 interview questions require `processed` | 78b32d9b |
| M10 CV text fenced as untrusted (`ai.ts:141-155`) | 0ea32f1b |
| M11 per-candidate scoring at temperature 0, clamped score | 9cc45afe, 7ac50e84 |
| M12 process-job re-enqueue dedupe, `wait.for` | b7ffc85f |
| M13 PDF line rebuild | 14bf1c7d |
| M14 v4 SDK, `schemaTask`, per-task `maxDuration`, `small-1x` | e3032898 |
| M15-M28 dashboard UX: ranks, failure state and retry, profile display, quota pre-check, single score format, status badges, counts, boundaries, a11y, on-click CV signing, share links, `processedAt`, shell fixes, live upsert | 7ac50e84, 9fa1b442, 0de0ba90, 9b6233fe, e8311e4f, 3b5bf914, 2b06c778, fbdb7955, e0523590, 89fdcfc2, 89f2a08c, 25d70ed9, efe1db62, 9a04f68d |
| M29 honest pricing; M30 privacy and terms | 4c7f55e4, 74c88c14 |
| M31 apply-form a11y and Turnstile timeout; M32 field validation before CAPTCHA, PDF magic-byte check | 9122d0b6, f42eb1f1 |
| M34 onboarding name bounds | 2d286230 |
| Env module plus boot check | e0691a02 |
| Unused deps removed except `@polar-sh/nextjs` | d22eeee6 |
| Dead code: relations, `PLAN_CV_LIMITS`, unused query exports, `/api/trigger` | 05387817, cb46bc95, fc7b044b |
| Performance: embeddings dropped (one composite per CV and job), narrowed columns, `cache()` auth, `Promise.all`, single-scan aggregates, lazy recharts, server-rendered markdown, gsap trimmed, fonts, images | 30732b70, bc953342, 0a5e8497, dc2a229a, 6957ea11, 2dd83777, 409d7753, 451e48f8, b0ce0a42, b23e87c5, cc50b430 |
| Lint and typecheck clean; `.trigger` ignored; Vitest added | 0860b517, d51d7e45, 2627bf33 |
| New features: duplicate job, shortlist/reject/notes, CSV export, search/filter/sort, team roster and roles, queue priority by plan, bulk-upload name and email, regenerate questions, demo video and support link | 89b2a8e2, 3b26b9b5, 7d2d5e21, 64cf716d, d8b958b1, 8d740225, b6f61184, 87110dba, 08b9abbf |

---

## 6. Features and plan limits to preserve

### 6.1 Plans (exact values from `src/lib/plans.ts:31-56`)

| | Free | Pro | Max |
|---|---|---|---|
| Price (USD/month) | 0 | 10 | 30 |
| CVs per job (lifetime, failed CVs count) | 10 | 100 | 1000 |
| New jobs per UTC calendar month | 10 | 20 | unlimited (`null`) |
| AI requests per rolling hour (JD enhance + interview questions) | 30 | 150 | 600 |
| Queue priority (Trigger.dev head start, seconds) | 0 | 300 | 1800 |

- Tier order is `free < pro < max` (`plans.ts:62`). Paid tiers are `pro` and `max` (`plans.ts:65`).
- Polar products come from the env keys `POLAR_PRODUCT_PRO_ID` and `POLAR_PRODUCT_MAX_ID` (`polar-products.ts:6-8`).
- Other billing env keys: `POLAR_ACCESS_TOKEN`, `POLAR_WEBHOOK_SECRET`, `POLAR_SUCCESS_URL` (optional), and `POLAR_SANDBOX` / `POLAR_SERVER` (`env.ts:39-70`).
- All other features are on every tier (`pricing-section.tsx:20-24`): AI ranking, vector plus LLM scoring, live pipeline updates, JD enhance, interview questions, CSV export.
- Roles are `admin` and `member` (`enums.ts:10`). Only admins can check out, open the portal, or change roles. The onboarding user becomes admin (`onboarding/actions.ts:157`).
- Subscription statuses shown in the UI: trialing, active, past_due, canceled ("cancels at period end"), revoked ("ended") (`enums.ts:50-56`, `billing-panel.tsx:40-46`).

### 6.2 Routes and flows (`src/lib/routes.ts:9-60`)

**Public pages**
- `/` landing with pricing and demo video
- `/sign-in`, `/sign-up`, `/sign-out` (Clerk)
- `/privacy`, `/terms`
- `/jobs/[slug]` public job page: drafts hidden, closed jobs show "Applications closed", OG image from the cover
- `/onboarding`: creates an org from a name; idempotent; completed users are sent to the dashboard
- `robots.ts`, `sitemap.ts` (active jobs only)

**Dashboard pages**
- `/dashboard`: overview KPIs, pipeline funnel, uploads chart, activity mix
- `/dashboard/jobs`: search, filter, sort, paginate, share toolbar
- `/dashboard/jobs/new`: create with AI enhance, cover image picker, status picker, monthly allowance shown up front
- `/dashboard/jobs/[id]`: job detail, share buttons, duplicate, delete
- `/dashboard/jobs/[id]/edit`: title, description, status, cover
- `/dashboard/jobs/[id]/candidates`: leaderboard with live updates, search, filter, sort, decision filter, CSV export (all or shortlist)
- `/dashboard/jobs/[id]/candidates/upload`: bulk PDF upload, at most 50 files per batch, per-file name and email, 5 MB each, per-file progress and retry
- `/dashboard/jobs/[id]/candidates/[candidateId]`: extracted profile, score out of 10 and ranking summary, decision (shortlist, reject, note), interview questions (generate or regenerate, copy), CV link signed on click, retry for failed CVs, "Onboard" (Gmail compose that also marks shortlisted)
- `/dashboard/settings`: account security, team roster with admin role changes, plan and usage meters
- `/dashboard/settings/billing`: plan cards, upgrade, portal, status badges, post-checkout activation, CV usage on the busiest job

**API routes**
- `POST /api/jobs`
- `POST /api/jobs/enhance`
- `GET /api/jobs/[id]/events` (SSE)
- `POST /api/jobs/by-slug/[slug]/apply`: Turnstile, email dedupe per job, PDF magic-byte check, 5 MB
- `GET /api/public/jobs/[slug]/cover`: redirects to a signed URL
- `PATCH /api/dashboard/jobs/[id]`
- `/api/dashboard/jobs/[id]/{delete,duplicate,cover-image/signed-url,candidates,candidates/bulk-upload/urls,candidates/bulk-upload/finalize,candidates/export}`
- `/api/dashboard/candidates/[id]/{cv,decision,delete,retry}`
- `/api/candidates/[id]/interview-questions`
- `PATCH /api/dashboard/org/members/[memberId]`
- `GET /api/billing/checkout?plan=pro|max`
- `GET /api/billing/portal`
- `POST /api/webhooks/polar`

**Pipeline (Trigger.dev)**
- `process-job`: structured extraction plus one composite embedding.
- `process-cv`: download, PDF text, structured extraction, one composite embedding. Applicant email is preserved. Concurrency is 5 per org.
- `rank-candidates`: per-candidate LLM score from 1 to 10 at temperature 0, against the job embedding plus the job description. Concurrency is 1 per job. One `ROW_NUMBER` renumber afterwards.
- Candidate statuses: `pending → processing → ranking → processed | failed`. Decisions (`undecided | shortlisted | rejected`) are separate (`enums.ts:16-31`).

**Data to carry over**
- `processedAt`, used for "time to shortlist"
- `org_activity_events`: types `ranking_complete` and `jd_enhanced`
- `interview_questions`: unique per candidate and job
- The "AI enhanced" flag is verified by a server-signed token (`src/lib/server/signed-content.ts`)
