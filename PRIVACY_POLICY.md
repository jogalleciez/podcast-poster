# Privacy Policy

**Last updated:** November 14, 2026

This privacy policy describes how the **podcast-poster** Reddit Devvit app ("the App") handles data.

---

## What the App Does

podcast-poster is a Reddit Devvit app that posts episodes from moderator-configured podcast feeds to a subreddit. It runs entirely within the Reddit/Devvit platform. Every 15 minutes it checks each configured feed and posts any new episode. Moderators can also pick an episode from a feed and post it by hand from the subreddit menu.

Episodes can be posted in one of three formats, chosen by the moderators:

- **Interactive post** (default): a post that displays the episode in a built-in viewer.
- **Text post**: a standard Reddit text post containing a listen link and the episode notes.
- **Link post**: a link to the episode page, with the episode notes added as a pinned first comment.

---

## Information We Collect

### We do not collect information that identifies Reddit users

The App does not collect, store, or process information that identifies any Reddit user. Specifically:

- No Reddit usernames, user IDs, or profile data are collected, including for moderators who use the App's menu actions
- No IP addresses are logged or stored
- No cookies are used
- No analytics, advertising, or tracking services are used

### Diagnostic logs from interactive posts

To diagnose display problems on different devices, the interactive post viewer sends short diagnostic reports to the App's own server. A report is sent:

- each time an interactive post loads,
- each time a viewer expands or collapses an interactive post, and
- whenever the viewer hits an error.

Each report can contain:

- the Reddit post ID being viewed,
- the viewer's browser user agent string (which describes the browser, app, and operating system, for example "iPhone, Reddit app"),
- technical details about the viewer's state (expanded or collapsed, whether the page was visible, whether cached data was used, whether it is running in the mobile Reddit app),
- for errors, the error message and technical trace, and
- the time the report was received.

Reports contain no username, user ID, or IP address, and cannot be linked to a specific Reddit account. Only the 50 most recent reports are kept. Older reports are deleted automatically as new ones arrive. Reports can be read only by moderators of the subreddit where the App is installed, for troubleshooting, and are not shared with any third party.

### Browser storage

To make interactive posts load faster, the viewer saves a copy of the episode details it displays (title, description, links, and similar podcast information) in the viewer's browser storage (`localStorage`), labeled by post ID. This copy contains only public episode information, never personal data. It stays on the viewer's device and can be cleared by clearing the browser's or Reddit app's site data.

### Moderator-configured settings

Subreddit moderators provide configuration values when setting up the App. These are stored in Devvit's built-in settings system and are scoped to the subreddit installation:

| Setting | Purpose |
|---------|---------|
| App enabled | Turns automatic posting on or off |
| RSS feed URLs | The podcast feeds to monitor, one per line, each with an optional podcast name and link URL override |
| Post type | Whether episodes are posted as interactive, text, or link posts |
| Post flair ID / text (optional) | Flair to apply to created posts |
| Include podcast name in post title | Whether titles start with the podcast name |
| Include episode number in post title | Whether titles include the episode number |
| Highlight new episode posts | Whether new posts are stickied to the top of the subreddit |
| Accent color | Color used for buttons and links in interactive posts |
| Listen button position | Whether the listen link appears above or below the episode notes |
| Post font | Font used in interactive posts |
| Feed history depth | How many recent episodes appear in the manual episode picker |

None of these settings capture or expose personal data about any Reddit user.

---

## How We Use Information

The App uses the configuration above to:

1. **Fetch podcast feeds:** retrieve each configured feed every 15 minutes, and when a moderator opens the episode picker
2. **Avoid duplicate posts:** compare each feed's newest episode against the last episode posted from that feed
3. **Create Reddit posts:** publish episode information (podcast and episode titles, descriptions, listen link, publish date, episode and season numbers, duration, and any hosts, guests, contact email, funding links, chapters, transcripts, or highlight clips the podcast's own feed lists) in the chosen post format
4. **Apply subreddit options:** add the configured flair, and if highlighting is on, sticky the new post and unsticky the oldest highlighted post once Reddit's limit of two stickied posts is reached

All episode information comes from the podcast's own public feed.

---

## Data Storage

The App stores the following in Devvit's Redis storage, scoped to the subreddit installation:

| Data | Contents | Purpose | Kept for |
|------|----------|---------|----------|
| Last posted episode, per feed | Episode ID string | Prevents duplicate posts | Replaced each time a newer episode from that feed is posted |
| Episode details, per interactive post | Public episode information for that post | Lets the interactive post display the episode | The lifetime of the installation |
| Feed data cache | Episode lists and show details from Spreaker and Audioboom | Reduces repeated requests to those services | About 50 minutes |
| Diagnostic logs | The reports described above | Diagnosing display problems | The 50 most recent reports |
| App enabled state | "true" or "false" | Detects when the App is switched on, so it does not post a backlog of old episodes | Replaced on every check |
| Highlighted posts | Up to 2 Reddit post IDs | Tracks which posts the App has stickied | Replaced each time a post is highlighted |

None of this data identifies a Reddit user, and none of it is shared outside the App.

---

## Third-Party Services

The App's server makes outbound requests only to fetch podcast episode data from podcast hosting platforms: RSS feeds, plus the Spreaker and Audioboom data services for shows hosted there. The domains the App is permitted to contact are:

- `rss.art19.com`
- `traffic.omny.fm`
- `rss.buzzsprout.com`
- `feeds.redcircle.com`
- `feeds.transistor.fm`
- `feeds.captivate.fm`
- `feed.podbean.com`
- `media.rss.com`
- `feeds.acast.com`
- `feed.ausha.co`
- `feeds.hubhopper.com`
- `feeds.simplecast.com`
- `api.spreaker.com`
- `cdn.atp.fm`
- `podcasts.files.bbci.co.uk`
- `feeds.megaphone.fm`
- `api.audioboom.com`
- `rss.libsyn.com`
- `feeds.libsyn.com`
- `podcast.darknetdiaries.com`
- `feeds.soundcloud.com`

**No Reddit user data is sent to any of these services.** These requests come from Reddit's servers, not from viewers' devices, and include only standard HTTP headers and an `X-Fetch-Reason` header explaining the App's purpose.

The interactive post viewer does not load content from outside Reddit. Its fonts are bundled with the App. A viewer's device only contacts an outside website (such as the podcast's site or a listening app) when the viewer chooses to open a link. That website's own privacy policy then applies.

All other data handling is performed within the Reddit/Devvit platform.

---

## Data Retention

- **Stored data** is kept as described in the Data Storage table above. Nothing is archived beyond it.
- **Browser storage** stays on the viewer's device until the viewer clears it.
- **Moderator settings** persist for the lifetime of the App installation and are managed by the Devvit platform, which removes them when the App is uninstalled.
- **Reddit posts and comments** created by the App become standard Reddit content, subject to Reddit's own [Privacy Policy](https://www.reddit.com/policies/privacy-policy). Uninstalling the App does not delete posts it has already made.

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
