# Orches-AI-Kanban

A Kanban dashboard hosted on GitHub Pages, with GitHub Issues as the task database. No local server, database, npm install, or browser token is needed.

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

Run `node --test tests/*.test.mjs` with Node.js 20 or newer. The app uses native browser modules and has no build step. `docs/issues.json` is generated during deployment and is not committed. For a local functional check, create a fixture snapshot in that location and serve `docs` through any static HTTP server. The deployed dashboard runs entirely on GitHub Pages.
