import { REST, Routes } from 'discord.js';
import { commands } from '../src/commands.js';
const { DISCORD_TOKEN: token, DISCORD_CLIENT_ID: id, DISCORD_GUILD_ID: guild } = process.env;
if (!token || !id) throw new Error('Set DISCORD_TOKEN and DISCORD_CLIENT_ID in .env');
await new REST({ version: '10' }).setToken(token).put(guild ? Routes.applicationGuildCommands(id, guild) : Routes.applicationCommands(id), { body: commands });
console.log(`Registered ${commands.length} commands ${guild ? 'in the development server' : 'globally'}.`);
