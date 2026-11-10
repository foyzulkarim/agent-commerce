#!/usr/bin/env bash
# The checks of landscape #34 and §5. Run from anywhere: it moves to the repo root.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== tsc --noEmit"
npx tsc --noEmit -p tsconfig.json
echo "== biome ci"
npx biome ci .
echo "== node --test"
node --test
echo "== npm audit signatures"
npm audit signatures
echo "== npm audit (high and above)"
# Moderate findings in @fastify/static's glob/minimatch are fixed in 10.1.10, which is younger than min-release-age. Raise to moderate once it ages.
npm audit --audit-level=high
echo "== all checks passed"
