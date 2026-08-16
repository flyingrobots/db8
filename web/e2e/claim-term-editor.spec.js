import { test, expect } from '@playwright/test';

// The claim term editor, driven in a browser.
//
// Everything else about this feature is tested below the UI: the validator, the
// projection, the store contract, the HTTP flow. None of it renders a component.
// This file exists because the editor and the verifier were both written and
// shipped without anyone looking at them — and the verifier turned out to call
// `c.text.slice()` on a field the cutover had removed, which would have thrown
// the moment a real user opened it.
//
// Runs against the API in memory mode. What is under test is the browser.

const API = 'http://localhost:3199';
const PARTICIPANT = '5a1e0000-0000-4000-8000-000000000001';

async function createRoom(request) {
  const res = await request.post(`${API}/rpc/room.create`, {
    data: {
      topic: 'Does remote work reduce productivity?',
      cfg: { participant_count: 2, submit_minutes: 30 },
      client_nonce: `pw-${Date.now()}-${Math.random().toString(36).slice(2)}`
    }
  });
  expect(res.ok(), 'room.create should succeed').toBeTruthy();
  return (await res.json()).room_id;
}

// The submission form is gated on a participant id, so every test opens the
// room the way a participant would.
async function openRoom(page, roomId) {
  await page.goto(`/room/${roomId}`);
  await page.getByPlaceholder('Participant ID').fill(PARTICIPANT);
  await expect(page.getByText('Reads as:')).toBeVisible();
}

test.describe('the claim term editor', () => {
  let roomId;

  test.beforeEach(async ({ request }) => {
    roomId = await createRoom(request);
  });

  test('renders, and offers every node kind the model has', async ({ page }) => {
    await openRoom(page, roomId);

    const kind = page.locator('select[aria-label="Node kind"]').first();
    await expect(kind).toBeVisible();

    const options = await kind.locator('option').allTextContents();
    expect(options.sort()).toEqual(
      ['All of', 'Either', 'Even if / still', 'Framed', 'If / then', 'Not', 'Proposition'].sort()
    );
  });

  test('reads back in plain English what the author built', async ({ page }) => {
    await openRoom(page, roomId);

    await page.getByPlaceholder('e.g. the_study').first().fill('remote_work');
    await page.getByPlaceholder('reduces').fill('reduces');
    await page.getByPlaceholder('productivity').fill('productivity');

    await expect(page.getByText('Reads as: remote_work reduces productivity')).toBeVisible();
  });

  // The motivating case: framing must be visible as framing, not collapsed into
  // the proposition it suspends.
  test('builds a framed attribution and says the frame is opaque', async ({ page }) => {
    await openRoom(page, roomId);

    await page.locator('select[aria-label="Node kind"]').first().selectOption('framed');
    await expect(page.getByText(/Opaque: nothing inside is asserted/)).toBeVisible();

    await page.getByPlaceholder('e.g. the_study').first().fill('the_study');
    await page.getByPlaceholder('e.g. the_study').nth(1).fill('remote_work');
    await page.getByPlaceholder('reduces').fill('reduces');
    await page.getByPlaceholder('productivity').fill('productivity');

    await expect(
      page.getByText('Reads as: the_study says that remote_work reduces productivity')
    ).toBeVisible();
  });

  test('names the transparent frames differently, because they do not suspend', async ({
    page
  }) => {
    await openRoom(page, roomId);
    await page.locator('select[aria-label="Node kind"]').first().selectOption('framed');
    await page.locator('#term-frame').selectOption('domain');
    await expect(
      page.getByText(/Transparent: the proposition inside is still asserted/)
    ).toBeVisible();
  });

  test('reports incomplete slots and holds the submit button until they are filled', async ({
    page
  }) => {
    await openRoom(page, roomId);

    const submit = page.getByRole('button', { name: /Submit Draft/ });
    await expect(page.getByText('$: subject is empty')).toBeVisible();
    await expect(submit).toBeDisabled();

    await page.getByPlaceholder('e.g. the_study').first().fill('remote_work');
    await page.getByPlaceholder('reduces').fill('reduces');
    await page.getByPlaceholder('productivity').fill('productivity');
    await expect(page.getByText('$: subject is empty')).toBeHidden();

    // The message disappearing is not the same as being able to submit; a
    // regression could clear the warning and leave the button disabled.
    // Content and two citations are the other gates on it.
    await page.getByPlaceholder('Write your argument...').fill('An argument.');
    const urls = page.getByPlaceholder('URL');
    await urls.nth(0).fill('https://example.com/a');
    await urls.nth(1).fill('https://example.com/b');
    await expect(submit).toBeEnabled();
  });

  // The editor's rule must agree with the server's, or an author is told their
  // predicate is fine and then rejected on submit.
  test('rejects a predicate that is not snake_case, the way the server does', async ({ page }) => {
    await openRoom(page, roomId);
    await page.getByPlaceholder('e.g. the_study').first().fill('remote_work');
    await page.getByPlaceholder('reduces').fill('Reduces Productivity');
    await expect(page.getByText(/predicate must be snake_case/)).toBeVisible();
  });

  test('nests: a denial wrapping a proposition', async ({ page }) => {
    await openRoom(page, roomId);
    await page.locator('select[aria-label="Node kind"]').first().selectOption('denial');

    await page.getByPlaceholder('e.g. the_study').first().fill('remote_work');
    await page.getByPlaceholder('reduces').fill('reduces');
    await page.getByPlaceholder('productivity').fill('productivity');

    await expect(
      page.getByText('Reads as: it is not the case that remote_work reduces productivity')
    ).toBeVisible();
  });
});
