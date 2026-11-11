import { z } from 'zod';

const terms = z.array(z.string().trim().min(1).max(100)).max(30).default([]);
export const filtersSchema = z.object({
  include: terms, exclude: terms,
  match: z.enum(['AND', 'OR']).default('OR'),
  flairs: terms, excludeFlairs: terms, authors: terms, excludeAuthors: terms,
  types: z.array(z.enum(['text', 'image', 'video', 'link', 'gallery'])).max(5).default([]),
  minScore: z.number().int().min(0).max(10000000).default(0),
}).strict();
export const sourceSchema = z.object({
  subreddit: z.string().trim().regex(/^[A-Za-z0-9_]{2,21}$/).transform(s => s.toLowerCase()),
  channelId: z.string().regex(/^\d{17,20}$/),
  interval: z.number().int().min(60).max(86400).default(300),
  filters: filtersSchema.default(() => filtersSchema.parse({})),
}).strict();
export const settingsSchema = z.object({
  notifications: z.string().regex(/^\d{17,20}$/).nullable().default(null),
  allowNsfw: z.boolean().default(false),
  paused: z.boolean().default(false),
}).strict();
export function matches(post, filters) {
  const f = filtersSchema.parse(filters);
  const text = `${post.title}\n${post.body ?? ''}`.toLowerCase();
  const has = term => text.includes(term.toLowerCase());
  const contains = (list, value) => list.some(x => x.toLowerCase() === (value ?? '').toLowerCase());
  if (post.score < f.minScore || f.exclude.some(has)) return false;
  if (f.include.length && !(f.match === 'AND' ? f.include.every(has) : f.include.some(has))) return false;
  if (f.flairs.length && !contains(f.flairs, post.flair)) return false;
  if (contains(f.excludeFlairs, post.flair)) return false;
  if (f.authors.length && !contains(f.authors, post.author)) return false;
  if (contains(f.excludeAuthors, post.author)) return false;
  return !f.types.length || f.types.includes(post.type);
}
