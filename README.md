<p align="center"><img src="assets/avatar-transparent.png" width="180" alt="HookMeUp hook and robot avatar"></p>

# HookMeUp

Connect the posts you care about to the Discord channels where they belong.

HookMeUp is a self-hosted Node.js Discord bot with an interactive setup wizard, per-server subscriptions, configurable filters, and webhook forwarding. The software is free and MIT licensed. **It ships in test mode because arbitrary third-party subreddit monitoring is not generally available without Reddit’s explicit approval.** No RSS, scraping, unofficial mirrors, or access workarounds are included.

## Current delivery status

| Area | Status |
| --- | --- |
| Discord commands, buttons, selects, modals and wizard | Implemented; tested with simulated interactions and Discord builder validation |
| Filters, SQLite persistence, encryption, retries, deduplication, multi-server isolation | Implemented; automated tests |
| Synthetic test mode | Working end to end against a local mock webhook; no external credentials needed |
| Discord webhook transport and automatic webhook creation | Implemented; needs a real Discord application and server installation for live validation |
| Approved Reddit OAuth adapter and deletion checks | Implemented; tested with mocked HTTP responses; **not verified against live Reddit** |
| Live monitoring of communities you do not moderate | **Blocked unless Reddit explicitly approves this use and those communities** |
| Hosting | Docker and self-hosted deployment workflow included; **no always-on host provisioned** |

**Selected host: Wispbyte.** Use the [Wispbyte deployment guide](docs/WISPBYTE.md) and the secret-free ZIP in [Releases](https://github.com/m-ayan-ahmed290/HookMeUp/releases). A root `index.js` and preparation script support its Node.js panel. Account setup, private credentials, storage behavior and actual uptime remain unverified until deployed there.

## What it does

- Multiple subreddit → channel connections per server, with independent filters and polling intervals.
- `/setup`: six steps covering community, timing, channel, keywords, advanced rules, alerts and final review.
- `/dashboard`: subscription pagination, editing, pause/resume, previews, diagnostics, retries, health, audit history, backup/import, purge and reset.
- Include/exclude phrases with AND/OR; allowed/excluded flairs and authors; post types and minimum score. Case-insensitive matching, no regex required.
- Attractive webhook embeds with title, text, author, flair, score, image, and Reddit/video link buttons. Video playback depends on Discord/media support; a video link is always used when available. Galleries use the available preview rather than uploading every image.
- AES-256-GCM encrypted webhook tokens; environment-only operator credentials; administrator-only management; private, owner-bound panels with 15-minute expiry and stale-panel protection.
- Durable SQLite queue, unique delivery keys, exponential backoff, rate-limit budgeting, failed-delivery retries, restart recovery, and one active process per database.
- Mention suppression, mature-content protection, shared polling per subreddit per tick, failure notifications, secret-free JSON backups, and 30-day audit/delivery metadata retention.
- Live-post deletion checks about every 15 minutes when the API permits, plus a 24-hour lifetime for relayed messages while online. `/purge` removes tracked messages sooner.

## Try it without accounts or credentials

Install [Node.js 24 LTS](https://nodejs.org/en/download), then:

```sh
git clone https://github.com/m-ayan-ahmed290/HookMeUp.git
cd HookMeUp
npm ci
npm test
npm run demo
```

The demo passes synthetic fixtures through filters, SQLite, the worker, and embed rendering into a local mock webhook. It writes `demo-output.json`. It makes **no Reddit or Discord requests** and does not start a live Discord bot.

## Connect to Discord — free

1. Open the [Discord Developer Portal](https://discord.com/developers/applications), select **New Application**, and name it **HookMeUp**.
2. Under **General Information**, copy the **Application ID**. Upload [`assets/avatar-transparent.png`](assets/avatar-transparent.png) as the application/bot avatar.
3. Under **Bot**, create or reset the token. Store it directly in your local `.env`; never paste it into chat, GitHub issues, or source code. No privileged intents are required.
4. Under **Installation**, enable **Guild Install**, with scopes **bot** and **applications.commands**. Request **View Channels**, **Send Messages**, **Embed Links**, **Attach Files**, **Manage Webhooks**, and **Manage Messages**. Manage Messages lets cleanup work if an original webhook is deleted. The bot does **not** need Administrator.
5. Open the generated install link and select a server where you can install apps. Confirm channel overrides allow the permissions above.
6. Create your private environment file:

   ```sh
   cp .env.example .env
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

7. Edit `.env`: fill `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, and paste the generated hex into `ENCRYPTION_KEY`. Keep `REDDIT_MODE=test`. Optionally set `DISCORD_GUILD_ID` for immediate development-server command registration. On Linux/macOS run `chmod 600 .env`.
8. Run `npm start`. Commands register automatically on login. Run `/setup` in your server. Global commands can take time to appear; the development guild option avoids that delay.
9. Add a community, choose a channel, leave filters blank initially, review and save. Clearly labeled synthetic posts should arrive through the webhook. Open the subscription’s **Test & preview** control to explicitly send another sample.

For an expanded checklist, see [first-run setup](docs/SETUP.md). These steps create no paid service or subscription. Running on your computer uses its electricity and internet connection.

## Reddit access in November 2026

As checked on **November 11, 2026**, Reddit says:

- RSS support ends **November 13, 2026**. Its announcement says there is no replacement for RSS feeds outside a community you moderate.
- Public Data API access removal starts **January 12, 2027** for apps/users that have not registered or responded to outreach; remaining public API access ends **March 2027**.
- Devvit is the supported route for Reddit-hosted community apps. Installing a Devvit app requires appropriate community permissions; it does not grant arbitrary outside-community monitoring.
- An external integration requires Reddit’s approval. Approval, free access, and suitability for redistribution into Discord cannot be assumed.

Sources: [Reddit’s November 10 changelog](https://support.reddithelp.com/hc/en-us/articles/55472297340308-Changelog-November-10-2026), [Developer FAQ](https://developers.reddit.com/docs/guides/faq), [Responsible Builder Policy](https://support.reddithelp.com/hc/en-us/articles/42728983564564-Responsible-Builder-Policy), [Data API Wiki](https://support.reddithelp.com/hc/en-us/articles/16160319875092-Reddit-Data-API-Wiki), [Data API Terms](https://redditinc.com/policies/data-api-terms).

**For your requested use—public communities you do not own or moderate—test mode is the working default.** The live adapter remains disabled unless the operator supplies approval details, approved communities, OAuth credentials and an actual approval expiry. After March 1, 2027 it additionally requires explicitly authorized continuing access. This is a conservative guard, not a claim that approval will be obtainable or free. If access is unavailable, keep test mode; the bot does not fall back to RSS or scraping.

Read [Reddit access and data handling](docs/REDDIT.md) before enabling live mode. A configuration flag is an operator attestation, not proof of Reddit approval.

## Commands and button equivalents

Every server management feature is available from Discord. Operator secrets, API approval and hosting remain outside Discord by design.

| Slash command | Dashboard equivalent |
| --- | --- |
| `/setup`, `/source add` | Add feed |
| `/source list`, `/source view id` | Subscriptions → choose feed |
| `/source edit id` | Edit feed |
| `/source filters id` | Filters → Keywords / Flairs / Authors / Types & score |
| `/source destination id` | Destination channel selector |
| `/source pause id`, `/source resume id` | Pause / Resume |
| `/source delete id` | Delete → Confirm |
| `/source test id` | Test & preview → Send test sample |
| `/source retry id` | Retry failures |
| `/settings view`, `/settings notifications` | Settings, alerts, mature-content policy, pause all |
| `/status` | Health |
| `/history`, `/audit` | Delivery history, Audit log |
| `/export`, `/import [file]` | Export backup, Import backup (paste small JSON) |
| `/purge` | Settings → Delete relayed messages → Confirm |
| `/reset` | Reset server → Confirm |
| `/help` | Help |

The import modal accepts up to 4,000 characters; use `/import file` for exports up to 100 KB. Imported channel IDs must belong to the current server. Imports are additive, reject duplicate community/channel pairs, and replace server settings after confirmation. Feed pause states are not included in exports.

## Filter semantics

The include list searches the title and body for literal phrases. **AND** requires every include phrase; **OR** requires at least one. An empty include list accepts any text. An exclude phrase always rejects the post. Commas separate phrases; a literal comma within a phrase is not supported.

Flair and author lists match exact values, ignoring case. Any allowed value within a category may match, and every nonempty category must pass. Excluded authors/flairs always reject. Post types are `text`, `image`, `video`, `link`, `gallery`. Minimum score is an additional requirement. Scores can change between polls.

Example: include `automation, node`, choose AND, exclude `sponsored`, allow flair `Showcase`, types `text, video`, minimum score `10`.

## Hosting and deployment

For your selected free host, start with [Deploy on Wispbyte](docs/WISPBYTE.md). It covers Node.js 24, uploads/private GitHub checkout, exact startup commands, credential setup, state-preserving updates and provider activity checks. The following Docker route is an alternative for your own hardware.

No billing account is necessary to run this on your own computer or existing Linux hardware. The bot runs only while that machine and process are available. **GitHub Actions is not the bot’s always-on host.** Scheduled Actions runs would not keep Discord interactions online and are not used for polling.

```sh
docker compose up -d --build
docker compose logs --tail=100 -f
```

Compose uses a persistent named volume, an unprivileged process, a read-only root filesystem, health checks and a restart policy. It needs an existing Docker installation and a completed `.env`. The optional manual deployment workflow targets a runner you provide on your own Linux machine; it does not provision cloud resources. See [operations and deployment](docs/OPERATIONS.md).

CI tests on pushes and pull requests, audits dependencies and builds the image. This private repository’s GitHub-hosted CI uses your account’s Actions allowance; configure a zero-dollar spending budget or disable hosted Actions if you cannot use that allowance. No paid hosting is created by this repository. The deployment workflow is manual and uses a self-hosted runner.

## Reliability and limits

- Poll intervals: 60–86,400 seconds; default 300. Default shared API budget: 30 requests/minute, hard maximum 60, or lower if your approval requires it.
- Each fetch reads the newest 100 posts from the last 24 hours. There is no full historical backfill or pagination of Reddit listings. Busy communities can exceed this window, and posts that reach a score threshold after leaving it may be missed.
- Duplicate prevention is per subscription and access mode, retained for 30 days. The latest-24-hour eligibility window normally prevents older posts from reentering. Test fixtures are deliberately stable: each fixture normally arrives once per subscription. Use **Send test sample** for repeated manual tests.
- Discord delivery is **at least once**: a crash or timeout after Discord accepted a message but before SQLite recorded success may cause a duplicate. There is no promise of exactly-once external delivery.
- Retries use backoff and jitter; after eight failed attempts a delivery enters the failed queue. `/source retry` can retry unexpired payloads. Pending post content expires after 24 hours; successful payloads are cleared immediately.
- Pausing stops new polls and queued deliveries; deletion/expiry cleanup continues. An in-flight request may finish. Editing filters or the destination drops pending/failed jobs evaluated under the previous configuration.
- Failure alerts are limited to one per issue per hour per process and require a configured notification channel. A disconnected Discord gateway cannot deliver alerts until it reconnects.
- Live-post checks and Discord cleanup need a running bot, working credentials and API/channel permissions. Deleted webhooks and revoked permissions can require administrator cleanup. Forwarded content is transient, not an archive.
- Up to 100 subscriptions per server; SQLite supports one active bot process per database. Do not run this on multiple replicas or network filesystems.

## Development

```sh
npm ci
npm run check
npm test
npm run demo
npm audit --omit=dev
```

`src/ui.js` owns Discord workflows; `schema.js` validates configuration and matches posts; `reddit.js` contains the official access adapter and fixtures; `store.js` owns persistence; `worker.js` handles polling, delivery, retries and cleanup; `discord.js` owns webhook transport. Tests use temporary SQLite databases, mocked Reddit HTTP responses, simulated Discord interactions and mocked webhook transports. They do not establish live service connectivity.

Brand assets: [`avatar.png`](assets/avatar.png) and [`avatar-transparent.png`](assets/avatar-transparent.png). Generated original artwork; no official Discord or Reddit logos. HookMeUp is not affiliated with either platform.
