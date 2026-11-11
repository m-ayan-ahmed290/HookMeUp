import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { filtersSchema, sourceSchema, matches } from '../src/schema.js';
import { loadConfig, assertApproval } from '../src/config.js';
import { Store } from '../src/store.js';
import { seal, open } from '../src/crypto.js';
import { Reddit, normalize, safeUrl } from '../src/reddit.js';
import { Worker } from '../src/worker.js';
import { postMessage } from '../src/forward.js';
import { Sessions } from '../src/sessions.js';
import { commands } from '../src/commands.js';

const key = randomBytes(32).toString('hex');
const guild = '100000000000000000', channelId = '200000000000000000';
const makeStore = () => new Store(':memory:', key);
const post = { id: 'abc', title: 'Open source automation', body: 'Node tools', author: 'Alice', flair: 'Showcase', score: 20, type: 'text', nsfw: false, subreddit: 'tools' };
const source = { subreddit: 'tools', channelId, interval: 60 };

test('filter rules: AND/OR, exclusions, exact flair/author, type and score boundaries', () => {
  const cases = [
    [{}, true], [{ include: ['AUTOMATION'] }, true], [{ include: ['automation', 'missing'], match: 'OR' }, true],
    [{ include: ['automation', 'missing'], match: 'AND' }, false], [{ include: ['automation', 'node'], match: 'AND' }, true],
    [{ include: ['automation'], exclude: ['source'] }, false], [{ flairs: ['showcase'] }, true], [{ flairs: ['Show'] }, false],
    [{ excludeFlairs: ['SHOWCASE'] }, false], [{ authors: ['alice'] }, true], [{ excludeAuthors: ['ALICE'] }, false],
    [{ types: ['image'] }, false], [{ types: ['text', 'image'] }, true], [{ minScore: 20 }, true], [{ minScore: 21 }, false],
    [{ authors: ['alice'], flairs: ['other'] }, false],
  ];
  for (const [filter, expected] of cases) assert.equal(matches(post, filter), expected, JSON.stringify(filter));
});
test('strict validation rejects malformed communities, channels, intervals and unknown filters', () => {
  for (const data of [{ ...source, subreddit: '../private' }, { ...source, interval: 59 }, { ...source, interval: NaN }, { ...source, channelId: 'abc' }, { ...source, surprise: true }]) assert.throws(() => sourceSchema.parse(data));
  assert.throws(() => filtersSchema.parse({ minScore: -1 })); assert.throws(() => filtersSchema.parse({ regex: '.*' }));
  assert.equal(sourceSchema.parse({ ...source, subreddit: 'TOOLS' }).subreddit, 'tools');
});
test('AES-GCM authenticates secrets; tampering and wrong keys fail', () => {
  const secret = seal('webhook-token', key); assert.equal(open(secret, key), 'webhook-token'); assert.ok(!secret.includes('webhook-token'));
  assert.throws(() => open(secret, randomBytes(32).toString('hex')));
  const chunks = secret.split('.'); chunks[2] = Buffer.from('tampered').toString('base64'); assert.throws(() => open(chunks.join('.'), key));
});
test('approval gate blocks incomplete, expired, out-of-scope and sunset access before fetching', async () => {
  const config = loadConfig({ ENCRYPTION_KEY: key, REDDIT_MODE: 'approved' });
  assert.throws(() => assertApproval(config, 'tools'));
  Object.assign(config.reddit, { id: 'id', secret: 'secret', agent: 'bot by u/owner', reference: 'written-approval', subreddits: ['tools'], expires: '2027-05-01T00:00:00Z' });
  assert.doesNotThrow(() => assertApproval(config, 'tools', Date.parse('2026-11-11')));
  assert.throws(() => assertApproval(config, 'other', Date.parse('2026-11-11')));
  assert.throws(() => assertApproval(config, 'tools', Date.parse('2027-03-01')));
  config.reddit.postSunset = true;
  assert.doesNotThrow(() => assertApproval(config, 'tools', Date.parse('2027-03-01')));
  assert.throws(() => assertApproval(config, 'tools', Date.parse('2027-05-02')));
  let calls = 0;
  await assert.rejects(() => new Reddit(loadConfig({ ENCRYPTION_KEY: key, REDDIT_MODE: 'approved' }), async () => { calls++; }).posts('tools'));
  assert.equal(calls, 0);
});
test('test adapter never touches network and fixtures have stable deduplication IDs', async () => {
  const api = new Reddit({ mode: 'test' }, () => { throw new Error('Network forbidden'); });
  const a = await api.posts('tools'), b = await api.posts('tools');
  assert.equal(a.length, 4); assert.deepEqual(a.map(p => p.id), b.map(p => p.id)); assert.ok(a.every(p => p.title.includes('[TEST]')));
});
test('approved OAuth flow uses official endpoints, caches token, respects budget and 401 refresh', async () => {
  const config = loadConfig({ ENCRYPTION_KEY: key, REDDIT_MODE: 'approved', REDDIT_CLIENT_ID: 'id', REDDIT_CLIENT_SECRET: 'secret', REDDIT_USER_AGENT: 'HookMeUp by u/test', REDDIT_APPROVAL_REFERENCE: 'ref', REDDIT_APPROVED_SUBREDDITS: 'tools', REDDIT_APPROVAL_EXPIRES_AT: '2099-01-01', REDDIT_POST_SUNSET_APPROVED: 'true' });
  const requests = [], responses = [
    new Response(JSON.stringify({ access_token: 'token', expires_in: 3600 })),
    new Response(JSON.stringify({ data: { children: [{ data: { id: 'abc', title: 'Hello', subreddit: 'tools', permalink: '/r/tools/comments/abc', selftext: '', is_self: true, created_utc: Date.now() / 1000 } }] } })),
    new Response('', { status: 401 }),
  ];
  const api = new Reddit(config, async (url, opts) => { requests.push({ url, opts }); return responses.shift(); });
  await assert.rejects(() => api.posts('tools'), e => e.status === 429);
  await assert.rejects(() => api.posts('tools'), e => e.status === 429);
  assert.equal(requests.length, 1);
  api.next = 0; const posts = await api.posts('tools'); assert.equal(posts[0].id, 'abc');
  assert.match(requests[0].url, /^https:\/\/www.reddit.com\/api\/v1\/access_token$/);
  assert.match(requests[1].url, /^https:\/\/oauth.reddit.com\/r\/tools\/new/);
  assert.equal(requests[1].opts.headers.Authorization, 'Bearer token');
  api.next = 0; await assert.rejects(() => api.posts('tools'), e => e.status === 401); assert.equal(api.expires, 0);
});
test('upstream rate limits defer requests using Retry-After and do not loop', async () => {
  const api = new Reddit({ reddit: { rpm: 30 } }, async () => new Response('', { status: 429, headers: { 'retry-after': '90' } }));
  const before = Date.now(); await assert.rejects(() => api.request('https://oauth.reddit.com', {}), e => e.retryAfter === 90000);
  assert.ok(api.next >= before + 90000);
});
test('normalization drops removed data, classifies videos, keeps only HTTPS media', () => {
  assert.equal(normalize({ id: 'x', title: 'X', selftext: '[removed]' }), null);
  assert.equal(normalize({ id: 'x', title: 'X', removed_by_category: 'deleted' }), null);
  const p = normalize({ id: 'x', title: 'X', is_video: true, subreddit: 'Tools', media: { reddit_video: { fallback_url: 'https://v.redd.it/video' } }, permalink: '/r/tools/comments/x', preview: { images: [{ source: { url: 'https://preview.redd.it/a?a=1&amp;b=2' } }] } });
  assert.equal(p.type, 'video'); assert.equal(p.subreddit, 'tools'); assert.match(p.image, /a=1&b=2/);
  assert.equal(safeUrl('javascript:alert(1)'), null); assert.equal(safeUrl('https://user:secret@example.com'), null);
});
test('guild isolation, configuration edits, queue invalidation and secret-free export inputs', () => {
  const db = makeStore(); try {
    const a = db.add(guild, source); assert.equal(db.get('other', a.id), null); assert.deepEqual(db.list('other'), []);
    db.pause('other', a.id, true); assert.equal(db.get(guild, a.id).paused, false);
    db.remove('other', a.id); assert.ok(db.get(guild, a.id));
    assert.throws(() => db.add(guild, source));
    db.saveHook(guild, channelId, { id: 'hook', token: 'secret-token' });
    assert.equal(db.hook('other', channelId), null); assert.equal(db.hook(guild, channelId).token, 'secret-token');
    assert.ok(!db.db.prepare('SELECT secret FROM hooks').get().secret.includes('secret-token'));
    db.enqueue(a, post, 'test'); db.update(guild, a.id, { filters: { minScore: 50 } }); assert.equal(db.pending().length, 0);
    db.setSettings(guild, { paused: true }); assert.equal(db.settings('other').paused, false);
    db.erase(guild); assert.deepEqual(db.list(guild), []); assert.equal(db.hook(guild, channelId), null);
  } finally { db.close(); }
});
test('persistence survives restart and lease prevents concurrent processes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hookmeup-')); const file = join(dir, 'db.sqlite');
  let db = new Store(file, key);
  try {
    const a = db.add(guild, source); db.enqueue(a, post, 'test'); db.saveHook(guild, channelId, { token: 'secret' });
    assert.equal(db.acquireLease('one', 100), true); assert.equal(db.acquireLease('two', 101), false); assert.equal(db.acquireLease('one', 200), true);
    db.close(); db = new Store(file, key); assert.equal(db.pending().length, 1); assert.equal(db.hook(guild, channelId).token, 'secret');
    assert.equal(db.acquireLease('two', 60101), false); assert.equal(db.acquireLease('two', 60201), true); db.releaseLease('two');
    assert.equal(db.acquireLease('three', 60202), true);
  } finally { db.close(); rmSync(dir, { recursive: true }); }
});
test('worker prevents duplicates across ticks and scopes deduplication per subscription', async () => {
  const db = makeStore(); try {
    const a = db.add(guild, source); db.add('other', source); let sends = 0, fetches = 0;
    const worker = new Worker(db, { posts: async () => { fetches++; return [post]; } }, { send: async () => ({ id: String(++sends) }), notify: async () => {} }, { mode: 'test' });
    await worker.tick(); assert.equal(sends, 2); assert.equal(fetches, 1);
    db.db.prepare('UPDATE sources SET next_poll=0').run(); await worker.tick(); assert.equal(sends, 2);
    assert.equal(db.enqueue(a, post, 'approved'), true); // mode namespacing prevents test IDs suppressing real posts
    await worker.tick(); assert.equal(db.history(guild)[0].status, 'dead');
  } finally { db.close(); }
});
test('worker retries failures, persists dead letters, pauses queues, and throttles alerts', async () => {
  const db = makeStore(); try {
    const a = db.add(guild, source); let sends = 0, alerts = 0;
    const worker = new Worker(db, { posts: async () => [post] }, { send: async () => { sends++; throw Object.assign(new Error('No'), { status: 503 }); }, notify: async () => { alerts++; } }, { mode: 'test' });
    await worker.tick(); assert.equal(sends, 1); assert.equal(alerts, 1); assert.equal(db.history(guild)[0].status, 'pending');
    db.pause(guild, a.id, true); db.db.prepare('UPDATE deliveries SET due=0').run(); await worker.tick(); assert.equal(sends, 1);
    db.pause(guild, a.id, false); await worker.tick(); assert.equal(sends, 2); assert.equal(alerts, 1);
    db.db.prepare('UPDATE deliveries SET attempts=7,due=0').run(); await worker.tick(); assert.equal(db.history(guild)[0].status, 'dead');
    db.retry(guild, a.id); assert.equal(db.history(guild)[0].status, 'pending'); assert.equal(db.history(guild)[0].attempts, 0);
    worker.delivery.send = async () => ({ id: 'delivered' }); await worker.tick();
    assert.equal(db.history(guild)[0].status, 'sent'); assert.equal(db.db.prepare('SELECT payload FROM deliveries').get().payload, null);
  } finally { db.close(); }
});
test('paused deliveries never starve another server behind a full queue', () => {
  const db = makeStore(); try {
    const a = db.add(guild, source), b = db.add('other', source);
    for (let n = 0; n < 25; n++) db.enqueue(a, { ...post, id: `post${n}` }, 'test');
    db.enqueue(b, post, 'test'); db.setSettings(guild, { paused: true });
    assert.equal(db.pending().length, 1); assert.equal(db.pending()[0].guild_id, 'other');
  } finally { db.close(); }
});
test('worker rechecks approval at delivery and blocks mature content', async () => {
  const db = makeStore(); try {
    const a = db.add(guild, source); db.enqueue(a, post, 'approved');
    let sends = 0;
    const config = loadConfig({ ENCRYPTION_KEY: key, REDDIT_MODE: 'approved' });
    const worker = new Worker(db, { posts: async () => [{ ...post, nsfw: true }] }, { send: async () => { sends++; }, notify: async () => {} }, config);
    await worker.tick(); assert.equal(sends, 0); assert.equal(db.history(guild).length, 1);
  } finally { db.close(); }
});
test('retention expires payloads after 24h, purges dedup history after 30 days', () => {
  const db = makeStore(); try {
    const a = db.add(guild, source); db.enqueue(a, post, 'test', Date.now() - 2 * 86400000); db.purge();
    assert.equal(db.history(guild)[0].status, 'expired'); assert.equal(db.pending().length, 0);
    assert.equal(db.db.prepare('SELECT payload FROM deliveries').get().payload, null);
    db.db.prepare('UPDATE deliveries SET created=0').run(); db.purge(); assert.equal(db.history(guild).length, 0);
  } finally { db.close(); }
});
test('session ownership, TTL and guild boundaries are enforced', () => {
  const sessions = new Sessions(), s = sessions.create(guild, 'alice'); assert.equal(sessions.get(s.token, guild, 'alice'), s);
  assert.throws(() => sessions.get(s.token, guild, 'bob')); assert.throws(() => sessions.get(s.token, 'other', 'alice'));
  s.expires = 0; assert.throws(() => sessions.get(s.token, guild, 'alice')); sessions.prune(); assert.equal(sessions.items.size, 0);
});
test('Discord payloads bound untrusted fields, disable mentions and link video safely', () => {
  const p = postMessage({ ...post, title: '@everyone **Hello**'.repeat(100), body: 'x'.repeat(10000), media: 'https://v.redd.it/demo' }, 'test');
  const e = p.embeds[0].toJSON(); assert.ok(e.title.length <= 256); assert.ok(e.description.length <= 3000); assert.match(e.footer.text, /TEST DATA/);
  assert.deepEqual(p.allowedMentions, { parse: [] }); assert.equal(p.components[0].toJSON().components.length, 2); assert.equal(p.withComponents, true);
});
test('commands cover every management feature and require administrator permission', () => {
  for (const name of ['setup','dashboard','source','settings','status','history','audit','export','import','reset','help']) assert.ok(commands.some(c => c.name === name));
  for (const c of commands) { assert.equal(c.default_member_permissions, '8'); assert.equal(c.dm_permission, false); }
  for (const sub of ['add','edit','filters','destination','pause','resume','delete','test','retry','list','view']) assert.ok(commands.find(c => c.name === 'source').options.some(s => s.name === sub));
});
test('generated transparent avatar is a real PNG with RGBA channels', () => {
  const image = readFileSync(new URL('../assets/avatar-transparent.png', import.meta.url));
  assert.equal(image.subarray(1,4).toString(), 'PNG'); assert.equal(image[25], 6);
});
test('worker shutdown drains in-flight work before allowing the database to close', async () => {
  const db = makeStore(); let release;
  try {
    db.add(guild, source);
    const pending = new Promise(resolve => { release = resolve; });
    const worker = new Worker(db, { posts: async () => { await pending; return [post]; } }, { send: async () => ({ id: 'message' }), notify: async () => {} }, { mode: 'test' });
    worker.start(); await new Promise(resolve => setImmediate(resolve));
    let drained = false; const stopping = worker.stop().then(() => { drained = true; });
    await new Promise(resolve => setImmediate(resolve)); assert.equal(drained, false);
    release(); await stopping; assert.equal(drained, true); assert.equal(db.pending().length, 1);
  } finally { release?.(); db.close(); }
});
