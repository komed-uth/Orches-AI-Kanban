import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { createCodexRunner } from './codex.mjs';
import { ensureWorktree, collectChanges } from './worktrees.mjs';
import { verifyRun } from './verification.mjs';

const occupied = new Set(['queued', 'starting', 'running', 'waiting', 'verifying']);
const now = () => new Date().toISOString();
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const copy = (value) => structuredClone(value);

// Every scheduling decision and its corresponding task mutation commits in the
// same synchronous SQLite transaction. No asynchronous work enters that boundary.
export function createScheduler({ store, dataDir, runnerFactory = createCodexRunner }) {
  const live = new Map();
  const ports = new Set();
  let closing = false;
  let pumping = false;
  const taskById = (id) => store.state.tasks.find((task) => task.id === id) ?? fail(404, 'Task not found.');
  const runById = (id) => store.state.runs.find((run) => run.id === id) ?? fail(404, 'Run not found.');
  const projectFor = (task) => store.state.projects.find((project) => project.id === task.projectId) ?? fail(404, 'Project not found.');
  const activeFor = (taskId) => store.state.runs.find((run) => run.taskId === taskId && occupied.has(run.state));
  const kindStatus = (project, kind) => project.statuses.find((status) => status.kind === kind)?.id;
  const event = (type, task, run, data = {}) => store.event(type, { ...data, taskId: task.id, projectId: task.projectId, ...(run ? { runId: run.id } : {}) });
  const changeState = (run, state, extra = {}) => {
    Object.assign(run, extra, { state });
    event('run.updated', taskById(run.taskId), run, { state });
  };
  function enqueue(task, actorId, requestKey) {
    if (closing) fail(503, 'The host is stopping. Start a new attempt after restart.');
    if (requestKey !== undefined && (typeof requestKey !== 'string' || !requestKey.trim() || requestKey.length > 200)) fail(400, 'Use a nonempty request key of at most 200 characters.');
    const duplicate = requestKey && store.state.runs.find((run) => run.taskId === task.id && run.requestKey === requestKey);
    if (duplicate) return duplicate;
    if (activeFor(task.id)) fail(409, 'This task already has queued or active work. Wait, send a queued follow-up, or cancel that attempt.');
    const project = projectFor(task);
    const messages = task.messages ??= [];
    const run = {
      id: randomUUID(), taskId: task.id, projectId: task.projectId, actorId,
      runner: store.state.settings.runner ?? 'codex', state: 'queued', requestKey,
      createdAt: now(), events: [], requests: [], verification: null,
      config: copy({ ...store.state.settings, ...project.rule, projectPath: project.path,
        revision: project.revision, buildCommand: project.rule?.buildCommand ?? project.buildCommand ?? '',
        testCommand: project.rule?.testCommand ?? project.testCommand ?? 'node --test' }),
      input: copy({ title: task.title, description: task.description, acceptanceCriteria: task.acceptanceCriteria,
        messages: messages.filter((message) => message.role === 'human') }),
    };
    for (const message of messages) if (message.queuedForNextAttempt) { message.queuedForNextAttempt = false; message.runId = run.id; }
    task.acceptedBy = null; task.acceptedAt = null;
    if (['done', 'review'].includes(project.statuses.find((status) => status.id === task.statusId)?.kind)) {
      task.statusId = kindStatus(project, 'ready') ?? kindStatus(project, 'execution') ?? task.statusId;
    }
    store.state.runs.push(run);
    event('run.queued', task, run, { state: 'queued' });
    event('task.updated', task, run);
    return run;
  }
  function start(taskId, actorId, requestKey) {
    const run = store.transaction(() => enqueue(taskById(taskId), actorId, requestKey));
    queueMicrotask(pump);
    return run;
  }
  function transition(taskId, statusId, actorId) {
    const task = store.transaction(() => {
      const task = taskById(taskId), project = projectFor(task);
      const status = project.statuses.find((status) => status.id === statusId) ?? fail(400, 'Unknown workflow status.');
      if (task.statusId === statusId) return task;
      if (status.kind === 'done' && store.state.runs.some((run) => run.taskId === task.id)) fail(409, 'AI work reaches Done only through human acceptance of verified work in Review.');
      if (activeFor(task.id)) fail(409, 'Cancel or finish the queued or active attempt before moving this task.');
      task.statusId = statusId;
      if (project.rule?.enabled && statusId === project.rule.triggerStatus) enqueue(task, actorId);
      event('task.updated', task);
      return task;
    });
    queueMicrotask(pump);
    return task;
  }
  async function capture(run) {
    const task = taskById(run.taskId);
    if (!task.worktree) return false;
    try {
      const changes = await collectChanges({ task });
      store.transaction(() => { Object.assign(run, changes, { evidenceError: null }); event('run.evidence', task, run, changes); });
      return true;
    } catch (error) {
      store.transaction(() => { run.evidenceError = error.message; event('run.evidence-error', task, run, { text: error.message }); });
      return false;
    }
  }
  function log(run, value) {
    if (!occupied.has(run.state)) return;
    const task = taskById(run.taskId);
    const entry = { ...copy(value), taskId: task.id, runId: run.id, createdAt: now() };
    store.transaction(() => {
      run.events.push(entry);
      if (['assistant', 'command'].includes(entry.type) && entry.text) (task.messages ??= []).push({
        id: randomUUID(), role: entry.type, text: entry.text, runId: run.id, createdAt: entry.createdAt,
      });
      event('run.output', task, run, entry);
    });
  }
  function request(run, value) {
    if (!['starting', 'running', 'waiting'].includes(run.state)) return;
    if (run.requests.some((request) => request.id === value.id)) return;
    store.transaction(() => {
      run.requests.push({ ...copy(value), state: 'pending', createdAt: now() });
      changeState(run, 'waiting');
      event('run.request', taskById(run.taskId), run, { request: run.requests.at(-1) });
    });
  }
  async function execute(run, control) {
    const task = taskById(run.taskId), project = projectFor(task);
    try {
      const worktree = await ensureWorktree({ task, project: { ...project, path: run.config.projectPath, revision: run.config.revision }, dataDir });
      store.transaction(() => { Object.assign(task, worktree); Object.assign(run, worktree); event('task.updated', task, run); });
      if (control.signal.aborted) throw new Error('Attempt stopped.');
      const resourceDir = join(resolve(dataDir), 'runs');
      await mkdir(resourceDir, { recursive: true });
      const tmpDir = await mkdtemp(join(resourceDir, `${run.id}-`));
      const port = await availablePort(ports);
      control.port = port;
      store.transaction(() => { Object.assign(run, { tmpDir, port }); });
      const runner = await runnerFactory({ run: copy(run), task: { ...copy(task), ...copy(run.input) }, project: copy(project),
        cwd: task.worktree, tmpDir, port, signal: control.signal,
        onEvent: (entry) => log(run, entry), onRequest: (entry) => request(run, entry),
        onConversation: (conversationId) => {
          store.transaction(() => { task.conversationId = conversationId; run.conversationId = conversationId; event('task.updated', task, run); });
        },
      });
      control.runner = runner;
      if (control.signal.aborted) throw new Error('Attempt stopped.');
      store.transaction(() => {
        changeState(run, run.requests.some((entry) => entry.state === 'pending') ? 'waiting' : 'running', { startedAt: now() });
        task.statusId = kindStatus(project, 'execution') ?? task.statusId;
        event('task.updated', task, run);
      });
      await runner.run();
      if (control.signal.aborted) throw new Error('Attempt stopped.');
      if (run.requests.some((entry) => entry.state === 'pending')) throw new Error('Codex finished while a human request was still pending. Retry after checking the protocol connection.');
      store.transaction(() => changeState(run, 'verifying'));
      const verification = await verifyRun({ run: copy(run), task: copy(task), project: copy(project), cwd: task.worktree,
        tmpDir, port, signal: control.signal, onEvent: (entry) => log(run, entry) });
      store.transaction(() => { run.verification = verification; event('run.verification', task, run, { verification }); });
      if (!verification.success) throw new Error('Verification failed. Inspect the recorded build/test command output before retrying.');
      if (control.signal.aborted) throw new Error('Attempt stopped.');
      if (!await capture(run)) throw new Error('Cannot collect Git review evidence. Restore the task working copy before retrying.');
      if (control.signal.aborted) throw new Error('Attempt stopped.');
      store.transaction(() => {
        changeState(run, 'completed', { finishedAt: now(), outcome: 'Verified; awaiting human review.' });
        task.statusId = project.statuses.some((status) => status.id === run.config.reviewStatus && status.kind === 'review')
          ? run.config.reviewStatus : kindStatus(project, 'review');
        task.error = null;
        event('task.updated', task, run);
      });
    } catch (error) {
      await capture(run);
      store.transaction(() => {
        const state = control.interrupted ? 'interrupted' : control.signal.aborted ? 'cancelled' : 'failed';
        const reason = control.interrupted ? 'Host stopped. Start a new attempt explicitly to continue.' : control.signal.aborted ? 'Cancelled by a team member. Changes and output are retained.' : error.message;
        changeState(run, state, { finishedAt: now(), error: reason, outcome: reason });
        task.statusId = kindStatus(project, 'blocked') ?? task.statusId;
        task.error = reason;
        event('task.updated', task, run);
      });
    } finally {
      if (control.port) ports.delete(control.port);
      live.delete(run.id);
      if (!closing) queueMicrotask(pump);
    }
  }
  function pump() {
    if (closing || pumping) return;
    pumping = true;
    try {
      const capacity = Number(store.state.settings.capacity) || 3;
      while (live.size < capacity) {
        const run = store.state.runs.find((run) => run.state === 'queued');
        if (!run) break;
        const controller = new AbortController();
        const control = { controller, signal: controller.signal };
        live.set(run.id, control);
        store.transaction(() => changeState(run, 'starting'));
        control.promise = execute(run, control);
      }
    } finally { pumping = false; }
  }
  function message(taskId, text, actorId) {
    if (typeof text !== 'string' || !text.trim() || text.length > 100000) fail(400, 'Enter a nonempty task message of at most 100000 characters.');
    const result = store.transaction(() => {
      const task = taskById(taskId);
      const active = activeFor(task.id);
      const message = { id: randomUUID(), role: 'human', text: text.trim(), actorId, createdAt: now(), queuedForNextAttempt: Boolean(active) };
      (task.messages ??= []).push(message);
      event('task.message', task, active, { message });
      if (active) return { message, queued: true, run: active };
      const run = enqueue(task, actorId);
      message.runId = run.id;
      return { message, queued: false, run };
    });
    queueMicrotask(pump);
    return result;
  }
  function cancel(runId, actorId) {
    const run = runById(runId);
    if (!occupied.has(run.state)) fail(409, 'This attempt has already ended.');
    store.transaction(() => {
      run.cancelledBy = actorId;
      run.cancelRequestedAt = now();
      if (run.state === 'queued') {
        const task = taskById(run.taskId);
        changeState(run, 'cancelled', { finishedAt: now(), outcome: 'Cancelled while queued.' });
        task.statusId = kindStatus(projectFor(task), 'blocked') ?? task.statusId;
        task.error = run.outcome;
        event('task.updated', task, run);
      } else event('run.cancel-requested', taskById(run.taskId), run);
    });
    live.get(run.id)?.controller.abort();
    queueMicrotask(pump);
    return run;
  }
  async function respond(runId, requestId, response, actorId) {
    const run = runById(runId);
    const pending = run.requests.find((entry) => String(entry.id) === String(requestId));
    if (run.state !== 'waiting' || run.cancelRequestedAt || !pending || pending.state !== 'pending' || !live.get(run.id)?.runner) fail(409, 'This request is not pending on the selected active run.');
    if (response === undefined || response === null) fail(400, 'A request response is required.');
    store.transaction(() => { pending.state = 'responding'; });
    try { await live.get(run.id).runner.respond(pending.id, response); }
    catch (error) { store.transaction(() => { pending.state = 'pending'; }); throw error; }
    store.transaction(() => {
      Object.assign(pending, { state: 'answered', response: copy(response), actorId, answeredAt: now() });
      const task = taskById(run.taskId);
      (task.messages ??= []).push({ id: randomUUID(), role: 'decision', text: JSON.stringify(response), actorId, runId: run.id, requestId: pending.id, createdAt: now() });
      if (run.state === 'waiting' && run.requests.every((entry) => entry.state === 'answered')) changeState(run, 'running');
      event('run.request-answered', task, run, { request: pending });
    });
    return pending;
  }
  function accept(taskId, actorId) {
    return store.transaction(() => {
      const task = taskById(taskId), project = projectFor(task);
      const latest = store.state.runs.filter((run) => run.taskId === task.id).at(-1);
      if (activeFor(task.id) || project.statuses.find((status) => status.id === task.statusId)?.kind !== 'review' || latest?.state !== 'completed' || !latest.verification?.success) fail(409, 'Accept only the latest successfully verified attempt from Review after all work has ended.');
      const done = kindStatus(project, 'done') ?? fail(409, 'Configure a Done status before accepting work.');
      task.statusId = done;
      task.acceptedBy = actorId; task.acceptedAt = now();
      event('task.accepted', task, latest, { actorId, acceptedAt: task.acceptedAt });
      return task;
    });
  }
  // A durable queue is evidence of intent, not permission to restart processes.
  store.transaction(() => {
    for (const run of store.state.runs) if (occupied.has(run.state)) {
      const task = taskById(run.taskId);
      changeState(run, 'interrupted', { finishedAt: now(), error: 'Host restarted. Start a new attempt explicitly to continue.' });
      task.statusId = kindStatus(projectFor(task), 'blocked') ?? task.statusId;
      task.error = run.error;
      event('task.updated', task, run);
    }
  });
  async function close() {
    closing = true;
    store.transaction(() => {
      for (const run of store.state.runs) if (run.state === 'queued') {
        const task = taskById(run.taskId);
        changeState(run, 'interrupted', { finishedAt: now(), error: 'Host stopped before this queued attempt started. Retry explicitly.' });
        task.statusId = kindStatus(projectFor(task), 'blocked') ?? task.statusId;
        task.error = run.error;
        event('task.updated', task, run);
      }
    });
    const controls = [...live.values()];
    for (const control of controls) { control.interrupted = true; control.controller.abort(); }
    await Promise.allSettled(controls.map((control) => control.promise));
  }
  return { start, transition, message, cancel, respond, accept, pump, close };
}

async function availablePort(claimed) {
  for (;;) {
    const socket = createServer();
    await new Promise((resolve, reject) => { socket.once('error', reject); socket.listen(0, '127.0.0.1', resolve); });
    const port = socket.address().port;
    await new Promise((resolve, reject) => socket.close((error) => error ? reject(error) : resolve()));
    if (!claimed.has(port)) { claimed.add(port); return port; }
  }
}
