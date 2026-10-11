#!/usr/bin/env bash
# One command to check a release candidate. Prints PASS, FAIL or SKIPPED for every step,
# and exits non-zero if anything failed. Skipped steps are listed so nothing is silently left out.
#
#   pnpm run release-check          # everything that runs offline
#   DATABASE_URL=... pnpm run release-check   # also the account and data isolation tests
#   pnpm run release-check -- --live          # also call the real weather, alert and map services
set -u
cd "$(dirname "$0")/.."

live=false
for arg in "$@"; do [ "$arg" = "--live" ] && live=true; done

results=()
failed=0
step() {
  local name="$1"; shift
  echo "==> $name"
  if "$@"; then results+=("PASS     $name"); else results+=("FAIL     $name"); failed=1; fi
}
skip() { results+=("SKIPPED  $1 ($2)"); }

step "Type check" pnpm run typecheck
step "Web app build" env PORT=1 BASE_PATH=/ pnpm --filter @workspace/sombra run build
step "Safety rules tests" pnpm --filter @workspace/heat-safety test
step "Web app tests" pnpm --filter @workspace/sombra test

api_tests=$(cd artifacts/api-server && ls tests/*.test.js | grep -v account-isolation | tr '\n' ' ')
step "API tests" bash -c "cd artifacts/api-server && node --test $api_tests"

if [ -n "${DATABASE_URL:-}" ]; then
  step "Database schema" pnpm --filter @workspace/db run push
  step "Account and data isolation tests" bash -c "cd artifacts/api-server && node --test tests/account-isolation.test.js"
else
  skip "Account and data isolation tests" "set DATABASE_URL to a TEST database"
fi

if $live; then
  step "Live data check" pnpm --filter @workspace/api-server run test:live
else
  skip "Live data check" "add --live; needs internet"
fi

if command -v chromium >/dev/null 2>&1 || [ -n "${CHROME_BIN:-}" ]; then
  step "Planner browser test" pnpm --filter @workspace/sombra run test:browser
else
  skip "Planner browser test" "needs Chromium or CHROME_BIN"
fi

echo
echo "Release check summary"
printf '  %s\n' "${results[@]}"
exit $failed
