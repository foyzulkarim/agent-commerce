# Contributing

- One PR per phase of `../docs/work-plan.md`. Each commit names its tasks and its check.
- A new dependency needs a reason in the PR text. Pin exact versions; `.npmrc` enforces `save-exact` and `min-release-age=7`.
- Every `FROM` and compose `image:` is pinned by digest.
- Before you push: `bash scripts/check.sh`, and `node scripts/e2e.ts` against a running system.
- A change to an agent's behaviour goes into `prompt.md`. Keep `scripted.ts` in step, so the fallback demo shows the same flow.
- A design change goes into `../docs/multi-agent-design.md` before the code, as a short diff.
- Workshop grade: easy to show, easy to add a service. Production concerns (design §13) stay out unless asked.
