const KEY = "orches.pages-trial";
const VERSION = 2;
const sample = () => ({
  version: VERSION,
  capacity: 2,
  projects: [
    {
      id: "project-gem-trail",
      title: "Gem Trail",
      repository: "demo/gem-trail",
      checkCommand: "node --test tests/*.test.mjs",
      buildCommand: "",
    },
  ],
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
      status: "backlog",
      attempt: null,
      merged: false,
      configuration: null,
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
      status: "backlog",
      attempt: null,
      merged: false,
      configuration: null,
    },
    {
      id: "task-restart",
      projectId: "project-gem-trail",
      title: "Restart the game with the R key",
      description: "Independent keyboard improvement.",
      acceptanceCriteria: ["Pressing R restarts the game."],
      priority: "low",
      prerequisites: [],
      status: "backlog",
      attempt: null,
      merged: false,
      configuration: null,
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
let simulationPaused = false;
const readinessErrors = new Map();
function node(tag, text) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  return element;
}
function readiness(task, next = state) {
  const project =
    task.configuration || next.projects.find((p) => p.id === task.projectId);
  return [
    !task.acceptanceCriteria.length && "Add at least one acceptance criterion.",
    !project.repository.trim() && "Configure a simulated repository.",
    !project.checkCommand.trim() && "Configure a test/check command.",
  ].filter(Boolean);
}
function admit(next) {
  if (simulationPaused) return next;
  for (const task of next.tasks) {
    if (task.status !== "ready" || readiness(task, next).length) continue;
    if (
      task.prerequisites.some(
        (id) => !next.tasks.find((t) => t.id === id).merged,
      )
    )
      continue;
    if (next.tasks.filter((t) => t.status === "active").length >= next.capacity)
      continue;
    task.status = "active";
    task.attempt = { id: crypto.randomUUID(), status: "running" };
  }
  return next;
}
function waitingReason(task) {
  if (task.status !== "ready") return "";
  const errors = readiness(task);
  if (errors.length) return `Configuration error: ${errors.join(" ")}`;
  const unmerged = task.prerequisites
    .map((id) => state.tasks.find((t) => t.id === id))
    .filter((t) => !t.merged);
  if (unmerged.length)
    return `Waiting for prerequisite merge: ${unmerged.map((t) => t.title).join(", ")}`;
  if (simulationPaused)
    return "Waiting for simulation recovery: choose Resume simulation.";
  return `Waiting for capacity: ${state.tasks.filter((t) => t.status === "active").length}/${state.capacity} slots occupied.`;
}
function progress(task, action) {
  if (simulationPaused || recoveryRequired) return;
  const next = structuredClone(state);
  const changed = next.tasks.find((t) => t.id === task.id);
  if (
    action === "wait" &&
    changed.status === "active" &&
    changed.attempt.status === "running"
  )
    changed.attempt.status = "waiting";
  else if (
    action === "answer" &&
    changed.status === "active" &&
    changed.attempt.status === "waiting"
  )
    changed.attempt.status = "running";
  else if (
    action === "accept" &&
    changed.status === "active" &&
    changed.attempt.status === "running"
  ) {
    changed.status = "accepted";
    changed.attempt.status = "complete";
  } else if (action === "merge" && changed.status === "accepted")
    changed.merged = true;
  else return;
  save(admit(next));
}
function render() {
  $("simulation-recovery").hidden = !simulationPaused;
  const project = state.projects[0];
  for (const key of ["repository", "checkCommand", "buildCommand"])
    $("settings").elements[key].value = project[key];
  $("settings").elements.capacity.value = state.capacity;
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
      edit.disabled = task.status !== "backlog";
      card.append(edit);
      card.append(
        node(
          "p",
          `Status: ${{ backlog: "Backlog", ready: "Ready", active: "In progress", accepted: "Accepted" }[task.status]}`,
        ),
      );
      if (task.configuration)
        card.append(
          node("p", `Authorized repository: ${task.configuration.repository}`),
          node(
            "p",
            `Authorized test/check: ${task.configuration.checkCommand}`,
          ),
          node(
            "p",
            `Authorized build: ${task.configuration.buildCommand || "None"}`,
          ),
        );
      if (task.status !== "backlog")
        card.append(
          node(
            "p",
            "Execution authorization retained; task editing is locked.",
          ),
        );
      if (task.attempt)
        card.append(
          node("p", `Attempt 1 · ${task.attempt.id} · ${task.attempt.status}`),
        );
      const errors = node("p", (readinessErrors.get(task.id) || []).join(" "));
      errors.setAttribute("role", "alert");
      card.append(errors);
      const ready = node("button", "Move to Ready");
      ready.type = "button";
      ready.addEventListener("click", () => {
        if (task.status !== "backlog") return;
        const errors = readiness(task);
        readinessErrors.set(task.id, errors);
        if (errors.length) {
          render();
          return;
        }
        const next = structuredClone(state);
        const changed = next.tasks.find((t) => t.id === task.id);
        changed.status = "ready";
        const project = next.projects.find((p) => p.id === task.projectId);
        changed.configuration = {
          repository: project.repository,
          checkCommand: project.checkCommand,
          buildCommand: project.buildCommand,
        };
        save(admit(next));
      });
      ready.disabled = simulationPaused && task.status === "backlog";
      card.append(ready);
      if (task.status === "ready") card.append(node("p", waitingReason(task)));
      card.append(
        node("p", `Prerequisite merge: ${task.merged ? "Merged" : "Unmerged"}`),
      );
      if (task.status === "active") {
        const waiting = task.attempt.status === "waiting";
        if (waiting)
          card.append(node("p", "Waiting for answer (slot retained)"));
        const answer = node(
          "button",
          waiting ? "Simulate answer received" : "Simulate waiting for answer",
        );
        answer.type = "button";
        answer.disabled = simulationPaused;
        answer.addEventListener("click", () =>
          progress(task, waiting ? "answer" : "wait"),
        );
        card.append(answer);
      }
      if (
        (task.status === "active" && task.attempt.status === "running") ||
        (task.status === "accepted" && !task.merged)
      ) {
        const action = node(
          "button",
          task.status === "active"
            ? "Simulate acceptance"
            : "Simulate prerequisite merge",
        );
        action.type = "button";
        action.disabled = simulationPaused;
        action.addEventListener("click", () =>
          progress(task, task.status === "active" ? "accept" : "merge"),
        );
        card.append(action);
      }
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
  if (value.version === 1) {
    value = {
      ...value,
      version: VERSION,
      capacity: 2,
      projects: value.projects?.map((p) => ({
        ...p,
        repository: "demo/gem-trail",
        checkCommand: "node --test tests/*.test.mjs",
        buildCommand: "",
      })),
      tasks: value.tasks?.map((t) => ({
        ...t,
        status: "backlog",
        attempt: null,
        merged: false,
        configuration: null,
      })),
    };
  }
  if (value.version !== VERSION)
    throw new Error("Saved trial version is incompatible with this page.");
  const text = (value) => typeof value === "string" && value.trim().length > 0;
  if (
    !Array.isArray(value.projects) ||
    !value.projects.length ||
    !value.projects.every(
      (p) =>
        p &&
        text(p.id) &&
        text(p.title) &&
        [p.repository, p.checkCommand, p.buildCommand].every(
          (v) => typeof v === "string",
        ),
    ) ||
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
  if (
    !Number.isInteger(value.capacity) ||
    value.capacity < 1 ||
    value.capacity > 100
  )
    throw new Error("Saved capacity is corrupt.");
  for (const task of value.tasks) {
    if (
      (task.status === "backlog"
        ? task.configuration !== null
        : !task.configuration ||
          !text(task.configuration.repository) ||
          !text(task.configuration.checkCommand) ||
          typeof task.configuration.buildCommand !== "string" ||
          !task.acceptanceCriteria.length) ||
      !["backlog", "ready", "active", "accepted"].includes(task.status) ||
      typeof task.merged !== "boolean" ||
      (task.merged && task.status !== "accepted") ||
      (["active", "accepted"].includes(task.status)
        ? !task.attempt ||
          !text(task.attempt.id) ||
          !["running", "waiting", "complete"].includes(task.attempt.status) ||
          (task.status === "accepted") !== (task.attempt.status === "complete")
        : task.attempt !== null)
    )
      throw new Error("Saved simulation state is corrupt.");
  }
  validateReferences(value.tasks);
  return value;
}
function controls() {
  $("new").disabled = recoveryRequired;
  $("reset").disabled = recoveryRequired;
  $("resume").disabled = recoveryRequired;
  $("settings")
    .querySelectorAll("input, button")
    .forEach((control) => {
      control.disabled = recoveryRequired;
    });
  editor
    .querySelectorAll("input, textarea, select, button")
    .forEach((control) => {
      control.disabled = recoveryRequired;
    });
  $("tasks")
    .querySelectorAll("button")
    .forEach((control) => {
      control.disabled =
        recoveryRequired ||
        (simulationPaused &&
          (control.textContent.startsWith("Simulate ") ||
            control.textContent === "Move to Ready")) ||
        (control.textContent === "Edit task" &&
          state.tasks.find(
            (t) => t.id === control.closest("article").dataset.taskId,
          ).status !== "backlog");
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
function adoptState(next) {
  state = next;
  readinessErrors.clear();
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
  adoptState(next);
  if (state.tasks.every((t) => t.status === "backlog"))
    simulationPaused = false;
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
    adoptState(next);
    simulationPaused = next.tasks.some(
      (t) => t.status === "ready" || t.status === "active",
    );
    temporary = false;
    render();
    completeRecovery();
  } catch (error) {
    showRecovery(error);
  }
}
$("resume").addEventListener("click", () => {
  simulationPaused = false;
  save(admit(structuredClone(state)));
});
$("settings").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = $("settings").elements;
  const capacity = Number(form.capacity.value);
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 100) {
    $("settings-error").textContent =
      "Enter a whole demo capacity from 1 to 100.";
    return;
  }
  $("settings-error").textContent = "";
  readinessErrors.clear();
  const next = structuredClone(state);
  next.capacity = capacity;
  for (const key of ["repository", "checkCommand", "buildCommand"])
    next.projects[0][key] = form[key].value.trim();
  save(admit(next));
});
$("new").addEventListener("click", () => openEditor());
$("cancel").addEventListener("click", () => {
  editor.hidden = true;
});
editor.addEventListener("submit", (event) => {
  event.preventDefault();
  if (
    editingId &&
    state.tasks.find((t) => t.id === editingId)?.status !== "backlog"
  ) {
    $("error").textContent =
      "Authorized tasks cannot be edited. Their execution configuration is retained.";
    return;
  }
  const task = {
    ...(state.tasks.find((t) => t.id === editingId) || {
      status: "backlog",
      attempt: null,
      merged: false,
      configuration: null,
    }),
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
    readinessErrors.delete(task.id);
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
  adoptState(pendingState || state || sample());
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
