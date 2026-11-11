import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const root = spawnSync(process.execPath, ['--check', 'index.js'], { stdio: 'inherit' });
if (root.status !== 0) process.exit(root.status || 1);
for (const directory of ['src', 'scripts', 'test']) {
  for (const file of readdirSync(directory).filter(f => f.endsWith('.js'))) {
    const r = spawnSync(process.execPath, ['--check', `${directory}/${file}`], { stdio: 'inherit' });
    if (r.status !== 0) process.exit(r.status || 1);
  }
}
console.log('Syntax checks passed.');
