import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('Choose the Node.js 24 runtime in your hosting panel');
const path = '.env';
let contents = existsSync(path) ? readFileSync(path, 'utf8') : readFileSync('.env.example', 'utf8');
if (!/^ENCRYPTION_KEY=[a-f0-9]{64}\s*$/im.test(contents) && !process.env.ENCRYPTION_KEY) {
  if (/^ENCRYPTION_KEY=\s*$/m.test(contents)) contents = contents.replace(/^ENCRYPTION_KEY=\s*$/m, `ENCRYPTION_KEY=${randomBytes(32).toString('hex')}`);
  else if (!/^ENCRYPTION_KEY=/m.test(contents)) contents += `\nENCRYPTION_KEY=${randomBytes(32).toString('hex')}\n`;
  else throw new Error('Existing ENCRYPTION_KEY is not a valid unquoted hex key. Preserve it and fix the format; do not rotate an existing key.');
}
writeFileSync(path, contents, { mode: 0o600 });
mkdirSync('data', { recursive: true, mode: 0o700 });
console.log('Private .env and data directory prepared. Fill Discord credentials privately; the encryption key was not printed. Existing keys were preserved.');
