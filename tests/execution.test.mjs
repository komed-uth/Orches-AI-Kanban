import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createApplication } from '../server/app.mjs';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'orches-execution-'));
  const repo = join(root, 'source');
  await mkdir(repo);
  execFileSync('git', ['init', '-q', repo]);
  execFileSync('git', ['-C', repo, 'config', 'user.email', 'test@example.test']);
  execFileSync('git', ['-C', repo, 'config', 'user.name', 'Test']);
  await writeFile(join(repo, 'shared.txt'), 'original\n');
  execFileSync('git', ['-C', repo, 'add', '.']);
  execFileSync('git', ['-C', repo, 'commit', '-qm', 'initial']);
  const sessions = new Map();
  const arrivals = new Map();
  const runnerFactory = (context) => {
    const gate = deferred();
    const session = { ...context, gate, responses: [] };
    sessions.set(context.task.id, session);
    arrivals.get(context.task.id)?.resolve(session);
    context.signal.addEventListener('abort', () => gate.reject(new Error('stopped')), { once: true });
    return {
      async run() { context.onConversation(`conversation-${context.task.id}`); await gate.promise; },
      respond(id, response) { session.responses.push({ id, response }); },
    };
  };
  let application, server, base, cookie;
  async function open() {
    application = await createApplication({ dataDir: join(root, 'data'), runnerFactory });
    server = createServer(application.app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  }
  async function close() {
    await application.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  await open();
  t.after(async () => { await close(); await rm(root, { recursive: true, force: true }); });
  async function api(path, body, method = body === undefined ? 'GET' : 'POST') {
    const response = await fetch(base + '/api' + path, {
      method, headers: { ...(cookie ? { Cookie: cookie } : {}), 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    return { status: response.status, body: await response.json() };
  }
  assert.equal((await api('/setup', { username: 'owner', password: 'safe-password-123' })).status, 201);
  const created = await api('/projects', { name: 'Fixture', path: repo, revision: 'HEAD', testCommand: 'node -e "console.log(\'verified\')"' });
  assert.equal(created.status, 201);
  const project = created.body.project;
  async function task(title = 'Change a file') {
    const result = await api('/tasks', { projectId: project.id, title, description: 'Implement it', acceptanceCriteria: 'Tests pass' });
    assert.equal(result.status, 201);
    return result.body.task;
  }
  async function started(id) {
    if (sessions.has(id)) return sessions.get(id);
    const arrival = deferred(); arrivals.set(id, arrival);
    let timeout;
    try { return await Promise.race([arrival.promise, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('runner did not start')), 5000); })]); }
    finally { clearTimeout(timeout); }
  }
  async function until(id, state) {
    for (let attempt = 0; attempt < 300; attempt++) {
      const result = (await api(`/tasks/${id}`)).body;
      if (result.runs.at(-1)?.state === state) return result;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.fail(`Task did not reach ${state}: ${JSON.stringify((await api(`/tasks/${id}`)).body)}`);
  }
  return { api, task, started, until, project, repo, sessions, close, open };
}

test('a task streams attributed evidence, verifies actual isolated changes and reaches Review', async (t) => {
  const f = await fixture(t);
  const task = await f.task();
  const result = await f.api(`/tasks/${task.id}/run`, { requestKey: 'start-once' });
  assert.equal(result.status, 200);
  const session = await f.started(task.id);
  await writeFile(join(session.cwd, 'shared.txt'), 'task change\n');
  await writeFile(join(session.cwd, 'new.txt'), 'new file\n');
  session.onEvent({ type: 'assistant', text: 'Implemented the change.' });
  session.onEvent({ type: 'command', text: 'editing shared.txt' });
  session.gate.resolve();
  const finished = await f.until(task.id, 'completed');
  assert.equal(finished.task.statusId, f.project.statuses.find((s) => s.kind === 'review').id);
  assert.equal(finished.task.conversationId, `conversation-${task.id}`);
  const run = finished.runs.at(-1);
  assert.ok(run.verification.results.every((entry) => entry.exitCode === 0));
  assert.match(run.diff, /task change/);
  assert.match(run.diff, /new file/);
  assert.ok(run.files.some((entry) => (typeof entry === 'string' ? entry : entry.path) === 'new.txt'));
  assert.equal(await readFile(join(f.repo, 'shared.txt'), 'utf8'), 'original\n');
  const snapshot = (await f.api('/snapshot')).body;
  assert.ok(snapshot.events.some((event) => event.runId === run.id && event.taskId === task.id && event.text === 'Implemented the change.'));
});
