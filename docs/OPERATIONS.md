# Operations and deployment

## Free hosting choice

Use your existing computer or Linux hardware. There is no newly provisioned paid service. Running it locally is free software usage with ordinary electricity/network costs. It runs only while the machine is on, connected and awake. Free cloud plans may sleep, exclude background workers, require payment details or offer limited credits; no such service is provisioned or promised here.

GitHub Actions tests and deploys code; it does not host the Discord gateway or polling loop. Do not run the bot as an endless Actions job or scheduled polling workflow. Private-repository hosted CI consumes the account’s Actions allowance. Set a zero-dollar Actions spending budget in GitHub billing or disable the hosted workflow to avoid exceeding an allowance. The deployment workflow uses your own runner.

## Docker Compose

1. Install Docker Engine with Compose on your Linux host.
2. Clone the repository, copy `.env.example` to `.env`, fill Discord credentials and the encryption key, and leave test mode enabled. Restrict access to `.env`.
3. Run `docker compose up -d --build`.
4. Check `docker compose ps` and `docker compose logs --tail=100 bot`.
5. Use `/setup` in Discord and send a synthetic test sample.

Compose persists state in the named `hookmeup-data` volume. Container recreation does not remove it. Never run `docker compose down -v` unless you intend to destroy all state. Host reboot resumes the container when Docker starts. This is only as available as your host.

The image is unprivileged, drops Linux capabilities and uses a read-only root filesystem. It has no inbound ports. Its outbound services are Discord REST/gateway and, only in approved mode, official Reddit OAuth/API endpoints. Media URLs in embeds are fetched by Discord rather than this bot.

Health checks require both a connected Discord client and a recent completed worker tick. Docker marks unhealthy containers but does **not** automatically restart a merely unhealthy container; use host monitoring or restart it manually after investigating. Process crashes do restart under Compose’s restart policy.

In this managed development environment, Docker builds may need the provided proxy CA:

```sh
docker build --secret id=proxy_ca,src="$CODEX_PROXY_CERT" -t hookmeup:local .
```

This is optional on ordinary hosts. Do not disable TLS verification. Runtime proxy access in a managed host may also need its documented CA mount and `NODE_USE_ENV_PROXY=1` for native fetch. discord.js gateway connectivity requires permitted WebSocket egress; a development proxy is not permanent bot hosting.

## Optional GitHub deployment workflow

This is configured for **manual deployment to your existing Linux host**, not automatic cloud provisioning.

1. Add a [self-hosted GitHub Actions runner](https://docs.github.com/en/actions/hosting-your-own-runners/managing-self-hosted-runners/adding-self-hosted-runners) to the private repository, on the machine that will run the bot. Give it the labels `self-hosted`, `linux`, `hookmeup`. Install Docker/Compose and Node.js 24, and run the runner as a service.
2. Store the host’s completed environment file at `/opt/hookmeup/.env`, readable only by the account that needs it. Keep it out of the runner checkout. This requires a one-time host setup by its administrator.
3. Create a GitHub deployment environment named **production**. Add required reviewers when available for your plan, or keep control of who can dispatch workflows and push to `main`. This workflow reads no application tokens from GitHub secrets.
4. In **Actions → Deploy to your own host → Run workflow**, select `main`, type `DEPLOY`, and run. It tests, builds and restarts Compose, waiting for a healthy connection. No runner exists until you install one, so do not dispatch this workflow beforehand.
5. Check its logs and then verify `/status` and **Send test sample** in Discord.

Never attach this privileged runner to untrusted public contributions. The normal PR CI uses GitHub-hosted runners, not your deployment runner. Restrict repository write access; code deployed here can access the local environment and Docker daemon.

For automatic deployment on trusted pushes later, change the trigger only after validating your host, review controls and rollback process. The default intentionally requires a manual dispatch.

## Backups and restore

`/export` is a **configuration backup**, not a database backup. It contains no webhook tokens, queued posts, delivery IDs, cleanup tracking or feed-specific pause state. It cannot recover duplicate history. `/import` reviews the change, verifies channel ownership and permissions, creates needed webhooks and applies the configuration atomically. If external webhook preparation succeeds but the later database import fails, those unused bot-owned hooks may remain; reset can remove them.

For a full backup, stop the process first, then copy the entire `hookmeup-data` volume and store the original `ENCRYPTION_KEY` separately and privately. Restart after copying. Protect backups as secrets because they contain encrypted webhook tokens and potentially pending post content. Delete obsolete backups consistent with your Reddit authorization; do not retain expired content indefinitely.

Restore into a stopped instance, using the original key and compatible application version. Start just one instance. Restoring an old backup may reintroduce already-delivered jobs, so pause feeds and inspect delivery history and cleanup tracking before resuming.

## Upgrades and rollback

1. Pause all subscriptions in Discord.
2. Stop the container and make a full private backup.
3. Check out the reviewed release/commit, run tests and rebuild.
4. Start it and verify health plus one synthetic delivery.
5. Resume feeds. For rollback, stop the new process before returning to the previous image and restore its compatible backup if the schema changed.

The initial schema is created idempotently on startup. Future releases that change it must provide explicit, versioned migrations. Do not assume arbitrary older binaries can open newer databases.

## Troubleshooting and removal

Logs contain identifiers and fixed error codes; they intentionally omit credentials, webhook URLs and post bodies. `/status`, subscription Diagnostics, `/history` and `/audit` are the first checks. Error 50013 generally means missing Discord permissions. A bot offline or without a notification channel cannot notify administrators reliably.

To remove HookMeUp: pause all feeds, run `/purge`, confirm `/reset`, stop the process, then remove the app from Discord and securely remove its environment/database/backups. Reset removes bot-owned webhooks and tracked relays in this server; it does not control users’ copied content.
