# podcast-poster

> ⚠️ **Work in Progress** — This app is under active development. Automated RSS polling is pending HTTP domain approval from Reddit's team.

A [Devvit](https://developers.reddit.com) app that automatically creates Reddit posts for new podcast episodes from one or more RSS feeds. When a new episode is detected, it creates a self-post with the episode title as the post title and the episode description as the post body.

---

## How It Works

### 1. Automatic (Cron — every 15 minutes)

The scheduler polls all configured RSS feeds every 15 minutes. Each feed is tracked independently — if a new episode GUID is detected (compared to the last-posted GUID stored in Redis), a new Reddit self-post is created for that feed. Episodes are never duplicated per feed.

### 2. Manual (Moderator Menu)

Subreddit moderators can immediately post the latest episode from all configured feeds:
> Three-dot menu → **"Post most recent episode"**

This posts from all active feed slots and updates their GUIDs so the cron won't re-post them.

---

## Post Format

| Field | Value |
|---|---|
| **Title** | `{Podcast Name} - {Episode Title}` |
| **Body** | Episode description from RSS feed (HTML stripped) |

---

## Configuration

After installing the app on your subreddit, go to **App Settings** to configure your podcast feeds.

Find the **RSS Feeds List** setting. You can add as many feeds as you want by entering them on **new lines**. You can optionally provide a custom name for the podcast by separating it with a pipe (`|`) or a comma (`,`).

**Format:**

```
https://path/to/feed.xml | Optional Podcast Name
```

**Example:**

```text
https://rss.art19.com/get-played | Get Played
https://feeds.megaphone.fm/WWO8086402096 | Conan O'Brien
https://feeds.npr.org/510318/podcast.xml
```

*(If you omit the name override, it will use the podcast title directly from the RSS feed).*

---

## Tech Stack

| Component | Technology |
|---|---|
| Platform | [Devvit Web](https://developers.reddit.com/docs/capabilities/devvit-web/devvit_web_overview) v0.12.13 |
| Language | TypeScript 5.x / Node.js ≥ 22.6 |
| RSS Parsing | [`fast-xml-parser`](https://github.com/NaturalIntelligence/fast-xml-parser) |
| Build | `esbuild` via `tools/build.ts` |
| Storage | Devvit Redis — per-feed GUID tracking via `last_posted_guid:N` |

---

## Project Structure

```
src/
  server/
    server.ts      # HTTP router, RSS fetch, post creation logic
    index.ts       # Server entry point
  shared/
    api.ts         # Endpoint constants
tools/
  build.ts         # esbuild config (server-only)
devvit.json        # App config (menu, scheduler, settings, HTTP permissions)
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
npm run build        # Production build
npm run deploy       # Build + upload to Devvit
npm run launch       # Build + upload + publish to Devvit app directory
npm run type-check   # TypeScript type checking
```

### Playtest

```bash
devvit playtest r/your_test_subreddit
```

---

## Fetch Domains

This app fetches external RSS feeds server-side. The following domains have been submitted for HTTP allowlisting:

| Domain | Purpose |
|---|---|
| `rss.art19.com` | Default podcast RSS feed host |
| `omny.fm` | Alternative podcast hosting provider |
| `traffic.omny.fm` | Omny audio delivery CDN |

> **Note:** Domain allowlisting requires approval from Reddit's developer team. Until approved, RSS fetching will return a `PERMISSION_DENIED` error. Check approval status at `deveopers.reddit.com/apps/podcast-poster/developler-settings`.

---

## Known Limitations

- **HTTP fetch pending approval** — The RSS polling only works once Reddit approves the domain exceptions.
- Only the **most recent** entry in each RSS feed is ever posted per check cycle.
- Up to **5 feeds** per subreddit installation.

---

## License

BSD-3-Clause
