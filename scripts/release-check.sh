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
log_dir=$(mktemp -d)
step() {
  local name="$1"; shift
  local log="$log_dir/$(echo "$name" | tr -c 'a-zA-Z0-9' '_').log"
  echo "==> $name"
  if "$@" 2>&1 | tee "$log"; [ "${PIPESTATUS[0]}" -eq 0 ]; then
    results+=("PASS     $name")
  else
    results+=("FAIL     $name"); failed=1
    # On GitHub, put the end of the failing output on the run page (numbered so lines aren't merged).
    if [ -n "${GITHUB_ACTIONS:-}" ]; then
      grep -vE "^\s*$" "$log" | grep -E "not ok|error:|expected|actual|Error|at .*browser.test" | head -n 25 | nl -ba | sed -E "s/^ *([0-9]+)\t/::error title=${name}::\1 /"
    fi
  fi
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
  step "Planner browser test" bash -c "cd artifacts/sombra && node --test --test-reporter=tap tests/*.browser.test.js"
else
  skip "Planner browser test" "needs Chromium or CHROME_BIN"
fi

echo
echo "Release check summary"
printf '  %s\n' "${results[@]}"
exit $failed
