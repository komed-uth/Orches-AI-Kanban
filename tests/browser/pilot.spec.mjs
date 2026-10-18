import { test, expect } from "@playwright/test";

// One pilot walkthrough shares the disposable host, accounts, and retained history.
test.describe.configure({ mode: "serial" });

test("owner and invited member share a persistent board with accessible task movement", async ({
  page,
  browser,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Create your workspace" }),
  ).toBeVisible();
  await page.getByLabel("Username", { exact: true }).fill("pilot-owner");
  await page.getByLabel("Password", { exact: true }).fill("pilot-password-123");
  await page.getByRole("button", { name: "Create owner account" }).click();
  await expect(
    page.getByRole("heading", { name: "Gem Trail sample", exact: true }),
  ).toBeVisible();
  for (const name of [
    "Backlog",
    "Ready",
    "In Progress",
    "Review",
    "Done",
    "Blocked",
  ]) {
    await expect(
      page.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
  }
  const snapshot = await (await page.request.get("/api/snapshot")).json();
  expect(snapshot.runs).toHaveLength(0);
  expect(snapshot.tasks.length).toBeGreaterThanOrEqual(2);
  await page.getByRole("button", { name: "+ New task", exact: true }).click();
  await page
    .getByLabel("Title", { exact: true })
    .fill("Browser collaboration task");
  await page
    .getByLabel("Description", { exact: true })
    .fill("Coordinate the game playtest.");
  await page
    .getByLabel("Acceptance criteria", { exact: true })
    .fill("Both team sessions see this task.");
  await page.getByRole("button", { name: "Create task", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "Browser collaboration task",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page
    .getByLabel("Move Browser collaboration task")
    .selectOption("ready");
  const invitation = await (
    await page.request.post("/api/invitations", { data: { expiresInHours: 1 } })
  ).json();
  const memberContext = await browser.newContext();
  const member = await memberContext.newPage();
  await member.goto(
    `/?invite=${invitation.token ?? invitation.invitation?.token}`,
  );
  await member.getByLabel("Username", { exact: true }).fill("pilot-member");
  await member
    .getByLabel("Password", { exact: true })
    .fill("member-password-123");
  await member
    .getByRole("button", { name: "Join workspace", exact: true })
    .click();
  await expect(
    member.getByRole("button", {
      name: "Browser collaboration task",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    member.getByRole("button", { name: /Settings & team/ }),
  ).toHaveCount(0);
  await member
    .getByLabel("Move Browser collaboration task")
    .selectOption("blocked");
  await expect(page.getByLabel("Move Browser collaboration task")).toHaveValue(
    "blocked",
  );
  await page.reload();
  await expect(page.getByLabel("Move Browser collaboration task")).toHaveValue(
    "blocked",
  );
  await page.getByRole("button", { name: /Agent activity/ }).click();
  await expect(
    page.getByRole("heading", { name: "Agent activity", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome back", exact: true }),
  ).toBeVisible();
  expect((await page.request.get("/api/snapshot")).status()).toBe(401);
  await memberContext.close();
});

test("task chat handles approval and questions, verifies changes, and records human acceptance", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill("pilot-owner");
  await page.getByLabel("Password", { exact: true }).fill("pilot-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Sign out", exact: true }),
  ).toBeVisible();
  const snapshot = await (await page.request.get("/api/snapshot")).json();
  const response = await page.request.post("/api/tasks", {
    data: {
      projectId: snapshot.projects[0].id,
      title: "Browser review task",
      description: "Deterministic browser fixture; no AI model call.",
      acceptanceCriteria: "Retain evidence and require human acceptance.",
      discipline: "programming",
      priority: "medium",
      statusId: "backlog",
    },
  });
  expect(response.ok()).toBeTruthy();
  await expect(
    page.getByRole("button", { name: "Browser review task", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Browser review task", exact: true })
    .click();
  await page.getByRole("button", { name: "Start agent", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Execution approval requested" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Approve execution", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Agent needs your input" }),
  ).toBeVisible();
  await page.getByLabel("What color should the gem be?").fill("Blue");
  await page.getByRole("button", { name: "Send answer", exact: true }).click();
  await page
    .getByRole("button", { name: "Changes & review", exact: true })
    .click();
  await expect(
    page.getByText("browser-evidence.txt", { exact: false }).first(),
  ).toBeVisible();
  const accept = page.getByRole("button", {
    name: "Accept verified work → Done",
    exact: true,
  });
  await expect(accept).toBeEnabled();
  await accept.click();
  await page.getByRole("button", { name: "History", exact: true }).click();
  await expect(page.getByText(/Accepted by pilot-owner/)).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByLabel("Move Browser review task")).toHaveValue("done");
});

test("owner configures capacity and workflow without launching work and sees host setup errors", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill("pilot-owner");
  await page.getByLabel("Password", { exact: true }).fill("pilot-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Sign out", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Settings & team/ }).click();
  await page.getByRole("button", { name: "Host", exact: true }).click();
  await page.getByLabel("Concurrent agent capacity").fill("2");
  await page.getByLabel("Codex executable").fill("/missing/orches-codex");
  await page
    .getByRole("button", { name: "Save host settings", exact: true })
    .click();
  await expect(
    page.getByText("Settings saved.", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Check host readiness", exact: true })
    .click();
  await expect(page.getByText(/Install Codex CLI/)).toBeVisible();
  await page.getByLabel("Codex executable").fill("codex");
  await page
    .getByRole("button", { name: "Save host settings", exact: true })
    .click();
  await page.getByRole("button", { name: "Workflow", exact: true }).click();
  await page.getByLabel("Column 1 name").fill("Ideas");
  await page
    .getByRole("button", { name: "Save workflow", exact: true })
    .click();
  await expect(
    page.getByText("Workflow saved. Rules apply to future status entries.", {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Task board/ }).click();
  await expect(
    page.getByRole("heading", { name: "Ideas", exact: true }),
  ).toBeVisible();
  const snapshot = await (await page.request.get("/api/snapshot")).json();
  expect(snapshot.settings.capacity).toBe(2);
  expect(
    snapshot.runs.every(
      (r) =>
        !["queued", "starting", "running", "waiting", "verifying"].includes(
          r.state,
        ),
    ),
  ).toBeTruthy();
  await page.getByRole("button", { name: /Settings & team/ }).click();
  await page
    .getByLabel("Project name", { exact: true })
    .first()
    .fill("Invalid repository");
  await page.getByLabel("Local Git repository path").fill("/not/a/repository");
  await page
    .getByLabel("Test command", { exact: true })
    .first()
    .fill("node --test");
  await page.getByRole("button", { name: "Add project", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(/repository|revision/);
});

test("cancellation preserves attempt history and reconnection restores activity", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill("pilot-owner");
  await page.getByLabel("Password", { exact: true }).fill("pilot-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Sign out", exact: true }),
  ).toBeVisible();
  const snapshot = await (await page.request.get("/api/snapshot")).json();
  await page.request.post("/api/tasks", {
    data: {
      projectId: snapshot.projects[0].id,
      title: "Browser cancel task",
      discipline: "qa",
      priority: "medium",
    },
  });
  await page
    .getByRole("button", { name: "Browser cancel task", exact: true })
    .click();
  await page.getByRole("button", { name: "Start agent", exact: true }).click();
  await expect(
    page.getByText("DETERMINISTIC TEST FIXTURE — no model execution."),
  ).toBeVisible();
  await context.setOffline(true);
  await expect(
    page.getByText("Reconnecting to host…", { exact: true }),
  ).toBeVisible();
  await context.setOffline(false);
  await expect(
    page.getByText("Live updates connected", { exact: true }),
  ).toBeVisible({ timeout: 15000 });
  await page
    .getByRole("button", { name: "Cancel attempt", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Retry / new attempt", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "History", exact: true }).click();
  await expect(
    page.locator(".history-entry").getByText("cancelled", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Retry / new attempt", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Cancel attempt", exact: true })
    .click();
  await expect(page.locator(".history-entry")).toHaveCount(2);
});

test("a failed task retries explicitly and retains its first outcome", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill("pilot-owner");
  await page.getByLabel("Password", { exact: true }).fill("pilot-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Sign out", exact: true }),
  ).toBeVisible();
  const snapshot = await (await page.request.get("/api/snapshot")).json();
  await page.request.post("/api/tasks", {
    data: {
      projectId: snapshot.projects[0].id,
      title: "Browser retry task",
      discipline: "programming",
      priority: "medium",
    },
  });
  await page
    .getByRole("button", { name: "Browser retry task", exact: true })
    .click();
  await page.getByRole("button", { name: "Start agent", exact: true }).click();
  await expect(
    page.getByText("Intentional browser fixture failure; retry explicitly.", {
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Retry / new attempt", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Approve execution", exact: true })
    .click();
  await page.getByLabel("What color should the gem be?").fill("Green");
  await page.getByRole("button", { name: "Send answer", exact: true }).click();
  await page
    .getByRole("button", { name: "Changes & review", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Accept verified work → Done",
      exact: true,
    }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "History", exact: true }).click();
  await expect(page.locator(".history-entry")).toHaveCount(2);
  await expect(
    page.locator(".history-entry").getByText("failed", { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(".history-entry").getByText("completed", { exact: true }),
  ).toBeVisible();
});

test("host restart retains interrupted evidence and waits for an explicit retry", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill("pilot-owner");
  await page.getByLabel("Password", { exact: true }).fill("pilot-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Sign out", exact: true }),
  ).toBeVisible();
  const initial = await (await page.request.get("/api/snapshot")).json();
  const created = await (
    await page.request.post("/api/tasks", {
      data: {
        projectId: initial.projects[0].id,
        title: "Browser restart cancel task",
        discipline: "programming",
        priority: "medium",
      },
    })
  ).json();
  await page
    .getByRole("button", { name: "Browser restart cancel task", exact: true })
    .click();
  await page.getByRole("button", { name: "Start agent", exact: true }).click();
  await expect(
    page.getByText("DETERMINISTIC TEST FIXTURE — no model execution."),
  ).toBeVisible();
  await page.request.post("/__fixture/restart");
  await expect
    .poll(async () => {
      try {
        const snapshot = await (await page.request.get("/api/snapshot")).json();
        return snapshot.runs?.find((r) => r.taskId === created.task.id)?.state;
      } catch {
        return "restarting";
      }
    })
    .toBe("interrupted");
  await page.reload();
  await page
    .getByRole("button", { name: "Browser restart cancel task", exact: true })
    .click();
  await page.getByRole("button", { name: "History", exact: true }).click();
  await expect(
    page.locator(".history-entry").getByText("interrupted", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".history-entry")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Retry / new attempt", exact: true })
    .click();
  await expect(page.locator(".history-entry")).toHaveCount(2);
  await page
    .getByRole("button", { name: "Cancel attempt", exact: true })
    .click();
});
