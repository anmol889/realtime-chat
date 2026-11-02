import { expect, test, type Page } from '@playwright/test';

/**
 * Browser end-to-end flow with two independent sessions (two users) in the same chat:
 * live delivery in both directions, then a reload proves history order == live order.
 */
const suffix = () => Math.random().toString(36).slice(2, 8);

async function login(page: Page, username: string) {
  await page.goto('/');
  await page.getByTestId('username').fill(username);
  await page.getByTestId('login').click();
  await expect(page.getByTestId('new-chat-name')).toBeVisible();
}

test('two users exchange messages live and history is ordered after reload', async ({ browser }) => {
  const s = suffix();
  const room = `room-${s}`;
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();

  await login(a, `alice_${s}`);
  await login(b, `bob_${s}`);

  // Alice creates the room; Bob joins it (list polls every 5s, so wait for it).
  await a.getByTestId('new-chat-name').fill(room);
  await a.getByTestId('create-chat').click();
  await expect(a.getByTestId('composer')).toBeVisible();

  await expect(b.getByTestId(`chat-${room}`)).toBeVisible({ timeout: 15_000 });
  await b.getByTestId(`chat-${room}`).click();
  await expect(b.getByTestId('composer')).toBeVisible();

  await a.getByTestId('composer').fill('hello from alice');
  await a.getByTestId('send').click();
  await expect(b.getByTestId('messages')).toContainText('hello from alice');

  await b.getByTestId('composer').fill('hi alice, bob here');
  await b.getByTestId('send').click();
  await expect(a.getByTestId('messages')).toContainText('hi alice, bob here');

  // Reload Alice: history must come back in the same order with seq 1, 2.
  await a.reload();
  await a.getByTestId(`chat-${room}`).click();
  const msgs = a.getByTestId('message');
  await expect(msgs).toHaveCount(2);
  await expect(msgs.nth(0)).toHaveAttribute('data-seq', '1');
  await expect(msgs.nth(0)).toContainText('hello from alice');
  await expect(msgs.nth(1)).toHaveAttribute('data-seq', '2');
  await expect(msgs.nth(1)).toContainText('hi alice, bob here');

  await ctxA.close();
  await ctxB.close();
});
