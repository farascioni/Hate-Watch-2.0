// Push titles (push.ts, fitTitle): iOS cuts a title longer than about 24 characters after the emoji with "…", so such a
// title goes first in the body under a short "<emoji> Hate Watch" title; a short one is sent as it is.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.HW_DB = ':memory:';
const { fitTitle } = await import('../src/push.ts');

const msg = (title: string) => ({ to: 'tok', title, body: 'Final Score: 20 to 17', data: {} }) as any;

test('a short title is unchanged', () => {
  const m = msg('😆 Celtics lost');
  assert.equal(fitTitle(m), m);
});

test('a title of exactly 24 characters after the emoji is unchanged', () => {
  const m = msg(`🔥 ${'x'.repeat(24)}`);
  assert.equal(fitTitle(m), m);
});

test('a long title moves into the body under a short title', () => {
  const out = fitTitle(msg('😆 Celtics blew a 22-point lead over the Knicks'));
  assert.equal(out.title, '😆 Hate Watch');
  assert.equal(out.body, 'Celtics blew a 22-point lead over the Knicks\nFinal Score: 20 to 17');
});
