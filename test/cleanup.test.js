import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { Store } from '../src/store.js';
import { Worker } from '../src/worker.js';
import { loadConfig } from '../src/config.js';
import { Reddit } from '../src/reddit.js';
const guild = '100000000000000000', channelId = '200000000000000000';
const key = randomBytes(32).toString('hex');
function setup(mode = 'test') {
  const store = new Store(':memory:', key), removed = [], notices = [];
  const source = store.add(guild, { subreddit: 'tools', channelId });
  store.published(source, { id: 'abc' }, 'message', mode);
  const delivery = { removePublished: async p => { removed.push(p.message_id); }, notify: async (g, text) => { notices.push(text); } };
  const config = loadConfig({ ENCRYPTION_KEY: key, REDDIT_MODE: mode, REDDIT_CLIENT_ID: 'id', REDDIT_CLIENT_SECRET: 'secret', REDDIT_USER_AGENT: 'HookMeUp by u/test', REDDIT_APPROVAL_REFERENCE: 'ref', REDDIT_APPROVED_SUBREDDITS: 'tools', REDDIT_APPROVAL_EXPIRES_AT: '2099-01-01', REDDIT_POST_SUNSET_APPROVED: 'true' });
  const worker = new Worker(store, { info: async () => new Set(), posts: async () => [] }, delivery, config);
  return { store, worker, removed, notices, source };
}
test('relayed messages expire after 24h, even when source was deleted or server paused', async () => {
  const { store, worker, removed, source } = setup(); try {
    store.remove(guild, source.id); store.setSettings(guild, { paused: true });
    store.db.prepare('UPDATE published SET created=?,next_check=0').run(Date.now() - 86400001);
    await worker.tick(); assert.deepEqual(removed, ['message']); assert.equal(store.publications(guild).length, 0);
  } finally { store.close(); }
});
test('deletion checks remove posts absent from approved API response', async () => {
  const { store, worker, removed } = setup('approved'); try {
    store.db.prepare('UPDATE published SET next_check=0').run(); await worker.reconcile(); assert.deepEqual(removed, ['message']);
  } finally { store.close(); }
});
test('deletion checks retain existing posts and respect the next check interval', async () => {
  const { store, worker, removed } = setup('approved'); try {
    worker.reddit.info = async () => new Set(['abc']); store.db.prepare('UPDATE published SET next_check=0').run();
    await worker.reconcile(); assert.deepEqual(removed, []); assert.equal(store.publications(guild).length, 1); assert.equal(store.publications().length, 0);
  } finally { store.close(); }
});
test('revoked or expired access triggers removal without fetching Reddit', async () => {
  const { store, worker, removed } = setup('approved'); try {
    worker.config.reddit.expires = '2000-01-01'; worker.reddit.info = () => { throw new Error('Network forbidden'); };
    store.db.prepare('UPDATE published SET next_check=0').run(); await worker.reconcile(); assert.deepEqual(removed, ['message']);
  } finally { store.close(); }
});
test('failed message deletion preserves tracking and notifies the administrator', async () => {
  const { store, worker, notices } = setup(); try {
    worker.delivery.removePublished = async () => { throw Object.assign(new Error('Forbidden'), { code: 50013 }); };
    store.db.prepare('UPDATE published SET created=0,next_check=0').run(); await worker.reconcile();
    assert.equal(store.publications(guild).length, 1); assert.equal(notices.length, 1); assert.match(notices[0], /50013/);
  } finally { store.close(); }
});
test('batch info rejects unauthorized subreddits and deleted authors', async () => {
  const { store, worker } = setup('approved'); try {
    let calls = 0;
    const api = new Reddit(worker.config, async () => { calls++; return new Response(JSON.stringify({ data: { children: [
      { data: { id: 'abc', title: 'X', author: '[deleted]' } }, { data: { id: 'def', title: 'Y', author: 'active' } },
    ] } })); });
    api.token = 'token'; api.expires = Date.now() + 60000;
    await assert.rejects(() => api.info([{ post_id: 'abc', subreddit: 'forbidden' }])); assert.equal(calls, 0);
    assert.deepEqual([...await api.info([{ post_id: 'abc', subreddit: 'tools' }, { post_id: 'def', subreddit: 'tools' }])], ['def']);
  } finally { store.close(); }
});
