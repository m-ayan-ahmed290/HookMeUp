import { SlashCommandBuilder, PermissionFlagsBits, ChannelType } from 'discord.js';
const cmd = (name, description) => new SlashCommandBuilder().setName(name).setDescription(description).setDMPermission(false).setDefaultMemberPermissions(PermissionFlagsBits.Administrator);
const id = s => s.addStringOption(o => o.setName('id').setDescription('Subscription ID from /source list').setRequired(true));
export const commands = [
  cmd('setup', 'Configure a feed with the guided setup wizard'),
  cmd('dashboard', 'Manage feeds, deliveries, settings and backups with buttons'),
  cmd('source', 'Manage subreddit subscriptions')
    .addSubcommand(s => s.setName('add').setDescription('Open the setup wizard'))
    .addSubcommand(s => s.setName('list').setDescription('Browse subscriptions'))
    .addSubcommand(s => id(s.setName('view').setDescription('Open subscription controls')))
    .addSubcommand(s => id(s.setName('edit').setDescription('Edit subreddit, interval and all filters')))
    .addSubcommand(s => id(s.setName('filters').setDescription('Edit keyword, flair, author, type and score filters')))
    .addSubcommand(s => id(s.setName('destination').setDescription('Select a new destination channel')))
    .addSubcommand(s => id(s.setName('pause').setDescription('Pause this feed and its deliveries')))
    .addSubcommand(s => id(s.setName('resume').setDescription('Resume this feed')))
    .addSubcommand(s => id(s.setName('delete').setDescription('Confirm subscription deletion')))
    .addSubcommand(s => id(s.setName('test').setDescription('Preview synthetic test matches and optionally send a sample')))
    .addSubcommand(s => id(s.setName('retry').setDescription('Retry failed deliveries less than 24 hours old'))),
  cmd('settings', 'Configure failure notifications and mature content policy')
    .addSubcommand(s => s.setName('view').setDescription('View and change server settings'))
    .addSubcommand(s => s.setName('notifications').setDescription('Choose an integration failure notification channel')),
  cmd('status', 'Show health, Reddit access mode and delivery counts'),
  cmd('history', 'Browse recent delivery results'),
  cmd('audit', 'Show recent server configuration changes'),
  cmd('export', 'Download a secret-free configuration backup'),
  cmd('import', 'Review and restore a configuration backup')
    .addAttachmentOption(o => o.setName('file').setDescription('HookMeUp JSON export (up to 100 KB)')),
  cmd('reset', 'Confirm removal of this server’s configuration and bot webhooks'),
  cmd('purge', 'Confirm deletion of tracked relayed messages in this server'),
  cmd('help', 'Show setup instructions, commands, limits and Reddit access policy'),
].map(c => c.toJSON());
export const destinationTypes = [ChannelType.GuildText, ChannelType.GuildAnnouncement];
