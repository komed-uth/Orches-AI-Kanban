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
  const identity = await card.getAttribute("data-task-id");
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
  await expect(edited).toHaveAttribute("data-task-id", identity);
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
