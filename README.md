# Pod Poster

A [Devvit](https://developers.reddit.com) app that automatically creates Reddit posts for new podcast episodes from an RSS feed. When a new episode is detected, it creates a custom-UI post (rendered by a small React client) with the episode title, podcast name, description, and a "Listen" button — no manual posting required. Moderators can also post past episodes on demand by selecting any episode from a feed's history via the subreddit menu.

---

## Features

- **Automatic RSS polling** — a background cron job checks every 15 minutes and posts any new episode it finds
- **Manual post trigger** — moderators can pick a feed and a specific episode to post from the subreddit menu
- **Custom episode card** — every post renders as a React WebView with description, metadata, and an accent-colored Listen button
- **Podcasting 2.0 metadata** — surfaces `<podcast:person>`, `<podcast:funding>`, `<podcast:chapters>`, `<podcast:soundbite>`, `<podcast:transcript>`, and season info when feeds provide it
- **Flair, sticky, and title customization** — optional flair template/text, auto-sticky, and a toggle for whether the podcast name is included in the post title
- **Configurable accent color** — applied across buttons, links, and other accent elements in the episode card
- **Duplicate prevention** — tracks the last-posted episode GUID per feed in Redis (keyed by URL hash, so reordering feeds is safe)

---

## How It Works

### Automatic (Cron)

The app runs a background check every 15 minutes. For each configured feed it fetches the RSS (or the Spreaker JSON API for Spreaker shows), compares the most recent episode's GUID against the last-posted GUID stored in Redis, and posts the episode if it's new.

### Manual (Moderator Menu)

Post an episode on demand:
> Subreddit three-dot menu → **"Post an episode"**

You'll be prompted to pick one of your configured feeds, then to pick a specific episode from that feed's recent history. The depth of the episode picker is controlled by the **Feed History Depth** setting.

Open settings:
> Subreddit three-dot menu → **"Configure Podcast Poster"**

Debug client errors:
> Subreddit three-dot menu → **"View client errors (debug)"** — shows recent errors reported by the WebView client.

---

## Post Format

By default, posts are interactive WebView posts rendered by a React client. The post title is `{Podcast Name} - {Episode Title}` by default (or just `{Episode Title}` when **Include Podcast Name in Post Title** is disabled). The post body shown inside the WebView includes the episode description (HTML converted to Markdown), a Listen button, and a Details tab with episode metadata.

You can change the format with the **Post Type** setting:

- **Interactive post** (default) — the rich in-app player described above.
- **Self / text post** — a normal text post whose body is the episode description (as Markdown) with a "▶ Listen" link at the top.
- **Link post** — a link post pointing at the episode page. Reddit doesn't allow text on a link post itself, so the episode description is posted as the first comment (pinned by the app).

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
| **Highlight New Episode Posts** | When on, each new episode post is stickied to the top and previously highlighted posts shift down, keeping up to 4 recent episodes pinned at once. Once all slots are full, the oldest is unstickied. |
| **Accent Color** | Optional CSS color (e.g. `#ff5733` or `coral`) applied to buttons, links, and accent elements in the episode card. Defaults to Reddit blue. |
| **Listen Button Position** | Show the Listen button below the description (default) or above it. |
| **Feed History Depth** | How many recent episodes to load in the manual episode picker. Higher values let you find older episodes but are slower to load. Default: 50. |

> **Don't know your podcast's RSS feed URL?** Search for the show at [podcastindex.org](https://podcastindex.org) — the RSS feed URL is listed on every show's page. Copy it and paste it into the **RSS Feed URLs** setting.

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
| **Fastcast.ai** | `feeds.fastcast.ai` |
| **HubHopper** | `rss.hubhopper.com` |
| **Libsyn** | `rss.libsyn.com` |
| **Megaphone** | `feeds.megaphone.fm` |
| **Omny Studio** | `traffic.omny.fm` ³ |
| **Podbean** | `feed.podbean.com` |
| **RedCircle** | `feeds.redcircle.com` |
| **RSS.com** | `media.rss.com` |
| **Simplecast** | `feeds.simplecast.com`, `api.simplecast.com` |
| **Spreaker** | `api.spreaker.com` ¹ |
| **Transistor** | `feeds.transistor.fm` |

> ¹ Enter your `https://www.spreaker.com/show/{id}/episodes/feed` URL as-is — the app automatically fetches episode data through the Spreaker JSON API.
>
> ² Audioboom doesn't expose an RSS host that's allowlistable on Devvit. Enter the channel page URL (`https://audioboom.com/channels/{id}`) as-is — the app fetches episodes through the `api.audioboom.com` JSON API.
>
> ³ Omny Studio shows `www.omnycontent.com` URLs in their dashboard — these are automatically normalized to `traffic.omny.fm` by the app, so either URL works.
>
> ⁴ Buzzsprout RSS feeds are also accessible at `rss.buzzsprout.com` — these are automatically normalized to `feeds.buzzsprout.com` by the app, so either URL works.

Need a different host? Open an [issue](https://github.com/jogalleciez/podcast-poster/issues/new) or [contact the developer](https://www.reddit.com/message/compose/?to=/u/jogalleciez).

---

## Tech Stack

| Component | Technology |
|---|---|
| Platform | [Devvit Web](https://developers.reddit.com/docs/capabilities/devvit-web/devvit_web_overview) v0.12.22 |
| Language | TypeScript 5.x / Node.js ≥ 22.6 |
| Frontend | React 19 + `react-markdown` (episode card UI) |
| RSS Parsing | [`fast-xml-parser`](https://github.com/NaturalIntelligence/fast-xml-parser) |
| HTML → Markdown | [`node-html-markdown`](https://github.com/crosstype/node-html-markdown) |
| Build | `esbuild` via `tools/build.ts` (server + client bundles) |
| Storage | Devvit Redis — per-feed GUID tracking via `last_posted_guid:url:{sha1(url).slice(0,12)}`, episode data via `post_data:{postId}` |

---

## Known Limitations

- Only the **most recent** entry in the RSS feed is posted per check cycle.
- Only podcast hosts in the **Supported RSS Feed Hosts** section above are supported — Devvit requires all external domains to be [pre-approved](https://developers.reddit.com/docs/capabilities/server/http-fetch-policy). Hosts not on the list will fail silently at fetch time.
- **Legacy posts** created before the React UI was introduced will continue to render as plain Reddit text posts. Reddit does not allow changing a post's type after creation, so only posts created from this version onward will display the custom episode card.

---

## Changelog

A reverse-chronological summary of what's changed in Pod Poster. Most recent updates first.

### Latest — Custom episode cards

- **Accent color everywhere.** The Accent Color setting now styles buttons, links, headers, and every other accent inside the episode card — not just the Listen button.
- **Podcasting 2.0 support.** Posts now show host and guest info, funding/support links, chapters, soundbites, transcripts, and season/episode numbers when the feed provides them.
- **Built-in error reporting.** A new "View client errors (debug)" menu lets moderators see any issues the in-post UI runs into, making it easier to report problems.
- **Custom episode card UI.** Pod Poster posts are now interactive episode cards (with description, metadata, and a Listen button) instead of plain Reddit text posts. Posts created before this change stay as text posts — Reddit doesn't allow changing a post's type after creation.
- **Devvit platform update.** Upgraded to the latest Devvit platform release.

### Earlier this year — More podcast hosts and post controls

- **Audioboom support.** Audioboom-hosted podcasts now work. Paste the channel page URL (`https://audioboom.com/channels/{id}`) into RSS Feed URLs.
- **Auto-sticky new episodes.** A new **Sticky (Highlight) New Episode Posts** setting will automatically pin each new episode to the top of your subreddit (Reddit allows up to 2 pinned posts at a time).
- **Title customization.** A new **Include Podcast Name in Post Title** setting lets you choose between titles like `My Podcast - Episode 42` or just `Episode 42`. On by default.
- **Cleaner feed picker.** When manually posting, the feed picker now shows the actual podcast name pulled from each feed instead of just the URL.
- **Pod Poster branding and polished posts.** Posts now include a small "Posted by Pod Poster" footer, and common privacy/disclosure boilerplate that some podcast feeds inject into descriptions is automatically stripped out.

### Mid-year — Spreaker support and smarter listen links

- **Spreaker support.** Spreaker-hosted podcasts now work. Paste your `https://www.spreaker.com/show/{id}/episodes/feed` URL and the app handles the rest behind the scenes.
- **Smarter Listen button.** The Listen button now opens the episode's landing page from the RSS feed by default, falling back to the audio file only if no landing page is provided. You can still override this per-feed using the optional Link URL.
- **Expanded supported hosts.** Added support for more podcast hosting providers and removed a few that couldn't be approved on Devvit.

### Early on — Multi-feed and manual posting

- **Manual "Edit Post Body" menu** *(retired with the custom-card update)* — moderators could rewrite the text of an existing episode post. Removed in the move to custom episode cards, since post content is now rendered by the in-post UI.
- **Unlimited feeds in one setting.** Consolidated the per-feed settings into a single multi-line **RSS Feed URLs** box so you can configure as many podcasts as you like, one per line.
- **Multi-feed support.** Pod Poster can manage more than one podcast at a time, with custom names per feed and independent "last posted" tracking so feeds don't interfere with each other.
- **Initial release.** Automatic posting of the latest episode from a single RSS feed, plus a moderator menu to post on demand.

---

## License

BSD-3-Clause
