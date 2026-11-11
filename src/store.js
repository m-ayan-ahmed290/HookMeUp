import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { sourceSchema, settingsSchema } from './schema.js';
import { seal, open } from './crypto.js';

export class Store {
  constructor(path, key) {
    this.key = key;
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    if (path !== ':memory:') chmodSync(path, 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS guilds(id TEXT PRIMARY KEY, settings TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS hooks(guild_id TEXT, channel_id TEXT, secret TEXT NOT NULL,
        PRIMARY KEY(guild_id,channel_id));
      CREATE TABLE IF NOT EXISTS sources(id TEXT PRIMARY KEY, guild_id TEXT NOT NULL,
        config TEXT NOT NULL, paused INTEGER NOT NULL DEFAULT 0, next_poll INTEGER NOT NULL DEFAULT 0,
        failures INTEGER NOT NULL DEFAULT 0, last_error TEXT, last_poll INTEGER,
        UNIQUE(guild_id,config));
      CREATE TABLE IF NOT EXISTS deliveries(id INTEGER PRIMARY KEY, source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
        post_id TEXT NOT NULL, payload TEXT, status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
        due INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL, error TEXT, message_id TEXT,
        UNIQUE(source_id,post_id));
      CREATE INDEX IF NOT EXISTS deliveries_due ON deliveries(status,due);
      CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY, guild_id TEXT, actor TEXT, action TEXT, created INTEGER);`);
    this.db.exec('CREATE TABLE IF NOT EXISTS lease(id INTEGER PRIMARY KEY CHECK(id=1), owner TEXT, expires INTEGER)');
    this.db.exec(`CREATE TABLE IF NOT EXISTS published(id INTEGER PRIMARY KEY, guild_id TEXT, channel_id TEXT,
      subreddit TEXT, post_id TEXT, message_id TEXT, mode TEXT, created INTEGER, next_check INTEGER DEFAULT 0);
      CREATE INDEX IF NOT EXISTS published_check ON published(next_check);`);
  }
  acquireLease(owner, now = Date.now()) {
    return this.db.prepare('INSERT INTO lease VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,expires=excluded.expires WHERE lease.expires<? OR lease.owner=?')
      .run(owner, now + 60000, now, owner).changes > 0;
  }
  releaseLease(owner) { this.db.prepare('DELETE FROM lease WHERE owner=?').run(owner); }
  settings(guild) {
    return settingsSchema.parse(JSON.parse(this.db.prepare('SELECT settings FROM guilds WHERE id=?').get(guild)?.settings ?? '{}'));
  }
  setSettings(guild, data) {
    const value = settingsSchema.parse({ ...this.settings(guild), ...data });
    this.db.prepare('INSERT INTO guilds VALUES(?,?) ON CONFLICT(id) DO UPDATE SET settings=excluded.settings').run(guild, JSON.stringify(value));
    return value;
  }
  hook(guild, channel) {
    const row = this.db.prepare('SELECT secret FROM hooks WHERE guild_id=? AND channel_id=?').get(guild, channel);
    return row ? JSON.parse(open(row.secret, this.key)) : null;
  }
  saveHook(guild, channel, data) {
    this.db.prepare('INSERT INTO hooks VALUES(?,?,?) ON CONFLICT(guild_id,channel_id) DO UPDATE SET secret=excluded.secret')
      .run(guild, channel, seal(JSON.stringify(data), this.key));
  }
  forgetHook(guild, channel) { this.db.prepare('DELETE FROM hooks WHERE guild_id=? AND channel_id=?').run(guild, channel); }
  list(guild) {
    return this.db.prepare('SELECT * FROM sources WHERE guild_id=? ORDER BY rowid').all(guild).map(this.decode);
  }
  decode(row) { return row ? { ...row, ...JSON.parse(row.config), paused: Boolean(row.paused) } : null; }
  get(guild, id) { return this.decode(this.db.prepare('SELECT * FROM sources WHERE guild_id=? AND id=?').get(guild, id)); }
  add(guild, data) {
    const config = sourceSchema.parse(data);
    if (this.list(guild).length >= 100) throw new Error('Maximum 100 subscriptions per server');
    if (this.list(guild).some(s => s.subreddit === config.subreddit && s.channelId === config.channelId))
      throw new Error('That subreddit already forwards to this channel; edit its filters instead');
    const id = randomUUID().replaceAll('-', '').slice(0, 12);
    this.db.prepare('INSERT INTO sources(id,guild_id,config) VALUES(?,?,?)').run(id, guild, JSON.stringify(config));
    return this.get(guild, id);
  }
  update(guild, id, data) {
    const old = this.get(guild, id);
    if (!old) throw new Error('Subscription not found');
    const value = sourceSchema.parse({ subreddit: old.subreddit, channelId: old.channelId, interval: old.interval, filters: old.filters, ...data });
    if (this.list(guild).some(s => s.id !== id && s.subreddit === value.subreddit && s.channelId === value.channelId)) throw new Error('Duplicate subscription destination');
    this.db.prepare('UPDATE sources SET config=?,next_poll=0 WHERE guild_id=? AND id=?').run(JSON.stringify(value), guild, id);
    // Pending items were evaluated under the old rules/destination. Drop them on edits.
    this.db.prepare("DELETE FROM deliveries WHERE source_id=? AND status IN ('pending','dead')").run(id);
    return this.get(guild, id);
  }
  pause(guild, id, value) { this.db.prepare('UPDATE sources SET paused=? WHERE guild_id=? AND id=?').run(+value, guild, id); }
  remove(guild, id) { this.db.prepare('DELETE FROM sources WHERE guild_id=? AND id=?').run(guild, id); }
  due(now = Date.now()) {
    return this.db.prepare('SELECT * FROM sources WHERE paused=0 AND next_poll<=? ORDER BY next_poll').all(now)
      .map(this.decode).filter(s => !this.settings(s.guild_id).paused);
  }
  polled(id, next, error = null) {
    this.db.prepare('UPDATE sources SET next_poll=?, last_poll=?, last_error=?, failures=CASE WHEN ? IS NULL THEN 0 ELSE failures+1 END WHERE id=?')
      .run(next, Date.now(), error, error, id);
  }
  enqueue(source, post, mode, now = Date.now()) {
    return this.db.prepare('INSERT OR IGNORE INTO deliveries(source_id,post_id,payload,created) VALUES(?,?,?,?)')
      .run(source.id, `${mode}:${post.id}`, JSON.stringify(post), now).changes > 0;
  }
  pending(now = Date.now()) {
    return this.db.prepare("SELECT d.*,s.guild_id FROM deliveries d JOIN sources s ON d.source_id=s.id LEFT JOIN guilds g ON g.id=s.guild_id WHERE d.status='pending' AND d.due<=? AND s.paused=0 AND COALESCE(json_extract(g.settings,'$.paused'),0)=0 ORDER BY d.id LIMIT 20").all(now);
  }
  sent(id, message) { this.db.prepare("UPDATE deliveries SET status='sent',payload=NULL,message_id=?,error=NULL WHERE id=?").run(message, id); }
  published(source, post, message, mode) {
    if (message.startsWith('skipped-')) return;
    this.db.prepare('INSERT INTO published(guild_id,channel_id,subreddit,post_id,message_id,mode,created,next_check) VALUES(?,?,?,?,?,?,?,?)')
      .run(source.guild_id, source.channelId, source.subreddit, post.id, message, mode, Date.now(), Date.now() + 900000);
  }
  publications(guild = null) { return guild ? this.db.prepare('SELECT * FROM published WHERE guild_id=?').all(guild) : this.db.prepare('SELECT * FROM published WHERE next_check<=? ORDER BY created LIMIT 100').all(Date.now()); }
  unpublish(id) { this.db.prepare('DELETE FROM published WHERE id=?').run(id); }
  checked(id, delay = 900000) { this.db.prepare('UPDATE published SET next_check=? WHERE id=?').run(Date.now() + delay, id); }
  failed(id, code, delay, permanent = false) {
    this.db.prepare("UPDATE deliveries SET attempts=attempts+1,error=?,due=?,status=CASE WHEN attempts>=7 OR ? THEN 'dead' ELSE 'pending' END WHERE id=?")
      .run(code, Date.now() + delay, +permanent, id);
  }
  retry(guild, source) {
    if (!this.get(guild, source)) throw new Error('Subscription not found');
    this.db.prepare("UPDATE deliveries SET status='pending',attempts=0,due=0,error=NULL WHERE source_id=? AND status='dead' AND payload IS NOT NULL AND created>?").run(source, Date.now() - 86400000);
  }
  history(guild, page = 0) {
    return this.db.prepare('SELECT d.id,d.post_id,d.status,d.attempts,d.error,d.created,s.id AS source FROM deliveries d JOIN sources s ON s.id=d.source_id WHERE s.guild_id=? ORDER BY d.id DESC LIMIT 8 OFFSET ?').all(guild, page * 8);
  }
  stats(guild) {
    return this.db.prepare('SELECT status,COUNT(*) AS total FROM deliveries d JOIN sources s ON s.id=d.source_id WHERE s.guild_id=? GROUP BY status').all(guild);
  }
  audit(guild, actor, action) { this.db.prepare('INSERT INTO audit(guild_id,actor,action,created) VALUES(?,?,?,?)').run(guild, actor, action, Date.now()); }
  audits(guild) { return this.db.prepare('SELECT actor,action,created FROM audit WHERE guild_id=? ORDER BY id DESC LIMIT 15').all(guild); }
  purge() {
    this.db.prepare("UPDATE deliveries SET payload=NULL,status='expired' WHERE created<? AND payload IS NOT NULL").run(Date.now() - 86400000);
    this.db.prepare('DELETE FROM deliveries WHERE created<?').run(Date.now() - 30 * 86400000);
    this.db.prepare('DELETE FROM audit WHERE created<?').run(Date.now() - 30 * 86400000);
  }
  erase(guild) {
    this.db.prepare('DELETE FROM sources WHERE guild_id=?').run(guild);
    this.db.prepare('DELETE FROM hooks WHERE guild_id=?').run(guild);
    this.db.prepare('DELETE FROM guilds WHERE id=?').run(guild);
    this.db.prepare('DELETE FROM audit WHERE guild_id=?').run(guild);
    this.db.prepare('DELETE FROM published WHERE guild_id=?').run(guild);
  }
  close() { this.db.close(); }
}
