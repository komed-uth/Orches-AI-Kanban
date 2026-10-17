import test from 'node:test';
import assert from 'node:assert/strict';
import { statusOf, filterIssues, issueUrl } from '../docs/board.mjs';

const issue = (names = [], overrides = {}) => ({
  number: 7, title: 'Build the agent dashboard', state: 'open',
  labels: names.map(name => ({ name })), assignees: [{ login: 'agent-one' }], ...overrides,
});

test('unlabelled issues enter backlog; each supported status maps to its column', () => {
  assert.equal(statusOf(issue()), 'backlog');
  for (const status of ['backlog', 'ready', 'in-progress', 'blocked', 'done']) {
    assert.equal(statusOf(issue([`status:${status}`])), status);
  }
});
test('closed issues are done even with stale blocked labels', () => {
  assert.equal(statusOf(issue(['status:blocked'], { state: 'closed' })), 'done');
});
test('blocked wins conflicting open statuses and matching ignores case', () => {
  assert.equal(statusOf(issue(['status:in-progress', 'STATUS:BLOCKED'])), 'blocked');
});
test('search covers title, issue number, labels, and assignees; filters combine', () => {
  const data = [issue(['priority:high']), issue([], { number: 9, title: 'Other task', assignees: [] })];
  for (const query of ['DASHBOARD', '7', 'priority:high', 'agent-one']) {
    assert.deepEqual(filterIssues(data, query, ''), [data[0]]);
  }
  assert.deepEqual(filterIssues(data, '', 'agent-one'), [data[0]]);
  assert.deepEqual(filterIssues(data, 'Other', 'agent-one'), []);
  assert.equal(filterIssues(data, '  ', '').length, 2);
});
test('card links always target the configured GitHub repository', () => {
  assert.equal(issueUrl(7), 'https://github.com/komed-uth/Orches-AI-Kanban/issues/7');
});
