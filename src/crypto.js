import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
export function seal(text, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv);
  const data = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map(b => b.toString('base64')).join('.');
}
export function open(text, key) {
  const [iv, tag, data] = text.split('.').map(s => Buffer.from(s, 'base64'));
  const cipher = createDecipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv);
  cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(data), cipher.final()]).toString('utf8');
}
