HookMeUp connects approved Reddit sources to Discord through webhooks, with a guided setup wizard, per-server filters, durable delivery queue, retries and deletion handling. It starts in synthetic test mode; live third-party subreddit access requires Reddit’s explicit approval.

Download `HookMeUp-wispbyte.zip` for Wispbyte file upload. Choose Node.js 24 and follow `docs/WISPBYTE.md`. The archive includes source and instructions but no credentials, database or installed dependencies. Fill Discord credentials privately in the host panel. No running bot or provisioned host is included in this release.

Automated validation covers filtering, persistence, access gates, cleanup and simulated Discord workflows. Live Discord/Reddit and Wispbyte account deployment still require credentialed verification.
