# LucidHire

AI candidate screening: post a job, collect CVs, and get a ranked shortlist
with the evidence behind every score.

This repo is the rebuild of LucidHire on Cloudflare for TestSprite Hackathon
Season 4. Every layer lands through a pull request that is gated by a
TestSprite check against a live deployment.

- **Status:** the landing page, sign-in, onboarding and jobs (with the AI
  description rewrite) are live. CV upload and scoring land next.
- **Live URL:** https://lucidhire.io (API: https://api.lucidhire.io)

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
| Recruiter posts a job and sees it in the list | "New job" → "Sprite test role" → "Open job"; the list shows it marked Open |
| Recruiter deletes a job after confirming | An admin deletes a "Sprite test role" through the confirm dialog and the list says "Deleted “Sprite test role”". It balances the posting test, so test jobs don't pile up |
| Recruiter closes an open job | "Sprite archive role" (reused every run) is closed and offers "Reopen job" |
| Recruiter rewrites rough job notes with AI | "Improve with AI" turns rough notes into sections with gemini-3.8-flash, without saving |
| New job form asks for a title | Saving without a title shows "Enter a job title between 2 and 120 characters" |

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
