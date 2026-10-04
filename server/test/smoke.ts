// End-to-end smoke test against a running server started with HW_DEV=1.
import WebSocket from 'ws';
const B = process.env.HW_URL ?? 'http://localhost:8787';
const call = async (method: string, path: string, token?: string, body?: unknown) => {
  const r = await fetch(B + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json();
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(j)}`);
  return j as any;
};
const check = (label: string, cond: unknown) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${label}`); if (!cond) process.exitCode = 1; };

const { token } = await call('POST', '/devices', undefined, { platform: 'test' });
const types = await call('GET', '/catalog/event-types');
check(`catalog exposes ${types.types.length} notification types`, types.types.length > 20);

for (const q of ['harper', 'acuna', 'Mahomes', 'lakers', 'NYY', 'mcdavid', 'wemb']) {
  const { results } = await call('GET', `/search?q=${encodeURIComponent(q)}&limit=3`);
  console.log(`  search "${q}":`, results.map((r: any) => `${r.name} (${r.kind}, ${r.league})`).join(' | '));
}
const harper = (await call('GET', '/search?q=bryce harper')).results[0];
const eagles = (await call('GET', '/search?q=eagles&kind=team')).results[0];
check('search finds Bryce Harper with a verified image', harper?.name === 'Bryce Harper' && harper.imageW > 0);
check('search finds the Eagles with a logo', eagles?.abbrev === 'PHI' && eagles.logoW > 0);

await call('PUT', `/me/follows/${encodeURIComponent(harper.key)}`, token);
await call('PUT', `/me/follows/${encodeURIComponent(eagles.key)}`, token);
await call('PUT', `/me/follows/${encodeURIComponent(eagles.key)}`, token); // idempotent
check('follow list has 2 targets (no duplicates)', (await call('GET', '/me/follows', token)).follows.length === 2);

const ws = new WebSocket(`${B.replace('http', 'ws')}/ws?token=${token}`);
const received: any[] = [];
await new Promise((r) => ws.on('open', r));
ws.on('message', (m) => { const f = JSON.parse(String(m)); if (f.kind === 'event') received.push(f.item); });

const t0 = Date.now();
await call('POST', '/dev/simulate', token, { targetKey: harper.key, type: 'mlb.batter.strikeout' });
await new Promise((r) => setTimeout(r, 300));
check(`websocket delivered the event in ${received[0] ? received[0].detectedAt - t0 : '?'}ms`, received.length === 1 && received[0].target.name === 'Bryce Harper');

await call('PUT', '/me/prefs', token, { types: { 'mlb.batter.strikeout': false } });
await call('POST', '/dev/simulate', token, { targetKey: harper.key, type: 'mlb.batter.strikeout' });
await new Promise((r) => setTimeout(r, 300));
check('disabled type is not delivered', received.length === 1);

// Per-player choice beats the global setting: strikeouts back ON globally, OFF just for Harper.
await call('PUT', '/me/prefs', token, { types: { 'mlb.batter.strikeout': true }, targetTypes: { [harper.key]: { 'mlb.batter.strikeout': false } } });
await call('POST', '/dev/simulate', token, { targetKey: harper.key, type: 'mlb.batter.strikeout' });
await new Promise((r) => setTimeout(r, 300));
check('per-player "off" beats global "on"', received.length === 1);
const saved = await call('GET', '/me/prefs', token);
check('per-player choice is saved', saved.targetTypes?.[harper.key]?.['mlb.batter.strikeout'] === false);
await call('PUT', '/me/prefs', token, { targetTypes: { [harper.key]: { 'mlb.batter.strikeout': null } } });
check('"reset to global" removes it', !(await call('GET', '/me/prefs', token)).targetTypes?.[harper.key]);
await call('POST', '/dev/simulate', token, { targetKey: harper.key, type: 'mlb.batter.strikeout' });
await new Promise((r) => setTimeout(r, 300));
check('after reset, the global "on" applies again', received.length === 2);

// 🔕 mute only turns off push (unit-tested in logic.test.ts): the alert must still reach the live feed.
await call('PUT', '/me/prefs', token, { muted: [eagles.key] });
await call('POST', '/dev/simulate', token, { targetKey: eagles.key, type: 'team.lost' });
await new Promise((r) => setTimeout(r, 300));
check('muted target still delivered to the live feed', received.length === 3 && received[2].type === 'team.lost');
await call('PUT', '/me/prefs', token, { muted: [] });

const feed = (await call('GET', '/me/feed', token)).items;
check('muted alert is stored in the feed, newest-first', feed.length === 3 && feed[0].type === 'team.lost' && feed[0].occurredAt >= feed[1].occurredAt);

await call('DELETE', `/me/follows/${encodeURIComponent(harper.key)}`, token);
check('unfollow works', (await call('GET', '/me/follows', token)).follows.length === 1);
const bad = await fetch(`${B}/me/feed`, { headers: { authorization: 'Bearer nope.nope' } });
check('bad token rejected', bad.status === 401);
ws.close();

for (const page of ['/privacy', '/support']) {
  const r = await fetch(B + page);
  const html = await r.text();
  check(`${page} serves HTML with a contact email`, r.ok && r.headers.get('content-type')?.startsWith('text/html') && /mailto:[^"]+@/.test(html));
}

const ws2 = new WebSocket(`${B.replace('http', 'ws')}/ws?token=${token}`);
await new Promise((r) => ws2.on('open', r));
const closed = new Promise<number>((r) => ws2.on('close', (code) => r(code)));
await call('DELETE', '/me', token);
check('delete-all closes the live socket', (await closed) === 4401);
const gone = await fetch(`${B}/me/follows`, { headers: { authorization: `Bearer ${token}` } });
check('deleted device token no longer works', gone.status === 401);
console.log('health:', JSON.stringify((await call('GET', '/health')).live));
