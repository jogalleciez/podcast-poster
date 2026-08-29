# Pod Poster: Technical Reference

Implementation-level documentation. For the moderator-facing setup guide, see [README.md](README.md).

A [Devvit](https://developers.reddit.com) app that automatically creates Reddit posts for new podcast episodes from an RSS feed. When a new episode is detected, it creates a custom-UI post (rendered by a small React client) with the episode title, podcast name, description, and a "Listen" button, with no manual posting required. Moderators can also post past episodes on demand by selecting any episode from a feed's history via the subreddit menu.

---

## Features

- **Automatic RSS polling**: a background cron job checks every 15 minutes and posts any new episode it finds
- **Manual post trigger**: moderators can pick a feed and a specific episode to post from the subreddit menu
- **Three post formats**: interactive episode card (default), self/text post, or link post, set globally or per post
- **Custom episode card**: interactive posts render as a React WebView with description, metadata, and an accent-colored Listen button
- **Podcasting 2.0 metadata**: surfaces `<podcast:person>`, `<podcast:funding>`, `<podcast:chapters>`, `<podcast:soundbite>`, `<podcast:transcript>`, and season info when feeds provide it
- **Flair, sticky, and title customization**: optional flair template/text, auto-highlight, and toggles for the podcast name and episode number in the post title
- **Configurable accent color and font**: applied across buttons, links, and other elements in the episode card
- **No backlog on enable**: turning the app on records where each feed stands instead of dumping old episodes
- **Duplicate prevention**: tracks the last-posted episode GUID per feed in Redis (keyed by URL hash, so reordering feeds is safe)

---

## How It Works

### Automatic (Cron)

The app runs a background check every 15 minutes. For each configured feed it fetches the RSS (or the Spreaker/Audioboom JSON API for those hosts), compares the most recent episode's GUID against the last-posted GUID stored in Redis, and posts the episode if it's new.

**No backlog on install or enable.** The first check after installing, and the first check after switching **App Enabled** back on, quietly records where each feed currently stands instead of posting. That way turning the app on never floods your subreddit with a backlog. Only episodes published *after* that point get posted, which also means episodes released while the app was switched off are skipped rather than posted late.

### Manual (Moderator Menu)

Post an episode on demand:
> Subreddit three-dot menu → **"Post an episode"**

You'll be prompted to pick one of your configured feeds (skipped if you only have one), then to pick a specific episode from that feed's recent history. The depth of the episode picker is controlled by the **Feed History Depth** setting.

The episode picker also has a **Post type** dropdown, pre-set to your **Post Type** setting. Changing it affects only that one post. Your saved setting stays as it is.

Open settings:
> Subreddit three-dot menu → **"Configure Podcast Poster"**

---

## Post Format

By default, posts are interactive WebView posts rendered by a React client. The post title is `{Podcast Name} - {Episode Title}` by default (or just `{Episode Title}` when **Include Podcast Name in Post Title** is disabled). The post body shown inside the WebView includes the episode description (HTML converted to Markdown), a Listen button, and a Details tab with episode metadata.

You can change the format with the **Post Type** setting:

- **Interactive post** (default): the rich in-app player described above.
- **Self / text post**: a normal text post whose body is the episode description (as Markdown) with a large "Listen to this Episode" link placed above or below the description per the **Listen Button Position** setting.
- **Link post**: a link post pointing at the episode page (or the audio file, if the feed doesn't provide an episode page). Reddit doesn't allow text on a link post itself, so the episode description is posted as the first comment (pinned by the app).

This setting applies to automatic posts. When posting manually, you can pick a different type for that one post without changing the setting.

---

## Configuration

After installing, go to **App Settings** to configure the app.

| Setting | Description |
|---|---|
| **App Enabled** | Toggle automatic posting on/off |
| **Post Type** | How new episodes are posted: **Interactive post** (in-app player, default), **Self / text post** (episode notes as a text post), or **Link post** (links to the episode page, with the notes added as the first comment). |
| **RSS Feed URLs** | One feed per line. Format: `URL \| Podcast Name \| Link URL`. Example: `https://rss.art19.com/my-podcast \| My Podcast \| https://example.com/listen` |
| **Post Flair Template ID** | UUID of the flair template to apply to each post (optional) |
| **Post Flair Text Override** | Custom flair text (only used when a flair template ID is set) |
| **Include Podcast Name in Post Title** | When on (default), titles are `Podcast Name - Episode Title`. When off, only the episode title is used. |
| **Include Episode Number in Post Title** | When on, prepends the episode number: `My Podcast - Ep. 42 - Great Interview`. Feeds that don't publish an episode number fall back to the normal title. Off by default. |
| **Highlight New Episode Posts** | When on, each new episode post is stickied to the top and the previous highlight shifts down, keeping up to 2 recent episodes pinned at once (Reddit's per-subreddit sticky limit). Once both slots are full, the older one is unstickied. |
| **Accent Color** | Optional CSS color (e.g. `#ff5733` or `coral`) applied to buttons, links, and accent elements in the episode card. Defaults to Reddit blue. |
| **Listen Button Position** | Show the Listen button below the description (default) or above it. |
| **Post Font** | Font used in interactive posts: System / Reddit (default), Figtree, Inter, IBM Plex Sans, Merriweather, Atkinson Hyperlegible, or system-only (no web font). Applies to existing posts too, with no need to re-post. |
| **Feed History Depth** | How many recent episodes to load in the manual episode picker. Higher values let you find older episodes but are slower to load. Default: 50. |

> **Don't know your podcast's RSS feed URL?** Search for the show at [podcastindex.org](https://podcastindex.org). The RSS feed URL is listed on every show's page. Copy it and paste it into the **RSS Feed URLs** setting.

> **Note:** The **RSS Feed URLs** setting has a 2KB character limit. If you're configuring many feeds with long URLs, keep this in mind.

**Feed URL Format Details:**

Each line in the **RSS Feed URLs** field follows this format:

```
URL | Podcast Name | Link URL
```

- **URL** (required): the podcast RSS feed URL
- **Podcast Name** (optional): custom name to override the RSS feed's `<title>`. If omitted, uses the feed's default title.
- **Link URL** (optional): URL for the "Listen to this episode" link. Generally intended for a splash page for the podcast. If omitted, falls back to the episode's landing page URL from the RSS feed (`<item><link>`), then to the audio URL.

Lines beginning with `#` are ignored, so they can be used for comments or to temporarily disable a feed.

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

| Provider | Domain(s) |
|---|---|
| **Acast** | `feeds.acast.com` |
| **Art19** | `rss.art19.com` |
| **ATP.fm** | `cdn.atp.fm` |
| **Audioboom** | `api.audioboom.com` ² |
| **Ausha** | `feed.ausha.co` |
| **BBC Podcasts** | `podcasts.files.bbci.co.uk` |
| **Buzzsprout** | `feeds.buzzsprout.com` ⁴ |
| **Captivate** | `feeds.captivate.fm` |
| **Darknet Diaries** | `podcast.darknetdiaries.com` |
| **Fastcast.ai** | `feeds.fastcast.ai` |
| **FeedBurner** | `feeds.feedburner.com` |
| **HubHopper** | `rss.hubhopper.com` |
| **Libsyn** | `rss.libsyn.com` |
| **Megaphone** | `feeds.megaphone.fm` |
| **Omny Studio** | `traffic.omny.fm` ³ |
| **Podbean** | `feed.podbean.com` |
| **RedCircle** | `feeds.redcircle.com` |
| **RSS.com** | `media.rss.com` |
| **Simplecast** | `feeds.simplecast.com`, `api.simplecast.com` |
| **SoundCloud** | `feeds.soundcloud.com` |
| **Spreaker** | `api.spreaker.com` ¹ |
| **Transistor** | `feeds.transistor.fm` |

> ¹ Enter your `https://www.spreaker.com/show/{id}/episodes/feed` URL as-is. The app automatically fetches episode data through the Spreaker JSON API.
>
> ² Audioboom doesn't expose an RSS host that's allowlistable on Devvit. Enter the channel page URL (`https://audioboom.com/channels/{id}`) as-is and the app fetches episodes through the `api.audioboom.com` JSON API.
>
> ³ Omny Studio shows `omnycontent.com` URLs in their dashboard, with or without a `www.` prefix. Both forms are automatically normalized to `traffic.omny.fm` by the app, so any of these URLs works.
>
> ⁴ Buzzsprout RSS feeds are also accessible at `rss.buzzsprout.com`. These are automatically normalized to `feeds.buzzsprout.com` by the app, so either URL works. A pasted URL with no `https://` at all is also accepted.

Adding a host requires a new entry in `devvit.json` → `permissions.http.domains`, which Devvit caps at 25. Where a host has aliases, prefer normalizing the URL in `normalizeRssUrl` over spending an allowlist slot.

Need a different host? Open an [issue](https://github.com/jogalleciez/podcast-poster/issues/new) or [contact the developer](https://www.reddit.com/message/compose/?to=/u/jogalleciez).

---

## Tech Stack

| Component | Technology |
|---|---|
| Platform | [Devvit Web](https://developers.reddit.com/docs/capabilities/devvit-web/devvit_web_overview) v0.14.0 |
| Language | TypeScript 5.x / Node.js ≥ 22.6 |
| Frontend | React 19 + `react-markdown` (episode card UI) |
| RSS Parsing | [`fast-xml-parser`](https://github.com/NaturalIntelligence/fast-xml-parser) |
| HTML → Markdown | [`node-html-markdown`](https://github.com/crosstype/node-html-markdown) |
| Build | `esbuild` via `tools/build.ts` (server + client bundles) |
| Storage | Devvit Redis: per-feed GUID tracking via `last_posted_guid:url:{sha1(url).slice(0,12)}`, episode data via `post_data:{postId}` |

```bash
npm run dev          # devvit playtest
npm run build        # bundle server and client
npm run type-check   # tsc --build across project references
npm run deploy       # build + devvit upload
npm run launch       # build + deploy + devvit publish
```

Tests are colocated `*.test.ts` files run with the Node test runner:

```bash
node --test --experimental-strip-types src/server/*.test.ts
```

Deeper architecture notes live in `CLAUDE.md`, code style rules in `AGENTS.md`, and the manual QA checklist in `TESTING.md`.

---

## Known Limitations

- Only the **most recent** entry in the RSS feed is posted per check cycle.
- Only podcast hosts in the **Supported RSS Feed Hosts** section above are supported. Devvit requires all external domains to be [pre-approved](https://developers.reddit.com/docs/capabilities/server/http-fetch-policy), and hosts not on the list will fail silently at fetch time.
- Episodes released while **App Enabled** is off are skipped, not caught up later (see "No backlog on install or enable" above).
- A feed added while the app is already enabled is not seeded, so its latest episode posts on the next cron tick.
- Manually posting an *older* episode moves that feed's "last posted" marker to it, so the next automatic check will post the current newest episode.
- Reddit allows only **2** pinned posts per subreddit, so **Highlight New Episode Posts** keeps at most 2 episodes pinned at a time.
- **Legacy posts** created before the React UI was introduced will continue to render as plain Reddit text posts. Reddit does not allow changing a post's type after creation, so only posts created from this version onward will display the custom episode card.

---

## License

BSD-3-Clause
