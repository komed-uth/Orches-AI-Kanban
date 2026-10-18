# Self-hosted orchestration pilot

This pilot is separate from the existing GitHub Pages dashboard. It runs one local host with a persistent team board and independent Codex task agents. Accepted branches are integrated by a person. The browser game needs no game engine; other game projects need their own engine/toolchain installed on the host.

## Install and start

Requirements: Node.js **22.13 or newer** (built-in SQLite), npm, Git with worktree support, and a current Codex CLI supporting `codex app-server`. Install/authenticate Codex on the same host account that runs the server. Check `codex --version`, `codex login status`, and `git --version`; complete `codex login` if needed. CLI login status alone does not prove model connectivity. Allow the CLI to reach its configured model service.

From the repository root:

```sh
npm install
npm run build
npm start
```

Open the localhost URL printed by the server. Create the first owner account in the setup form. For application development use `npm run dev`; the production flow above serves the built client. Run checks with `npm test` and `npm run build`. The sample's independent baseline is `node --test sample-game/tests/*.test.mjs` from the application repository, or `node --test tests/*.test.mjs` from the seeded game repository.

The server binds localhost by default. To permit a small trusted team to connect, deliberately set `HOST=0.0.0.0` and a `PORT`, then use the host's trusted LAN address. Restrict access with the host firewall or a trusted VPN. Local account cookies over plain HTTP do not provide transport encryption; use a trusted TLS reverse proxy when needed. This pilot is not configured for public internet hosting. Team members use invitations created by the owner and shared manually; Codex authentication stays on the host. Members can manage tasks, respond to requests, and review work; owner settings control repositories and executable commands.

Runtime data uses `ORCHES_DATA_DIR` (default `.orches-data` in the process working directory). Keep this directory private, writable, backed up, and outside tracked source. It holds SQLite state, the independent `sample-project` Git repository, and task worktrees/resources. Reuse the same directory after a restart; deleting it loses team/run history. Codex's own credentials remain in its host configuration, outside browser snapshots. Do not commit runtime data or credentials. Use an absolute `ORCHES_DATA_DIR` when starting from different directories.

## First look and configuration

The initial board contains the Gem Trail sample project and two Backlog tasks with explicit acceptance criteria. Open **Sample game** (or `/sample-game/`) and collect all five gems using arrow keys, WASD, or the buttons. Restart with the button. The bundled game is a baseline preview; task changes live in separate working copies and do not rewrite this preview or the original application checkout.

The sample project is copied once into `ORCHES_DATA_DIR/sample-project` and committed as an independent Git repository. It has no build command and uses `node --test tests/*.test.mjs` for verification. The two tasks change different files:

- **Show the remaining gem count** changes the status renderer and its tests.
- **Restart the game with the R key** changes keyboard controls and their tests.

Configure the Codex executable/model in owner settings. Keep the real Codex runner selected. Check host diagnostics and the configured repository revision. Set capacity to **2** (the default is 3). In the project's workflow configure the enabled status-entry rule to trigger on **Ready**, use **Review** as its review destination, and retain the sample test command. Suggested instructions: “Implement only this task's acceptance criteria, preserve existing behavior, and run the tests. Keep changes focused.” Saving a rule does not start tasks that already occupy its trigger column. Rename or reorder a column if desired; references use stable IDs. Occupied or rule-referenced columns cannot be removed.

## Real Codex two-task evaluation

Record the actual date, CLI version, run IDs, states, worktree paths, test outputs and any blocker in the validation record below. This procedure requires real model access and may consume account quota.

1. In a second browser profile, use an owner-created invitation to join as a member. Keep both boards visible. Move the first and second sample tasks from Backlog into Ready (or use their explicit run actions). Both should be active at once when capacity is 2. Record overlapping start/completion times from run history; two sequential completions do not prove overlap.
2. Open each task panel. Confirm different branch/worktree references and independent live activity. Output, questions, approvals, and test evidence must stay with the correct task. Check the original sample checkout stays untouched. A waiting request reserves that task's slot but does not stop the other task.
3. If a Codex approval or question appears, inspect its request and answer in that task's panel. Reject an unsafe/unwanted request. Requests depend on actual CLI behavior: do not report a request interaction unless one occurred. To evaluate a question deliberately, send a follow-up asking the agent to request a choice through its supported user-input mechanism before making a small change. Record a protocol limitation if this CLI/model cannot emit it.
4. Send a task-specific follow-up. During an active run it is retained for a later attempt; after completion explicitly start the next attempt. Confirm the task conversation is resumed and no second writer starts on the same task. Do not expect a completed turn to restart merely because a message was saved.
5. Let both tasks finish. Successful configured verification should put each in Review. Read the diff, test command output/exit code and worktree reference. Check each acceptance criterion. To request rework, send an explicit follow-up and start another attempt; retain the earlier history. Only after review choose **Accept** to move the result into Done, attributed to the signed-in reviewer. This is human acceptance, not branch merging.
6. Confirm the second browser sees task movement and activity. Disconnect it briefly, reconnect or reload, and verify the current snapshot and persisted task/run history return before live activity continues. Signing out must end access to protected data/events.

The bundled baseline stays unchanged until manual integration. To play a changed task working copy, serve that worktree with a static HTTP server on a separate localhost port. Do not expose a worktree's `.git` metadata to an untrusted network.

## Failure, queueing, and recovery

Use a separate disposable task for failure tests so that the two sample acceptance results stay clear. In owner workflow settings, set the rule’s test command for its next attempt to an intentionally failing command, such as `node -e "process.exit(1)"`, then start it. A verification failure must preserve changes/logs, explain failure, and move the task to Blocked. Restore the real test command and explicitly retry. The new attempt should retain earlier history and reuse the task's working copy/conversation; it must not retry on its own. Restore shared rule commands before starting other work. A model connection/authentication failure is also valid failure evidence, but does not prove the successful verification path.

To observe the queue, set capacity to 1, start two disposable tasks, and verify one waits. Raise capacity to 2 and observe the queued task start. Lowering capacity while agents run must leave current work alone and delay new starts. Cancel one run and verify only its processes stop; the other task continues and the cancelled task's evidence remains. These operations execute real Codex work when the real runner is configured.

For host recovery, start a disposable task, record its active state, stop the host, and restart with the **same `ORCHES_DATA_DIR`**. Previously unfinished attempts must be marked interrupted for attention, and no task should execute automatically. Inspect retained history and explicitly start another attempt when ready. Configuration changes, a browser reload, and reconnection must not start historical tasks.

## Manual integration and practical limits

Acceptance preserves a branch/worktree and does not merge it. On the host inspect each worktree (`git -C <worktree> diff` and `git -C <worktree> status`) and commit reviewed edits if they are uncommitted. From the project's normal checkout merge or cherry-pick the resulting commits one at a time. Resolve overlaps deliberately, run the game's tests again, and play the combined result. Keep task branches and worktrees until the team decides they can be removed; the pilot does not automatically clean up accepted work.

The application coordinates independent tasks on one host. It does not decompose a goal, plan dependencies, automatically retry, generate art/audio assets, merge branches, resolve conflicts, or distribute work across machines. Other disciplines can be tracked on the board. Verification commands and Codex operations run with the host account's authority; only owners should configure executable paths, repositories, and commands. Large output/history retention and many preserved worktrees need operator disk management. Engine prerequisites remain the project's responsibility.

No deterministic offline demo runner is included. Automated tests use a controlled Codex protocol fixture where appropriate; their success is application verification and must never be described as a successful live Codex loop.

## Validation record

Fill this with observed evidence before calling the pilot verified. Do not replace a failed or blocked live attempt with fixture results.

| Check | Observed result |
| --- | --- |
| Install, application tests, production build | Pending integration validation |
| Sample baseline tests | Pending final integration validation |
| Focused browser smoke: owner/member, shared updates, movement, settings, chat, request, cancellation, review/acceptance | Pending browser validation |
| Real Codex: two overlapping sample tasks, changes, tests, follow-up, human review | Pending live attempt; record exact auth/connectivity/protocol blocker if blocked |
| Explicit failure/retry, reconnect, restart recovery | Pending integration validation |

For any blocked item include the exact command or operation, observed error, and which behavior remains unverified. Login diagnostics alone and passing fixture tests are insufficient evidence for the live loop.
