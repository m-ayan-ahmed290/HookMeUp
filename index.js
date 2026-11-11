// Hosting panels commonly expect a root index.js. Keep all application logic in src/.
import { existsSync } from 'node:fs';
if (existsSync('.env')) process.loadEnvFile('.env');
await import('./src/index.js');
