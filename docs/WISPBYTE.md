# Deploy HookMeUp on Wispbyte

Your selected hosting target is **Wispbyte’s free Node.js service**. No paid plan is needed for this project’s test mode. This guide prepares deployment; it does not mean a server has been created or the bot is online.

## What was verified

Wispbyte’s [free hosting page](https://wispbyte.com/free-discord-bot-hosting) advertises free, no-card bot hosting. Its [getting-started guide](https://wispbyte.com/kb/getting-started) describes server creation, file uploads, startup settings and an activity-login requirement. Its [startup guide](https://wispbyte.com/kb/startup-settings) documents runtime selection and startup commands. Its [GitHub integration](https://wispbyte.com/kb/github-integration) covers repository deployment.

The documentation is inconsistent about the activity interval: the getting-started page says monthly, while its [hosting comparison](https://wispbyte.com/blog/free-hosting-comparison) says biweekly. Follow the actual deadline shown in your account and log in at least every 14 days unless the panel asks for more frequent activity. Free uptime is not an SLA. Exact capacity, persistence across provider maintenance, and the runtime choices must be checked in your panel. Never assume free storage is a backup.

## One-time deployment

1. Sign in at [Wispbyte’s client panel](https://wispbyte.com/client). Create or use your **one free account**. Choose **Create Server**, name it **HookMeUp**, and select a **Node.js 24** runtime. Keep the free plan; do not order premium services or enter payment details for these instructions. If Node.js 24 is not available, stop here and ask Wispbyte about that runtime. Bun and older Node.js versions are not verified for this project’s built-in SQLite dependency.
2. Choose either the private repository integration or the secret-free upload below. No GitHub credential is included in HookMeUp. Keep repository access read-only if the panel offers that option; do not paste credentials into chat or into the startup command.
3. **Repository route:** in your server’s GitHub controls, clone `https://github.com/m-ayan-ahmed290/HookMeUp.git`, branch `main`, using the panel’s supported private-repository authentication. Start with automatic updates disabled until you have checked that they preserve `.env` and `data/`. Never change this private repository to public just to deploy it.
4. **Upload route:** download `HookMeUp-wispbyte.zip` from the latest [GitHub Release](https://github.com/m-ayan-ahmed290/HookMeUp/releases/latest) or use the provided local archive. Upload/extract it through **Files**. Put `package.json`, `index.js`, `src/`, `fixtures/`, `assets/` and `scripts/` at the server root—not inside a second nested folder. It includes no token, encryption key or database.
5. In **Startup**, set the main JavaScript file/`JS_FILE` to **`index.js`**. If you can customize the full startup command, use:

   ```sh
   npm ci --omit=dev --cache ./.npm-cache && node scripts/prepare-host.js && node index.js
   ```

   If the panel installs dependencies separately, use `npm ci --omit=dev --cache ./.npm-cache` for installation and `node scripts/prepare-host.js && node index.js` for startup. `package-lock.json` must be present. Do not use `npm run demo` as the production start command.
6. Start once. The preparation script creates a private `.env`, a random encryption key and the `data/` directory; it never prints the key. Startup will stop with a missing-Discord-credentials message until you fill those values. Existing valid encryption keys are preserved on later starts.
7. In Wispbyte’s private environment-variable controls, or its private `.env` editor if custom variables are not supported, set **`DISCORD_TOKEN`** and **`DISCORD_CLIENT_ID`**. Obtain them through the [Discord Developer Portal](https://discord.com/developers/applications) as explained in [SETUP.md](SETUP.md). Keep **`REDDIT_MODE=test`** and **`DATABASE_PATH=./data/hookmeup.sqlite`**. The preparation script has filled `ENCRYPTION_KEY`; back it up privately. Do not expose the `.env` through a website or public file link.
8. Install the bot in your Discord server with the permissions listed in [SETUP.md](SETUP.md). Restart it in Wispbyte’s **Console**. Wait for the JSON `ready` event; do not share full environment values or tokens when reporting errors.
9. Run `/setup` in Discord, save an unfiltered feed, and verify that clearly labeled synthetic messages arrive. Then run `/status` and explicitly send a sample from the subscription panel.
10. Check persistence: record a subscription ID, restart the Wispbyte server, and confirm the same subscription exists and automatic fixtures are not delivered again. Export a configuration backup through `/export`. Stop the server before copying its full `data/` directory for a database backup.

## Updates and limits

- **Keep `.env`, `data/`, the database/WAL files and the original encryption key.** Updating means replacing source files, not deleting the whole server directory. Back up first and stop the process before file replacement. If the panel’s clone/update operation wipes untracked files, use controlled file upload instead.
- The ZIP contains no `node_modules`; Wispbyte installs the lockfile dependencies with `npm ci`. It uses JavaScript directly, so there is no TypeScript or frontend build step.
- Wispbyte shared-IP Discord rate limits are a host-level constraint. Respect its console guidance and wait for reset; do not create extra accounts, bots or servers to bypass a limit. Keep polling intervals conservative.
- This project’s Docker Compose and self-hosted-runner workflow are for your own Linux hardware, not for running Docker inside Wispbyte. GitHub CI builds/test packages; initial Wispbyte deployment and private credentials must be configured in its panel.
- A supplied release workflow publishes a ZIP for upload. There is no assumed Wispbyte API token or undocumented automatic deployment endpoint. Panel GitHub auto-update is optional and must first be checked for state preservation.
- Wispbyte hosting does not change Reddit’s authorization requirements. Arbitrary communities remain test-only unless Reddit explicitly authorizes your exact external use.

## Deployment acceptance checklist

- Node.js 24 selected and dependencies installed successfully.
- Private credentials saved; no secrets in GitHub or startup logs.
- Discord `ready`, `/status` connected, setup wizard completed.
- Synthetic webhook embed arrived in the chosen channel.
- Subscription and duplicate history survived an actual host restart.
- Configuration and database/key backups stored privately.
- Activity-login deadline recorded from your Wispbyte panel.

Until those checks are observed in your account, hosting is **prepared but unverified**.
