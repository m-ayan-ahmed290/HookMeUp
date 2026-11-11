import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { PermissionFlagsBits } from 'discord.js';
import { Store } from '../src/store.js';
import { UI } from '../src/ui.js';
import { DiscordDelivery } from '../src/discord.js';

const guild = '100000000000000000', channelId = '200000000000000000';
function harness() {
  const store = new Store(':memory:', randomBytes(32).toString('hex'));
  const calls = { ensured: [], sent: [], cleaned: 0 };
  const delivery = { client: { isReady: () => true }, channel: async () => ({}), ensure: async (g,c) => { calls.ensured.push([g,c]); }, send: async (...args) => { calls.sent.push(args); return { id: 'message' }; }, cleanup: async () => { calls.cleaned++; } };
  const ui = new UI(store, delivery, { lastTick: Date.now() }, { mode: 'test' });
  return { store, ui, calls };
}
function interaction({ kind = 'button', customId, commandName, sub, id, values = [], fields = {}, user = 'alice', guildId = guild, admin = true } = {}) {
  const i = { guildId, user: { id: user }, customId, commandName, values, deferred: false, replied: false,
    memberPermissions: { has: p => admin && p === PermissionFlagsBits.Administrator },
    inGuild: () => true, isChatInputCommand: () => kind === 'slash', isMessageComponent: () => kind === 'button',
    options: { getSubcommand: () => sub, getString: () => id, getAttachment: () => null }, fields: { getTextInputValue: name => fields[name] || '' },
    reply: async p => { i.replied = true; i.output = p; }, update: async p => { i.replied = true; i.output = p; },
    editReply: async p => { i.output = p; }, deferUpdate: async () => { i.deferred = true; }, deferReply: async () => { i.deferred = true; },
    showModal: async m => { i.modal = m.toJSON(); },
  };
  return i;
}
function validate(payload) {
  assert.ok(payload.components.length <= 5);
  for (const r of payload.components) { const json = r.toJSON(); assert.ok(json.components.length <= 5); }
  for (const e of payload.embeds) assert.ok(e.toJSON().description.length <= 4096);
  return payload;
}
function cid(payload, action) {
  const c = payload.components.flatMap(r => r.toJSON().components).find(c => c.custom_id?.split(':')[2] === action);
  assert.ok(c, `Missing ${action}`); return c.custom_id;
}
async function click(ui, payload, action, extra = {}) {
  const i = interaction({ customId: cid(payload, action), ...extra }); await ui.handle(i);
  if (i.output?.embeds?.length) validate(i.output);
  return i;
}
test('complete six-step setup saves source, filters, notifications and creates webhook', async () => {
  const { store, ui, calls } = harness(); try {
    const i = interaction({ kind: 'slash', commandName: 'setup' }); await ui.handle(i); validate(i.output);
    let next = await click(ui, i.output, 'basics');
    assert.equal(next.modal.title, 'Community & polling');
    next = interaction({ kind: 'modal', customId: next.modal.custom_id, fields: { subreddit: 'r/programming', interval: '120' } }); await ui.handle(next);
    next = await click(ui, next.output, 'wizardChannel', { values: [channelId] });
    next = await click(ui, next.output, 'keywords');
    next = interaction({ kind: 'modal', customId: next.modal.custom_id, fields: { include: 'automation, node', exclude: 'sponsored', match: 'AND' } }); await ui.handle(next);
    next = await click(ui, next.output, 'flairs');
    next = interaction({ kind: 'modal', customId: next.modal.custom_id, fields: { include: 'Showcase', exclude: 'Ads' } }); await ui.handle(next);
    next = await click(ui, next.output, 'authors');
    next = interaction({ kind: 'modal', customId: next.modal.custom_id, fields: { include: 'u/demo_user', exclude: 'u/promo' } }); await ui.handle(next);
    next = await click(ui, next.output, 'types');
    next = await click(ui, next.output, 'typeSelect', { values: ['text', 'video'] });
    next = await click(ui, next.output, 'types'); next = await click(ui, next.output, 'score');
    next = interaction({ kind: 'modal', customId: next.modal.custom_id, fields: { score: '10' } }); await ui.handle(next);
    next = await click(ui, next.output, 'wizardNotifications');
    next = await click(ui, next.output, 'wizardNotify', { values: [channelId] });
    const saveId = cid(next.output, 'save'); next = await click(ui, next.output, 'save');
    assert.equal(store.list(guild).length, 1); const s = store.list(guild)[0];
    assert.equal(s.subreddit, 'programming'); assert.equal(s.interval, 120); assert.equal(s.filters.match, 'AND');
    assert.deepEqual(s.filters.authors, ['demo_user']); assert.equal(s.filters.minScore, 10); assert.deepEqual(s.filters.types, ['text', 'video']);
    assert.equal(store.settings(guild).notifications, channelId); assert.equal(calls.ensured.length, 1);
    const replay = interaction({ customId: saveId }); await ui.handle(replay); assert.match(replay.output.content, /outdated/); assert.equal(store.list(guild).length, 1);
  } finally { store.close(); }
});
test('every panel and modal serializes against Discord builder validation', async () => {
  const { store, ui } = harness(); try {
    const a = store.add(guild, { subreddit: 'tools', channelId });
    const s = ui.sessions.create(guild, 'alice', { source: a.id });
    for (const method of ['home','list','source','settings','health','history']) validate(ui[method](s));
    ui.newDraft(s, a);
    for (const step of ['intro','channel','keywords','advanced','notifications','review']) validate(ui.wizard(s, step));
    for (const action of ['basics', 'keywords', 'flairs', 'authors', 'score', 'import']) {
      const i = interaction(); await ui.action(i, s, action); assert.ok(i.modal, action);
    }
    for (const action of ['help','audit','export','reset','preview','notifications','types','diagnostics']) {
      const i = interaction(); await ui.action(i, s, action); validate(i.output);
    }
  } finally { store.close(); }
});
test('authorization is enforced for slash commands, session ownership and stale panels', async () => {
  const { store, ui } = harness(); try {
    const deny = interaction({ kind: 'slash', commandName: 'dashboard', admin: false }); await ui.handle(deny); assert.match(deny.output.content, /administrators/);
    const s = ui.sessions.create(guild, 'alice'); const first = ui.home(s);
    const stolen = interaction({ customId: cid(first, 'reset'), user: 'bob' }); await ui.handle(stolen); assert.match(stolen.output.content, /belongs/);
    const foreign = interaction({ customId: cid(first, 'reset'), guildId: 'other' }); await ui.handle(foreign); assert.match(foreign.output.content, /belongs/);
    ui.home(s); const stale = interaction({ customId: cid(first, 'reset') }); await ui.handle(stale); assert.match(stale.output.content, /outdated/);
  } finally { store.close(); }
});
test('source controls preview, explicitly send a test, pause, retry and confirm deletion', async () => {
  const { store, ui, calls } = harness(); try {
    const a = store.add(guild, { subreddit: 'tools', channelId }); const s = ui.sessions.create(guild, 'alice', { source: a.id });
    let p = ui.source(s), next = await click(ui, p, 'preview'); assert.equal(calls.sent.length, 0);
    next = await click(ui, next.output, 'sendSample'); assert.equal(calls.sent.length, 1); assert.equal(calls.sent[0][2], 'test');
    next = await click(ui, next.output, 'source'); next = await click(ui, next.output, 'toggle'); assert.equal(store.get(guild, a.id).paused, true);
    next = await click(ui, next.output, 'retry'); next = await click(ui, next.output, 'delete'); assert.ok(store.get(guild, a.id));
    next = await click(ui, next.output, 'confirm_delete'); assert.equal(store.get(guild, a.id), null);
  } finally { store.close(); }
});
test('pagination, server pause, mature policy confirmation and reset', async () => {
  const { store, ui, calls } = harness(); try {
    for (let n = 0; n < 11; n++) store.add(guild, { subreddit: `tools${n}`, channelId });
    const s = ui.sessions.create(guild, 'alice'); let next = await click(ui, ui.list(s), 'next');
    assert.match(next.output.embeds[0].toJSON().title, /2/); next = await click(ui, next.output, 'home');
    next = await click(ui, next.output, 'settings'); next = await click(ui, next.output, 'pauseAll'); assert.equal(store.settings(guild).paused, true);
    next = await click(ui, next.output, 'nsfw'); assert.equal(store.settings(guild).allowNsfw, false);
    next = await click(ui, next.output, 'confirm_nsfw'); assert.equal(store.settings(guild).allowNsfw, true);
    next = await click(ui, next.output, 'home'); next = await click(ui, next.output, 'reset'); assert.equal(store.list(guild).length, 11);
    await click(ui, next.output, 'confirm_reset'); assert.equal(store.list(guild).length, 0); assert.equal(calls.cleaned, 1);
  } finally { store.close(); }
});
test('secret-free backup import is confirmed and atomic, rejects duplicates', async () => {
  const { store, ui } = harness(); try {
    const s = ui.sessions.create(guild, 'alice');
    s.backup = { version: 1, sources: [{ subreddit: 'tools', channelId, interval: 60, filters: {} }], settings: {} };
    let next = await click(ui, ui.importReview(s), 'confirm_import'); assert.equal(store.list(guild).length, 1);
    s.backup = { version: 1, sources: [{ subreddit: 'newtools', channelId, interval: 60, filters: {} }, { subreddit: 'tools', channelId, interval: 60, filters: {} }], settings: {} };
    next = await click(ui, ui.importReview(s), 'confirm_import'); assert.match(next.output.content, /Duplicate/); assert.equal(store.list(guild).length, 1);
    store.saveHook(guild, channelId, { token: 'DO_NOT_EXPORT' });
    const i = interaction(); await ui.action(i, s, 'export');
    const backup = i.output.files[0].attachment.toString(); assert.ok(!backup.includes('DO_NOT_EXPORT')); assert.ok(backup.includes('tools'));
  } finally { store.close(); }
});
test('Discord adapter validates guild ownership, permissions and mature destinations', async () => {
  const store = new Store(':memory:', randomBytes(32).toString('hex'));
  try {
    let c = { guildId: guild, type: 0, nsfw: false, permissionsFor: () => ({ has: () => true }) };
    const g = { channels: { fetch: async () => c }, members: { fetchMe: async () => ({}) } };
    const client = { guilds: { fetch: async () => g }, user: { id: 'bot' } };
    const delivery = new DiscordDelivery(client, store);
    assert.equal(await delivery.channel(guild, channelId), c);
    c.guildId = 'other'; await assert.rejects(() => delivery.channel(guild, channelId)); c.guildId = guild;
    c.permissionsFor = () => ({ has: () => false }); await assert.rejects(() => delivery.channel(guild, channelId)); c.permissionsFor = () => ({ has: () => true });
    assert.equal((await delivery.send({ guild_id: guild, channelId }, { nsfw: true }, 'test')).id, 'skipped-nsfw');
  } finally { store.close(); }
});
