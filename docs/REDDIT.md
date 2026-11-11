# Reddit access and data handling

Policy review date: November 11, 2026. Recheck official sources before enabling any live deployment.

## Why live monitoring is gated

Reddit’s [November 10 changelog](https://support.reddithelp.com/hc/en-us/articles/55472297340308-Changelog-November-10-2026) announces RSS retirement on November 13, 2026 and says there is no replacement for feeds outside communities you moderate. Public API access is being retired in stages beginning January 12, 2027, with remaining access ending March 2027.

The [Developer FAQ](https://developers.reddit.com/docs/guides/faq) distinguishes Reddit-hosted Devvit apps from external scripts and bots. Signing into Devvit does not issue external API credentials or authorize monitoring arbitrary third-party communities. HookMeUp includes no Devvit app because a community-installed app would not satisfy that requested capability without the community’s cooperation and platform approval.

The [Responsible Builder Policy](https://support.reddithelp.com/hc/en-us/articles/42728983564564-Responsible-Builder-Policy), [access guidance](https://support.reddithelp.com/hc/en-us/articles/14945211791892-Developer-Platform-Accessing-Reddit-Data), [Data API Wiki](https://support.reddithelp.com/hc/en-us/articles/16160319875092-Reddit-Data-API-Wiki), and [Data API Terms](https://redditinc.com/policies/data-api-terms) govern access and handling. A public subreddit is not automatic permission to collect or redistribute its content.

## Approval checklist

1. Follow the current official access guidance and request a determination for an external, noncommercial, Reddit-to-Discord alert integration. Requests may be unavailable or declined during the migration; do not assume a support form is a guaranteed route to access.
2. Describe the exact communities, polling budget, Discord recipients, embedded fields, deletion checks, 24-hour message lifetime and retention. Explain that you do not moderate those communities. Request explicit authorization for external redistribution, not just API authentication.
3. Retain the written approval and any expiry or special restrictions. If free access is not explicitly available, keep test mode rather than purchasing a service.
4. Only after approval, obtain the OAuth credentials through the method Reddit authorizes. The adapter implements application-only `client_credentials` OAuth. If your approved grant or endpoints differ, this adapter is not ready for that approval and must be adapted/tested before activation.
5. Set the following **privately on the host**, never in Discord or a GitHub commit:

   ```dotenv
   REDDIT_MODE=approved
   REDDIT_CLIENT_ID=your_approved_client_id
   REDDIT_CLIENT_SECRET=your_approved_client_secret
   REDDIT_USER_AGENT=HookMeUp/1.0 by u/your_account
   REDDIT_APPROVAL_REFERENCE=your_written_approval_reference
   REDDIT_APPROVED_SUBREDDITS=community_one,community_two
   REDDIT_APPROVAL_EXPIRES_AT=actual_approval_expiry_in_ISO_8601
   REDDIT_REQUESTS_PER_MINUTE=30
   REDDIT_POST_SUNSET_APPROVED=false
   ```

6. The actual expiry is required. If Reddit has not specified one, obtain clarification; do not invent approval. After March 1, 2027, the adapter conservatively blocks requests unless continuing access is explicitly authorized and the post-sunset flag is enabled to reflect that authorization.
7. Restart, check `/status` and subscription Diagnostics, and verify one approved community before adding more. Authentication or successful API responses alone do not prove that your use is authorized.

No live Reddit request was needed to develop or test this project. Test mode never authenticates, fetches Reddit data, reads RSS or scrapes webpages.

## Content lifetime and deletion

- Matching post payloads stay in pending/failed SQLite jobs for at most 24 hours while the worker is running. On success the payload is cleared immediately. The synthetic fixtures contain no fetched Reddit content.
- Each delivered message has a tracking record containing its Discord destination, message ID, Reddit post ID, community, mode, creation time and next check. Live IDs are batched through the approved `/api/info` endpoint roughly every 15 minutes, subject to the shared API budget. Missing posts, removed content and deleted authors trigger deletion of the entire forwarded embed.
- Every tracked message, including a manually sent synthetic sample, is scheduled for deletion after 24 hours. If live access expires or is disabled, existing live relays are removed on their next check. These operations need an online process and Discord permissions; they are not a deletion SLA.
- On a cleanup failure, tracking is retained for retry and a configured notification channel receives an alert. A missing/deleted webhook falls back to the bot’s Manage Messages permission. If access to the channel/server is lost, a Discord administrator must remove the content.
- Feed pause and subscription deletion do not cancel cleanup. Tracking lives separately from subscriptions. Reset first pauses this server, drains the current worker pass, purges tracked messages and then removes its webhooks/configuration. If cleanup fails, reset remains blocked and the server stays paused.
- `/purge` deletes currently tracked messages. If authorization ends, pause all feeds, purge, reset and clear private backups as required. Do this **before** removing the bot or deleting its webhooks. Leaving a server clears its local configuration, but the bot cannot promise to remove messages after losing server access.
- Delivery IDs/status and audit metadata expire after 30 days. They contain no stored title/body/media. Cleanup tracking remains until deletion succeeds. SQLite deletion does not guarantee forensic disk erasure; protect the database volume and backups.
- Discord recipients can copy messages or media. HookMeUp cannot revoke copies made outside its control. Your approval must cover this disclosure and the operational limits. If stricter deletion, privacy, consent or retention obligations apply, keep live mode disabled until those requirements are implemented and verified.

No claim is made that API approval alone establishes full compliance for a particular deployment. The code refuses unapproved access paths; the operator must ensure the authorized purpose, data handling and recipient permissions match the actual deployment.
