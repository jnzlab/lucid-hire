# LucidHire

AI candidate screening: post a job, collect CVs, and get a ranked shortlist
with the evidence behind every score.

This repo is the rebuild of LucidHire on Cloudflare for TestSprite Hackathon
Season 4. Every layer lands through a pull request that is gated by a
TestSprite check against a live deployment.

- **Status:** scaffold. Two Workers are live; product features land next.
- **Live URL:** https://lucidhire.io (API: https://api.lucidhire.io)

## TestSprite coverage

Each PR deploys both Workers through Workers Builds. When the
`Workers Builds: lucidhire-app` check passes, TestSprite runs this suite against
https://lucidhire.io and reports a `TestSprite V3` check that blocks the merge
on failure.

| Test | What it checks |
| --- | --- |
| Home page loads with core marketing content | The heading "We read every CV." and the "API online · lucidhire-api" status |
| Sign in dialog opens from the home page | Sign in opens the Clerk dialog with the email option |
| Home page redirects from the www domain | https://www.lucidhire.io ends up on https://lucidhire.io |

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
