import test from 'node:test';
import assert from 'node:assert/strict';
import { youtubeFetch } from './youtube-transport.mjs';

test('a YouTube 429 honors Retry-After and retries once', async () => {
  let calls = 0;
  const started = Date.now();
  const response = await youtubeFetch('https://youtube.test/player', {}, async () => {
    calls++;
    return calls === 1
      ? new Response('rate limited', { status: 429, headers: { 'Retry-After': '0.01' } })
      : new Response('ok', { status: 200 });
  });
  assert.equal(response.status, 200);
  assert.equal(calls, 2);
  assert.ok(Date.now() - started >= 5);
});

test('non-429 responses are returned without an unnecessary retry', async () => {
  let calls = 0;
  const response = await youtubeFetch('https://youtube.test/search', {}, async () => {
    calls++;
    return new Response('ok', { status: 200 });
  });
  assert.equal(response.status, 200);
  assert.equal(calls, 1);
});


test('the shared lane never exceeds three concurrent upstream requests', async () => {
  let active = 0, peak = 0;
  await Promise.all(Array.from({ length: 12 }, (_, index) => youtubeFetch(`https://youtube.test/${index}`, {}, async () => {
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 8));
    active--;
    return new Response('ok', { status: 200 });
  })));
  assert.equal(peak, 3);
});
