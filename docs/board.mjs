export const columns = [
  { id: 'backlog', name: 'Backlog', hint: 'Ideas & incoming work' },
  { id: 'ready', name: 'Ready', hint: 'Ready to pick up' },
  { id: 'in-progress', name: 'In progress', hint: 'Work happening now' },
  { id: 'blocked', name: 'Blocked', hint: 'Needs a hand' },
  { id: 'done', name: 'Done', hint: 'Shipped & completed' },
];

export function statusOf(issue) {
  if (issue.state === 'closed') return 'done';
  const names = new Set(issue.labels.map(label => label.name.toLowerCase()));
  // When labels conflict, surface blocked work first.
  return ['blocked', 'in-progress', 'ready', 'done', 'backlog']
    .find(status => names.has(`status:${status}`)) || 'backlog';
}

export function filterIssues(issues, query, assignee) {
  const search = query.trim().toLowerCase();
  return issues.filter(issue =>
    (!assignee || issue.assignees.some(person => person.login === assignee)) &&
    `${issue.number} ${issue.title} ${issue.labels.map(label => label.name).join(' ')} ${issue.assignees.map(person => person.login).join(' ')}`
      .toLowerCase().includes(search));
}

export function issueUrl(number) {
  return `https://github.com/komed-uth/Orches-AI-Kanban/issues/${Number(number)}`;
}
