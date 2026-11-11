import { matches } from './schema.js';
import { log, errorCode } from './log.js';
import { assertApproval } from './config.js';

export class Worker {
  constructor(store, reddit, delivery, config) {
    Object.assign(this, { store, reddit, delivery, config });
    this.busy = false; this.stopping = false; this.notified = new Map(); this.lastTick = null;
  }
  async alert(guild, key, message) {
    const k = `${guild}:${key}`;
    if (Date.now() - (this.notified.get(k) || 0) < 3600000) return;
    this.notified.set(k, Date.now());
    try { await this.delivery.notify(guild, message); } catch (e) { log('notification_failed', { guild, code: errorCode(e) }); }
  }
  async tick() {
    if (this.busy || this.stopping) return;
    this.busy = true;
    try {
      this.store.purge();
      await this.reconcile();
      const cache = new Map();
      for (const source of this.store.due()) {
        if (this.stopping) break;
        try {
          if (!cache.has(source.subreddit)) cache.set(source.subreddit, this.reddit.posts(source.subreddit));
          const posts = await cache.get(source.subreddit);
          for (const post of posts) {
            if (post.nsfw && !this.store.settings(source.guild_id).allowNsfw) continue;
            if (matches(post, source.filters)) this.store.enqueue(source, post, this.config.mode);
          }
          this.store.polled(source.id, Date.now() + source.interval * 1000);
        } catch (e) {
          const delay = Math.max(e.retryAfter || 0, e.status === 429 ? 5000 : Math.min(3600000, source.interval * 1000 * 2 ** Math.min(source.failures, 5)));
          this.store.polled(source.id, Date.now() + delay, errorCode(e));
          if (e.status !== 429) await this.alert(source.guild_id, source.id, `⚠️ HookMeUp cannot read r/${source.subreddit} (subscription ${source.id}, code ${errorCode(e)}). Open /dashboard → subscription → Diagnostics. Test mode remains available.`);
        }
      }
      for (const job of this.store.pending()) {
        if (this.stopping) break;
        const source = this.store.get(job.guild_id, job.source_id);
        if (!source || source.paused || this.store.settings(job.guild_id).paused) continue;
        const mode = job.post_id.split(':')[0];
        try {
          if (mode !== this.config.mode) throw Object.assign(new Error('Mode changed'), { code: 'MODE_CHANGED' });
          assertApproval(this.config, source.subreddit);
          const post = JSON.parse(job.payload);
          if (post.nsfw && !this.store.settings(job.guild_id).allowNsfw) { this.store.sent(job.id, 'skipped-nsfw'); continue; }
          const message = await this.delivery.send(source, post, mode);
          this.store.published(source, post, message.id, mode);
          this.store.sent(job.id, message.id);
          log('delivered', { guild: job.guild_id, source: source.id, delivery: job.id, mode });
        } catch (e) {
          const permanent = [400, 401, 403].includes(e.status) || e.code === 'MODE_CHANGED';
          this.store.failed(job.id, errorCode(e), Math.max(e.retryAfter || 0, Math.min(3600000, 5000 * 2 ** job.attempts) + Math.random() * 1000), permanent);
          await this.alert(job.guild_id, `delivery:${source.id}`, `⚠️ HookMeUp delivery failed for ${source.id} (code ${errorCode(e)}). Check channel permissions in /dashboard. Failed deliveries can be retried for 24 hours.`);
          log('delivery_failed', { guild: job.guild_id, source: source.id, code: errorCode(e) });
        }
      }
      this.lastTick = Date.now();
    } finally { this.busy = false; }
  }
  async reconcile() {
    const entries = this.store.publications();
    const live = [];
    for (const p of entries) {
      let expired = Date.now() - p.created >= 86400000;
      if (p.mode === 'approved') {
        try { if (this.config.mode !== 'approved') expired = true; else assertApproval(this.config, p.subreddit); }
        catch { expired = true; }
      }
      if (expired) await this.remove(p);
      else if (p.mode === 'approved') live.push(p);
      else this.store.checked(p.id);
    }
    if (live.length) {
      try {
        const remaining = await this.reddit.info(live);
        for (const p of live) { if (remaining.has(p.post_id)) this.store.checked(p.id); else await this.remove(p); }
      } catch (e) {
        for (const p of live) this.store.checked(p.id, Math.max(5000, e.retryAfter || 60000));
        if (e.status !== 429) for (const guild of new Set(live.map(p => p.guild_id))) await this.alert(guild, 'reconciliation', '⚠️ HookMeUp cannot check Reddit deletions. Messages still expire after 24 hours while the bot is online. Review /status.');
      }
    }
  }
  async remove(p) {
    try { await this.delivery.removePublished(p); this.store.unpublish(p.id); }
    catch (e) { this.store.checked(p.id, 60000); await this.alert(p.guild_id, 'cleanup', `⚠️ HookMeUp could not remove a relayed message (code ${errorCode(e)}). A server administrator must remove it from <#${p.channel_id}>. Preserve webhook credentials until cleanup completes.`); }
  }
  start() {
    const launch = () => {
      if (this.busy || this.stopping) return;
      this.running = this.tick().catch(e => log('worker_failed', { code: errorCode(e) }));
    };
    this.timer = setInterval(launch, 5000);
    launch();
  }
  async stop() { this.stopping = true; clearInterval(this.timer); await this.running; }
}
