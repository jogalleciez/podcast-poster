# Pod Poster

A [Devvit](https://developers.reddit.com) app that automatically creates Reddit posts for new podcast episodes from an RSS feed. When a new episode is detected, it creates a self-post with the episode title and description — no manual posting required.

---

## Features

- **Automatic RSS polling** — checks for new episodes on your configured schedule (hourly, daily, or weekly)
- **Manual post trigger** — moderators can post the latest episode on demand from the subreddit menu
- **Edit post body** — moderators can edit the text body of any episode post directly from the post menu
- **Flair support** — optionally apply a flair template and custom text to every episode post
- **Duplicate prevention** — tracks the last-posted episode GUID in Redis so episodes are never double-posted

---

## How It Works

### Automatic (Cron)

The app runs a background check every 15 minutes. Whether it actually posts depends on your **Polling Frequency** setting:

- **Hourly** — posts on the first check of each hour that finds a new episode
- **Daily** — posts once per UTC day if a new episode is found
- **Weekly** — posts once on the configured day of the week if a new episode is found

A new episode is detected by comparing the episode's GUID to the last-posted GUID stored in Redis.

### Manual (Moderator Menu)

Post the latest episode immediately:
> Subreddit three-dot menu → **"Post most recent episode"**

If multiple feeds are configured, a selection prompt will appear so you can choose a specific feed or post from all feeds at once.

Edit an existing episode post:
> Post Moderator Actions → **"Edit post body"**

---

## Post Format

| Field | Value |
|---|---|
| **Title** | `{Podcast Name} - {Episode Title}` |
| **Body** | Episode description (HTML converted to Markdown) + listen link |

---

## Configuration

After installing, go to **App Settings** to configure the app.

| Setting | Description |
|---|---|
| **App Enabled** | Toggle automatic posting on/off |
| **RSS Feed URLs** | One feed per line. Format: `URL \| Podcast Name \| Link URL`. Example: `https://rss.art19.com/my-podcast \| My Podcast \| https://example.com/listen` |
| **Post Flair Template ID** | UUID of the flair template to apply to each post (optional) |
| **Post Flair Text Override** | Custom flair text (only used when a flair template ID is set) |
| **Polling Frequency** | How often to post new episodes: `Hourly` (default), `Daily`, or `Weekly` |
| **Weekly Polling Day** | Day of the week to post (only applies when frequency is set to Weekly) |

> **Note:** The **RSS Feed URLs** setting has a 2KB character limit. If you're configuring many feeds with long URLs, keep this in mind.

**Feed URL Format Details:**

Each line in the **RSS Feed URLs** field follows this format:

```
URL | Podcast Name | Link URL
```

- **URL** (required) — The podcast RSS feed URL
- **Podcast Name** (optional) — Custom name to override the RSS feed's `<title>`. If omitted, uses the feed's default title.
- **Link URL** (optional) — URL for the "Listen to this episode" link. Generally intended for a splash page for the podcast. If omitted, falls back to the episode's landing page URL from the RSS feed (`<item><link>`), then to the audio URL.

**Examples:**

```
https://rss.art19.com/get-played | Get Played
https://feeds.transistor.fm/my-podcast | | https://my-podcast.com/listen
https://feeds.buzzsprout.com/123456.xml
```

In the first example, the feed will be titled "Get Played". In the second, the podcast name defaults to the RSS title, but the listen link points to your site. The third uses both defaults.

---

## Supported RSS Feed Hosts

The following podcast hosting providers are supported out of the box:

| Domain |
|---|
| `rss.art19.com` |
| `traffic.omny.fm` |
| `feeds.buzzsprout.com` |
| `feeds.redcircle.com` |
| `feeds.transistor.fm` |
| `feeds.captivate.fm` |
| `feed.podbean.com` |
| `media.rss.com` |
| `feeds.acast.com` |
| `feed.ausha.co` |
| `rss.hubhopper.com` |
| `feeds.simplecast.com` |

Need a different host? Open an [issue](https://github.com/jogalleciez/podcast-poster/issues/new) or [contact the developer](https://www.reddit.com/message/compose/?to=/u/jogalleciez).

---

## Tech Stack

| Component | Technology |
|---|---|
| Platform | [Devvit Web](https://developers.reddit.com/docs/capabilities/devvit-web/devvit_web_overview) v0.12.18 |
| Language | TypeScript 5.x / Node.js ≥ 22.6 |
| RSS Parsing | [`fast-xml-parser`](https://github.com/NaturalIntelligence/fast-xml-parser) |
| HTML → Markdown | [`node-html-markdown`](https://github.com/crosstype/node-html-markdown) |
| Build | `esbuild` via `tools/build.ts` |
| Storage | Devvit Redis — per-feed GUID tracking via `last_posted_guid:{index}` |

---

## Known Limitations

- Only the **most recent** entry in the RSS feed is posted per check cycle.
- Post descriptions are truncated to fit Devvit's ~2KB payload limit.

---

## License

BSD-3-Clause
