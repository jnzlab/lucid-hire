# LucidHire

AI candidate screening: post a job, collect CVs, and get a ranked shortlist
with the evidence behind every score.

This repo is the rebuild of LucidHire on Cloudflare for TestSprite Hackathon
Season 4. Every layer lands through a pull request that is gated by a
TestSprite check against a live deployment.

- **Status:** the landing page is live. Sign-in, jobs and CV scoring land next.
- **Live URL:** https://lucidhire.io (API: https://api.lucidhire.io)

## TestSprite coverage

Each PR deploys both Workers through Workers Builds. When the
`Workers Builds: lucidhire-app` check passes, TestSprite runs this suite against
https://lucidhire.io and reports a `TestSprite V3` check that blocks the merge
on failure.

| Test | What it checks |
| --- | --- |
| Home page loads with core marketing content | The heading "We read every CV. You meet the best ones." and the "API online · lucidhire-api" status in the footer |
| Sign in dialog opens from the home page | Sign in opens the Clerk dialog with the email option |
| Home page redirects from the www domain | https://www.lucidhire.io ends up on https://lucidhire.io |
| Sign-up dialog opens from the hero call to action | "Post a job free" opens Clerk's "Create your account" dialog |
| Pricing slider recommends the plan that fits the pile | At 1,000 CVs a job the summary names Max at $30 a month and the Max card is marked as the fit |
| Try-it demo lists Grace Turner first by default | The sample shortlist opens with Grace Turner first at 93 and Rayan Al-Farsi fifth at 46 |
| Try-it demo re-ranks candidates when priorities change | The Android-leaning preset puts Rayan Al-Farsi first at 95 and Grace second |
| Story chapters and FAQ answers open on demand | The "Rank" chapter shows the ranked list, and an FAQ question expands to its answer |

## Local development

```sh
pnpm install
pnpm dev:api   # http://localhost:8787, needs apps/api/.dev.vars (see .dev.vars.example)
pnpm dev:web   # http://localhost:5173
pnpm check     # types, lint and tests for both apps
```

## Docs

- [Hackathon rules for this repo](docs/hackathon-s4.md)
- [Design system: "Highlighter"](docs/design/design-system.md)
- [Legacy audit](docs/legacy-audit.md)
