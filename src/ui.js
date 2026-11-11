import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, StringSelectMenuBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle, EmbedBuilder, AttachmentBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { z } from 'zod';
import { Sessions } from './sessions.js';
import { sourceSchema, filtersSchema, settingsSchema, matches } from './schema.js';
import { destinationTypes } from './commands.js';
import fixtures from '../fixtures/posts.json' with { type: 'json' };
import { assertApproval } from './config.js';
import { errorCode, log } from './log.js';

const row = (...items) => new ActionRowBuilder().addComponents(items);
const code = value => String(value).replaceAll('`', '').replaceAll('@', '@\u200b');
const csv = value => value.split(',').map(s => s.trim()).filter(Boolean);
const csvText = values => values.join(', ');
const backupSchema = z.object({ version: z.literal(1), sources: z.array(sourceSchema).max(100), settings: settingsSchema }).strict();
export class UI {
  constructor(store, delivery, worker, config) { Object.assign(this, { store, delivery, worker, config }); this.sessions = new Sessions(); }
  button(s, action, label, style = ButtonStyle.Secondary) { return new ButtonBuilder().setCustomId(`h:${s.token}:${action}`).setLabel(label).setStyle(style); }
  embed(title, text) { return new EmbedBuilder().setColor(0x00cbd8).setTitle(title).setDescription(text).setFooter({ text: `HookMeUp • ${this.config.mode === 'test' ? '🧪 Test mode — synthetic posts only' : 'Approved API mode'} • Private admin panel` }); }
  payload(s, title, text, components = []) {
    // Each render invalidates old panels, including messages left behind by modal replies.
    s.revision = (s.revision || 0) + 1;
    for (const r of components) for (const c of r.components) {
      if (c.data.custom_id) c.setCustomId(`${c.data.custom_id.split(':').slice(0, 3).join(':')}:${s.revision}`);
    }
    return { embeds: [this.embed(title, text)], components, content: '', files: [], allowedMentions: { parse: [] } };
  }
  home(s) {
    const sources = this.store.list(s.guild);
    return this.payload(s, 'HookMeUp · Your connections', `**${sources.length} subscriptions** · ${sources.filter(x => !x.paused).length} enabled\n\nCatch the posts you care about. Route each community to its own channel and fine-tune what comes through.\n\n${this.config.mode === 'test' ? '🧪 **Test mode:** all posts are clearly labeled synthetic examples. No live Reddit requests.' : '🔐 Live access is limited to the operator’s approved subreddit allowlist.'}`, [
      row(this.button(s, 'setup', '＋ Add feed', ButtonStyle.Primary), this.button(s, 'list', 'Subscriptions'), this.button(s, 'health', 'Health')),
      row(this.button(s, 'settings', 'Settings'), this.button(s, 'history', 'Delivery history'), this.button(s, 'audit', 'Audit log')),
      row(this.button(s, 'export', 'Export backup'), this.button(s, 'import', 'Import backup'), this.button(s, 'reset', 'Reset server', ButtonStyle.Danger), this.button(s, 'help', 'Help')),
    ]);
  }
  nav(s) { return row(this.button(s, 'home', 'Dashboard')); }
  list(s, page = 0) {
    s.page = Math.max(0, page);
    const all = this.store.list(s.guild), items = all.slice(s.page * 10, s.page * 10 + 10);
    const controls = [];
    if (items.length) controls.push(row(new StringSelectMenuBuilder().setCustomId(`h:${s.token}:choose`).setPlaceholder('Choose a subscription').addOptions(items.map(x => ({ label: `r/${x.subreddit} · ${x.id}`, description: `${x.paused ? 'Paused' : 'Enabled'} · every ${x.interval}s`, value: x.id })))));
    controls.push(row(this.button(s, 'prev', 'Previous').setDisabled(s.page === 0), this.button(s, 'next', 'Next').setDisabled((s.page + 1) * 10 >= all.length), this.button(s, 'setup', '＋ Add feed', ButtonStyle.Primary), this.button(s, 'home', 'Dashboard')));
    return this.payload(s, `Subscriptions · Page ${s.page + 1}`, items.map(x => `${x.paused ? '⏸' : '●'} **r/${x.subreddit}** → <#${x.channelId}>\nID: \`${x.id}\` · ${x.interval}s`).join('\n\n') || 'No subscriptions yet. Add your first feed to get started.', controls);
  }
  source(s) {
    const x = this.requireSource(s);
    return this.payload(s, `r/${x.subreddit} · ${x.paused ? 'Paused' : 'Enabled'}`, `Destination: <#${x.channelId}>\nInterval: **${x.interval} seconds**\nID: \`${x.id}\`\n\n**Filters**\n${this.describe(x.filters)}\n\nLast poll: ${x.last_poll ? `<t:${Math.floor(x.last_poll / 1000)}:R>` : 'Not yet'}\nLast error: ${code(x.last_error || 'None')}`, [
      row(this.button(s, 'edit', 'Edit feed', ButtonStyle.Primary), this.button(s, 'filters', 'Filters'), this.button(s, 'destination', 'Destination'), this.button(s, 'toggle', x.paused ? 'Resume' : 'Pause')),
      row(this.button(s, 'preview', 'Test & preview'), this.button(s, 'retry', 'Retry failures'), this.button(s, 'diagnostics', 'Diagnostics'), this.button(s, 'delete', 'Delete', ButtonStyle.Danger)),
      row(this.button(s, 'list', 'All subscriptions'), this.button(s, 'home', 'Dashboard')),
    ]);
  }
  describe(f) {
    return [`Keywords (${f.match}): ${code(csvText(f.include)) || 'Any'}`, `Exclude: ${code(csvText(f.exclude)) || 'None'}`,
      `Flairs: ${code(csvText(f.flairs)) || 'Any'} · Exclude: ${code(csvText(f.excludeFlairs)) || 'None'}`,
      `Authors: ${code(csvText(f.authors)) || 'Any'} · Exclude: ${code(csvText(f.excludeAuthors)) || 'None'}`,
      `Types: ${csvText(f.types) || 'Any'} · Minimum score: ${f.minScore}`].join('\n').slice(0, 2800);
  }
  requireSource(s) { const x = this.store.get(s.guild, s.source); if (!x) throw new Error('Subscription no longer exists'); return x; }
  wizard(s, step = 'intro') {
    s.step = step;
    const d = s.draft;
    if (step === 'intro') return this.payload(s, 'Connect a community · 1 of 6', 'Start with a subreddit name and polling interval. Public communities still require official approval for live monitoring.\n\nTest mode works with any valid community name and makes no Reddit requests.', [row(this.button(s, 'basics', 'Set community & timing', ButtonStyle.Primary), this.button(s, 'home', 'Cancel'))]);
    if (step === 'channel') return this.payload(s, 'Choose a destination · 2 of 6', `r/${d.subreddit} · every ${d.interval}s\n\nChoose a text channel. HookMeUp checks permissions and creates its own webhook when you save.`, [row(new ChannelSelectMenuBuilder().setCustomId(`h:${s.token}:wizardChannel`).setPlaceholder('Destination channel').setChannelTypes(destinationTypes)), row(this.button(s, 'basics', 'Back'), this.button(s, 'home', 'Cancel'))]);
    if (step === 'keywords') return this.payload(s, 'Choose your keywords · 3 of 6', `Destination: <#${d.channelId}>\n\nKeywords are case-insensitive phrases matched against title and text. Exclusions always win. Use AND to require every include phrase, OR to match any.`, [row(this.button(s, 'keywords', 'Set keywords', ButtonStyle.Primary), this.button(s, 'advanced', 'Skip / keep current')), row(this.button(s, 'wizardBackChannel', 'Back'), this.button(s, 'home', 'Cancel'))]);
    if (step === 'advanced') return this.payload(s, 'Fine-tune your feed · 4 of 6', `${this.describe(d.filters)}\n\nAll configured filter categories must pass. Flairs and authors use exact case-insensitive matching. Blank lists match any.`, [row(this.button(s, 'flairs', 'Flairs'), this.button(s, 'authors', 'Authors'), this.button(s, 'types', 'Types & score'), this.button(s, 'keywords', 'Keywords')), row(this.button(s, 'wizardNotifications', 'Continue', ButtonStyle.Primary), this.button(s, 'wizardBackKeywords', 'Back'), this.button(s, 'home', 'Cancel'))]);
    if (step === 'notifications') return this.payload(s, 'Stay informed · 5 of 6', 'Optional: choose a channel for integration failure alerts. This setting applies to this entire server. Alerts are limited to one per issue per hour.', [row(new ChannelSelectMenuBuilder().setCustomId(`h:${s.token}:wizardNotify`).setPlaceholder('Failure notifications channel').setChannelTypes(destinationTypes)), row(this.button(s, 'review', 'Keep current / skip', ButtonStyle.Primary), this.button(s, 'advanced', 'Back'), this.button(s, 'home', 'Cancel'))]);
    return this.payload(s, 'Review your connection · 6 of 6', `**r/${d.subreddit}** → <#${d.channelId}>\nPoll every **${d.interval}s**\n\n${this.describe(d.filters)}\n\nNotifications: ${s.notify ? `<#${s.notify}>` : 'Keep current'}\n\n${this.config.mode === 'test' ? '🧪 Saving enables synthetic test deliveries only.' : 'Live API access requires current approval for this community.'}`, [row(this.button(s, 'save', s.source ? 'Save changes' : 'Create connection', ButtonStyle.Success), this.button(s, 'advanced', 'Edit filters'), this.button(s, 'wizardBackChannel', 'Edit channel'), this.button(s, 'home', 'Cancel'))]);
  }
  modal(s, action, title, fields) {
    s.revision = (s.revision || 0) + 1;
    return new ModalBuilder().setCustomId(`h:${s.token}:modal_${action}:${s.revision}`).setTitle(title).addComponents(fields.map(([id, label, value, placeholder, paragraph = false]) => row(new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(paragraph ? TextInputStyle.Paragraph : TextInputStyle.Short).setRequired(false).setMaxLength(action === 'import' ? 4000 : 1000).setValue(String(value ?? '')).setPlaceholder(placeholder || 'Leave blank for any / none'))));
  }
  settings(s) {
    const v = this.store.settings(s.guild);
    return this.payload(s, 'Server settings', `Notifications: ${v.notifications ? `<#${v.notifications}>` : 'Off'}\nMature content: **${v.allowNsfw ? 'Allowed only in age-restricted channels' : 'Blocked'}**\nAll subscriptions: **${v.paused ? 'Paused' : 'Running'}**\n\nRelayed messages expire after 24h while online. Approved live posts are checked for deletion roughly every 15 minutes, subject to API availability.`, [row(this.button(s, 'notifications', 'Notification channel'), this.button(s, 'notifyOff', 'Disable alerts')), row(this.button(s, 'nsfw', v.allowNsfw ? 'Block mature content' : 'Allow mature content'), this.button(s, 'pauseAll', v.paused ? 'Resume all' : 'Pause all')), row(this.button(s, 'purge', 'Delete relayed messages', ButtonStyle.Danger)), this.nav(s)]);
  }
  health(s) {
    let approval = 'Test mode — no Reddit requests';
    if (this.config.mode === 'approved') { try { assertApproval(this.config, this.config.reddit.subreddits[0] || ''); approval = 'Configured and unexpired (not proof of upstream availability)'; } catch (e) { approval = e.message; } }
    return this.payload(s, 'Integration health', `Discord: **${this.delivery.client?.isReady() ? 'Connected' : 'Not connected / test harness'}**\nWorker: ${this.worker.lastTick ? `<t:${Math.floor(this.worker.lastTick / 1000)}:R>` : 'Not ticked yet'}\nReddit: **${this.config.mode}**\n${approval}\n\n${this.store.stats(s.guild).map(x => `${x.status}: **${x.total}**`).join('\n') || 'No deliveries yet.'}\n\nPolling checks the latest 100 posts from the last 24h; busy communities can outpace it. Scores are snapshots. This process runs only while its host is awake.`, [this.nav(s)]);
  }
  history(s, page = 0) {
    s.historyPage = Math.max(0, page);
    const entries = this.store.history(s.guild, s.historyPage);
    return this.payload(s, `Delivery history · ${s.historyPage + 1}`, entries.map(x => `**${x.status}** · ${x.source} · ${code(x.post_id)}\nAttempts: ${x.attempts} · ${code(x.error || 'OK')} · <t:${Math.floor(x.created / 1000)}:R>`).join('\n\n') || 'No deliveries on this page.', [row(this.button(s, 'historyPrev', 'Previous').setDisabled(s.historyPage === 0), this.button(s, 'historyNext', 'Next').setDisabled(entries.length < 8), this.button(s, 'home', 'Dashboard'))]);
  }
  confirm(s, action, title, text) { return this.payload(s, title, text, [row(this.button(s, `confirm_${action}`, 'Confirm', ButtonStyle.Danger), this.button(s, 'home', 'Cancel'))]); }
  async respond(i, payload) {
    if (i.deferred || i.replied) return i.editReply(payload);
    if (i.isMessageComponent()) return i.update(payload);
    return i.reply({ ...payload, flags: MessageFlags.Ephemeral });
  }
  async readAttachment(file) {
    if (file.size > 100000) throw new Error('Backup exceeds 100 KB');
    const u = new URL(file.url);
    if (u.protocol !== 'https:' || !['cdn.discordapp.com', 'media.discordapp.net'].includes(u.hostname) || !u.pathname.startsWith('/attachments/')) throw new Error('Use a JSON attachment uploaded to Discord');
    const r = await fetch(u, { signal: AbortSignal.timeout(10000), redirect: 'error' });
    if (!r.ok) throw new Error('Could not download backup');
    const reader = r.body.getReader(); let size = 0; const chunks = [];
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 100000) { await reader.cancel(); throw new Error('Backup exceeds 100 KB'); } chunks.push(Buffer.from(value)); }
    return backupSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  }
  async handle(i) {
    try {
      if (!i.inGuild() || !i.memberPermissions?.has(PermissionFlagsBits.Administrator)) throw new Error('Only server administrators can manage HookMeUp');
      if (i.isChatInputCommand()) return await this.slash(i);
      if (!i.customId?.startsWith('h:')) return;
      const [, token, action, revision] = i.customId.split(':');
      const s = this.sessions.get(token, i.guildId, i.user.id);
      if (Number(revision) !== s.revision || s.locked) throw new Error('This panel is outdated or busy. Use the newest panel or open /dashboard.');
      if (action.startsWith('modal_')) return await this.submit(i, s, action.slice(6));
      s.locked = true;
      try { return await this.action(i, s, action); } finally { s.locked = false; }
    } catch (e) {
      log('interaction_failed', { guild: i.guildId, code: errorCode(e) });
      const text = e instanceof z.ZodError ? e.issues.slice(0, 4).map(x => `${x.path.join('.')}: ${x.message}`).join('\n') : e.code || e.status ? `Discord request failed (code ${errorCode(e)}). Check permissions in /dashboard.` : e.message;
      const payload = { content: `⚠️ ${code(text).slice(0, 1800)}`, allowedMentions: { parse: [] }, components: [], embeds: [] };
      if (i.deferred || i.replied) await i.editReply(payload).catch(() => {});
      else await i.reply({ ...payload, flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }
  newDraft(s, source = null) {
    s.source = source?.id; s.notify = null;
    s.draft = source ? sourceSchema.parse({ subreddit: source.subreddit, channelId: source.channelId, interval: source.interval, filters: source.filters }) : { subreddit: '', channelId: '', interval: 300, filters: filtersSchema.parse({}) };
  }
  async slash(i) {
    const s = this.sessions.create(i.guildId, i.user.id);
    const name = i.commandName;
    if (name === 'setup') { this.newDraft(s); return this.respond(i, this.wizard(s)); }
    if (name === 'dashboard') return this.respond(i, this.home(s));
    if (name === 'status') return this.respond(i, this.health(s));
    if (name === 'history') return this.respond(i, this.history(s));
    if (name === 'source') {
      const action = i.options.getSubcommand();
      if (action === 'add') { this.newDraft(s); return this.respond(i, this.wizard(s)); }
      if (action === 'list') return this.respond(i, this.list(s));
      s.source = i.options.getString('id', true); this.requireSource(s);
      if (action === 'view') return this.respond(i, this.source(s));
      if (['edit', 'filters', 'destination'].includes(action)) { this.newDraft(s, this.requireSource(s)); return this.respond(i, this.wizard(s, action === 'edit' ? 'intro' : action === 'filters' ? 'advanced' : 'channel')); }
      if (['pause', 'resume'].includes(action)) { this.store.pause(s.guild, s.source, action === 'pause'); this.store.audit(s.guild, s.user, `${action}:${s.source}`); return this.respond(i, this.source(s)); }
      return this.action(i, s, action === 'test' ? 'preview' : action);
    }
    if (name === 'settings') return this.action(i, s, i.options.getSubcommand() === 'notifications' ? 'notifications' : 'settings');
    if (name === 'import' && i.options.getAttachment('file')) {
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      s.backup = await this.readAttachment(i.options.getAttachment('file'));
      return this.respond(i, this.importReview(s));
    }
    return this.action(i, s, name);
  }
  importReview(s) { return this.confirm(s, 'import', 'Review configuration import', `Add **${s.backup.sources.length} subscriptions** and replace server settings. Destination channels must belong to this server. Existing subscriptions remain. Duplicate community/channel pairs block the whole import. Webhook tokens are never imported.`); }
  async action(i, s, action) {
    if (action === 'home') { delete s.draft; delete s.backup; return this.respond(i, this.home(s)); }
    if (action === 'setup') { this.newDraft(s); return this.respond(i, this.wizard(s)); }
    if (action === 'list') return this.respond(i, this.list(s));
    if (['prev', 'next'].includes(action)) return this.respond(i, this.list(s, s.page + (action === 'next' ? 1 : -1)));
    if (action === 'choose') { s.source = i.values[0]; return this.respond(i, this.source(s)); }
    if (action === 'edit' || action === 'filters' || action === 'destination') { this.newDraft(s, this.requireSource(s)); return this.respond(i, this.wizard(s, action === 'edit' ? 'intro' : action === 'filters' ? 'advanced' : 'channel')); }
    if (action === 'basics') return i.showModal(this.modal(s, 'basics', 'Community & polling', [['subreddit', 'Subreddit (without r/)', s.draft.subreddit, 'e.g. programming'], ['interval', 'Polling interval in seconds (60–86400)', s.draft.interval, '300']]));
    if (action === 'wizardBackChannel') return this.respond(i, this.wizard(s, 'channel'));
    if (action === 'wizardChannel') {
      await i.deferUpdate();
      await this.delivery.channel(s.guild, i.values[0]); s.draft.channelId = i.values[0]; return this.respond(i, this.wizard(s, 'keywords'));
    }
    if (action === 'wizardBackKeywords') return this.respond(i, this.wizard(s, 'keywords'));
    if (action === 'keywords') return i.showModal(this.modal(s, 'keywords', 'Keyword rules', [['include', 'Include phrases, comma separated', csvText(s.draft.filters.include)], ['exclude', 'Exclude phrases, comma separated', csvText(s.draft.filters.exclude)], ['match', 'Match includes: AND or OR', s.draft.filters.match]]));
    if (action === 'flairs') return i.showModal(this.modal(s, 'flairs', 'Flair rules', [['include', 'Allowed flairs, comma separated', csvText(s.draft.filters.flairs)], ['exclude', 'Excluded flairs, comma separated', csvText(s.draft.filters.excludeFlairs)]]));
    if (action === 'authors') return i.showModal(this.modal(s, 'authors', 'Author rules', [['include', 'Allowed usernames (without u/)', csvText(s.draft.filters.authors)], ['exclude', 'Excluded usernames (without u/)', csvText(s.draft.filters.excludeAuthors)]]));
    if (action === 'types') return this.respond(i, this.payload(s, 'Post types & score', 'Choose one or more types; clear the selection to allow every type.', [row(new StringSelectMenuBuilder().setCustomId(`h:${s.token}:typeSelect`).setPlaceholder('Post types (empty = all)').setMinValues(0).setMaxValues(5).addOptions(['text', 'image', 'video', 'link', 'gallery'].map(t => ({ label: t, value: t, default: s.draft.filters.types.includes(t) })))), row(this.button(s, 'score', 'Minimum score'), this.button(s, 'advanced', 'Done'))]));
    if (action === 'typeSelect') { s.draft.filters.types = i.values; return this.respond(i, this.wizard(s, 'advanced')); }
    if (action === 'score') return i.showModal(this.modal(s, 'score', 'Minimum upvotes', [['score', 'Minimum score (0 or greater)', s.draft.filters.minScore, '0']]));
    if (action === 'advanced') return this.respond(i, this.wizard(s, 'advanced'));
    if (action === 'wizardNotifications') return this.respond(i, this.wizard(s, 'notifications'));
    if (action === 'wizardNotify') { await i.deferUpdate(); await this.delivery.channel(s.guild, i.values[0], { webhook: false }); s.notify = i.values[0]; return this.respond(i, this.wizard(s, 'review')); }
    if (action === 'review') return this.respond(i, this.wizard(s, 'review'));
    if (action === 'save') {
      const data = sourceSchema.parse(s.draft); assertApproval(this.config, data.subreddit);
      await this.defer(i);
      await this.delivery.ensure(s.guild, data.channelId);
      const saved = s.source ? this.store.update(s.guild, s.source, data) : this.store.add(s.guild, data);
      if (s.notify) this.store.setSettings(s.guild, { notifications: s.notify });
      s.source = saved.id; delete s.draft;
      this.store.audit(s.guild, s.user, `save:${saved.id}`);
      return this.respond(i, this.source(s));
    }
    if (action === 'toggle') { const x = this.requireSource(s); this.store.pause(s.guild, x.id, !x.paused); this.store.audit(s.guild, s.user, `pause:${x.id}:${!x.paused}`); return this.respond(i, this.source(s)); }
    if (action === 'delete') return this.respond(i, this.confirm(s, 'delete', 'Delete this subscription?', 'Removes this subscription, its delivery queue and duplicate history. Shared webhooks remain for other feeds.'));
    if (action === 'confirm_delete') { this.requireSource(s); this.store.remove(s.guild, s.source); this.store.audit(s.guild, s.user, `delete:${s.source}`); s.source = null; return this.respond(i, this.list(s)); }
    if (action === 'retry') { this.requireSource(s); this.store.retry(s.guild, s.source); this.store.audit(s.guild, s.user, `retry:${s.source}`); return this.respond(i, this.source(s)); }
    if (action === 'preview') {
      const x = this.requireSource(s), posts = fixtures.filter(p => matches(p, x.filters));
      return this.respond(i, this.payload(s, 'Synthetic filter preview', `**${posts.length} of ${fixtures.length} fixtures match.**\n\n${fixtures.map(p => `${matches(p, x.filters) ? '✅' : '➖'} ${p.title}`).join('\n')}\n\nSend sample explicitly posts one matching, clearly labeled test embed to <#${x.channelId}>. This does not fetch Reddit data.`, [row(this.button(s, 'sendSample', 'Send test sample', ButtonStyle.Primary).setDisabled(!posts.length), this.button(s, 'source', 'Back'))]));
    }
    if (action === 'source') return this.respond(i, this.source(s));
    if (action === 'sendSample') {
      await this.defer(i); const x = this.requireSource(s); const post = fixtures.find(p => matches(p, x.filters));
      if (!post) throw new Error('No synthetic fixtures match; relax filters to test delivery');
      const message = await this.delivery.send(x, { ...post, subreddit: x.subreddit, created: Date.now(), url: 'https://www.reddit.com/' }, 'test');
      this.store.published(x, post, message.id, 'test');
      this.store.audit(s.guild, s.user, `test:${x.id}`);
      return this.respond(i, this.payload(s, 'Test delivered', `A synthetic sample was sent to <#${x.channelId}>.`, [row(this.button(s, 'source', 'Back'))]));
    }
    if (action === 'diagnostics') {
      await this.defer(i); const x = this.requireSource(s); await this.delivery.channel(s.guild, x.channelId);
      let status = 'Test mode: no live request'; try { assertApproval(this.config, x.subreddit); } catch (e) { status = e.message; }
      return this.respond(i, this.payload(s, 'Subscription diagnostics', `✅ Destination and bot permissions checked\nReddit: ${code(status)}\nConsecutive poll failures: ${x.failures}\nLast error: ${code(x.last_error || 'None')}\n\nDeleted webhooks are recreated on the next retry. Permission errors need a server administrator.`, [row(this.button(s, 'source', 'Back'))]));
    }
    if (action === 'settings') return this.respond(i, this.settings(s));
    if (action === 'notifications') return this.respond(i, this.payload(s, 'Failure notifications', 'Select a text channel for rate-limited integration alerts.', [row(new ChannelSelectMenuBuilder().setCustomId(`h:${s.token}:setNotify`).setChannelTypes(destinationTypes).setPlaceholder('Choose notification channel')), row(this.button(s, 'settings', 'Back'))]));
    if (action === 'setNotify') { await this.defer(i); await this.delivery.channel(s.guild, i.values[0], { webhook: false }); this.store.setSettings(s.guild, { notifications: i.values[0] }); this.store.audit(s.guild, s.user, 'notifications'); return this.respond(i, this.settings(s)); }
    if (action === 'notifyOff') { this.store.setSettings(s.guild, { notifications: null }); this.store.audit(s.guild, s.user, 'notifications:off'); return this.respond(i, this.settings(s)); }
    if (action === 'nsfw') return this.respond(i, this.confirm(s, 'nsfw', 'Change mature content policy?', 'Enabling mature content still requires an age-restricted Discord destination. Disabling it blocks future mature deliveries.'));
    if (action === 'confirm_nsfw') { this.store.setSettings(s.guild, { allowNsfw: !this.store.settings(s.guild).allowNsfw }); this.store.audit(s.guild, s.user, 'mature-policy'); return this.respond(i, this.settings(s)); }
    if (action === 'pauseAll') { this.store.setSettings(s.guild, { paused: !this.store.settings(s.guild).paused }); this.store.audit(s.guild, s.user, 'toggle-all'); return this.respond(i, this.settings(s)); }
    if (action === 'health') return this.respond(i, this.health(s));
    if (action.startsWith('history')) return this.respond(i, this.history(s, action === 'history' ? 0 : (s.historyPage || 0) + (action === 'historyNext' ? 1 : -1)));
    if (action === 'audit') return this.respond(i, this.payload(s, 'Configuration audit', this.store.audits(s.guild).map(x => `${code(x.action)} · <@${x.actor}> · <t:${Math.floor(x.created / 1000)}:R>`).join('\n') || 'No configuration changes recorded.', [this.nav(s)]));
    if (action === 'export') {
      const data = { version: 1, sources: this.store.list(s.guild).map(x => sourceSchema.parse({ subreddit: x.subreddit, channelId: x.channelId, interval: x.interval, filters: x.filters })), settings: this.store.settings(s.guild) };
      return this.respond(i, { ...this.payload(s, 'Configuration backup', 'Contains subscriptions and server settings. No tokens, webhook credentials or post content. Individual feed pause states are not exported.', [this.nav(s)]), files: [new AttachmentBuilder(Buffer.from(JSON.stringify(data, null, 2)), { name: 'hookmeup-backup.json' })] });
    }
    if (action === 'import') return i.showModal(this.modal(s, 'import', 'Import configuration', [['json', 'Backup JSON (larger files: /import file)', '', 'Exported HookMeUp JSON', true]]));
    if (action === 'confirm_import') {
      if (!s.backup) throw new Error('Import expired; upload the backup again');
      await this.defer(i);
      const backup = backupSchema.parse(s.backup); const existing = this.store.list(s.guild);
      if (existing.length + backup.sources.length > 100) throw new Error('Import exceeds 100 subscriptions');
      const pairs = new Set(existing.map(x => `${x.subreddit}:${x.channelId}`));
      for (const x of backup.sources) { assertApproval(this.config, x.subreddit); const pair = `${x.subreddit}:${x.channelId}`; if (pairs.has(pair)) throw new Error('Duplicate subreddit/channel in import'); pairs.add(pair); }
      if (backup.settings.notifications) await this.delivery.channel(s.guild, backup.settings.notifications, { webhook: false });
      for (const x of backup.sources) await this.delivery.ensure(s.guild, x.channelId);
      this.store.db.exec('BEGIN');
      try { for (const x of backup.sources) this.store.add(s.guild, x); this.store.setSettings(s.guild, backup.settings); this.store.audit(s.guild, s.user, 'import'); this.store.db.exec('COMMIT'); } catch (e) { this.store.db.exec('ROLLBACK'); throw e; }
      delete s.backup; return this.respond(i, this.list(s));
    }
    if (action === 'purge') return this.respond(i, this.confirm(s, 'purge', 'Delete relayed messages?', 'Deletes all currently tracked HookMeUp messages in this server. Pending deliveries remain; pause all feeds first if needed. This cannot be undone.'));
    if (action === 'confirm_purge') { await this.defer(i); await this.delivery.purge(s.guild); this.store.audit(s.guild, s.user, 'purge'); return this.respond(i, this.settings(s)); }
    if (action === 'reset') return this.respond(i, this.confirm(s, 'reset', 'Reset this server?', 'Deletes tracked relayed messages, every subscription, pending delivery, local history, settings and HookMeUp-owned webhook in this server. This cannot be undone. Export a backup first.'));
    if (action === 'confirm_reset') { await this.defer(i); this.store.setSettings(s.guild, { paused: true }); await this.worker.running; await this.delivery.cleanup(s.guild); this.store.erase(s.guild); this.sessions.items.delete(s.token); return this.respond(i, { content: 'Server reset complete. Run /setup to start again.', embeds: [], components: [], files: [] }); }
    if (action === 'help') return this.respond(i, this.payload(s, 'HookMeUp · Help', '**Start:** /setup → community → channel → keywords → rules → alerts → review.\n**Manage:** /dashboard or /source add|list|view|edit|filters|destination|pause|resume|delete|test|retry.\n**Server:** /settings, /status, /history, /audit, /export, /import, /purge, /reset.\n\nOnly administrators can manage feeds. Panels expire after 15 minutes and belong to their opener. All filters work without regex. Blank filters match any.\n\nTest mode uses synthetic fixtures. Live access needs operator-configured written Reddit approval and credentials. RSS and scraping are never used. Devvit is not permission to monitor arbitrary communities.\n\nLatest 100 posts, last 24h, no guarantee of complete coverage. Automatic retries can duplicate a delivery after an ambiguous network failure. Relayed messages expire after 24h while online; /purge deletes tracked messages sooner.\n\n[Setup & policy](https://github.com/m-ayan-ahmed290/HookMeUp#readme)', [this.nav(s)]));
    throw new Error('Unknown action; open /dashboard again');
  }
  async defer(i) { if (i.isMessageComponent()) await i.deferUpdate(); else await i.deferReply({ flags: MessageFlags.Ephemeral }); }
  async submit(i, s, kind) {
    const get = name => i.fields.getTextInputValue(name).trim();
    if (kind === 'import') { s.backup = backupSchema.parse(JSON.parse(get('json'))); return this.respond(i, this.importReview(s)); }
    if (!s.draft) throw new Error('Setup expired; start again with /setup');
    if (kind === 'basics') {
      const d = sourceSchema.parse({ ...s.draft, subreddit: get('subreddit').replace(/^r\//i, ''), interval: Number(get('interval')), channelId: s.draft.channelId || '100000000000000000' });
      s.draft.subreddit = d.subreddit; s.draft.interval = d.interval;
      return this.respond(i, this.wizard(s, 'channel'));
    }
    let patch;
    if (kind === 'keywords') patch = { include: csv(get('include')), exclude: csv(get('exclude')), match: get('match').toUpperCase() || 'OR' };
    if (kind === 'flairs') patch = { flairs: csv(get('include')), excludeFlairs: csv(get('exclude')) };
    if (kind === 'authors') patch = { authors: csv(get('include')).map(x => x.replace(/^u\//i, '')), excludeAuthors: csv(get('exclude')).map(x => x.replace(/^u\//i, '')) };
    if (kind === 'score') patch = { minScore: Number(get('score')) };
    if (!patch) throw new Error('Unknown form');
    s.draft.filters = filtersSchema.parse({ ...s.draft.filters, ...patch });
    return this.respond(i, this.wizard(s, 'advanced'));
  }
}
