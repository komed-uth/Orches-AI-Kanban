# Orches-AI-Kanban

The self-hosted game development orchestration pilot is documented in [PILOT.md](PILOT.md). It runs locally with team accounts, isolated Codex task agents, verification, and human review. The independent GitHub Pages dashboard below remains available.

A Kanban dashboard hosted on GitHub Pages, with GitHub Issues as the task database. No local server, database, npm install, or browser token is needed.

## Browser-local Pages trial

Open **Try the editable browser-local backlog** from the dashboard, or visit `trial/` below the deployed URL. The original dashboard continues to display GitHub Issues; trial tasks are separate app-owned records and never write to GitHub. The trial has no backend, credentials, model access, real execution or team synchronization. Browser profiles/devices have independent data.

The Gem Trail sample project includes its stable project ID and editable simulated repository, test/check, and optional build configuration (no build by default; test command `node --test tests/*.test.mjs`). The trial does not execute that configuration. Three documented samples are restored by reset:

- **Show the remaining gem count** (`task-gem-count`): independent high-priority work with count visibility/update criteria.
- **Celebrate collecting every gem** (`task-victory`): medium priority, depends on `task-gem-count`, with a victory-message criterion.
- **Restart the game with the R key** (`task-restart`): independent low-priority work with a keyboard restart criterion.

Create or edit titles, descriptions, acceptance criteria (one per line, displayed as a numbered list), priority, and prerequisite selections. Task/project IDs remain stable after edits. Self-dependencies, missing references, and cycles are rejected with corrective feedback.

**Move to Ready** authorizes simulated execution and requires acceptance criteria, a simulated repository, and a test/check command. Specific validation messages explain missing information. Authorization retains the project configuration and locks task editing; later project-setting changes apply to newly authorized tasks. Dependencies allow entry into Ready but wait for an explicit **Simulate prerequisite merge**; **Simulate acceptance** alone does not mark a prerequisite merged.

The demo capacity (1–100; initially two) limits active attempts. Independent eligible tasks start in their displayed order while others show dependency or capacity waiting reasons. **Simulate waiting for answer** retains the same attempt and its capacity slot; **Simulate answer received** continues it. Acceptance frees the slot. Lowering capacity leaves existing attempts intact, and raising it admits eligible Ready work. These controls demonstrate admission only, with no timers, subprocesses, real verification, or GitHub merge detection.

Reload retains attempt identities and waiting states, pauses the simulation, and never admits work by itself. Nothing runs while the page is closed. **Resume simulation** explicitly continues saved attempts and admits eligible Ready tasks under the current capacity. Settings edits before resume leave saved work paused. Repeated Ready actions never create another attempt. Version-one backlog data migrates without changing task identities or authorizing work.

Versioned local storage uses only the `orches.pages-trial` key on this site's origin. Successful saves survive reload in the same browser; clearing browser data loses them. Storage denial, malformed data, incompatible versions, or invalid saved references visibly block saving until you choose recovery. **Retry saved storage** re-reads saved data or retries a failed write while retaining its draft. **Continue without saving** uses retained in-memory edits (or samples when saved data cannot be read), leaving saved bytes untouched; those temporary edits disappear on reload. **Replace saved trial with samples** requires confirmation and explicitly replaces only trial-owned data. **Reset trial data** also requires confirmation and restores the three samples; in temporary mode it resets only the unsaved session. Neither reset touches unrelated storage or the issue snapshot.

## Deploy

1. Merge these files into `main` in `komed-uth/Orches-AI-Kanban`.
2. In **Settings → Pages → Build and deployment**, select **GitHub Actions** as the source.
3. Run **Actions → Publish task dashboard → Run workflow**, or push to `main`.
4. After the deployment succeeds, GitHub reports the published URL (normally `https://komed-uth.github.io/Orches-AI-Kanban/`).

The workflow requires a public repository with Issues and Actions enabled. It intentionally refuses to export private repository data. The built-in workflow token reads issues and deploys Pages; do not put a personal access token in the site.

## Use the board

Create tasks as GitHub Issues. Create these labels in the repository's **Issues → Labels** page:

| Label | Column |
| --- | --- |
| `status:backlog` (or no status label) | Backlog |
| `status:ready` | Ready |
| `status:in-progress` | In progress |
| `status:blocked` | Blocked |
| `status:done` (or a closed issue) | Done |

Use one status label per open issue. Closed issues always appear in Done; if open issues have conflicting labels, Blocked takes precedence, then In progress, Ready, Done, and Backlog. Assign issues to identify the responsible GitHub account. Extra labels such as `agent:codex` or `priority:high` appear on cards and are searchable.

Click a card to edit its issue on GitHub. The board displays tasks; edits happen through GitHub's authenticated interface. The New task link opens GitHub's issue form.

Issue changes trigger an Action that exports titles, numbers, labels, assignees, states, and update times to a static snapshot and publishes it. Issue bodies and comments are not exported. The browser checks the snapshot every minute and shows its timestamp. GitHub Actions and Pages can add several minutes of delay, so this is periodic status tracking rather than a live stream of AI activity. Pull requests are excluded. Existing cards remain visible if a refresh fails.

## AI agent updates

Agents must explicitly update issues through their existing GitHub integration; Pages cannot monitor agents running elsewhere. For example, with an authenticated GitHub CLI and the labels already created:

```sh
gh issue edit 12 --repo komed-uth/Orches-AI-Kanban \
  --remove-label status:ready --add-label status:in-progress
gh issue close 12 --repo komed-uth/Orches-AI-Kanban
```

## Development checks

For the self-hosted application, use Linux and Node.js **22.13 or newer**, then `npm ci`, `npm test`, `npm run format:check`, and `npm run build`. `npm test` is the canonical contributor check; see [PILOT.md](PILOT.md) for browser checks and host/live evaluation, and [contributor/architecture.md](contributor/architecture.md) for module ownership. Run `npm run format` to apply the pinned formatter to application sources and associated tooling/tests. The independent Pages files and board-only test are excluded.

For the independent Pages dashboard only, run `node --test tests/board.test.mjs`. This dashboard uses native browser modules and has no build step. `docs/issues.json` is generated during deployment and is not committed. For a local functional check, create a fixture snapshot in that location and serve `docs` through any static HTTP server. The deployed dashboard runs entirely on GitHub Pages.

For the Pages trial's real-browser checks, run `npm ci`, `npx playwright install chromium`, then `npm run test:pages`. Its Playwright configuration starts a static `docs/` server independently of the self-hosted application and Codex runner; no application build is needed. Set `ORCHES_CHROMIUM` to an installed Chromium executable if needed. These checks cover create/edit/reload, stable references, dependency rejection, reset confirmation/isolation, storage recovery and temporary mode, readiness feedback, simulated dependency/capacity admission, retained configuration, reload recovery, and version-one migration. CI runs them alongside the existing checks.
