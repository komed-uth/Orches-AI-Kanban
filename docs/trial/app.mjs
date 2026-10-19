const KEY = "orches.pages-trial";
const VERSION = 1;
const sample = () => ({
  version: VERSION,
  projects: [{ id: "project-gem-trail", title: "Gem Trail" }],
  tasks: [
    {
      id: "task-gem-count",
      projectId: "project-gem-trail",
      title: "Show the remaining gem count",
      description: "Help players track progress.",
      acceptanceCriteria: [
        "The remaining gem count is visible.",
        "Collecting a gem updates the count.",
      ],
      priority: "high",
      prerequisites: [],
    },
    {
      id: "task-victory",
      projectId: "project-gem-trail",
      title: "Celebrate collecting every gem",
      description: "Build on the gem counter.",
      acceptanceCriteria: [
        "A victory message appears when the count reaches zero.",
      ],
      priority: "medium",
      prerequisites: ["task-gem-count"],
    },
    {
      id: "task-restart",
      projectId: "project-gem-trail",
      title: "Restart the game with the R key",
      description: "Independent keyboard improvement.",
      acceptanceCriteria: ["Pressing R restarts the game."],
      priority: "low",
      prerequisites: [],
    },
  ],
});
const $ = (id) => document.getElementById(id);
const editor = $("editor");
let state;
let editingId;
let temporary = false;
let pendingState = null;
let recoveryRequired = false;
function node(tag, text) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  return element;
}
function render() {
  $("tasks").replaceChildren(
    ...state.tasks.map((task) => {
      const card = node("article");
      card.dataset.taskId = task.id;
      card.append(
        node("h2", task.title),
        node("p", `Task: ${task.id} · Project: ${task.projectId}`),
        node("p", task.description),
        node("p", `Priority: ${task.priority}`),
      );
      const criteria = node("ol");
      criteria.append(
        ...task.acceptanceCriteria.map((text) => node("li", text)),
      );
      card.append(criteria);
      card.append(
        node(
          "p",
          `Prerequisites: ${task.prerequisites.map((id) => state.tasks.find((t) => t.id === id)?.title || id).join(", ") || "None"}`,
        ),
      );
      const edit = node("button", "Edit task");
      edit.type = "button";
      edit.addEventListener("click", () => openEditor(task));
      card.append(edit);
      return card;
    }),
  );
}
function openEditor(task) {
  editingId = task?.id;
  editor.reset();
  $("error").textContent = "";
  $("editor-heading").textContent = task ? "Edit task" : "New task";
  $("identity").textContent = task
    ? `Task: ${task.id} · Project: ${task.projectId}`
    : "Project: project-gem-trail";
  editor.elements.title.value = task?.title || "";
  editor.elements.description.value = task?.description || "";
  editor.elements.criteria.value = task?.acceptanceCriteria.join("\n") || "";
  editor.elements.priority.value = task?.priority || "medium";
  editor.elements.prerequisites.replaceChildren(
    ...state.tasks.map((t) => {
      const option = node("option", `${t.title} (${t.id})`);
      option.value = t.id;
      option.selected = !!task?.prerequisites.includes(t.id);
      return option;
    }),
  );
  editor.hidden = false;
  editor.elements.title.focus();
}
function validateReferences(tasks) {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  for (const task of tasks)
    for (const id of task.prerequisites) {
      if (id === task.id)
        throw new Error(
          `Task ${task.title} cannot depend on itself. Select another prerequisite.`,
        );
      if (!byId.has(id))
        throw new Error(
          `Prerequisite ${id} is missing. Choose an existing task.`,
        );
    }
  const visited = new Set(),
    active = new Set();
  function visit(task) {
    if (active.has(task.id))
      throw new Error(
        `Dependency cycle includes ${task.title}. Remove a prerequisite to break the cycle.`,
      );
    if (visited.has(task.id)) return;
    active.add(task.id);
    task.prerequisites.forEach((id) => visit(byId.get(id)));
    active.delete(task.id);
    visited.add(task.id);
  }
  tasks.forEach(visit);
}
function validateSaved(value) {
  if (!value || typeof value !== "object")
    throw new Error("Saved trial data is corrupt.");
  if (value.version !== VERSION)
    throw new Error("Saved trial version is incompatible with this page.");
  const text = (value) => typeof value === "string" && value.trim().length > 0;
  if (
    !Array.isArray(value.projects) ||
    !value.projects.length ||
    !value.projects.every((p) => p && text(p.id) && text(p.title)) ||
    new Set(value.projects.map((p) => p.id)).size !== value.projects.length
  )
    throw new Error("Saved project data is corrupt.");
  if (
    !Array.isArray(value.tasks) ||
    !value.tasks.every(
      (t) =>
        t &&
        text(t.id) &&
        value.projects.some((p) => p.id === t.projectId) &&
        text(t.title) &&
        typeof t.description === "string" &&
        Array.isArray(t.acceptanceCriteria) &&
        t.acceptanceCriteria.every(text) &&
        ["low", "medium", "high"].includes(t.priority) &&
        Array.isArray(t.prerequisites) &&
        t.prerequisites.every(text) &&
        new Set(t.prerequisites).size === t.prerequisites.length,
    ) ||
    new Set(value.tasks.map((t) => t.id)).size !== value.tasks.length
  )
    throw new Error(
      "Saved task data is corrupt or has a missing project reference.",
    );
  validateReferences(value.tasks);
  return value;
}
function controls() {
  $("new").disabled = recoveryRequired;
  $("reset").disabled = recoveryRequired;
  editor
    .querySelectorAll("input, textarea, select, button")
    .forEach((control) => {
      control.disabled = recoveryRequired;
    });
  $("tasks")
    .querySelectorAll("button")
    .forEach((control) => {
      control.disabled = recoveryRequired;
    });
}
function showRecovery(error) {
  recoveryRequired = true;
  $("recovery").hidden = false;
  $("recovery-message").textContent =
    `Trial storage could not be used: ${error.message} Your saved data has not been replaced. Retry storage, work temporarily without saving, or explicitly replace trial data with samples.`;
  $("persistence").textContent =
    "Local persistence failed. Changes are not saved; choose a recovery action.";
  controls();
}
function savedStatus() {
  $("persistence").textContent = temporary
    ? "Temporary mode: changes are not saved and will be lost on reload."
    : "Saved in this browser only.";
}
function completeRecovery() {
  recoveryRequired = false;
  $("recovery").hidden = true;
  controls();
  savedStatus();
}
function save(next) {
  if (!temporary) {
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch (error) {
      pendingState = next;
      showRecovery(error);
      return false;
    }
  }
  state = next;
  pendingState = null;
  render();
  savedStatus();
  return true;
}
function load() {
  try {
    const raw = localStorage.getItem(KEY);
    const next = raw === null ? sample() : validateSaved(JSON.parse(raw));
    if (raw === null) localStorage.setItem(KEY, JSON.stringify(next));
    state = next;
    temporary = false;
    render();
    completeRecovery();
  } catch (error) {
    showRecovery(error);
  }
}
$("new").addEventListener("click", () => openEditor());
$("cancel").addEventListener("click", () => {
  editor.hidden = true;
});
editor.addEventListener("submit", (event) => {
  event.preventDefault();
  const task = {
    id: editingId || crypto.randomUUID(),
    projectId:
      state.tasks.find((t) => t.id === editingId)?.projectId ||
      "project-gem-trail",
    title: editor.elements.title.value.trim(),
    description: editor.elements.description.value,
    acceptanceCriteria: editor.elements.criteria.value
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
    priority: editor.elements.priority.value,
    prerequisites: [...editor.elements.prerequisites.selectedOptions].map(
      (option) => option.value,
    ),
  };
  const tasks = editingId
    ? state.tasks.map((t) => (t.id === editingId ? task : t))
    : [...state.tasks, task];
  try {
    if (!task.title) throw new Error("Enter a task title.");
    validateReferences(tasks);
    if (save({ ...state, tasks })) editor.hidden = true;
  } catch (error) {
    $("error").textContent = error.message;
  }
});

function resetTrial() {
  if (
    confirm(
      "Replace all trial tasks with the three documented Gem Trail samples? This affects only this trial in this browser.",
    )
  ) {
    if (save(sample())) editor.hidden = true;
  }
}
$("reset").addEventListener("click", resetTrial);

$("retry").addEventListener("click", () => {
  temporary = false;
  if (pendingState) {
    if (save(pendingState)) {
      completeRecovery();
      editor.hidden = true;
    }
  } else load();
});
$("temporary").addEventListener("click", () => {
  temporary = true;
  state = pendingState || state || sample();
  pendingState = null;
  render();
  editor.hidden = true;
  completeRecovery();
});
$("recover-reset").addEventListener("click", () => {
  if (
    confirm(
      "Replace saved trial data with the three documented Gem Trail samples? Existing trial edits will be lost.",
    )
  ) {
    temporary = false;
    if (save(sample())) {
      completeRecovery();
      editor.hidden = true;
    }
  }
});
load();
