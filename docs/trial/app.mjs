const KEY = 'orches.pages-trial';
const VERSION = 1;
const sample = () => ({version: VERSION, projects: [{id: 'project-gem-trail', title: 'Gem Trail'}], tasks: [
  {id: 'task-gem-count', projectId: 'project-gem-trail', title: 'Show the remaining gem count', description: 'Help players track progress.', acceptanceCriteria: ['The remaining gem count is visible.', 'Collecting a gem updates the count.'], priority: 'high', prerequisites: []},
  {id: 'task-victory', projectId: 'project-gem-trail', title: 'Celebrate collecting every gem', description: 'Build on the gem counter.', acceptanceCriteria: ['A victory message appears when the count reaches zero.'], priority: 'medium', prerequisites: ['task-gem-count']},
  {id: 'task-restart', projectId: 'project-gem-trail', title: 'Restart the game with the R key', description: 'Independent keyboard improvement.', acceptanceCriteria: ['Pressing R restarts the game.'], priority: 'low', prerequisites: []},
]});
const $ = (id) => document.getElementById(id);
const editor = $('editor');
let state;
let editingId;
function node(tag, text) { const element = document.createElement(tag); if (text !== undefined) element.textContent = text; return element; }
function render() {
  $('tasks').replaceChildren(...state.tasks.map(task => {
    const card = node('article'); card.dataset.taskId = task.id;
    card.append(node('h2', task.title), node('p', `Task: ${task.id} · Project: ${task.projectId}`), node('p', task.description), node('p', `Priority: ${task.priority}`));
    const criteria = node('ol'); criteria.append(...task.acceptanceCriteria.map(text => node('li', text))); card.append(criteria);
    card.append(node('p', `Prerequisites: ${task.prerequisites.map(id => state.tasks.find(t => t.id === id)?.title || id).join(', ') || 'None'}`));
    const edit = node('button', 'Edit task'); edit.type = 'button'; edit.addEventListener('click', () => openEditor(task)); card.append(edit); return card;
  }));
}
function openEditor(task) {
  editingId = task?.id;
  editor.reset(); $('error').textContent = ''; $('editor-heading').textContent = task ? 'Edit task' : 'New task';
  $('identity').textContent = task ? `Task: ${task.id} · Project: ${task.projectId}` : 'Project: project-gem-trail';
  editor.elements.title.value = task?.title || '';
  editor.elements.description.value = task?.description || '';
  editor.elements.criteria.value = task?.acceptanceCriteria.join('\n') || '';
  editor.elements.priority.value = task?.priority || 'medium';
  editor.elements.prerequisites.replaceChildren(...state.tasks.map(t => {
    const option = node('option', `${t.title} (${t.id})`); option.value = t.id; option.selected = !!task?.prerequisites.includes(t.id); return option;
  }));
  editor.hidden = false; editor.elements.title.focus();
}
function validateReferences(tasks) {
  const byId = new Map(tasks.map(task => [task.id, task]));
  for (const task of tasks) for (const id of task.prerequisites) {
    if (id === task.id) throw new Error(`Task ${task.title} cannot depend on itself. Select another prerequisite.`);
    if (!byId.has(id)) throw new Error(`Prerequisite ${id} is missing. Choose an existing task.`);
  }
  const visited = new Set(), active = new Set();
  function visit(task) {
    if (active.has(task.id)) throw new Error(`Dependency cycle includes ${task.title}. Remove a prerequisite to break the cycle.`);
    if (visited.has(task.id)) return;
    active.add(task.id);
    task.prerequisites.forEach(id => visit(byId.get(id)));
    active.delete(task.id); visited.add(task.id);
  }
  tasks.forEach(visit);
}
function save(next) { localStorage.setItem(KEY, JSON.stringify(next)); state = next; $('persistence').textContent = 'Saved in this browser only.'; render(); return true; }
$('new').addEventListener('click', () => openEditor());
$('cancel').addEventListener('click', () => { editor.hidden = true; });
editor.addEventListener('submit', event => {
  event.preventDefault();
  const task = {id: editingId || crypto.randomUUID(), projectId: 'project-gem-trail', title: editor.elements.title.value.trim(), description: editor.elements.description.value, acceptanceCriteria: editor.elements.criteria.value.split('\n').map(line => line.trim()).filter(Boolean), priority: editor.elements.priority.value, prerequisites: [...editor.elements.prerequisites.selectedOptions].map(option => option.value)};
  const tasks = editingId ? state.tasks.map(t => t.id === editingId ? task : t) : [...state.tasks, task];
  try {
    if (!task.title) throw new Error('Enter a task title.');
    validateReferences(tasks);
    if (save({...state, tasks})) editor.hidden = true;
  } catch (error) { $('error').textContent = error.message; }
});
state = JSON.parse(localStorage.getItem(KEY) || 'null') || sample(); render(); $('persistence').textContent = 'Saved in this browser only.';
