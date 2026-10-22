# LucidHire

AI candidate screening: post a job, collect CVs, and get a ranked shortlist
with the evidence behind every score.

This repo is the rebuild of LucidHire on Cloudflare for TestSprite Hackathon
Season 4. Every layer lands through a pull request that is gated by a
TestSprite check against a live deployment.

- **Status:** the landing page, sign-in, onboarding, jobs (with the AI
  description rewrite), CV scoring and interview questions are live. Next comes polish. Billing and
  the public apply portal are out of scope.
- **Live URL:** https://lucidhire.io (API: https://api.lucidhire.io)

## How scoring works

A recruiter uploads PDFs on an open job: up to 10 per job, 5 MB each. The API
streams each file into the private R2 bucket `lucidhire-cvs`.

Each CV starts its own Workflow (`lucidhire-score-cv`). It sends the PDF to
gemini-3.5-flash-lite through the Gemini Files API, in one call. Gemini returns
every requirement of the job as met or not met, with a quote from the CV as
evidence.

LucidHire computes the score itself, and must-haves count double. So the
same CV always gets the same score, and every point traces back to a quote.
The job page polls while CVs are scoring.

On a scored candidate, "Write questions" asks gemini-3.5-flash-lite for 5 to 8
interview questions. They're built from the scoring's evidence, so the CV isn't
sent again. There's one for each unmet must-have, then a few that ask for
detail on the candidate's strongest claims.

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
| Recruiter signs in and reaches the jobs dashboard | The recruiter test account signs in with email and password, names its company "Sprite Labs" if it hasn't yet, and lands on its "Jobs" page |
| Recruiter posts a job and sees it in the list | "New job" → "Sprite post role" → "Open job"; the list shows it marked Open, then the test deletes it |
| Recruiter deletes a job after confirming | An admin saves a "Sprite delete role" draft, deletes it through the confirm dialog, and the list says "Deleted “Sprite delete role”" without showing it |
| Recruiter closes an open job | "Sprite archive role" (reused every run) is closed and offers "Reopen job" |
| Recruiter rewrites rough job notes with AI | "Improve with AI" turns rough notes into sections with gemini-3.5-flash-lite, without saving |
| New job form asks for a title | Saving without a title shows "Enter a job title between 2 and 120 characters" |
| Recruiter uploads a CV and sees it scored with evidence | Opens "Sprite scoring role", uploads grace-turner.pdf, waits for her score, then checks her page for met requirements with quotes and a "Not shown in the CV" gap. Deletes its job afterwards |
| Admin deletes a candidate after confirming | Uploads kenji-tanaka.pdf to "Sprite candidate role", deletes the candidate through the confirm dialog, and sees "Deleted …". Deletes its job afterwards |
| Jobs take PDF CVs only while open | A draft job explains it can't take CVs; once opened, a .txt file is refused with "Upload a PDF file" and no slot is used. Deletes its job afterwards |
| Recruiter gets interview questions for a candidate | Uploads grace-turner.pdf to "Sprite questions role", opens her once scored, clicks "Write questions", and sees at least 5 numbered questions with "Copy all" and "Write new questions". Deletes its job afterwards |

The recruiter test account's credentials live only in the TestSprite
environment, never in this repo.

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
