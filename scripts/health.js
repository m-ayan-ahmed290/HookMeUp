import { readFileSync } from 'node:fs';
try {
  const last = Number(readFileSync(`${process.env.DATABASE_PATH || './data/hookmeup.sqlite'}.health`, 'utf8'));
  process.exit(Date.now() - last < 120000 ? 0 : 1);
} catch { process.exit(1); }
