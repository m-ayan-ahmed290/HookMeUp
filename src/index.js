import { Client, GatewayIntentBits, Events, REST, Routes, ActivityType } from 'discord.js';
import { writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { loadConfig } from './config.js';
import { Store } from './store.js';
import { Reddit } from './reddit.js';
import { DiscordDelivery } from './discord.js';
import { Worker } from './worker.js';
import { UI } from './ui.js';
import { commands } from './commands.js';
import { log, errorCode } from './log.js';

const config = loadConfig();
if (!config.token || !config.clientId) throw new Error('Set DISCORD_TOKEN and DISCORD_CLIENT_ID in .env (never paste secrets in chat)');
const store = new Store(config.dbPath, config.key), owner = randomUUID();
if (!store.acquireLease(owner)) { store.close(); throw new Error('Another HookMeUp instance is using this database. Wait 60s after a crash.'); }
const client = new Client({ intents: [GatewayIntentBits.Guilds], allowedMentions: { parse: [] }, rest: { timeout: 15000, retries: 2 } });
const delivery = new DiscordDelivery(client, store), worker = new Worker(store, new Reddit(config), delivery, config);
const ui = new UI(store, delivery, worker, config);
client.on(Events.InteractionCreate, i => { void ui.handle(i); });
client.on(Events.Error, e => log('discord_error', { code: errorCode(e) }));
client.on(Events.ShardDisconnect, () => log('discord_disconnected'));
client.on(Events.GuildDelete, guild => { store.erase(guild.id); log('guild_removed', { guild: guild.id }); });
let healthTimer, stopping = false;
async function shutdown(signal, exitCode = 0) {
  if (stopping) return; stopping = true;
  clearInterval(healthTimer); log('shutdown', { signal });
  const forced = setTimeout(() => process.exit(1), 30000); forced.unref();
  await worker.stop(); client.destroy(); store.releaseLease(owner); store.close(); process.exitCode = exitCode;
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('unhandledRejection', e => { log('unhandled_rejection', { code: errorCode(e) }); void shutdown('unhandledRejection', 1); });
client.once(Events.ClientReady, async ready => {
  try {
    if (ready.user.id !== config.clientId) throw new Error('DISCORD_CLIENT_ID does not match this bot token');
    const rest = new REST({ version: '10' }).setToken(config.token);
    await rest.put(config.guildId ? Routes.applicationGuildCommands(config.clientId, config.guildId) : Routes.applicationCommands(config.clientId), { body: commands });
    ready.user.setActivity(config.mode === 'test' ? 'Test mode · /setup' : '/setup · HookMeUp', { type: ActivityType.Watching });
    worker.start();
    healthTimer = setInterval(() => {
      if (!store.acquireLease(owner)) { void shutdown('lease_lost', 1); return; }
      ui.sessions.prune();
      if (client.isReady() && worker.lastTick && Date.now() - worker.lastTick < 120000) writeFileSync(`${config.dbPath}.health`, String(Date.now()), { mode: 0o600 });
    }, 15000);
    log('ready', { mode: config.mode, commands: commands.length });
  } catch (e) { log('startup_failed', { code: errorCode(e) }); await shutdown('startup_failed', 1); }
});
try { await client.login(config.token); } catch (e) { log('login_failed', { code: errorCode(e) }); await shutdown('login_failed', 1); }
