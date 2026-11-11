// Shared YouTube request lane for catalog and player extraction.
// A 429 cools down the whole lane so concurrent callers do not amplify the limit.
const MAX_CONCURRENT = 3;
const MAX_COOLDOWN_MS = 30_000;
let active = 0;
let cooldownUntil = 0;
const waiters = [];

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function acquire() {
  if (active < MAX_CONCURRENT) {
    active++;
    return;
  }
  await new Promise(resolve => waiters.push(resolve));
}

function release() {
  const next = waiters.shift();
  if (next) next();
  else active--;
}

function retryDelay(response) {
  const value = response.headers.get('retry-after');
  if (value) {
    const seconds = Number(value);
    const until = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - Date.now();
    if (Number.isFinite(until) && until > 0) return Math.min(until, MAX_COOLDOWN_MS);
  }
  return 2_000;
}

export async function youtubeFetch(input, init = {}, fetchImpl = fetch) {
  for (let attempt = 0; attempt < 2; attempt++) {
    await acquire();
    let response;
    let held = true;
    try {
      const wait = cooldownUntil - Date.now();
      if (wait > 0) {
        release();
        held = false;
        await sleep(wait);
        continue;
      }
      response = await fetchImpl(input, init);
      if (response.status === 429) {
        cooldownUntil = Math.max(cooldownUntil, Date.now() + retryDelay(response));
      }
    } finally {
      if (held) release();
    }
    if (response.status !== 429 || attempt === 1) return response;
    await sleep(Math.max(0, cooldownUntil - Date.now()));
  }
}
