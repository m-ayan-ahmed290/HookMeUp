import { WebhookClient, PermissionFlagsBits, ChannelType } from 'discord.js';
import { postMessage } from './forward.js';

export class DiscordDelivery {
  constructor(client, store) { this.client = client; this.store = store; }
  async channel(guild, id, { webhook = true } = {}) {
    const g = await this.client.guilds.fetch(guild);
    const c = await g.channels.fetch(id);
    if (!c || c.guildId !== guild || ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(c.type)) throw new Error('Choose a text or announcement channel in this server');
    const me = await g.members.fetchMe();
    const permissions = c.permissionsFor(me);
    const needed = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks];
    if (webhook) needed.push(PermissionFlagsBits.ManageWebhooks);
    if (!permissions?.has(needed)) throw new Error('Bot needs View Channel, Send Messages, Embed Links and Manage Webhooks in the destination');
    return c;
  }
  async ensure(guild, id) {
    const c = await this.channel(guild, id);
    const existing = this.store.hook(guild, id);
    if (existing) return existing;
    // Reuse only webhooks created by this bot; never adopt another integration's token.
    const hooks = await c.fetchWebhooks();
    const own = hooks.find(h => h.owner?.id === this.client.user.id && h.name === 'HookMeUp' && h.token);
    const h = own || await c.createWebhook({ name: 'HookMeUp', avatar: './assets/avatar-transparent.png', reason: 'HookMeUp administrator setup' });
    const saved = { id: h.id, token: h.token };
    this.store.saveHook(guild, id, saved);
    return saved;
  }
  async send(source, post, mode) {
    const c = await this.channel(source.guild_id, source.channelId);
    if (post.nsfw && !c.nsfw) return { id: 'skipped-nsfw' };
    const hook = await this.ensure(source.guild_id, source.channelId);
    const client = new WebhookClient(hook, { rest: { timeout: 15000, retries: 0 } });
    try { return await client.send(postMessage(post, mode)); }
    catch (error) {
      if ([10015, 50027].includes(error.code)) this.store.forgetHook(source.guild_id, source.channelId);
      throw error;
    } finally { client.destroy(); }
  }
  async notify(guild, message) {
    const id = this.store.settings(guild).notifications;
    if (!id) return;
    const c = await this.channel(guild, id, { webhook: false });
    await c.send({ content: message, allowedMentions: { parse: [] } });
  }
  async removePublished(publication) {
    const hook = this.store.hook(publication.guild_id, publication.channel_id);
    const fallback = async () => {
      const c = await this.channel(publication.guild_id, publication.channel_id, { webhook: false });
      try { await c.messages.delete(publication.message_id); } catch (e) { if (e.code !== 10008) throw e; }
    };
    if (!hook) return fallback();
    const client = new WebhookClient(hook, { rest: { timeout: 15000, retries: 0 } });
    try { await client.deleteMessage(publication.message_id); }
    catch (e) { if ([10015, 50027].includes(e.code)) await fallback(); else if (e.code !== 10008) throw e; }
    finally { client.destroy(); }
  }
  async purge(guild) {
    for (const p of this.store.publications(guild)) { await this.removePublished(p); this.store.unpublish(p.id); }
  }
  async cleanup(guild) {
    await this.purge(guild);
    const g = await this.client.guilds.fetch(guild);
    const hooks = await g.fetchWebhooks();
    for (const hook of hooks.values()) if (hook.owner?.id === this.client.user.id && hook.name === 'HookMeUp') await hook.delete('HookMeUp server reset');
  }
}
