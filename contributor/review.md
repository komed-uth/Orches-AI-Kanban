# Reviewing external effects and durable state

Use this reference when a change crosses a Git, process, Codex protocol, configuration, or persistence boundary. Follow the changed path through its caller and recovery path. Mechanical requirements belong in executable checks.

For each changed effect, explain the durable record that identifies it, the point at which it is acknowledged, the window where interruption leaves the effect and record disagreeing, and what an explicit retry or host restart observes. Connect that reasoning to an observable test (name and file), or state the concrete coverage gap and consequence. Review only boundaries affected by the diff; this is not a request for boilerplate on every PR.

## The escaped crash window

In [ensureWorktree](../server/worktrees.mjs), `git worktree add` can finish before [the scheduler](../server/scheduler.mjs) persists the task's working-copy reference. Killing the host there leaves a registered worktree and branch, but no saved task reference. A retry that merely repeats creation fails because the path/branch already exist.

The current recovery path adopts only the exact expected registration, repository, branch and starting revision, on explicit retry. It rejects an unrelated directory or mismatched registration rather than deleting or silently adopting it. Trace both the effect and the later store transaction; checking either alone misses the interruption window.

Public HTTP/application regressions in [tests/execution.test.mjs](../tests/execution.test.mjs):

- “an explicit retry adopts only its registered orphan after death during Git worktree creation” kills the host in that window and retries.
- “orphan recovery rejects unrelated directories and registrations with the wrong branch or base” covers unsafe adoption.
- “abrupt host death recovers actual interrupted Git evidence before serving the board” checks that post-interruption evidence is available, rather than trusting the last output event.

These tests cover the identified window, not every possible failure inside Git. If changing creation/adoption or capture behavior opens a different window, identify its expected recovery outcome and add coverage at the same public boundary.

## Other boundaries to follow when changed

| Changed area | Judgment and existing evidence |
| --- | --- |
| Verification settings or workflow entry | Distinguish inheritance from explicit overrides and queued snapshots. Confirm the task transition and admitted configuration persist together. Execution tests: “project verification edits apply to inherited commands while explicit automation overrides survive” and “an actual workflow entry queues one atomic attempt with its updated task and rule snapshot”. |
| Codex input delivery or conversation resume | Identify the actual successful delivery acknowledgment, then the persisted consumed-message marker. A write to stdin is not sufficient evidence of acceptance. Check retries do not repeat consumed instructions or lose cancelled queued input. [Protocol tests](../tests/protocol.test.mjs): “resumed Codex sends only the current attempt input and acknowledges successful turn delivery”; execution tests: “resumed attempts send each new human instruction once and retain instructions from cancelled queued work”. |
| Process lifetime, cancellation or shutdown | Follow the owned subprocess group through normal completion, abort, abrupt parent death, and host restart. Preserve working copies and explicit retry. [Process tests](../tests/processes.test.mjs): “host SIGKILL terminates an isolated writer that ignores SIGTERM”; protocol tests: “cancellation stops a held Codex turn before the run settles”; execution tests: “restart retains interrupted work, conversations and queue evidence without spontaneous execution”. |
| Evidence capture or Review/acceptance | Check current Git changes and verification are retained on failure/interruption; missing evidence cannot qualify for Review. Execution tests: “a task cannot enter Review when its actual Git evidence is unavailable” and “failed verification retains evidence and a new rework attempt must verify before attributed human acceptance”. |

See [architecture.md](architecture.md) for module ownership and authoritative implementations. An existing test name is a starting point: read its assertions against the changed behavior before claiming coverage.
