# Privacy Policy

**Last updated:** April 8, 2026

This privacy policy describes how the **podcast-poster** Reddit Devvit app ("the App") handles data.

---

## What the App Does

podcast-poster is a Reddit Devvit app that automatically posts the latest episodes from a moderator-configured RSS podcast feed to a subreddit. It runs entirely within the Reddit/Devvit platform and periodically fetches RSS feeds to create Reddit posts on behalf of the subreddit.

---

## Information We Collect

### We do not collect personal information

The App does not collect, store, or process any personal information from Reddit users. Specifically:

- No Reddit usernames, user IDs, or profile data are collected
- No IP addresses are logged or stored
- No cookies or browser storage are used
- No user activity (views, clicks, playback) is tracked or measured
- No analytics or telemetry is gathered

### Moderator-configured settings

Subreddit moderators provide configuration values when installing the App. These are stored within Devvit's built-in settings system and are scoped to the subreddit installation:

| Setting | Purpose |
|---------|----------|
| RSS feed URL | The podcast feed to monitor for new episodes |
| Podcast name (optional) | Display name override for the podcast |
| Post link URL (optional) | URL override for the Reddit post link |
| Post flair ID / text (optional) | Flair to apply to created posts |
| Polling frequency | How often to check for new episodes (hourly / daily / weekly) |
| Weekly polling day | Day of week for weekly polling |
| App enabled toggle | Enable or disable automatic posting |

None of these settings capture or expose personal data about any Reddit user.

---

## How We Use Information

The App uses the above configuration solely to:

1. **Fetch RSS feeds** — Periodically retrieve the configured RSS feed URL to check for new episodes
2. **Deduplicate posts** — Compare the most recent episode's GUID against the last-posted GUID to avoid posting duplicates
3. **Create Reddit posts** — Publish episode metadata (title, description, audio link) as a Reddit self-post in the configured subreddit

---

## Data Storage

The App stores two pieces of state in Devvit's Redis instance, scoped per subreddit installation:

| Key | Value | Purpose |
|-----|-------|----------|
| `last_posted_guid:<index>` | Episode GUID string | Prevents duplicate posts |
| `last_global_check_date` | ISO date string (YYYY-MM-DD) | Gates daily/weekly polling cadence |

Both values are overwritten each time a new episode is posted and are never shared outside the App. No episode content, user data, or historical records are retained.

---

## Third-Party Services

The App makes outbound HTTP requests only to fetch RSS feed XML from podcast hosting platforms. The domains the App is permitted to contact are:

- `rss.art19.com`
- `traffic.omny.fm`
- `feeds.buzzsprout.com`
- `feeds.redcircle.com`
- `feeds.transistor.fm`
- `feeds.captivate.fm`
- `feed.podbean.com`
- `media.rss.com`
- `feeds.acast.com`
- `feed.ausha.co`
- `rss.hubhopper.com`

**No Reddit user data is sent to any of these services.** Requests include only standard HTTP headers and an explanatory `X-Fetch-Reason` header identifying the App's purpose.

All other data handling is performed within the Reddit/Devvit platform. The App does not integrate with any analytics, advertising, or tracking services.

---

## Data Retention

- **Episode GUIDs and polling dates** are stored in Redis and overwritten whenever a new episode is posted. They are not archived.
- **Moderator settings** persist for the lifetime of the App installation in the subreddit and are deleted when the App is uninstalled.
- **Reddit posts** created by the App become standard Reddit content, subject to Reddit's own [Privacy Policy](https://www.reddit.com/policies/privacy-policy).

---

## Children's Privacy

The App does not collect personal information from anyone, including children under the age of 13.

---

## Changes to This Policy

If this policy changes, an updated version will be committed to the repository with a revised "Last updated" date. The repository is publicly available at:

[https://github.com/jogalleciez/podcast-poster](https://github.com/jogalleciez/podcast-poster)

---

## Contact

If you have questions about this privacy policy, please open an issue at:

[https://github.com/jogalleciez/podcast-poster/issues](https://github.com/jogalleciez/podcast-poster/issues)
