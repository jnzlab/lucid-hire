# LucidHire

AI candidate screening: post a job, collect CVs, and get a ranked shortlist
with the evidence behind every score.

This repo is the rebuild of LucidHire on Cloudflare for TestSprite Hackathon
Season 4. Every layer lands through a pull request that is gated by a
TestSprite check against a live deployment.

- **Status:** the landing page, sign-in and sign-out, onboarding, a dashboard
  with a sidebar and a company overview, jobs (search, filters, duplicate and
  the AI description rewrite), CV scoring with a profile read from each CV,
  candidate search, filters and CSV export, shortlisting, interview
  questions, public job pages where candidates apply with their CV, the
  Free, Pro and Max plans with their limits and Polar billing (sandbox),
  team roles and invite links, and the privacy and terms pages are live.
- **Live URL:** https://lucidhire.io (API: https://api.lucidhire.io)

## How scoring works

A recruiter uploads PDFs on an open job, three at a time: up to 10 per job on
Free, 100 on Pro and 1,000 on Max, 5 MB each. Each CV can carry a name and an
email the recruiter types, which win over what is read from the CV. The API
streams each file into the private R2 bucket `lucidhire-cvs`.

Every job has one fixed list of requirements, and every CV is checked against
that same list. When a job opens, a second Workflow (`lucidhire-draft-rubric`)
asks gemini-3.5-flash-lite to turn the description into 4 to 15 atomic checks,
splitting compound ones ("VoiceOver and Dynamic Type" becomes two). Recruiters
can then mark each one Must, Nice or Off, rename or remove it, add their own,
or redraft the list from the description.

Each CV starts its own Workflow (`lucidhire-score-cv`). It waits for the job's
list if it is still being drafted, then for a reading slot: at most 5 CVs per
company and 10 in all read at once, and Pro and Max CVs count as queued 5 and
30 minutes earlier, so they go first. Then it sends the PDF to
gemini-3.5-flash-lite through the Gemini Files API, in one call. For each
requirement Gemini answers clear, partial or none, with a verbatim quote from
the CV for clear and partial.

LucidHire computes the score itself with `@lucid-hire/scoring`: a must-have
counts three times a nice-to-have, an Off requirement doesn't count, and
partial evidence counts half. Since the score comes from the weights and the
stored evidence, changing a weight re-ranks the job at once, in the browser,
with no new AI read; the API recalculates every score in one SQL statement. A
requirement added later shows as not checked on each CV until "Check all"
reads just that requirement. The job page polls while CVs are being read.
SQLite writes that list as JSON and flattens the CSV export, so the Worker only
joins rows: about 4 ms of CPU for 250 CVs, where shaping them in JavaScript
took 16 to 25 ms.

`pnpm --filter @lucid-hire/api bench:scoring` measures how steady this is. It
scores the four fictional sample CVs five times each against one drafted list
with the production code, and reports the spread of each score, the rank order
of each run, which levels moved between identical runs, and whether every quote
is in the CV.

Recruiters mark each candidate Shortlisted, Rejected or Undecided, keep a
shared note, and open the original PDF. The ranked list shows each decision and
can be filtered by it.

On a scored candidate, "Write questions" asks gemini-3.5-flash-lite for 5 to 8
interview questions. They're built from the scoring's evidence, so the CV isn't
sent again. There's one for each must-have the CV doesn't clearly show, then a
few that ask for detail on the candidate's strongest claims.

## TestSprite coverage

Each PR deploys both Workers through Workers Builds. When the
`Workers Builds: lucidhire-app` check passes, TestSprite runs this suite against
https://lucidhire.io and reports a `TestSprite V3` check that blocks the merge
on failure.

| Test | What it checks |
| --- | --- |
| Home page loads with core marketing content | The heading "We read every CV. You meet the best ones." and the "API online · lucidhire-api" status in the footer |
| Sign-in page opens from the home page | "Sign in" in the header opens the "Sign in to LucidHire" page with the email field |
| Home page redirects from the www domain | https://www.lucidhire.io ends up on https://lucidhire.io |
| Sign-up page opens from the hero call to action | "Post a job free" opens the "Create your LucidHire account" page |
| Pricing slider recommends the plan that fits the pile | At 1,000 CVs a job the summary names Max at $30 a month and the Max card is marked as the fit |
| Try-it demo lists Grace Turner first by default | The sample shortlist opens with Grace Turner first at 93 and Rayan Al-Farsi fifth at 46 |
| Try-it demo re-ranks candidates when priorities change | The Android-leaning preset puts Rayan Al-Farsi first at 95 and Grace second |
| Story chapters and FAQ answers open on demand | The "Rank" chapter shows the ranked list, and an FAQ question expands to its answer |
| Signed-out visitors are sent to sign in from the dashboard | /dashboard without a session lands on the sign-in page |
| Recruiter signs in and reaches the dashboard | The recruiter test account signs in with email and password, names its company "Sprite Labs" if it hasn't yet, and lands on its "Overview" page |
| Recruiter posts a job and sees it in the list | "Post a job" → "Sprite post role" → "Open job"; the list shows it marked Open, then the test deletes it |
| Recruiter deletes a job after confirming | An admin saves a "Sprite delete role" draft, deletes it through the confirm dialog, and the list says "Deleted “Sprite delete role”" without showing it |
| Recruiter closes an open job | "Sprite archive role" (reused every run) is closed and offers "Reopen job" |
| Recruiter rewrites rough job notes with AI | "Improve with AI" turns rough notes into sections with gemini-3.5-flash-lite, without saving |
| New job form asks for a title | Saving without a title shows "Enter a job title between 2 and 120 characters" |
| Recruiter uploads a CV and sees it scored with evidence | Opens "Sprite scoring role", uploads grace-turner.pdf, waits for her score, then checks her page for met requirements with quotes and a "Not shown in the CV" gap. Deletes its job afterwards |
| Admin deletes a candidate after confirming | Uploads kenji-tanaka.pdf to "Sprite candidate role", deletes the candidate through the confirm dialog, and sees "Deleted …". Deletes its job afterwards |
| Jobs take PDF CVs only while open | A draft job explains it can't take CVs; once opened, a .txt file is refused with "Upload a PDF file" and no slot is used. Deletes its job afterwards |
| Recruiter gets interview questions for a candidate | Uploads grace-turner.pdf to "Sprite questions role", opens her once scored, clicks "Write questions", and sees at least 5 numbered questions with "Copy all" and "Write new questions". Deletes its job afterwards |
| Recruiter shortlists a candidate and filters the list | Uploads kenji-tanaka.pdf to "Sprite shortlist role", marks Kenji "Shortlisted" with a saved note, sees the badge in the list, and filters to "Shortlisted 1". Deletes its job afterwards |
| Privacy policy opens from the landing footer | "Privacy" in the footer opens "Privacy policy", last updated 22 October 2026, naming Cloudflare, Clerk, Gemini, Polar and privacy@lucidhire.io |
| Terms page lists the plans and their limits | /terms shows "Terms of service" with Free ($0), Pro ($10 a month) and Max ($30 a month) and their CV and job limits |
| Unknown address shows the not-found page | A made-up address shows "This page does not exist" with a "Go home" link |
| Signing out shows a confirmation | After signing in, /sign-out says "You're signed out" with "Sign in again" and "Go home" |
| A dashboard link survives sign-in | A signed-out visit to /dashboard/jobs/new goes through sign-in and comes back to the "Post a job" form, not the jobs list (legacy always landed on the dashboard) |
| Applicant fills in the apply form on a job's public page | A recruiter opens "Sprite apply role" and follows its public link; the form takes applicant.sprite@example.com and grace-turner.pdf. Turnstile refuses automated browsers, so the submit itself is covered by the API tests. Deletes its job afterwards |
| A closed job's public page says applications are closed | After "Close job", the public page of "Sprite closed role" shows "Closed role" and "Applications closed" with no form. Deletes its job afterwards |
| Unknown job link shows a friendly page | /jobs/no-such-job-00000000 shows "This job isn't available" |
| Recruiter shares an open job's public link | "Sprite share role" shows its https://lucidhire.io/jobs/… link and a Share menu with Email, X, LinkedIn, WhatsApp, Facebook and "Copy caption". Deletes its job afterwards |
| Recruiter searches and filters the jobs list | Saves "Sprite search role" as a draft, searches for it and filters to "Draft", and sees only that job. Deletes its job afterwards |
| Recruiter duplicates a job as a draft | "Duplicate" on "Sprite duplicate role" opens "Sprite duplicate role (copy)" for editing with "Duplicated as a draft". Deletes both jobs afterwards |
| Overview shows the company dashboard | "Overview", the first page after sign-in, shows active roles, CVs screened, time to shortlist, top match, pipeline velocity, the 90-day funnel, the AI output mix and recent activity |
| Collapsed sidebar stays collapsed after a reload | "Collapse sidebar", then a reload, still shows "Expand sidebar" |
| Recruiter searches the candidate list | Uploads grace-turner.pdf and kenji-tanaka.pdf to "Sprite search candidates role", searches "Kenji", and sees only Kenji Tanaka. Deletes its job afterwards |
| Candidate page shows the rank and the profile read from the CV | Grace Turner's page in "Sprite profile role" says "Ranked #1 of 1 scored CV for this role" and has a "Profile" section with her skills. Deletes its job afterwards |
| Recruiter opens the CSV export choices | With kenji-tanaka.pdf in "Sprite export role", "Export CSV" offers all, shortlisted, undecided or rejected candidates. Deletes its job afterwards |
| Settings shows the company's plan, usage and the plans | Settings says "Current plan Max" with "Active", shows the monthly job meter and compares Free, Pro and Max |
| Pricing button carries the picked plan to sign-up | "Choose Pro" on the landing pricing opens /sign-up?plan=pro |
| Admin creates a team invite link | The Team section lists the signed-in admin as "You" and "Create invite link" shows an /invite/ link, which the test then revokes |
| New job page shows the monthly job allowance | The new job page says "Unlimited jobs on your plan" |
| Recruiter copies a job's public link from the jobs list | The row menu of an open job says "Copied" after "Copy public link". Deletes its job afterwards |
| Sidebar shows the company's plan | The "Max" badge beside "Sprite Labs" opens Settings at "Plan & usage" |
| Recruiter gives an uploaded CV its applicant's name and email | With "Add a name or email to each CV" on, grace-turner.pdf is staged with the name Grace Sprite and the email grace.sprite@example.com, which the candidate page then shows over what the CV says. Deletes its job afterwards |
| A malformed email holds a staged upload back | A staged CV with the email "not-an-email" says "Enter a valid email address" and nothing uploads. Deletes its job afterwards |

The recruiter test account's credentials live only in the TestSprite
environment, never in this repo.
Its company, Sprite Labs, is comped to Max by migration
`0008_comp_test_company`: each run posts and deletes about fifteen jobs, and
the Free plan's 10 new jobs a month would stop the suite after one run.

## Local development

```sh
pnpm install
pnpm --filter @lucid-hire/api db:migrate:local   # local D1 tables; rerun after new migrations
pnpm dev:api   # http://localhost:8787, needs apps/api/.dev.vars: Clerk dev secret and a Gemini key (see .dev.vars.example)
pnpm dev:web   # http://localhost:5173
pnpm check     # types, lint and tests for both apps
```

Schema changes: edit `apps/api/src/db/schema.ts`, run
`pnpm --filter @lucid-hire/api db:generate`, and commit the new file in
`apps/api/migrations`. The deploy applies it to the live D1 database before
it deploys the API.

## Docs

- [Hackathon rules for this repo](docs/hackathon-s4.md)
- [Design system: "Highlighter"](docs/design/design-system.md)
- [Legacy audit](docs/legacy-audit.md)
