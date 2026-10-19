# Contributor setup and delivery

Use the supported Linux/Node/Git host in [PILOT.md](../PILOT.md). Repository tooling diagnoses its environment; permission grants, proxy/trust configuration and service access belong to the host provider. Preserve inherited identity and network settings when diagnosing failures.

## Dependencies and readiness

From the checkout root, run:

```sh
node scripts/setup.mjs
npm run skills:setup
npm run ready
```

The setup command validates a writable cache before `npm ci`. The project `.npmrc` also gives plain npm commands the workspace-local `.cache/npm` default. To select a host cache explicitly, use `npm_config_cache=/absolute/cache node scripts/setup.mjs`, `NPM_CONFIG_CACHE`, or `node scripts/setup.mjs --cache /absolute/cache`; the command-line choice wins. With npm, use `npm --cache /absolute/cache run setup` or `npm run setup -- --cache /absolute/cache`. An unusable explicit choice fails with its path and corrective action; setup never silently replaces it. Cache contents and generated skills are ignored by Git.

Readiness checks the supported runtime and Git worktree version, installed dependencies and writable npm cache, the existing test capability preflight, locked skill integrity, actual Chromium launch/page execution, and read-only GitHub repository access/push permission. Browser selection shares both Playwright configurations: `ORCHES_CHROMIUM` chooses an existing executable; otherwise install the pinned Playwright Chromium with `npx playwright install chromium` (and required Linux libraries). This is a prerequisite probe; it does not run the application or regression suites.

Each readiness result is `PASS` or `BLOCKED`, names its public command, and gives a corrective action. A blocker exits nonzero. Child probes have deadlines and bounded diagnostics; owned temporary files and processes are cleaned up. Probes never create application data, call a model, edit a PR, grant access, log in, read credentials, or change network policy. Real-model connectivity and untested provider permissions remain `UNVERIFIED`; a passing probe does not establish code correctness or guarantee a future network/write operation.

For a subprocess, listener or temporary-filesystem blocker, request the supported execution grant from the host and repeat readiness. Diagnose GitHub access with `gh auth status` and the provider's network/authentication tools. An inaccessible service is an environment blocker, not evidence of an application regression.

## Locked Matt Pocock skills

[skills-lock.json](skills-lock.json) records the upstream Git repository, immutable commit and selected source paths. `npm run skills:setup` fetches that exact commit and installs only the required workflow bundle and referenced dependencies, with upstream LICENSE, under `.agents/skills/<name>/SKILL.md`. Tell the agent to read that path when its skill catalog does not expose it. The issue tracker is this repository's GitHub issues; the originating issue and comments are the specification. The bundle includes implementation, TDD, review, retrospective, specification, ticketing, writing, and the conditional design reference.

Repeated setup safely replaces the generated bundle. Download/source failure retains the previous bundle and reports the missing source; it never chooses a newer revision. `npm run skills:setup -- --check` validates the lock and installed file hashes offline, including missing or edited references. Missing skills are a blocker; restore the pinned bundle rather than substituting a different workflow.

To update deliberately, choose an upstream commit, review its selected skill/reference changes, edit the lock revision and paths if needed, rerun setup and the integrity check, and review/commit the lock diff with the reason for the update. A moving branch is not a valid revision. Installation stages a complete bundle before replacing the old directory; if the host is killed during directory replacement, rerun setup to restore the generated bundle. It contains no durable application state.

## Agent delivery

1. Read the issue and comments (`gh issue view NUMBER --comments`), applicable `AGENTS.md` navigation, and the pinned requested skills. Look up only the specific capability needed when discovering host tools; keep diagnostics and status observations bounded.
2. Create a focused feature branch. Run readiness before implementation. Use the issue's agreed public testing boundaries and established project patterns.
3. Before the **first draft push**, review the final diff and run `npm test`, `npm run format:check`, `npm run build`, and the browser checks relevant to the change (`npm run test:browser` and/or `npm run test:pages`). Build before the application browser suite. Repair formatting with `npm run format`; it covers the application, tooling/tests and `docs/trial`, while preserving legacy Pages exclusions. Resolve failures before committing/pushing.
4. Open the PR with the repository template when present, resulting behavior, validation results and `Closes #NUMBER`. Follow the requested review workflow; address findings, rerun affected checks, and push fixes. Observe CI with bounded commands such as `gh pr checks NUMBER --watch --interval 10` under a host deadline, then inspect changed/failing checks. Leave human acceptance and merging to the maintainer.

## GitHub CLI compatibility

Use `gh` with the host's existing authentication and repository context. Read metadata through targeted fields (`gh pr view NUMBER --json number,title,body,url`) or `gh api repos/{owner}/{repo}/pulls/NUMBER`.

For an existing PR's title/body, write the intended multiline Markdown to a file, then run:

```sh
npm run pr:edit -- NUMBER --body-file /absolute/pr-body.md --title "Resulting behavior"
```

This tries `gh pr edit` first. Only its observed deprecated classic Projects GraphQL `repository.pullRequest.projectCards` error selects a structured REST PATCH with the same metadata. The JSON body travels on stdin, preserving literal text and newlines. Compatible CLI success needs no fallback; authorization/network failures and failed REST writes remain visible and failing. The helper neither upgrades global tools nor retries with different identity/permissions. Tests control the executable/service boundary and never write a production PR; readiness uses read-only access.
