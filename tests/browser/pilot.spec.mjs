import { test, expect } from '@playwright/test';

test('owner and invited member share a persistent board with accessible task movement', async ({ page, browser }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Create your workspace' })).toBeVisible();
  await page.getByLabel('Username', { exact: true }).fill('pilot-owner');
  await page.getByLabel('Password', { exact: true }).fill('pilot-password-123');
  await page.getByRole('button', { name: 'Create owner account' }).click();
  await expect(page.getByRole('heading', { name: 'Sample game', exact: true })).toBeVisible();
  for (const name of ['Backlog', 'Ready', 'In Progress', 'Review', 'Done', 'Blocked']) {
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  }
  const snapshot = await (await page.request.get('/api/snapshot')).json();
  expect(snapshot.runs).toHaveLength(0);
  expect(snapshot.tasks.length).toBeGreaterThanOrEqual(2);
  await page.getByRole('button', { name: '+ New task', exact: true }).click();
  await page.getByLabel('Title', { exact: true }).fill('Browser collaboration task');
  await page.getByLabel('Description', { exact: true }).fill('Coordinate the game playtest.');
  await page.getByLabel('Acceptance criteria', { exact: true }).fill('Both team sessions see this task.');
  await page.getByRole('button', { name: 'Create task', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Browser collaboration task', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByLabel('Move Browser collaboration task').selectOption('ready');
  const invitation = await (await page.request.post('/api/invitations', { data: { expiresInHours: 1 } })).json();
  const memberContext = await browser.newContext();
  const member = await memberContext.newPage();
  await member.goto(`/?invite=${invitation.token ?? invitation.invitation?.token}`);
  await member.getByLabel('Username', { exact: true }).fill('pilot-member');
  await member.getByLabel('Password', { exact: true }).fill('member-password-123');
  await member.getByRole('button', { name: 'Join workspace', exact: true }).click();
  await expect(member.getByRole('button', { name: 'Browser collaboration task', exact: true })).toBeVisible();
  await expect(member.getByRole('button', { name: /Settings & team/ })).toHaveCount(0);
  await member.getByLabel('Move Browser collaboration task').selectOption('blocked');
  await expect(page.getByLabel('Move Browser collaboration task')).toHaveValue('blocked');
  await page.reload();
  await expect(page.getByLabel('Move Browser collaboration task')).toHaveValue('blocked');
  await page.getByRole('button', { name: /Agent activity/ }).click();
  await expect(page.getByRole('heading', { name: 'Agent activity', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back', exact: true })).toBeVisible();
  expect((await page.request.get('/api/snapshot')).status()).toBe(401);
  await memberContext.close();
});
