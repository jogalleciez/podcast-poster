# Pod Poster

Automatically posts your podcast's new episodes to your subreddit.

Point Pod Poster at your show's feed and it takes care of the rest. Every time you release an episode, it creates a post with the title, show name, episode notes, and a Listen button, usually within 15 minutes of the episode going live. You can also post any older episode by hand whenever you want.

---

## Quick Start

**1. Install the app on your subreddit.**

**2. Add your podcast.** Open the subreddit's three-dot menu and choose **Configure Podcast Poster**. Paste your show's RSS feed URL into the **RSS Feed URLs** box.

> An RSS feed is the address your podcast host publishes your episodes at. Every podcast has one. If you do not know yours, search for your show at [podcastindex.org](https://podcastindex.org) and copy the RSS feed URL from its page.

**3. Turn it on.** Check that **App Enabled** is switched on, then save.

That is it. Your next new episode will be posted automatically. Old episodes stay where they are, so switching the app on will never dump your back catalog into the subreddit all at once.

---

## What a post looks like

By default, posts are titled **Podcast Name - Episode Title** and open an interactive player right inside Reddit. You can change the format with the **Post Type** setting:

| Format | What it is | When to pick it |
|---|---|---|
| **Interactive post** (default) | A built-in player with the episode notes, a Listen button, and a Details tab with extra episode info. | You want the nicest-looking result and the most episode detail in one place. |
| **Self / text post** | An ordinary Reddit text post. The body is the episode notes, with a large "Listen to this Episode" link above or below them. | You prefer posts that look like everything else on your subreddit, or your community reads mostly in old Reddit. |
| **Link post** | A link straight to the episode page. Reddit will not allow text on a link post, so the episode notes are added as a pinned first comment instead. | You want clicks to go directly to your episode page. |

This setting controls automatic posts. When you post an episode by hand, you can choose a different format just for that one post.

Interactive posts also pick up any extra detail your feed publishes: hosts and guests, support and funding links, chapters, clips, transcripts, and season numbers. Nothing to configure, and anything your feed leaves out is simply left out of the post.

---

## Posting an episode yourself

You do not have to wait for a new release. To post any recent episode:

1. Open the subreddit's three-dot menu and choose **Post an episode**.
2. Pick which podcast you want (this step is skipped if you only have one).
3. Pick the episode from the list.

The list shows your most recent episodes. **Feed History Depth** controls how far back it goes.

That screen also has a **Post type** dropdown, already set to whatever you picked in settings. Changing it here affects only this one post. Your saved setting stays as it is.

---

## Adding your podcast

Each line in the **RSS Feed URLs** box is one podcast. The full format is:

```
URL | Podcast Name | Link URL
```

Only the first part is required.

| Part | Required? | What it does |
|---|---|---|
| **URL** | Yes | Your podcast's RSS feed address. |
| **Podcast Name** | No | Overrides the show name from the feed. Leave it out to use whatever your feed already says. |
| **Link URL** | No | Where the "Listen to this episode" link points. Useful if you have a landing page you want listeners to reach. Leave it out and the link goes to the episode's own page, or to the audio file if the feed does not provide one. |

**Examples:**

```
https://rss.art19.com/get-played | Get Played
https://feeds.transistor.fm/my-podcast | | https://my-podcast.com/listen
https://rss.buzzsprout.com/123456.xml
```

The first one is renamed to "Get Played". The second keeps its own name but sends listeners to your site. The third uses the defaults for both.

You can add as many podcasts as you like, one per line. Start a line with `#` to leave yourself a note or to temporarily switch a feed off.

> **Note:** The box holds about 2,000 characters in total, which is plenty for most setups but worth knowing if you are adding a long list of feeds with long URLs.

---

## Supported podcast hosts

Pod Poster works with these hosts out of the box:

| Provider | Domain(s) |
|---|---|
| **Acast** | `feeds.acast.com` |
| **Art19** | `rss.art19.com` |
| **ATP.fm** | `cdn.atp.fm` |
| **Audioboom** | `api.audioboom.com` ² |
| **Ausha** | `feed.ausha.co` |
| **BBC Podcasts** | `podcasts.files.bbci.co.uk` |
| **Buzzsprout** | `rss.buzzsprout.com` ⁴ |
| **Captivate** | `feeds.captivate.fm` |
| **Darknet Diaries** | `podcast.darknetdiaries.com` |
| **HubHopper** | `feeds.hubhopper.com` |
| **Libsyn** | `rss.libsyn.com`, `feeds.libsyn.com` |
| **Megaphone** | `feeds.megaphone.fm` |
| **Omny Studio** | `traffic.omny.fm` ³ |
| **Podbean** | `feed.podbean.com` |
| **RedCircle** | `feeds.redcircle.com` |
| **RSS.com** | `media.rss.com` |
| **Simplecast** | `feeds.simplecast.com` |
| **SoundCloud** | `feeds.soundcloud.com` |
| **Spreaker** | `api.spreaker.com` ¹ |
| **Transistor** | `feeds.transistor.fm` |

To check whether yours is covered, look at your feed URL and find the part right after `https://`. If it appears in the table above, you are good to go.

If your feed address starts with `rss.pdrl.fm/` (a Podtrac tracking link), skip past that part and the short code after it, and check the address that follows instead. The app handles Podtrac links for you.

> ¹ For Spreaker, paste your `https://www.spreaker.com/show/{id}/episodes/feed` URL exactly as it appears. The app handles the rest.
>
> ² For Audioboom, paste your channel page URL (`https://audioboom.com/channels/{id}`) exactly as it appears. The app handles the rest.
>
> ³ Omny Studio shows `omnycontent.com` addresses in its dashboard (sometimes with a `www.` in front). Any of those, or a `traffic.omny.fm` address, will work.
>
> ⁴ Buzzsprout feeds work whether the address starts with `rss.buzzsprout.com` or `feeds.buzzsprout.com`.

Do not see your host? Open an [issue](https://github.com/jogalleciez/podcast-poster/issues/new) or [send the developer a message](https://www.reddit.com/message/compose/?to=/u/jogalleciez).

---

## Settings

Find these under **Configure Podcast Poster** in the subreddit menu.

| Setting | What it does |
|---|---|
| **App Enabled** | Turns automatic posting on and off. On by default. |
| **RSS Feed URLs** | Your podcasts, one per line. See [Adding your podcast](#adding-your-podcast) above. |
| **Post Type** | How new episodes are posted: **Interactive post** (default), **Self / text post**, or **Link post**. See [What a post looks like](#what-a-post-looks-like) above. |
| **Post Flair Template ID** | Applies a flair to every episode post. Copy the ID from your subreddit's flair settings. It looks like a long string of letters, numbers, and dashes. Optional. |
| **Post Flair Text Override** | Shows different wording on the flair than the template's own. Only does anything if you have set a flair template ID above. Optional. |
| **Include Podcast Name in Post Title** | On by default, giving you titles like *My Podcast - Great Interview*. Turn it off to use just the episode title. Handy if your whole subreddit is about one show. |
| **Include Episode Number in Post Title** | Adds the episode number, as in *My Podcast - Ep. 42 - Great Interview*. Off by default. Shows have to publish an episode number for this to appear, and titles fall back to the normal format when they do not. |
| **Highlight New Episode Posts** | Pins each new episode to the top of your subreddit. Off by default. See the note about the two-pin limit in [Good to know](#good-to-know). |
| **Accent Color** | Changes the color of buttons and links in interactive posts. Enter a color name like `coral` or a hex code like `#ff5733`. Leave blank for Reddit blue. |
| **Listen Button Position** | Puts the Listen button below the episode notes (default) or above them. |
| **Post Font** | The font used in interactive posts. System / Reddit is the default and matches the look of the Reddit app. Merriweather, Figtree, Inter, IBM Plex Sans, and Atkinson Hyperlegible (designed for readability) are also available. Changing this updates your existing posts too, so there is no need to re-post anything. |
| **Feed History Depth** | How many recent episodes appear when you post one by hand. 50 by default. Raise it to reach further back, at the cost of a slower-loading list. |

---

## Good to know

**Turning the app on will not flood your subreddit.** The first check after you install the app, and the first check after you switch **App Enabled** back on, simply makes a note of where each podcast currently stands. Nothing gets posted. Only episodes released after that point show up. The trade-off is that episodes released while the app was switched off are skipped rather than posted late.

**Nothing posted?** First check that your host appears in [Supported podcast hosts](#supported-podcast-hosts). An unsupported host fails quietly, with no error message anywhere, so it is worth ruling out before anything else. Then confirm **App Enabled** is on and that your feed URL is spelled correctly.

**Adding a podcast later posts its newest episode.** The "no flood" behavior above only applies when you switch the whole app on. A feed you add to an app that is already running is treated as new, so its most recent episode is posted on the next check. Only that one, not its whole history.

**One episode per check.** Each check posts at most the newest episode from each podcast. If you release two episodes within the same 15 minutes, only the newer one is posted automatically. You can add the other by hand.

**Posting an older episode by hand moves the bookmark.** The app then treats that older episode as the most recent one it has seen, so the next automatic check will post your current newest episode. This is usually harmless, but it does mean you may see a second post shortly after.

**Reddit allows only two pinned posts per subreddit.** So **Highlight New Episode Posts** keeps your two most recent episodes pinned. When a third arrives, the oldest is unpinned automatically.

**Older posts keep their old look.** Posts created before the interactive player existed will keep showing up as plain text posts. Reddit does not allow a post's format to be changed after it is created, so only new posts get the current design.

---

## Support

Questions, bug reports, and host requests are welcome:

- [Open an issue on GitHub](https://github.com/jogalleciez/podcast-poster/issues/new)
- [Message the developer on Reddit](https://www.reddit.com/message/compose/?to=/u/jogalleciez)

---

## Tech Stack

| Component | Technology |
|---|---|
| Platform | [Devvit Web](https://developers.reddit.com/docs/capabilities/devvit-web/devvit_web_overview) v0.15.4 |
| Language | TypeScript 7.x / Node.js ≥ 24.18 |
| Frontend | React 19 + `react-markdown` (episode card UI) |
| RSS Parsing | [`fast-xml-parser`](https://github.com/NaturalIntelligence/fast-xml-parser) |
| HTML → Markdown | [`node-html-markdown`](https://github.com/crosstype/node-html-markdown) |
| Build | `esbuild` via `tools/build.ts` (server + client bundles) |
| Storage | Devvit Redis: per-feed GUID tracking via `last_posted_guid:url:{sha1(url).slice(0,12)}`, episode data via `post_data:{postId}` |

Source code: [podcast-poster on GitHub](https://github.com/jogalleciez/podcast-poster)

---

## License

BSD-3-Clause
