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
  const card = page
    .getByRole("article")
    .filter({
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
  await page.getByLabel("Prerequisite tasks").selectOption("task-gem-count");
  await page.getByRole("button", { name: "Save task" }).click();
  await page.reload();
  const edited = page
    .getByRole("article")
    .filter({
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
});

test("self dependencies, cycles, and missing references are rejected with actionable feedback", async ({
  page,
}) => {
  await page.goto("/trial/");
  const first = page
    .getByRole("article")
    .filter({
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
