export function loadConfig(env = process.env) {
  const mode = env.REDDIT_MODE || 'test';
  if (!['test', 'approved'].includes(mode)) throw new Error('REDDIT_MODE must be test or approved');
  if (!/^[a-f0-9]{64}$/i.test(env.ENCRYPTION_KEY ?? '')) throw new Error('Set ENCRYPTION_KEY to 32 random bytes in hex (see .env.example)');
  const rpm = Number(env.REDDIT_REQUESTS_PER_MINUTE || 30);
  if (!Number.isInteger(rpm) || rpm < 1 || rpm > 60) throw new Error('REDDIT_REQUESTS_PER_MINUTE must be 1–60 and within your approval');
  return { mode, key: env.ENCRYPTION_KEY, dbPath: env.DATABASE_PATH || './data/hookmeup.sqlite',
    token: env.DISCORD_TOKEN, clientId: env.DISCORD_CLIENT_ID, guildId: env.DISCORD_GUILD_ID,
    reddit: { id: env.REDDIT_CLIENT_ID, secret: env.REDDIT_CLIENT_SECRET,
      agent: env.REDDIT_USER_AGENT, reference: env.REDDIT_APPROVAL_REFERENCE,
      subreddits: (env.REDDIT_APPROVED_SUBREDDITS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
      expires: env.REDDIT_APPROVAL_EXPIRES_AT, postSunset: env.REDDIT_POST_SUNSET_APPROVED === 'true', rpm } };
}
export function assertApproval(config, subreddit, now = Date.now()) {
  if (config.mode === 'test') return;
  const r = config.reddit;
  if (!r.id || !r.secret || !r.agent || !r.reference || !r.expires || !Number.isFinite(Date.parse(r.expires)) || Date.parse(r.expires) <= now)
    throw new Error('Live access blocked: explicit, unexpired Reddit approval and OAuth credentials required');
  if (now >= Date.parse('2027-03-01T00:00:00Z') && !r.postSunset)
    throw new Error('Public API sunset: exceptional continuing access requires written Reddit authorization');
  if (!r.subreddits.includes(subreddit.toLowerCase())) throw new Error('This subreddit is outside the approved allowlist');
}
