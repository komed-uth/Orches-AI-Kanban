# Self-hosted ownership and invariants

The application is a Linux, single-host Node/Express service with SQLite and a React/Vite client. The static GitHub Pages dashboard in `docs/` is independent; its issues and labels are not the application's projects, tasks, or workflow statuses. See [PILOT.md](../PILOT.md) for operation and evaluation.

| Responsibility | Authoritative implementation | Observable coverage |
| --- | --- | --- |
| Authenticated HTTP operations, owner configuration, workflow identities, event replay | [server/app.mjs](../server/app.mjs), [server/index.mjs](../server/index.mjs) | [tests/app.test.mjs](../tests/app.test.mjs), [browser scenarios](../tests/browser/pilot.spec.mjs) |
| Task automation rules, queue admission, attempts/runs, Review and human acceptance | [server/scheduler.mjs](../server/scheduler.mjs) | [tests/execution.test.mjs](../tests/execution.test.mjs) |
| Durable state, transactions, ordered persisted events | [server/store.mjs](../server/store.mjs) | [HTTP/restart tests](../tests/app.test.mjs), [recovery tests](../tests/execution.test.mjs) |
| Repository validation, task working copies, review branches and diffs | [server/worktrees.mjs](../server/worktrees.mjs) | [tests/worktrees.test.mjs](../tests/worktrees.test.mjs), [crash recovery](../tests/execution.test.mjs) |
| Codex readiness, protocol, conversations and delivery acknowledgment | [server/codex.mjs](../server/codex.mjs) | [tests/protocol.test.mjs](../tests/protocol.test.mjs), [protocol fixture](../tests/fixtures/codex-protocol.mjs) |
| Verification commands, subprocess lifetime and process-group cleanup | [server/verification.mjs](../server/verification.mjs), [server/processes.mjs](../server/processes.mjs), [supervisor](../server/process-supervisor.mjs) | [tests/processes.test.mjs](../tests/processes.test.mjs), [execution tests](../tests/execution.test.mjs) |
| Team board and live activity UI | [client/src/main.jsx](../client/src/main.jsx) | [browser scenarios](../tests/browser/pilot.spec.mjs) |
| Independent seeded project and playable baseline | [server/sample.mjs](../server/sample.mjs), [sample-game/](../sample-game/) | [sample tests](../sample-game/tests/), [application seeding tests](../tests/app.test.mjs) |

Use those modules for current record shapes and protocol behavior; this map does not define another schema.

## Decisions that span modules

- A queued attempt records configuration and human input at admission. Automation-rule command overrides take precedence; absent overrides inherit current project commands. Later settings changes do not rewrite an admitted run. The execution tests “an actual workflow entry queues one atomic attempt…” and “project verification edits apply to inherited commands…” cover these boundaries.
- A task has at most one queued/active writer. Capacity gates admission to execution, and waiting requests retain a slot. Working copies and review branches belong to the task, so an explicit new attempt can resume its work and conversation. See “capacity admits three isolated writers…” and “waiting requests stay scoped to their run…” in the execution tests.
- Human messages are consumed only after Codex acknowledges turn input. A resumed attempt sends new instructions once; cancelled queued input remains available. See “resumed Codex sends only the current attempt input…” in the protocol tests and “resumed attempts send each new human instruction once…” in the execution tests.
- Store transactions persist before publishing events. An external Git or process effect cannot be made atomic by wrapping an in-memory mutation in a store transaction. In particular, Git can create a working copy before its reference is persisted. The exact registered orphan may be adopted on explicit retry; unexpected directory, branch, repository or base revision must be rejected. See the [review reference](review.md) for the crash case and its public-boundary tests.
- Restart marks unfinished runs interrupted, gathers actual retained Git evidence before serving the board, and never starts historical work automatically. Cancellation and shutdown stop owned processes while retaining work and evidence. See “abrupt host death recovers actual interrupted Git evidence…” and “restart retains interrupted work…” in the execution tests, plus the process tests.
- Verification must succeed and actual Git evidence must be available before Review. Human acceptance is a separate authenticated action attributed to a reviewer; it preserves the review branch rather than merging it. See “failed verification retains evidence…” and “a task cannot enter Review…” in the execution tests.

Fixture success establishes application behavior. Successful real-model evaluation, resumed context, and human acceptance remain tracked separately in [issue #17](https://github.com/komed-uth/Orches-AI-Kanban/issues/17).
