# podcast-poster

A [Devvit](https://developers.reddit.com) app that automatically creates Reddit posts for new podcast episodes from an RSS feed. When a new episode is detected, it creates a self-post with the episode title as the post title, the episode description (converted from HTML to Markdown) as the body, and a "Listen" link to the episode audio.

---

## How It Works

### 1. Automatic (Cron)

The scheduler fires every 15 minutes, but only posts according to the configured polling frequency:

- **Hourly** — posts on every cron trigger
- **Daily** — posts once per UTC day
- **Weekly** — posts once per week on the configured day of the week

When the cron runs, it fetches the latest episode from the configured RSS feed. If the episode's GUID differs from the last-posted GUID stored in Redis, a new Reddit post is created. Episodes are never duplicated.

### 2. Manual (Moderator Menu)

Subreddit moderators can immediately post the latest episode:
> Three-dot menu → **"Post most recent episode"**

This posts the latest episode and updates the stored GUID so the cron won't re-post it.

---

## Post Format

| Field | Value |
|---|---|
| **Title** | `{Podcast Name} - {Episode Title}` |
| **Body** | Episode description (HTML converted to Markdown) + `[Listen to this episode](URL)` |
| **Link URL** | Custom `postLinkUrl` setting if configured, otherwise the episode audio URL |
| **Flair** | Optional — configured via `postFlairId` / `postFlairText` settings |

---

## Configuration

After installing the app on your subreddit, go to **App Settings** to configure it.

| Setting | Type | Description |
|---|---|---|
| **App Enabled** | Toggle | Enables or disables automatic posting |
| **Feed URL** | Text | RSS feed URL to monitor |
| **Feed Name** | Text | Optional podcast name override (falls back to the RSS `<title>`) |
| **Post Link URL** | Text | Optional URL override for the post link (falls back to the episode audio URL) |
| **Post Flair ID** | Text | Optional flair template UUID to apply to created posts |
| **Post Flair Text** | Text | Optional custom flair display text |
| **Polling Frequency** | Select | `hourly` / `daily` / `weekly` — controls how often new episodes are posted |
| **Weekly Polling Day** | Select | Day of the week for weekly posting (Sunday–Saturday) |

---

## Tech Stack

| Component | Technology |
|---|---|
| Platform | [Devvit Web](https://developers.reddit.com/docs/capabilities/devvit-web/devvit_web_overview) v0.12.13 |
| Language | TypeScript 5.x / Node.js ≥ 22.6 |
| RSS Parsing | [`fast-xml-parser`](https://github.com/NaturalIntelligence/fast-xml-parser) |
| HTML → Markdown | [`node-html-markdown`](https://github.com/crosstype/node-html-markdown) |
| Build | `esbuild` via `tools/build.ts` |
| Storage | Devvit Redis — GUID deduplication via `last_posted_guid:1`, daily/weekly gate via `last_global_check_date` |

---

## Project Structure

```
src/
  server/
    server.ts      # HTTP router, RSS fetching, post creation, cron/menu handlers
    index.ts       # Server entry point
  shared/
    api.ts         # Shared endpoint constants and types
tools/
  build.ts         # esbuild bundler (server, CommonJS, Node.js)
  tsconfig.*.json  # Modular TypeScript configs
devvit.json        # App manifest: scheduler, menu, settings, HTTP permissions
public/
  snoo.png         # App icon
```

---

## Development

### Prerequisites

- Node.js ≥ 22.6.0
- A Reddit account with a test subreddit
- [Devvit CLI](https://developers.reddit.com/docs/devvit_cli): `npm install -g devvit`

### Commands

```bash
npm run dev          # Watch build + playtest on your test subreddit
npm run build        # Production build (minified)
npm run deploy       # Build + upload to Devvit
npm run launch       # Build + upload + publish to Devvit app directory
npm run type-check   # TypeScript type checking
```

### Playtest

```bash
devvit playtest r/your_test_subreddit
```

---

## Supported RSS Feed Domains

The app is permitted to fetch from the following podcast hosting platforms (allowlisted in `devvit.json`):

| Domain | Provider |
|---|---|
| `rss.art19.com` | Art19 |
| `traffic.omny.fm` | Omny Studio |
| `feeds.buzzsprout.com` | Buzzsprout |
| `feeds.redcircle.com` | RedCircle |
| `feeds.transistor.fm` | Transistor |
| `feeds.captivate.fm` | Captivate |
| `feed.podbean.com` | Podbean |
| `media.rss.com` | RSS.com |
| `feeds.acast.com` | Acast |
| `feed.ausha.co` | Ausha |
| `rss.hubhopper.com` | HubHopper |

To use a feed from a domain not listed above, submit a PR adding it to the `permissions.http.domains` array in `devvit.json`.

---

## Known Limitations

- Only the **most recent** entry in the RSS feed is posted per check cycle.
- Only **one feed** per subreddit installation is supported.
- Descriptions are truncated to fit within Devvit's ~2 KB `postData` payload limit.

---

## License

BSD-3-Clause
