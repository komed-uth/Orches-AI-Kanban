import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

const activeStates = ["queued", "starting", "running", "waiting", "verifying"];
const reservedStates = activeStates.filter((state) => state !== "queued");
const disciplines = [
  "programming",
  "qa",
  "design",
  "art",
  "animation",
  "audio",
];
async function api(path, method = "GET", body) {
  const response = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw Object.assign(
      new Error(
        data.error || data.message || `Request failed (${response.status})`,
      ),
      { status: response.status },
    );
  return data;
}
const date = (value) => (value ? new Date(value).toLocaleString() : "—");
const stringify = (value) =>
  typeof value === "string" ? value : JSON.stringify(value, null, 2);
function Field({ label, children, ...props }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children || <input {...props} />}
    </label>
  );
}
function Badge({ state }) {
  return (
    <span className={`badge ${state || ""}`}>{state || "No attempt"}</span>
  );
}
function ErrorBox({ error }) {
  return error ? (
    <div className="error" role="alert">
      {error}
    </div>
  ) : null;
}
function App() {
  const [auth, setAuth] = useState(null),
    [snapshot, setSnapshot] = useState(null),
    [error, setError] = useState(""),
    [connection, setConnection] = useState("connecting");
  const [projectId, setProjectId] = useState(""),
    [page, setPage] = useState("board"),
    [taskId, setTaskId] = useState(null),
    [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const stream = useRef(null);
  const mounted = useRef(true);
  const refresh = useCallback(async () => {
    try {
      const data = await api("/snapshot");
      if (mounted.current) {
        setSnapshot(data);
        setAuth("signed-in");
        setError("");
      }
      return data;
    } catch (e) {
      if (mounted.current) {
        if (e.status === 401) {
          setSnapshot(null);
          const setup = await api("/setup");
          setAuth(setup.needsSetup ? "setup" : "login");
        } else setError(e.message);
      }
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    if (new URLSearchParams(location.search).has("invite")) setAuth("join");
    else refresh();
    return () => {
      mounted.current = false;
    };
  }, [refresh]);
  useEffect(() => {
    if (auth !== "signed-in") return;
    let closed = false,
      reconnecting = false,
      running = false,
      dirty = false;
    const reconcile = async () => {
      if (running) {
        dirty = true;
        return;
      }
      running = true;
      do {
        dirty = false;
        await refresh();
      } while (dirty && !closed);
      running = false;
    };
    let source;
    let cursor = snapshot?.cursor || 0;
    const connect = () => {
      if (closed) return;
      source?.close();
      source = new EventSource(`/api/events?after=${cursor}`);
      stream.current = source;
      source.onopen = () => {
        if (closed) return;
        setConnection("live");
        if (reconnecting) reconcile();
        reconnecting = true;
      };
      source.onmessage = (event) => {
        cursor = Number(event.lastEventId) || cursor;
        reconcile();
      };
      source.onerror = () => {
        if (!closed) {
          setConnection("reconnecting");
          reconcile();
        }
      };
    };
    const offline = () => {
      source?.close();
      setConnection("reconnecting");
    };
    window.addEventListener("offline", offline);
    window.addEventListener("online", connect);
    if (navigator.onLine) connect();
    else offline();
    return () => {
      closed = true;
      source?.close();
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", connect);
      stream.current = null;
    };
  }, [auth, refresh]);
  async function mutate(path, method, body) {
    setBusy(true);
    setError("");
    try {
      const result = await api(path, method, body);
      await refresh();
      return result;
    } catch (e) {
      setError(e.message);
      throw e;
    } finally {
      setBusy(false);
    }
  }
  if (!auth)
    return (
      <main className="loading" role="status">
        Opening your workspace…
        <ErrorBox error={error} />
      </main>
    );
  if (auth !== "signed-in")
    return <Auth mode={auth} setMode={setAuth} onSuccess={refresh} />;
  if (!snapshot)
    return (
      <main className="loading">
        Loading board…
        <ErrorBox error={error} />
      </main>
    );
  const projects = snapshot.projects || [],
    project = projects.find((p) => p.id === projectId) || projects[0];
  const tasks = (snapshot.tasks || []).filter(
      (t) => t.projectId === project?.id,
    ),
    runs = snapshot.runs || [];
  const currentTask = (snapshot.tasks || []).find((t) => t.id === taskId);
  const used = runs.filter((r) => reservedStates.includes(r.state)).length;
  const owner = snapshot.user?.role === "owner";
  return (
    <div className="app">
      <header className="topbar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setPage("board");
          }}
        >
          <span className="mark">O</span>orches
          <span className="brand-note">TEAM WORKSPACE</span>
        </a>
        <div className="account">
          <span>
            {snapshot.user?.username} <small>{snapshot.user?.role}</small>
          </span>
          <button
            className="quiet"
            onClick={async () => {
              try {
                await api("/logout", "POST");
                stream.current?.close();
                setSnapshot(null);
                setAuth("login");
              } catch (e) {
                setError(e.message);
              }
            }}
          >
            Sign out
          </button>
        </div>
      </header>
      <div className="workspace">
        <aside className="sidebar">
          <div className="section-label">WORKSPACE</div>
          <Field label="Project">
            <select
              aria-label="Project"
              value={project?.id || ""}
              onChange={(e) => setProjectId(e.target.value)}
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <nav aria-label="Workspace">
            <button
              className={page === "board" ? "selected" : ""}
              onClick={() => setPage("board")}
            >
              ▦ <span>Task board</span>
            </button>
            <button
              className={page === "activity" ? "selected" : ""}
              onClick={() => setPage("activity")}
            >
              ◉ <span>Agent activity</span>
              <span className="count">{used}</span>
            </button>
            {owner && (
              <button
                className={page === "settings" ? "selected" : ""}
                onClick={() => setPage("settings")}
              >
                ⚙ <span>Settings & team</span>
              </button>
            )}
          </nav>
          <div className="host-state">
            <div>
              <span className={`dot ${connection === "live" ? "live" : ""}`} />
              {connection === "live"
                ? "Live updates connected"
                : "Reconnecting to host…"}
            </div>
            <p>
              {used} / {snapshot.settings?.capacity ?? 3} agent slots in use
            </p>
            <Badge state={snapshot.settings?.runner || "codex"} />
            <small>Changes stay on task branches for human review.</small>
          </div>
        </aside>
        <main className="content">
          <ErrorBox error={error} />
          {page === "board" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">PROJECT BOARD</div>
                  <h1>{project?.name || "Your projects"}</h1>
                  <p>
                    Plan together. Run independent agents. Review every change.{" "}
                    <a href="/sample-game/" target="_blank" rel="noreferrer">
                      Play sample game ↗
                    </a>
                  </p>
                </div>
                <button
                  className="primary"
                  onClick={() => setCreating(true)}
                  disabled={!project}
                >
                  + New task
                </button>
              </div>
              <div className="board" aria-label="Task board">
                {(project?.statuses || []).map((status) => (
                  <section
                    className="column"
                    key={status.id}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      const id = e.dataTransfer.getData("text/plain");
                      if (tasks.some((t) => t.id === id))
                        mutate(`/tasks/${id}`, "PATCH", {
                          statusId: status.id,
                        }).catch(() => {});
                    }}
                  >
                    <div className="column-heading">
                      <h2>{status.name}</h2>
                      <span>
                        {tasks.filter((t) => t.statusId === status.id).length}
                      </span>
                    </div>
                    <div className="cards">
                      {tasks
                        .filter((t) => t.statusId === status.id)
                        .map((task) => (
                          <TaskCard
                            key={task.id}
                            task={task}
                            run={runs
                              .filter((r) => r.taskId === task.id)
                              .at(-1)}
                            project={project}
                            users={snapshot.users}
                            open={() => setTaskId(task.id)}
                            move={(statusId) =>
                              mutate(`/tasks/${task.id}`, "PATCH", {
                                statusId,
                              }).catch(() => {})
                            }
                          />
                        ))}
                      {!tasks.some((t) => t.statusId === status.id) && (
                        <p className="empty-column">No tasks here</p>
                      )}
                    </div>
                  </section>
                ))}
              </div>
              {!project && (
                <p className="empty">
                  Add a local repository in Settings to start planning.
                </p>
              )}
            </>
          )}
          {page === "activity" && (
            <Activity snapshot={snapshot} open={(id) => setTaskId(id)} />
          )}
          {page === "settings" && owner && (
            <Settings
              snapshot={snapshot}
              project={project}
              mutate={mutate}
              selectProject={setProjectId}
            />
          )}
        </main>
      </div>
      {(currentTask || creating) && (
        <TaskPanel
          key={currentTask?.id || "new"}
          task={creating ? null : currentTask}
          project={
            creating
              ? project
              : projects.find((p) => p.id === currentTask.projectId)
          }
          snapshot={snapshot}
          mutate={mutate}
          busy={busy}
          close={() => {
            setTaskId(null);
            setCreating(false);
          }}
          onCreate={(id) => {
            setCreating(false);
            setTaskId(id);
          }}
        />
      )}
    </div>
  );
}
function Auth({ mode, setMode, onSuccess }) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const titles = {
    setup: "Create your workspace",
    login: "Welcome back",
    join: "Join your team",
  };
  return (
    <main className="auth-page">
      <div className="auth-intro">
        <div className="brand">
          <span className="mark">O</span>orches
        </div>
        <h1>
          A shared board.
          <br />
          Independent agents.
          <br />
          Human judgment.
        </h1>
        <p>Your game development workspace, hosted on your machine.</p>
      </div>
      <form
        className="auth-card"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          const data = Object.fromEntries(new FormData(e.currentTarget));
          if (mode === "join")
            data.token =
              new URLSearchParams(location.search).get("invite") || data.token;
          try {
            await api(
              mode === "setup"
                ? "/setup"
                : mode === "join"
                  ? "/join"
                  : "/login",
              "POST",
              data,
            );
            if (mode === "join")
              history.replaceState({}, "", location.pathname);
            await onSuccess();
          } catch (err) {
            setError(err.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="eyebrow">
          {mode === "setup" ? "FIRST TIME SETUP" : "TEAM ACCESS"}
        </div>
        <h2>{titles[mode]}</h2>
        <p>
          {mode === "setup"
            ? "The first account becomes the workspace owner."
            : mode === "join"
              ? "Use your single-use invitation to create a member account."
              : "Sign in to your self-hosted workspace."}
        </p>
        <ErrorBox error={error} />
        {mode === "join" &&
          !new URLSearchParams(location.search).get("invite") && (
            <Field label="Invitation token" name="token" required />
          )}
        <Field
          label="Username"
          name="username"
          autoComplete="username"
          required
        />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          minLength={mode === "login" ? undefined : 10}
          required
        />
        <button className="primary" disabled={busy}>
          {busy
            ? "Please wait…"
            : mode === "setup"
              ? "Create owner account"
              : mode === "join"
                ? "Join workspace"
                : "Sign in"}
        </button>
        {mode === "login" && (
          <button
            type="button"
            className="quiet"
            onClick={() => setMode("join")}
          >
            Have an invitation?
          </button>
        )}
        {mode === "join" && (
          <button
            type="button"
            className="quiet"
            onClick={() => setMode("login")}
          >
            Back to sign in
          </button>
        )}
      </form>
    </main>
  );
}
function TaskCard({ task, run, project, users = [], open, move }) {
  return (
    <article
      className="task-card"
      draggable
      onDragStart={(e) => e.dataTransfer.setData("text/plain", task.id)}
    >
      <div className="card-top">
        <span className="discipline">{task.discipline}</span>
        <span className={`priority ${task.priority}`}>{task.priority}</span>
      </div>
      <button className="task-title" onClick={open}>
        {task.title}
      </button>
      <p className="task-excerpt">
        {task.description ||
          "Open task to add details and acceptance criteria."}
      </p>
      <div className="card-meta">
        <span title={task.id}>#{task.id.slice(0, 8)}</span>
        <span>
          {users.find((u) => u.id === task.assigneeId)?.username ||
            "Unassigned"}
        </span>
      </div>
      {run && <Badge state={run.state} />}
      <label className="move-control">
        Move task
        <select
          aria-label={`Move ${task.title}`}
          value={task.statusId}
          onChange={(e) => move(e.target.value)}
        >
          {project.statuses.map((s) => (
            <option value={s.id} key={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
    </article>
  );
}
function Activity({ snapshot, open }) {
  const runs = snapshot.runs || [];
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">LIVE OPERATIONS</div>
          <h1>Agent activity</h1>
          <p>
            {runs.filter((r) => reservedStates.includes(r.state)).length} of{" "}
            {snapshot.settings?.capacity ?? 3} slots used ·{" "}
            {runs.filter((r) => r.state === "queued").length} queued
          </p>
        </div>
        <Badge state={snapshot.settings?.runner || "codex"} />
      </div>
      <div className="activity-list">
        {[...runs].reverse().map((run) => {
          const task = snapshot.tasks.find((t) => t.id === run.taskId),
            project = snapshot.projects.find((p) => p.id === run.projectId);
          return (
            <article className="activity-row" key={run.id}>
              <Badge state={run.state} />
              <div>
                <button className="link" onClick={() => open(run.taskId)}>
                  {task?.title || run.taskId}
                </button>
                <p>
                  {project?.name} · {run.runner || "codex"} ·{" "}
                  {date(run.createdAt)}
                </p>
                {(run.error || run.reason) && (
                  <p className="failure-text">{run.error || run.reason}</p>
                )}
                {run.state === "waiting" && (
                  <p>Waiting for a team member’s response</p>
                )}
              </div>
              <code>{run.id.slice(0, 8)}</code>
            </article>
          );
        })}
        {!runs.length && (
          <div className="empty">
            No attempts yet. Open a task and start an agent to see its progress
            here.
          </div>
        )}
      </div>
    </>
  );
}
function TaskPanel({ task, project, snapshot, mutate, busy, close, onCreate }) {
  const [tab, setTab] = useState(task ? "conversation" : "details"),
    [localError, setLocalError] = useState(""),
    [message, setMessage] = useState(""),
    [attemptId, setAttemptId] = useState("");
  const runs = (snapshot.runs || []).filter((r) => r.taskId === task?.id),
    latest = runs.at(-1),
    selected = runs.find((r) => r.id === attemptId) || latest;
  const active = runs.find((r) => activeStates.includes(r.state));
  const execute = async (path, method, data) => {
    setLocalError("");
    try {
      return await mutate(path, method, data);
    } catch (e) {
      setLocalError(e.message);
    }
  };
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    const previous = document.activeElement;
    const panel = document.querySelector(".task-panel");
    panel?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <section
        className="task-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-panel-title"
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key !== "Tab") return;
          const nodes = [
            ...e.currentTarget.querySelectorAll(
              "button:not(:disabled),input,textarea,select,a[href]",
            ),
          ];
          if (!nodes.length) return;
          const first = nodes[0],
            last = nodes.at(-1);
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }}
      >
        <header className="panel-heading">
          <div>
            <div className="eyebrow">
              {project?.name} {task && ` / #${task.id.slice(0, 8)}`}
            </div>
            <h2 id="task-panel-title">{task?.title || "Create a task"}</h2>
          </div>
          <button aria-label="Close" className="quiet" onClick={close}>
            ✕
          </button>
        </header>
        {task && (
          <>
            <div className="task-actions">
              <Badge state={latest?.state} />
              <select
                aria-label="Task status"
                value={task.statusId}
                onChange={(e) =>
                  execute(`/tasks/${task.id}`, "PATCH", {
                    statusId: e.target.value,
                  })
                }
              >
                {project.statuses.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <button
                className="primary"
                disabled={busy || !!active}
                onClick={() =>
                  execute(`/tasks/${task.id}/run`, "POST", {
                    requestKey: crypto.randomUUID(),
                  })
                }
              >
                {latest ? "Retry / new attempt" : "Start agent"}
              </button>
              {active && (
                <button
                  className="danger"
                  disabled={busy}
                  onClick={() =>
                    execute(`/runs/${active.id}/cancel`, "POST", {})
                  }
                >
                  Cancel attempt
                </button>
              )}
            </div>
            <nav className="tabs" aria-label="Task views">
              {["conversation", "details", "review", "history"].map((name) => (
                <button
                  key={name}
                  className={tab === name ? "selected" : ""}
                  onClick={() => setTab(name)}
                >
                  {name === "review"
                    ? "Changes & review"
                    : name[0].toUpperCase() + name.slice(1)}
                </button>
              ))}
            </nav>
          </>
        )}
        <div className="panel-body">
          <ErrorBox error={localError} />
          {tab === "details" && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const values = Object.fromEntries(
                  new FormData(e.currentTarget),
                );
                values.projectId = project.id;
                values.assigneeId = values.assigneeId || null;
                const data = await execute(
                  task ? `/tasks/${task.id}` : "/tasks",
                  task ? "PATCH" : "POST",
                  values,
                );
                if (data && !task) onCreate(data.task?.id || data.id);
              }}
            >
              <Field
                label="Title"
                name="title"
                required
                defaultValue={task?.title || ""}
              />
              <Field label="Description">
                <textarea
                  name="description"
                  rows={4}
                  defaultValue={task?.description || ""}
                />
              </Field>
              <Field label="Acceptance criteria">
                <textarea
                  name="acceptanceCriteria"
                  rows={5}
                  defaultValue={
                    Array.isArray(task?.acceptanceCriteria)
                      ? task.acceptanceCriteria.join("\n")
                      : task?.acceptanceCriteria || ""
                  }
                  placeholder="Describe observable outcomes and checks"
                />
              </Field>
              <div className="form-grid">
                <Field label="Discipline">
                  <select
                    name="discipline"
                    defaultValue={task?.discipline || "programming"}
                  >
                    {disciplines.map((d) => (
                      <option key={d}>{d}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Priority">
                  <select
                    name="priority"
                    defaultValue={task?.priority || "medium"}
                  >
                    {["low", "medium", "high", "urgent"].map((p) => (
                      <option key={p}>{p}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Assign to">
                  <select
                    name="assigneeId"
                    defaultValue={task?.assigneeId || ""}
                  >
                    <option value="">Unassigned</option>
                    {snapshot.users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.username}
                      </option>
                    ))}
                  </select>
                </Field>
                {!task && (
                  <Field label="Initial stage">
                    <select
                      name="statusId"
                      defaultValue={
                        project.statuses.find((s) => s.kind === "backlog")?.id
                      }
                    >
                      {project.statuses
                        .filter((s) => s.kind === "backlog")
                        .map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                    </select>
                  </Field>
                )}
              </div>
              <button className="primary" disabled={busy}>
                {busy ? "Saving…" : task ? "Save task" : "Create task"}
              </button>
            </form>
          )}
          {task && tab === "conversation" && (
            <>
              <div className="conversation">
                {!(task.messages || []).length && (
                  <div className="empty">
                    Start an agent to work on this task. Follow-up messages
                    retain the task’s working copy and conversation.
                  </div>
                )}
                {(task.messages || []).map((entry, i) => (
                  <article
                    className={`message ${entry.role}`}
                    key={entry.id || i}
                  >
                    <div className="message-heading">
                      <strong>
                        {entry.role === "human"
                          ? snapshot.users.find((u) => u.id === entry.actorId)
                              ?.username || "Team member"
                          : entry.role}
                      </strong>
                      <small>
                        {date(entry.createdAt)}
                        {entry.queuedForNextAttempt &&
                          " · Queued for next attempt"}
                      </small>
                    </div>
                    <pre>{entry.text}</pre>
                  </article>
                ))}
              </div>
              {active?.requests
                ?.filter((request) => request.state === "pending")
                .map((request) => (
                  <Request
                    key={request.id}
                    request={request}
                    busy={busy}
                    respond={(response) =>
                      execute(
                        `/runs/${active.id}/requests/${request.id}`,
                        "POST",
                        { response },
                      )
                    }
                  />
                ))}
              {latest?.error && (
                <div className="error" role="alert">
                  {latest.error}
                </div>
              )}
              <form
                className="composer"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const result = await execute(
                    `/tasks/${task.id}/messages`,
                    "POST",
                    { text: message },
                  );
                  if (result) setMessage("");
                }}
              >
                <Field
                  label={
                    active
                      ? "Follow-up (queued for the next attempt)"
                      : "Message the agent / request rework"
                  }
                >
                  <textarea
                    rows={3}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    required
                    placeholder="Give context, answer a question, or request a change…"
                  />
                </Field>
                <button className="primary" disabled={busy || !message.trim()}>
                  Send message
                </button>
              </form>
            </>
          )}
          {task && tab === "history" && (
            <>
              <h3>Attempt history</h3>
              {!runs.length && <p className="empty">No attempts yet.</p>}
              {[...runs].reverse().map((run) => (
                <article className="history-entry" key={run.id}>
                  <div className="row">
                    <Badge state={run.state} />
                    <strong>{run.runner || "codex"}</strong>
                    <small>{date(run.createdAt)}</small>
                  </div>
                  <code>{run.id}</code>
                  {run.error && <p className="failure-text">{run.error}</p>}
                  <button
                    className="link"
                    onClick={() => {
                      setAttemptId(run.id);
                      setTab("review");
                    }}
                  >
                    Inspect changes, verification and logs
                  </button>
                </article>
              ))}
              {task.acceptedBy && (
                <p className="notice">
                  Accepted by{" "}
                  {snapshot.users.find((u) => u.id === task.acceptedBy)
                    ?.username || task.acceptedBy}{" "}
                  at {date(task.acceptedAt)}.
                </p>
              )}
            </>
          )}
          {task && tab === "review" && (
            <>
              <Field label="Attempt">
                <select
                  value={selected?.id || ""}
                  onChange={(e) => setAttemptId(e.target.value)}
                >
                  {runs.map((r, i) => (
                    <option key={r.id} value={r.id}>
                      Attempt {i + 1} · {r.state} · {r.runner} ·{" "}
                      {date(r.createdAt)}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="notice">
                Changes remain in this isolated branch and working copy.
                Integrate them manually after review; overlapping branches may
                need conflict resolution.
              </div>
              <dl className="references">
                <dt>Branch</dt>
                <dd>
                  <code>
                    {selected?.branch || task.branch || "Not created yet"}
                  </code>
                </dd>
                <dt>Working copy</dt>
                <dd>
                  <code>
                    {selected?.worktree || task.worktree || "Not created yet"}
                  </code>
                </dd>
                <dt>Base revision</dt>
                <dd>
                  <code>
                    {selected?.baseRevision || task.baseRevision || "—"}
                  </code>
                </dd>
                <dt>Conversation</dt>
                <dd>
                  <code>{task.conversationId || "—"}</code>
                </dd>
              </dl>
              {selected?.error && <div className="error">{selected.error}</div>}
              <h3>Verification</h3>
              {!(selected?.verification?.results || []).length && (
                <p>No verification results recorded.</p>
              )}
              {(selected?.verification?.results || []).map((result, i) => (
                <details key={i} open>
                  <summary>
                    {result.kind} ·{" "}
                    {result.exitCode === 0 ? "Passed" : "Failed"} ·{" "}
                    <code>{result.command}</code>
                  </summary>
                  <pre className="output">
                    {result.output || "(No output)"}
                    {"\n"}Exit status:{" "}
                    {result.exitCode ?? result.signal ?? "unknown"}
                  </pre>
                </details>
              ))}
              <h3>Changed files</h3>
              {!selected?.files?.length && <p>No changed files recorded.</p>}
              <ul className="file-list">
                {(selected?.files || []).map((f, i) => (
                  <li key={i}>
                    <code>
                      {typeof f === "string" ? f : `${f.status} ${f.path}`}
                    </code>
                  </li>
                ))}
              </ul>
              <h3>Actual diff</h3>
              <pre className="output diff">
                {selected?.diff || "No diff recorded for this attempt."}
              </pre>
              <details>
                <summary>Attempt event log</summary>
                {(selected?.events || []).map((event, i) => (
                  <pre className="output" key={i}>
                    {event.type}: {event.text || stringify(event)}
                  </pre>
                ))}
              </details>
              <div className="review-actions">
                <button
                  className="primary"
                  disabled={
                    busy ||
                    !!active ||
                    selected?.id !== latest?.id ||
                    latest?.state !== "completed" ||
                    !latest?.verification?.success ||
                    project.statuses.find((s) => s.id === task.statusId)
                      ?.kind !== "review"
                  }
                  onClick={() =>
                    execute(`/tasks/${task.id}/accept`, "POST", {})
                  }
                >
                  Accept verified work → Done
                </button>
                <button onClick={() => setTab("conversation")}>
                  Request rework in conversation
                </button>
                <small>
                  Acceptance records your identity. It does not merge the
                  branch.
                </small>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
function Request({ request, respond, busy }) {
  const [answer, setAnswer] = useState("");
  const params = request.params || {};
  const isQuestion =
    request.kind === "question" ||
    request.kind === "user-input" ||
    /userInput|question/i.test(request.method || "");
  const questions = params.questions || [];
  return (
    <section className="pending-request">
      <h3>
        {isQuestion ? "Agent needs your input" : "Execution approval requested"}
      </h3>
      <p>{params.message || params.reason || request.method}</p>
      {isQuestion ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (questions.length) {
              const data = new FormData(e.currentTarget);
              respond({
                answers: Object.fromEntries(
                  questions.map((q) => [q.id, { answers: [data.get(q.id)] }]),
                ),
              });
            } else respond({ text: answer });
          }}
        >
          {questions.map((q) => (
            <Field key={q.id} label={q.question || q.header || q.id}>
              {q.options?.length ? (
                <select name={q.id} required>
                  <option value="">Choose an answer</option>
                  {q.options.map((o, i) => (
                    <option key={i} value={typeof o === "string" ? o : o.label}>
                      {typeof o === "string"
                        ? o
                        : `${o.label}${o.description ? ` — ${o.description}` : ""}`}
                    </option>
                  ))}
                </select>
              ) : (
                <textarea name={q.id} required />
              )}
            </Field>
          ))}
          {!questions.length && (
            <Field label="Your answer">
              <textarea
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                required
              />
            </Field>
          )}
          <button className="primary" disabled={busy}>
            Send answer
          </button>
        </form>
      ) : (
        <>
          <pre className="output">{stringify(params)}</pre>
          <div className="row">
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                respond(
                  request.kind === "permission"
                    ? { permissions: params.permissions || {} }
                    : { decision: "accept" },
                )
              }
            >
              Approve execution
            </button>
            <button
              disabled={busy}
              onClick={() =>
                respond(
                  request.kind === "permission"
                    ? { permissions: {} }
                    : { decision: "decline" },
                )
              }
            >
              Decline execution
            </button>
          </div>
          <small>
            This approves an execution request, not the final deliverable.
          </small>
        </>
      )}
    </section>
  );
}
function Settings({ snapshot, project, mutate, selectProject }) {
  const [section, setSection] = useState("project"),
    [notice, setNotice] = useState(""),
    [health, setHealth] = useState(null),
    [invite, setInvite] = useState(""),
    [pending, setPending] = useState(false);
  const [statuses, setStatuses] = useState(project?.statuses || []);
  useEffect(() => {
    setStatuses(project?.statuses || []);
  }, [project]);
  async function submit(path, method, data, success) {
    setPending(true);
    setNotice("");
    try {
      const result = await mutate(path, method, data);
      setNotice(success || "Settings saved.");
      return result;
    } catch {
    } finally {
      setPending(false);
    }
  }
  const rule = project?.rule || {};
  function shift(index, direction) {
    const next = [...statuses],
      destination = index + direction;
    [next[index], next[destination]] = [next[destination], next[index]];
    setStatuses(next);
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">OWNER CONTROLS</div>
          <h1>Settings & team</h1>
          <p>Configure the host, your repositories, and how work moves.</p>
        </div>
      </div>
      <nav className="tabs" aria-label="Settings sections">
        {["project", "workflow", "host", "team"].map((s) => (
          <button
            key={s}
            className={section === s ? "selected" : ""}
            onClick={() => {
              setSection(s);
              setNotice("");
            }}
          >
            {s[0].toUpperCase() + s.slice(1)}
          </button>
        ))}
      </nav>
      {notice && (
        <p className="success" role="status">
          {notice}
        </p>
      )}
      <div className="settings-content">
        {section === "project" && (
          <>
            <h2>Connect a local repository</h2>
            <p>
              The path is on the host running Orches. Choose a committed Git
              revision.
            </p>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const form = e.currentTarget;
                const data = Object.fromEntries(new FormData(form));
                const result = await submit(
                  "/projects",
                  "POST",
                  data,
                  "Repository connected.",
                );
                if (result) {
                  selectProject(result.project?.id || result.id);
                  form.reset();
                }
              }}
            >
              <Field label="Project name" name="name" required />
              <Field
                label="Local Git repository path"
                name="path"
                placeholder="/home/team/my-game"
                required
              />
              <Field
                label="Starting revision"
                name="revision"
                defaultValue="HEAD"
                required
              />
              <Field label="Build command (optional)" name="buildCommand" />
              <Field
                label="Test command"
                name="testCommand"
                placeholder="npm test"
                required
              />
              <button className="primary" disabled={pending}>
                Add project
              </button>
            </form>
            {project && (
              <>
                <hr />
                <h2>Project verification · {project.name}</h2>
                <form
                  key={project.id}
                  onSubmit={(e) => {
                    e.preventDefault();
                    submit(
                      `/projects/${project.id}`,
                      "PATCH",
                      Object.fromEntries(new FormData(e.currentTarget)),
                    );
                  }}
                >
                  <Field
                    label="Project name"
                    name="name"
                    defaultValue={project.name}
                    required
                  />
                  <Field
                    label="Build command (optional)"
                    name="buildCommand"
                    defaultValue={project.buildCommand || ""}
                  />
                  <Field
                    label="Test command"
                    name="testCommand"
                    defaultValue={project.testCommand || ""}
                    required
                  />
                  <button disabled={pending}>Save project</button>
                </form>
                <p className="muted">
                  Repository: <code>{project.path}</code> · revision{" "}
                  <code>{project.revision}</code>
                </p>
              </>
            )}
          </>
        )}
        {section === "workflow" && project && (
          <form
            key={project.id}
            onSubmit={(e) => {
              e.preventDefault();
              const fields = Object.fromEntries(new FormData(e.currentTarget));
              const nextRule = {
                ...rule,
                enabled: fields.enabled === "on",
                triggerStatus: fields.triggerStatus,
                reviewStatus: fields.reviewStatus,
                instructions: fields.instructions,
                buildCommand: fields.buildCommand,
                testCommand: fields.testCommand,
              };
              submit(
                `/projects/${project.id}/workflow`,
                "PUT",
                { statuses, rule: nextRule },
                "Workflow saved. Rules apply to future status entries.",
              );
            }}
          >
            <h2>Board columns</h2>
            <p>
              Keep stable identities when renaming or reordering. Occupied and
              referenced columns cannot be removed.
            </p>
            <div className="status-editor">
              {statuses.map((s, i) => (
                <div className="status-row" key={s.id}>
                  <Field label={`Column ${i + 1} name`}>
                    <input
                      value={s.name}
                      onChange={(e) =>
                        setStatuses(
                          statuses.map((item) =>
                            item.id === s.id
                              ? { ...item, name: e.target.value }
                              : item,
                          ),
                        )
                      }
                      required
                    />
                  </Field>
                  <Field label="Stage meaning">
                    <select
                      value={s.kind}
                      onChange={(e) =>
                        setStatuses(
                          statuses.map((item) =>
                            item.id === s.id
                              ? { ...item, kind: e.target.value }
                              : item,
                          ),
                        )
                      }
                    >
                      {[
                        "backlog",
                        "ready",
                        "execution",
                        "review",
                        "done",
                        "blocked",
                        "custom",
                      ].map((k) => (
                        <option key={k}>{k}</option>
                      ))}
                    </select>
                  </Field>
                  <button
                    type="button"
                    aria-label={`Move ${s.name} left`}
                    disabled={i === 0}
                    onClick={() => shift(i, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${s.name} right`}
                    disabled={i === statuses.length - 1}
                    onClick={() => shift(i, 1)}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove ${s.name}`}
                    onClick={() =>
                      setStatuses(statuses.filter((item) => item.id !== s.id))
                    }
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() =>
                setStatuses([
                  ...statuses,
                  {
                    id: crypto.randomUUID(),
                    name: "New column",
                    kind: "custom",
                  },
                ])
              }
            >
              + Add column
            </button>
            <hr />
            <h2>Status-triggered automation</h2>
            <Field label="Enable automation">
              <input
                className="checkbox"
                type="checkbox"
                name="enabled"
                defaultChecked={rule.enabled}
              />
            </Field>
            <div className="form-grid">
              <Field label="Start status">
                <select name="triggerStatus" defaultValue={rule.triggerStatus}>
                  {statuses.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Human review destination">
                <select name="reviewStatus" defaultValue={rule.reviewStatus}>
                  {statuses
                    .filter((s) => s.kind === "review")
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                </select>
              </Field>
            </div>
            <Field label="Codex instructions">
              <textarea
                name="instructions"
                rows={5}
                defaultValue={rule.instructions}
              />
            </Field>
            <Field
              label="Automation build command (optional)"
              name="buildCommand"
              defaultValue={rule.buildCommand}
            />
            <Field
              label="Automation test command"
              name="testCommand"
              defaultValue={rule.testCommand || project.testCommand}
              required
            />
            <p className="notice">
              Saving a rule does not start existing tasks. A future move into
              the start status queues an attempt with a copy of these settings.
            </p>
            <button className="primary" disabled={pending}>
              Save workflow
            </button>
          </form>
        )}
        {section === "host" && (
          <>
            <h2>Execution host</h2>
            <form
              key={JSON.stringify(snapshot.settings)}
              onSubmit={(e) => {
                e.preventDefault();
                const data = Object.fromEntries(new FormData(e.currentTarget));
                data.capacity = Number(data.capacity);
                submit("/settings", "PATCH", data);
              }}
            >
              <Field
                label="Concurrent agent capacity"
                name="capacity"
                type="number"
                min="1"
                max="32"
                defaultValue={snapshot.settings?.capacity || 3}
                required
              />
              <Field
                label="Codex executable"
                name="executable"
                defaultValue={snapshot.settings?.executable || "codex"}
                required
              />
              <Field
                label="Model (blank uses CLI default)"
                name="model"
                defaultValue={snapshot.settings?.model || ""}
              />
              <Field label="Runner">
                <select
                  name="runner"
                  defaultValue={snapshot.settings?.runner || "codex"}
                >
                  <option value="codex">Real Codex (local host)</option>
                </select>
              </Field>
              <p className="notice">
                Real Codex runs on this host using its existing CLI login.
              </p>
              <button className="primary" disabled={pending}>
                Save host settings
              </button>
            </form>
            <hr />
            <h2>Host readiness</h2>
            <p>CLI and login checks do not prove model connectivity.</p>
            <button
              onClick={async () => {
                setPending(true);
                try {
                  setHealth(await api("/health"));
                } catch (e) {
                  setHealth({ error: e.message });
                } finally {
                  setPending(false);
                }
              }}
              disabled={pending}
            >
              Check host readiness
            </button>
            {health && (
              <pre className="output" role="status">
                {stringify(health)}
              </pre>
            )}
          </>
        )}
        {section === "team" && (
          <>
            <h2>Team members</h2>
            <div className="team-list">
              {snapshot.users.map((u) => (
                <div className="row" key={u.id}>
                  <strong>{u.username}</strong>
                  <Badge state={u.role} />
                </div>
              ))}
            </div>
            <hr />
            <h2>Invite a teammate</h2>
            <p>
              Invitations expire and can be used once. Share the link manually
              with a trusted team member.
            </p>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const data = Object.fromEntries(new FormData(e.currentTarget));
                const result = await submit(
                  "/invitations",
                  "POST",
                  { expiresInHours: Number(data.expiresInHours) },
                  "Invitation created.",
                );
                if (result) {
                  const token = result.token || result.invitation?.token;
                  setInvite(
                    new URL(
                      result.url ||
                        result.link ||
                        `/?invite=${encodeURIComponent(token)}`,
                      location.origin,
                    ).href,
                  );
                }
              }}
            >
              <Field
                label="Invitation lifetime (hours)"
                name="expiresInHours"
                type="number"
                min="1"
                max="168"
                defaultValue="24"
                required
              />
              <button className="primary" disabled={pending}>
                Create invitation
              </button>
            </form>
            {invite && (
              <Field label="Share invitation link">
                <input
                  readOnly
                  value={invite}
                  onFocus={(e) => e.target.select()}
                />
              </Field>
            )}
          </>
        )}
      </div>
    </>
  );
}
createRoot(document.getElementById("root")).render(<App />);
