import { columns, statusOf, filterIssues, issueUrl } from './board.mjs';

const board = document.querySelector('#board');
const search = document.querySelector('#search');
const assignee = document.querySelector('#assignee');
const status = document.querySelector('#status');
const refresh = document.querySelector('#refresh');
let snapshot = null;
let busy = false;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function card(issue) {
  const node = element('a', 'card');
  node.href = issueUrl(issue.number);
  node.target = '_blank';
  node.rel = 'noopener noreferrer';
  node.append(element('span', 'issue-number', `#${issue.number}`), element('h3', '', issue.title));
  const tags = element('div', 'tags');
  for (const label of issue.labels.filter(label => !label.name.startsWith('status:'))) {
    tags.append(element('span', 'tag', label.name));
  }
  node.append(tags);
  const bottom = element('div', 'card-bottom');
  bottom.append(element('span', '', issue.assignees.map(person => `@${person.login}`).join(', ') || 'Unassigned'));
  const date = element('time', '', new Date(issue.updated_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
  date.dateTime = issue.updated_at;
  date.title = `Updated ${new Date(issue.updated_at).toLocaleString()}`;
  bottom.append(date);
  node.append(bottom);
  return node;
}

function render() {
  const issues = filterIssues(snapshot?.issues || [], search.value, assignee.value);
  board.replaceChildren();
  for (const column of columns) {
    const tasks = issues.filter(issue => statusOf(issue) === column.id);
    const section = element('section', `column ${column.id}`);
    const heading = element('div', 'column-heading');
    heading.append(element('h2', '', column.name), element('span', 'count', tasks.length));
    section.append(heading, element('p', 'column-hint', column.hint));
    tasks.forEach(issue => section.append(card(issue)));
    if (!tasks.length) section.append(element('div', 'empty', snapshot ? 'No tasks here' : 'Waiting for data'));
    board.append(section);
  }
  document.querySelector('#total').textContent = `${issues.length} / ${snapshot?.issues.length || 0} tasks`;
}

async function load() {
  if (busy) return;
  busy = true;
  refresh.disabled = true;
  try {
    const response = await fetch('./issues.json', { cache: 'no-store', signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data.issues) || !data.generated_at || !Number.isFinite(Date.parse(data.generated_at))) {
      throw new Error('Invalid task snapshot');
    }
    snapshot = data;
    const selected = assignee.value;
    assignee.replaceChildren(new Option('Everyone', ''));
    const people = [...new Set(data.issues.flatMap(issue => issue.assignees.map(person => person.login)))].sort();
    people.forEach(login => assignee.add(new Option(`@${login}`, login)));
    if (people.includes(selected)) assignee.value = selected;
    status.textContent = `Snapshot: ${new Date(data.generated_at).toLocaleString()} · GitHub publishing may take a few minutes`;
    status.className = '';
    render();
  } catch (error) {
    status.textContent = `${snapshot ? 'Showing last loaded tasks.' : 'Tasks unavailable.'} Could not refresh (${error.message}). Try again shortly.`;
    status.className = 'error';
  } finally {
    busy = false;
    refresh.disabled = false;
  }
}

search.addEventListener('input', render);
assignee.addEventListener('change', render);
refresh.addEventListener('click', load);
document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
setInterval(() => { if (!document.hidden) load(); }, 60000);
render();
load();
