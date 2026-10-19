import { test, expect } from "@playwright/test";

test("create and edit all task fields persist after reload with stable references", async ({
  page,
}) => {
  await page.goto("/trial/");
  await page.getByRole("button", { name: "New task" }).click();
  await page.getByLabel("Title", { exact: true }).fill("Accessible controls");
  await page
    .getByLabel("Description", { exact: true })
    .fill("Support keyboard users.");
  await page
    .getByLabel("Acceptance criteria")
    .fill("Tab reaches buttons\nEnter activates buttons");
  await page.getByLabel("Priority", { exact: true }).selectOption("high");
  await page.getByLabel("Prerequisite tasks").selectOption("task-gem-count");
  await page.getByRole("button", { name: "Save task" }).click();
  await page.reload();
  const card = page.getByRole("article").filter({
    has: page.getByRole("heading", {
      name: "Accessible controls",
      exact: true,
    }),
  });
  await expect(card).toContainText("Support keyboard users.");
  await expect(card.locator("ol li")).toHaveText([
    "Tab reaches buttons",
    "Enter activates buttons",
  ]);
  await expect(card).toContainText("high");
  await expect(card).toContainText("Show the remaining gem count");
  const identity = await card.getByText(/^Task:/).innerText();
  await card.getByRole("button", { name: "Edit task" }).click();
  await page.getByLabel("Title", { exact: true }).fill("Keyboard controls");
  await page
    .getByLabel("Description", { exact: true })
    .fill("Updated instructions");
  await page
    .getByLabel("Acceptance criteria")
    .fill("Keyboard can complete the game");
  await page.getByLabel("Priority", { exact: true }).selectOption("low");
  await page.getByLabel("Prerequisite tasks").selectOption("task-restart");
  await page.getByRole("button", { name: "Save task" }).click();
  await page.reload();
  const edited = page.getByRole("article").filter({
    has: page.getByRole("heading", {
      name: "Keyboard controls",
      exact: true,
    }),
  });
  await expect(edited.getByText(/^Task:/)).toHaveText(identity);
  await expect(edited).toContainText("Updated instructions");
  await expect(edited.locator("ol li")).toHaveText([
    "Keyboard can complete the game",
  ]);
  await expect(edited).toContainText("low");
  await expect(edited).toContainText(
    "Prerequisites: Restart the game with the R key",
  );
  const restart = page.getByRole("article").filter({
    has: page.getByRole("heading", {
      name: "Restart the game with the R key",
      exact: true,
    }),
  });
  await restart.getByRole("button", { name: "Edit task" }).click();
  await page
    .getByLabel("Title", { exact: true })
    .fill("Restart using keyboard");
  await page.getByRole("button", { name: "Save task" }).click();
  await page.reload();
  await expect(edited).toContainText("Prerequisites: Restart using keyboard");
});

test("self dependencies, cycles, and missing references are rejected with actionable feedback", async ({
  page,
}) => {
  await page.goto("/trial/");
  const first = page.getByRole("article").filter({
    has: page.getByRole("heading", {
      name: "Show the remaining gem count",
      exact: true,
    }),
  });
  await first.getByRole("button", { name: "Edit task" }).click();
  await page.getByLabel("Prerequisite tasks").selectOption("task-gem-count");
  await page.getByRole("button", { name: "Save task" }).click();
  await expect(page.getByRole("alert").filter({ visible: true })).toContainText(
    "cannot depend on itself",
  );
  await page.getByLabel("Prerequisite tasks").selectOption("task-victory");
  await page.getByRole("button", { name: "Save task" }).click();
  await expect(page.getByRole("alert").filter({ visible: true })).toContainText(
    "cycle",
  );
  // Browser boundary tampering models a stale/missing choice; the app must validate again on save.
  await page.getByLabel("Prerequisite tasks").evaluate((select) => {
    select.replaceChildren(
      new Option("Removed task", "missing-task", true, true),
    );
  });
  await page.getByRole("button", { name: "Save task" }).click();
  await expect(page.getByRole("alert").filter({ visible: true })).toContainText(
    "missing-task",
  );
  await page.reload();
  await expect(first).toContainText("Prerequisites: None");
});

async function seedEdit(page) {
  await page.goto("/trial/");
  await page
    .getByRole("article")
    .first()
    .getByRole("button", { name: "Edit task" })
    .click();
  await page.getByLabel("Title", { exact: true }).fill("Retained local work");
  await page.getByRole("button", { name: "Save task" }).click();
}

test("reset requires confirmation, restores samples and preserves unrelated storage and legacy dashboard", async ({
  page,
}) => {
  await seedEdit(page);
  await page.evaluate(() => localStorage.setItem("unrelated-app", "keep me"));
  page.once("dialog", (dialog) => dialog.dismiss());
  await page
    .getByRole("button", { name: "Reset trial data", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Retained local work" }),
  ).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Reset trial data", exact: true })
    .click();
  await page.reload();
  await expect(page.getByRole("article")).toHaveCount(3);
  await expect(
    page.getByRole("heading", { name: "Retained local work" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("article").filter({
      has: page.getByRole("heading", {
        name: "Celebrate collecting every gem",
      }),
    }),
  ).toContainText("Show the remaining gem count");
  expect(await page.evaluate(() => localStorage.getItem("unrelated-app"))).toBe(
    "keep me",
  );
  await page.getByRole("link", { name: "GitHub Issues dashboard" }).click();
  await expect(
    page.getByRole("heading", { name: "Mission control." }),
  ).toBeVisible();
});

for (const kind of ["corrupt", "incompatible", "missing reference", "cycle"]) {
  test(`${kind} saved state requires explicit recovery without overwriting it`, async ({
    page,
  }) => {
    await seedEdit(page);
    const saved = await page.evaluate((kind) => {
      const key = Object.keys(localStorage).find((key) =>
        key.startsWith("orches.pages-trial"),
      );
      const value = JSON.parse(localStorage.getItem(key));
      if (kind === "incompatible") value.version = 999;
      if (kind === "missing reference")
        value.tasks[0].prerequisites = ["deleted-task"];
      if (kind === "cycle") value.tasks[0].prerequisites = [value.tasks[1].id];
      const raw = kind === "corrupt" ? "{not json" : JSON.stringify(value);
      localStorage.setItem(key, raw);
      return { key, raw };
    }, kind);
    await page.reload();
    await expect(
      page.getByRole("region", { name: "Storage recovery" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "New task", exact: true }),
    ).toBeDisabled();
    expect(
      await page.evaluate((key) => localStorage.getItem(key), saved.key),
    ).toBe(saved.raw);
    await page.getByRole("button", { name: "Continue without saving" }).click();
    await expect(page.getByRole("status")).toContainText("not saved");
    await expect(page.getByRole("article")).toHaveCount(3);
    expect(
      await page.evaluate((key) => localStorage.getItem(key), saved.key),
    ).toBe(saved.raw);
    await page.reload();
    page.once("dialog", (dialog) => dialog.accept());
    await page
      .getByRole("button", { name: "Replace saved trial with samples" })
      .click();
    await page.reload();
    await expect(
      page.getByRole("region", { name: "Storage recovery" }),
    ).toBeHidden();
    await expect(page.getByRole("article")).toHaveCount(3);
  });
}

test("denied storage is visible and allows explicit temporary work", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => {
      throw new DOMException("Denied", "SecurityError");
    };
    Storage.prototype.setItem = () => {
      throw new DOMException("Denied", "SecurityError");
    };
  });
  await page.goto("/trial/");
  await expect(page.getByRole("alert").filter({ visible: true })).toContainText(
    "storage",
  );
  await page.getByRole("button", { name: "Continue without saving" }).click();
  await page.getByRole("button", { name: "New task", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("Temporary work");
  await page.getByRole("button", { name: "Save task" }).click();
  await expect(
    page.getByRole("heading", { name: "Temporary work", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("status")).toContainText("not saved");
});

test("failed writes retain the edit and retry saves it after storage becomes available", async ({
  page,
}) => {
  await seedEdit(page);
  await page.evaluate(() => {
    window.restoreWrite = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new DOMException("Full", "QuotaExceededError");
    };
  });
  await page
    .getByRole("article")
    .first()
    .getByRole("button", { name: "Edit task" })
    .click();
  await page.getByLabel("Title", { exact: true }).fill("Recover this edit");
  await page.getByRole("button", { name: "Save task" }).click();
  await expect(
    page.getByRole("region", { name: "Storage recovery" }),
  ).toBeVisible();
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue(
    "Recover this edit",
  );
  await expect(page.getByLabel("Title", { exact: true })).toBeDisabled();
  await expect(
    page
      .getByRole("article")
      .first()
      .getByRole("button", { name: "Edit task" }),
  ).toBeDisabled();
  await page.evaluate(() => {
    Storage.prototype.setItem = window.restoreWrite;
  });
  await page.getByRole("button", { name: "Retry saved storage" }).click();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Recover this edit", exact: true }),
  ).toBeVisible();
});

const taskCard = (page, id) => page.locator(`[data-task-id="${id}"]`);
async function saveSettings(
  page,
  {
    repository = "demo/gem-trail",
    check = "node --test tests/*.test.mjs",
    capacity = "2",
  } = {},
) {
  await page.getByLabel("Simulated repository").fill(repository);
  await page.getByLabel("Test/check command").fill(check);
  await page.getByLabel("Demo capacity").fill(capacity);
  await page.getByRole("button", { name: "Save project settings" }).click();
}

test("Ready explains each missing requirement and accepts optional build configuration", async ({
  page,
}) => {
  await page.goto("/trial/");
  const count = taskCard(page, "task-gem-count");
  await count.getByRole("button", { name: "Edit task" }).click();
  await page.getByLabel("Acceptance criteria").fill("");
  await page.getByRole("button", { name: "Save task" }).click();
  await saveSettings(page, { repository: "", check: "" });
  await count.getByRole("button", { name: "Move to Ready" }).click();
  await expect(count).toContainText("Add at least one acceptance criterion");
  await expect(count).toContainText("Configure a simulated repository");
  await expect(count).toContainText("Configure a test/check command");
  await expect(count).toContainText("Status: Backlog");
  await count.getByRole("button", { name: "Edit task" }).click();
  await page.getByLabel("Acceptance criteria").fill("The counter is visible");
  await page.getByRole("button", { name: "Save task" }).click();
  await saveSettings(page, { check: "" });
  await count.getByRole("button", { name: "Move to Ready" }).click();
  await expect(count).toContainText("Configure a test/check command");
  await expect(count).not.toContainText("Configure a simulated repository");
  await expect(count).not.toContainText(
    "Add at least one acceptance criterion",
  );
  await saveSettings(page);
  await expect(page.getByLabel("Build command (optional)")).toHaveValue("");
  await count.getByRole("button", { name: "Move to Ready" }).click();
  await expect(count).toContainText("Status: In progress");
  await expect(count).toContainText("Attempt 1");
});

test("Ready waits for prerequisite merge even after acceptance, while independent work starts", async ({
  page,
}) => {
  await page.goto("/trial/");
  const count = taskCard(page, "task-gem-count");
  const victory = taskCard(page, "task-victory");
  const restart = taskCard(page, "task-restart");
  await victory.getByRole("button", { name: "Move to Ready" }).click();
  await expect(victory).toContainText("Status: Ready");
  await expect(victory).toContainText(
    "Waiting for prerequisite merge: Show the remaining gem count",
  );
  await page.reload();
  await expect(victory).toContainText("Status: Ready");
  await expect(victory).not.toContainText("Attempt 1");
  await page.getByRole("button", { name: "Resume simulation" }).click();
  await expect(victory).not.toContainText("Attempt 1");
  await count.getByRole("button", { name: "Move to Ready" }).click();
  await restart.getByRole("button", { name: "Move to Ready" }).click();
  await expect(count).toContainText("Status: In progress");
  await expect(restart).toContainText("Status: In progress");
  await count.getByRole("button", { name: "Simulate acceptance" }).click();
  await expect(count).toContainText("Status: Accepted");
  await expect(count).toContainText("Prerequisite merge: Unmerged");
  await expect(victory).toContainText("Waiting for prerequisite merge");
  await expect(victory).not.toContainText("Attempt 1");
  await count
    .getByRole("button", { name: "Simulate prerequisite merge" })
    .click();
  await expect(count).toContainText("Prerequisite merge: Merged");
  await expect(victory).toContainText("Status: In progress");
});

async function addIndependentTask(page) {
  await page.getByRole("button", { name: "New task" }).click();
  await page.getByLabel("Title", { exact: true }).fill("Independent polish");
  await page.getByLabel("Acceptance criteria").fill("The polish is visible");
  await page.getByRole("button", { name: "Save task" }).click();
  return page.getByRole("article").filter({
    has: page.getByRole("heading", {
      name: "Independent polish",
      exact: true,
    }),
  });
}

test("two active attempts include waiting-for-answer work and lowering capacity only limits new starts", async ({
  page,
}) => {
  await page.goto("/trial/");
  const count = taskCard(page, "task-gem-count");
  const restart = taskCard(page, "task-restart");
  const third = await addIndependentTask(page);
  await count.getByRole("button", { name: "Move to Ready" }).click();
  await restart.getByRole("button", { name: "Move to Ready" }).click();
  await third.getByRole("button", { name: "Move to Ready" }).click();
  await expect(count).toContainText("Status: In progress");
  await expect(restart).toContainText("Status: In progress");
  await expect(third).toContainText("Waiting for capacity: 2/2");
  await count
    .getByRole("button", { name: "Simulate waiting for answer" })
    .click();
  await expect(count).toContainText("Waiting for answer (slot retained)");
  await expect(third).toContainText("Waiting for capacity: 2/2");
  await saveSettings(page, { capacity: "1" });
  await expect(count).toContainText("Waiting for answer (slot retained)");
  await expect(restart).toContainText("Status: In progress");
  await expect(third).toContainText("Waiting for capacity: 2/1");
  await count.getByRole("button", { name: "Simulate answer received" }).click();
  await count.getByRole("button", { name: "Simulate acceptance" }).click();
  await expect(third).toContainText("Waiting for capacity: 1/1");
  await restart.getByRole("button", { name: "Simulate acceptance" }).click();
  await expect(third).toContainText("Status: In progress");
  await expect(third).toContainText("Attempt 1");
});

test("repeated Ready and reload preserve attempts and queued work needs explicit simulation recovery", async ({
  page,
}) => {
  await page.goto("/trial/");
  await saveSettings(page, { capacity: "1" });
  const count = taskCard(page, "task-gem-count");
  const restart = taskCard(page, "task-restart");
  await count.getByRole("button", { name: "Move to Ready" }).click();
  await count.getByRole("button", { name: "Move to Ready" }).click();
  await count
    .getByRole("button", { name: "Simulate waiting for answer" })
    .click();
  const attempt = await count.getByText(/^Attempt 1/).innerText();
  await restart.getByRole("button", { name: "Move to Ready" }).click();
  await restart.getByRole("button", { name: "Move to Ready" }).click();
  await page.reload();
  await expect(
    page.getByText("Simulation paused after reload", { exact: false }),
  ).toBeVisible();
  await expect(count.getByText(/^Attempt 1/)).toHaveText(attempt);
  await expect(
    count.getByRole("button", { name: "Simulate answer received" }),
  ).toBeDisabled();
  await expect(restart).toContainText("Status: Ready");
  await expect(restart).not.toContainText("Attempt 1");
  await saveSettings(page, { capacity: "2" });
  await expect(restart).toContainText("Status: Ready");
  await expect(restart).not.toContainText("Attempt 1");
  await page.getByRole("button", { name: "Resume simulation" }).click();
  await expect(count.getByText(/^Attempt 1/)).toHaveText(attempt);
  await expect(count).toContainText("Waiting for answer (slot retained)");
  await expect(restart).toContainText("Status: In progress");
  const restarted = await restart.getByText(/^Attempt 1/).innerText();
  await restart.getByRole("button", { name: "Move to Ready" }).click();
  await page.reload();
  await page.getByRole("button", { name: "Resume simulation" }).click();
  await expect(count.getByText(/^Attempt 1/)).toHaveText(attempt);
  await expect(restart.getByText(/^Attempt 1/)).toHaveText(restarted);
});

test("raising capacity admits queued work with the configuration authorized at Ready", async ({
  page,
}) => {
  await page.goto("/trial/");
  await saveSettings(page, { capacity: "1" });
  await page.getByLabel("Build command (optional)").fill("npm run build");
  await page.getByRole("button", { name: "Save project settings" }).click();
  const count = taskCard(page, "task-gem-count");
  const restart = taskCard(page, "task-restart");
  await count.getByRole("button", { name: "Move to Ready" }).click();
  await restart.getByRole("button", { name: "Move to Ready" }).click();
  await expect(restart).toContainText("Waiting for capacity: 1/1");
  await saveSettings(page, { repository: "", check: "", capacity: "2" });
  await expect(restart).toContainText("Status: In progress");
  await expect(restart).toContainText("Authorized repository: demo/gem-trail");
  await expect(restart).toContainText(
    "Authorized test/check: node --test tests/*.test.mjs",
  );
  await expect(restart).toContainText("Authorized build: npm run build");
  await expect(
    restart.getByRole("button", { name: "Edit task" }),
  ).toBeDisabled();
  await page.reload();
  await expect(restart).toContainText("Authorized repository: demo/gem-trail");
  await expect(restart).toContainText("Authorized build: npm run build");
});

test("version-one backlog edits migrate without authorizing work or losing identities", async ({
  page,
}) => {
  await seedEdit(page);
  await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem("orches.pages-trial"));
    localStorage.setItem(
      "orches.pages-trial",
      JSON.stringify({
        version: 1,
        projects: saved.projects.map(({ id, title }) => ({ id, title })),
        tasks: saved.tasks.map(
          ({
            id,
            projectId,
            title,
            description,
            acceptanceCriteria,
            priority,
            prerequisites,
          }) => ({
            id,
            projectId,
            title,
            description,
            acceptanceCriteria,
            priority,
            prerequisites,
          }),
        ),
      }),
    );
  });
  await page.reload();
  const count = taskCard(page, "task-gem-count");
  const victory = taskCard(page, "task-victory");
  await expect(count).toContainText("Retained local work");
  await expect(count).toContainText(
    "Task: task-gem-count · Project: project-gem-trail",
  );
  await expect(count).toContainText("Status: Backlog");
  await expect(count).not.toContainText("Attempt 1");
  await expect(victory).toContainText("Prerequisites: Retained local work");
  await expect(
    page.getByRole("region", { name: "Storage recovery" }),
  ).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Resume simulation" }),
  ).toBeHidden();
  await count.getByRole("button", { name: "Move to Ready" }).click();
  await page.reload();
  await expect(count).toContainText("Retained local work");
  await expect(count).toContainText("Attempt 1");
  await expect(
    page.getByRole("region", { name: "Storage recovery" }),
  ).toBeHidden();
});

test("failed Ready persistence blocks all mutation controls and explicit retry retains one attempt", async ({
  page,
}) => {
  await page.goto("/trial/");
  const count = taskCard(page, "task-gem-count");
  const restart = taskCard(page, "task-restart");
  await count.getByRole("button", { name: "Move to Ready" }).click();
  const originalAttempt = await count.getByText(/^Attempt 1/).innerText();
  await page.evaluate(() => {
    window.restoreWrite = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new DOMException("Full", "QuotaExceededError");
    };
  });
  await restart.getByRole("button", { name: "Move to Ready" }).click();
  await expect(
    page.getByRole("region", { name: "Storage recovery" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save project settings" }),
  ).toBeDisabled();
  await expect(page.getByLabel("Demo capacity")).toBeDisabled();
  await expect(
    count.getByRole("button", { name: "Simulate acceptance" }),
  ).toBeDisabled();
  await expect(
    count.getByRole("button", { name: "Simulate waiting for answer" }),
  ).toBeDisabled();
  await expect(
    restart.getByRole("button", { name: "Move to Ready" }),
  ).toBeDisabled();
  await page.evaluate(() => {
    Storage.prototype.setItem = window.restoreWrite;
  });
  await page.getByRole("button", { name: "Retry saved storage" }).click();
  await expect(count.getByText(/^Attempt 1/)).toHaveText(originalAttempt);
  await expect(restart).toContainText("Status: In progress");
  const attempt = await restart.getByText(/^Attempt 1/).innerText();
  await restart.getByRole("button", { name: "Move to Ready" }).click();
  await page.reload();
  await expect(count.getByText(/^Attempt 1/)).toHaveText(originalAttempt);
  await expect(restart.getByText(/^Attempt 1/)).toHaveText(attempt);
});
