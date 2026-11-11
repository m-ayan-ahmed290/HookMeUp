import fixtures from '../fixtures/posts.json' with { type: 'json' };
import { assertApproval } from './config.js';

export class HttpError extends Error {
  constructor(status, retryAfter = 0) { super(`Upstream HTTP ${status}`); this.status = status; this.retryAfter = retryAfter; }
}
export function safeUrl(value) {
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password ? u.href : null; } catch { return null; }
}
export function normalize(p) {
  if (!p.id || !p.title || p.author === '[deleted]' || p.removed_by_category || ['[deleted]', '[removed]'].includes(p.selftext)) return null;
  const image = p.url_overridden_by_dest || p.url;
  const preview = p.preview?.images?.[0]?.source?.url?.replaceAll('&amp;', '&');
  const video = p.media?.reddit_video?.fallback_url;
  const type = p.is_gallery ? 'gallery' : p.is_video ? 'video' : p.is_self ? 'text' : /\.(png|jpe?g|gif|webp)(\?|$)/i.test(image || '') ? 'image' : 'link';
  return { id: String(p.id), title: String(p.title), body: String(p.selftext || '').slice(0, 3000), author: String(p.author || '[deleted]'),
    flair: String(p.link_flair_text || ''), score: Number(p.score) || 0, nsfw: Boolean(p.over_18), type,
    created: Number(p.created_utc) * 1000, url: safeUrl(`https://www.reddit.com${p.permalink}`),
    image: safeUrl(type === 'image' ? image : preview), media: safeUrl(video), subreddit: String(p.subreddit).toLowerCase() };
}
export class Reddit {
  constructor(config, fetcher = fetch) { this.config = config; this.fetch = fetcher; this.token = null; this.expires = 0; this.next = 0; }
  async request(url, options) {
    if (Date.now() < this.next) { const e = new HttpError(429, this.next - Date.now()); throw e; }
    this.next = Date.now() + Math.ceil(60000 / this.config.reddit.rpm);
    const response = await this.fetch(url, { ...options, signal: AbortSignal.timeout(20000), redirect: 'error' });
    if (!response.ok) {
      let delay = Number(response.headers.get('retry-after')) * 1000;
      if (!Number.isFinite(delay)) delay = Math.max(0, Date.parse(response.headers.get('retry-after')) - Date.now()) || 0;
      if (response.status === 429) this.next = Date.now() + Math.max(delay, 60000);
      if (response.status === 401) this.expires = 0;
      throw new HttpError(response.status, delay);
    }
    if (Number(response.headers.get('x-ratelimit-remaining') ?? 1) < 1) this.next = Date.now() + Math.max(1000, Number(response.headers.get('x-ratelimit-reset')) * 1000 || 60000);
    return response.json();
  }
  async posts(subreddit) {
    assertApproval(this.config, subreddit);
    if (this.config.mode === 'test') return fixtures.map(p => ({ ...p, subreddit, created: Date.now(), url: 'https://www.reddit.com/' }));
    await this.authenticate();
    const r = this.config.reddit;
    const data = await this.request(`https://oauth.reddit.com/r/${encodeURIComponent(subreddit)}/new?limit=100&raw_json=1`, {
      headers: { Authorization: `Bearer ${this.token}`, 'User-Agent': r.agent } });
    if (!Array.isArray(data.data?.children)) throw new Error('Invalid Reddit listing');
    return data.data.children.map(x => normalize(x.data)).filter(Boolean).filter(p => p.subreddit === subreddit && Date.now() - p.created < 86400000);
  }
  async info(publications) {
    for (const p of publications) assertApproval(this.config, p.subreddit);
    await this.authenticate();
    const ids = [...new Set(publications.map(p => `t3_${p.post_id}`))].slice(0, 100);
    const data = await this.request(`https://oauth.reddit.com/api/info?id=${encodeURIComponent(ids.join(','))}&raw_json=1`, {
      headers: { Authorization: `Bearer ${this.token}`, 'User-Agent': this.config.reddit.agent } });
    if (!Array.isArray(data.data?.children)) throw new Error('Invalid Reddit info response');
    return new Set(data.data.children.filter(x => x.data.author !== '[deleted]' && normalize(x.data)).map(x => x.data.id));
  }
  async authenticate() {
    // Callers must check the approval gate before invoking authentication.
    const r = this.config.reddit;
    if (!this.token || Date.now() >= this.expires) {
      const data = await this.request('https://www.reddit.com/api/v1/access_token', { method: 'POST',
        headers: { Authorization: `Basic ${Buffer.from(`${r.id}:${r.secret}`).toString('base64')}`, 'User-Agent': r.agent, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=client_credentials' });
      if (!data.access_token || data.error) throw new Error('OAuth token unavailable');
      this.token = data.access_token; this.expires = Date.now() + (data.expires_in - 60) * 1000;
      // Next tick fetches listings, respecting the shared request budget.
      throw new HttpError(429, Math.max(1000, this.next - Date.now()));
    }
  }
}
