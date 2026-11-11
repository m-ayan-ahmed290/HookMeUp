# First-run checklist

## What you need

| Item | Where | Cost |
| --- | --- | --- |
| Discord application and token | [Developer Portal](https://discord.com/developers/applications) | Free |
| A Discord server where you can install apps | Discord server settings | Free |
| Node.js 24 | [Official download](https://nodejs.org/en/download) | Free |
| Existing computer or Linux host | Your hardware | No new subscription; normal power/network costs |
| Reddit approval | [Access guidance](https://support.reddithelp.com/hc/en-us/articles/14945211791892-Developer-Platform-Accessing-Reddit-Data) | Not required for test mode; approval/free eligibility is not guaranteed |

## Install and configure

1. Clone this private repository while signed into the GitHub account that owns it.
2. Run `npm ci` in the repository directory.
3. Copy `.env.example` to `.env`.
4. Create a Discord application named HookMeUp. Copy its Application ID into `DISCORD_CLIENT_ID` in `.env`.
5. On the Bot tab, reset/copy the token directly into `DISCORD_TOKEN`. Keep it private. If it is ever exposed, reset it and update your host.
6. Generate a key with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` and save it as `ENCRYPTION_KEY`. Back up this key privately alongside the database.
7. Leave `REDDIT_MODE=test`. You do not need a Reddit account or credential for this mode.
8. Enable Guild Install with `bot` and `applications.commands`. Choose View Channels, Send Messages, Embed Links, Attach Files, Manage Webhooks and Manage Messages. Do not enable privileged gateway intents.
9. Use the installation URL from the Installation page to add the app to your server. Resolve channel permission overrides where needed.
10. Optionally turn on Discord Developer Mode, copy your server ID and set `DISCORD_GUILD_ID`. This registers commands directly into that server for quicker testing. Remove it and restart for global registration; remove stale development guild commands if both versions appear.
11. Run `npm start`. Wait for the JSON `ready` log. The process must stay running.

## Your first feed

1. In Discord, run `/setup` as an administrator.
2. Select **Set community & timing**. Enter `programming` and `300`.
3. Choose a destination text channel where the bot has permissions.
4. Skip keywords for an unfiltered demonstration, or include `automation` and exclude `sponsored`.
5. Set optional flair, author, post type and minimum score rules using the buttons and forms.
6. Choose a failure notification channel, or keep the existing setting.
7. Review the summary and select **Create connection**. The bot creates/reuses its own webhook.
8. Expect clearly labeled synthetic posts. The standard fixture set contains four posts; filters reduce that number. Fixture IDs stay stable to demonstrate duplicate prevention.
9. Run `/dashboard`. Select the subscription, open **Test & preview**, then **Send test sample** for another explicit test. Check **Diagnostics** and **Health** if delivery fails.

## If it does not work

- **No slash commands:** verify the Application ID matches the token, the bot is installed with `applications.commands`, and the process logged `ready`. Use `DISCORD_GUILD_ID` for development. `/register` is not a Discord command; `npm run register` is the local repair script.
- **Permission error:** in the target channel allow View Channel, Send Messages, Embed Links, Manage Webhooks and Attach Files. For deleted-webhook cleanup, also allow Manage Messages.
- **No new test posts:** fixture IDs are stable and already delivered. Use **Send test sample**. Scores/flairs/authors may also exclude every fixture; the preview explains which match.
- **Webhook was deleted:** delivery forgets an invalid token; the next retry recreates the webhook. Use Retry failures after checking permissions. Manage Messages is needed to clean up older messages made by the deleted webhook.
- **Bot stops when terminal closes:** use Docker Compose or a service on your own machine. This cloud development session is not permanent hosting.
- **Another instance error:** stop the other instance. After a crash, wait 60 seconds for its database lease to expire. Never delete the database to clear the lease.
- **Webhook decryption error:** restore the original encryption key. Do not rotate or replace it casually. Losing it requires webhook recreation and may require administrator cleanup of earlier messages.

Do not paste tokens into support requests. Use error codes and subscription IDs from diagnostics and logs.
