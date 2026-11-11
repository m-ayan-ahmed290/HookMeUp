import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, escapeMarkdown } from 'discord.js';
import { safeUrl } from './reddit.js';

export function postMessage(post, mode) {
  const clean = text => escapeMarkdown(String(text || '')).replaceAll('@', '@\u200b');
  const url = safeUrl(post.url) || 'https://www.reddit.com/';
  const embed = new EmbedBuilder().setColor(mode === 'test' ? 0xf5b841 : 0x00cbd8)
    .setTitle(`${mode === 'test' ? '🧪 ' : ''}${clean(post.title)}`.slice(0, 256))
    .setURL(url).setDescription(clean(post.body).slice(0, 3000) || 'Open the post on Reddit to join the conversation.')
    .addFields({ name: 'Community', value: `r/${clean(post.subreddit)}`, inline: true },
      { name: 'Author', value: `u/${clean(post.author)}`.slice(0, 1024), inline: true },
      { name: 'Score', value: String(post.score), inline: true },
      { name: 'Flair · Type', value: `${clean(post.flair) || 'None'} · ${post.type}`.slice(0, 1024), inline: true })
    .setFooter({ text: mode === 'test' ? 'HookMeUp • TEST DATA • No Reddit request made' : 'HookMeUp • Score at polling time' });
  if (safeUrl(post.image)) embed.setImage(post.image);
  if (post.created && Number.isFinite(post.created)) embed.setTimestamp(post.created);
  const buttons = [new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(mode === 'test' ? 'Reddit (demo)' : 'View on Reddit').setURL(url)];
  if (safeUrl(post.media)) buttons.push(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Watch video').setURL(post.media));
  return { username: 'HookMeUp', embeds: [embed], components: [new ActionRowBuilder().addComponents(buttons)],
    allowedMentions: { parse: [] }, withComponents: true };
}
