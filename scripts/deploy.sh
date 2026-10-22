#!/usr/bin/env bash
# Deploys both Workers to the live environment and waits until it answers.
# Workers Builds runs this as its deploy command, so its GitHub check run (the event the
# TestSprite PR trigger listens for) only succeeds once https://lucidhire.io is live.
set -euo pipefail

cd "$(dirname "$0")/.."
message="${WORKERS_CI_BRANCH:-local} ${WORKERS_CI_COMMIT_SHA:-$(git rev-parse HEAD)}"

# The API goes first so the app never ships ahead of the endpoints it calls.
# The Workers Builds trigger lives on lucidhire-app; its name and tag checks don't apply to the API.
(cd apps/api && env -u WRANGLER_CI_MATCH_TAG -u WRANGLER_CI_OVERRIDE_NAME \
	pnpm exec cf deploy --message "$message")
(cd apps/web && pnpm exec cf deploy --message "$message")

health=$(curl -fsS --retry 30 --retry-delay 5 --retry-all-errors --max-time 10 \
	https://api.lucidhire.io/health)
echo "health: $health"
grep -q '"ok":true' <<<"$health"
curl -fsS --retry 10 --retry-delay 3 --retry-all-errors --max-time 10 -o /dev/null \
	-w 'home page: %{http_code}\n' https://lucidhire.io/
