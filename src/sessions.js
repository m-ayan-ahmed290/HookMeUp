import { randomBytes } from 'node:crypto';
export class Sessions {
  constructor() { this.items = new Map(); }
  create(guild, user, data = {}) {
    this.prune();
    if (this.items.size >= 5000) throw new Error('Too many open panels; try again shortly');
    const value = { ...data, guild, user, expires: Date.now() + 15 * 60000, token: randomBytes(9).toString('hex') };
    this.items.set(value.token, value); return value;
  }
  get(token, guild, user) {
    const s = this.items.get(token);
    if (!s || s.guild !== guild || s.user !== user || s.expires < Date.now()) throw new Error('This panel expired or belongs to another administrator. Open /dashboard again.');
    return s;
  }
  prune() { for (const [key, s] of this.items) if (s.expires < Date.now()) this.items.delete(key); }
}
