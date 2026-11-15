# Test & Verification Checklist — podcast-poster

## Context

The working tree carries five behavioral changes that have never run on a real subreddit: the sticky-slot cap dropped 4→2, a brand-new cron seeding policy (`cron-policy.ts`), Markdown list-nesting clamping (`markdown.ts`), a per-post post-type override in the episode picker, and two fixes to link-post behavior. `@devvit/web` also went 0.13.7 → 0.13.8 and `devvit` moved to devDependencies. None of this is covered by anything but two small unit-test files.

This is a manual QA checklist for a test subreddit, ordered by risk: Tier 1 is the unreleased work, Tiers 2–5 are regression coverage for the whole feature surface. Tier 1 alone is the minimum bar before shipping.

**Where to watch:** `devvit logs <test-sub>` in a second terminal for every cron/post test — most failure paths log and produce no user-visible signal.

---

## 0. Pre-flight setup

- [ ] `npm ci` from clean (`rm -rf node_modules`) → `npm run type-check` → `npm run build` all pass on 0.13.8
- [ ] `npm run dev` (`devvit playtest`) connects to the test sub; `devvit` CLI resolves from devDependencies
- [ ] `node --test --experimental-strip-types src/server/*.test.ts` → 8 tests pass (`cron-policy.test.ts`, `markdown.test.ts`)
- [ ] App install → `devvit logs` shows `podcast-poster installed. Configure RSS feeds in App Settings.`
- [ ] As a **non-moderator** member: neither subreddit menu item appears
- [ ] As a mod: exactly two menu items — "Post an episode", "Configure Podcast Poster"
- [ ] Create 2+ flair templates on the test sub (one text-editable, one not) and note the template IDs

**Test feeds to have on hand** (all allowlisted hosts, `devvit.json:56-80`):

| Purpose | Feed |
|---|---|
| Deep nested show notes | `https://cdn.atp.fm/rss/public` |
| Omny privacy boilerplate + URL alias | an `omnycontent.com/d/...` URL (tests rewrite to `traffic.omny.fm`) |
| Acast privacy boilerplate | `https://feeds.acast.com/...` |
| Spreaker adapter | `https://www.spreaker.com/show/{id}` |
| Audioboom adapter | `https://audioboom.com/channel/{id}` |
| Megaphone (often no per-item `<link>`) | `https://feeds.megaphone.fm/...` |
| Podcasting 2.0 tags | a `podcastindex.org` PC2.0 example feed on an allowlisted host |
| Non-allowlisted (negative test) | `https://anchor.fm/s/xxx/podcast/rss` |

---

## Tier 1 — Unreleased changes (must pass before shipping)

### 1.1 Sticky slots 4 → 2 (`server.ts:1009-1021`, `devvit.json:123`)
The whole point of this change: `post.sticky(3)`/`(4)` returned `400 Bad Request`.

- [ ] `stickyPost = true`, post episode A → A stickied slot 1; `sticky_highlights` = `["t3_A"]`
- [ ] Post B → B slot 1, A slot 2; **no `400 Bad Request` anywhere in logs**
- [ ] Post C → A unstickied, C slot 1, B slot 2, list is exactly 2 entries
- [ ] Post D → confirm still exactly 2 stickies, no errors
- [ ] Migration case: seed `sticky_highlights` with 4 ids (or test on a pre-change install), post once → the 2 extras get unstickied, none orphaned
- [ ] `stickyPost = false` → no sticky calls, existing stickies untouched
- [ ] Sticky works for **all three** post types, not just interactive
- [ ] Sticky failure (delete a tracked post, then post a new episode) → logged per-post, new post still created successfully
- [ ] App Settings help text reads "up to 2 recent episodes"

### 1.2 Cron seeding policy (`cron-policy.ts`, `server.ts:1459-1510`)
Highest-risk change — controls whether enabling the app dumps a backlog.

- [ ] **Fresh install with feeds already configured** → first cron tick logs `App enabled: seeded N feed baseline(s); no backlog posted.` and creates **zero posts**
- [ ] Second tick onward → only genuinely new episodes post. Confirm no backlog dump ever.
- [ ] `appEnabled` never touched (unset) → cron still runs (regression on `server.ts:1485`, `!== false` was `=== false`)
- [ ] Toggle `appEnabled = false` → next tick logs `Podcast poster is disabled in settings.`, `app_enabled_state` = `"false"`, nothing posted
- [ ] Toggle back to `true` → next tick **seeds** (posts nothing). Any episode published while disabled is permanently skipped — **confirm this is the intended contract** (see §6.1)
- [ ] Zero feeds + enabled → logs `seeded 0 feed baseline(s)`, no crash
- [ ] Add a **brand-new feed while already enabled** (`app_enabled_state` = `"true"`) → its latest episode posts on the next tick, unseeded. Asymmetric with fresh install — **confirm intended** (see §6.2)
- [ ] Same episode still latest across several ticks → logs `already posted "…"`, creates nothing
- [ ] One broken feed among good ones → broken one logs `Error checking feed N`, the others still post

### 1.3 List-nesting clamp (`markdown.ts`, `server.ts:1103`)
Reddit's RTJSON rejects list items nested >2 tiers on self/link submission.

- [ ] ATP feed, `postType = self` → submits successfully, rendered list is max 2 tiers
- [ ] ATP feed, `postType = link` → the description **comment** submits successfully (previously the failure point)
- [ ] Same ATP episode as `custom` → WebView shows the **original deep nesting** (clamp must not touch the interactive path)
- [ ] A feed whose notes contain a fenced code block → code block passes through untouched
- [ ] Ordered lists (`1.` and `1)`) survive with markers and inline text intact

### 1.4 Per-post `postTypeOverride` (`server.ts:920-955`, `1128-1130`, `1424`)
- [ ] Episode picker shows a second required "Post type" select, pre-selected to the current global `postType`
- [ ] Global `custom`, override `self` → that one post is a self post; global setting unchanged afterward
- [ ] Global `self`, override `custom` → that one post is interactive with a working WebView
- [ ] Global `custom`, override `link` → link post + distinguished first comment
- [ ] Submitting without changing the dropdown → matches the global setting

### 1.5 `navigateTo` gets `{url, permalink}` (`server.ts:1203-1208`, `1428`)
- [ ] Manual **link** post → after the success toast you land on the Reddit **comments page**, not the external-link confirmation dialog (this was the bug)
- [ ] Manual `custom` post → lands on the post
- [ ] Manual `self` post → lands on the post

### 1.6 Link post falls back to `audioUrl` (`server.ts:1156-1158`)
- [ ] Megaphone-style feed with no per-item `<link>` and no Link URL column, `postType = link` → a real **link post pointing at the MP3** (previously silently became a self post)
- [ ] Feed where all three URLs are empty → still falls back to a self post
- [ ] `postLinkUrl` (Link URL column) present → wins over both others

### 1.7 Housekeeping
- [ ] `assets/icon.png.old2` / `.old3` are not shipped in the bundle
- [ ] `README.md:38` still documents a "View client errors (debug)" menu item that no longer exists in `devvit.json` — remove or restore the menu item (see §6.8)
- [ ] `README.md` Tech Stack still says "Devvit Web v0.12.22" — update to 0.13.8

---

## Tier 2 — Post types, titles, flair

### 2.1 Post type matrix (`createEpisodePost`, `server.ts:1109-1209`)
Run each with the **same** episode so output is comparable.

- [ ] `custom` → WebView renders; `post_data:{postId}` written; `/api/post-data` returns the payload
- [ ] `self` → Markdown body, no WebView, `/api/post-data` returns 404 (expected)
- [ ] `link` → link post + distinguished/stickied first comment carrying the same body
- [ ] `link` where the bot lacks mod-comment permission → link post exists, comment failure logged only, post not broken

### 2.2 `buildSelfPostBody` + `listenButtonPosition` (`server.ts:1091-1107`)
- [ ] `position = top` → `# [Listen to this Episode](url)` **above** the description
- [ ] `position = bottom` (default) → heading **below** the description
- [ ] Heading is H1 with **no emoji** (commits 46666e3, 178c1b2)
- [ ] Episode with no audio and no link → body is the bare description, no heading
- [ ] Very long description (>40 000 chars) → truncated with a trailing `…`, submission succeeds
- [ ] **Known gap:** self posts point the Listen link at the audio enclosure, ignoring the feed's Link URL column (see §6.3)

### 2.3 Title building (`server.ts:1136-1142`)
- [ ] Both title settings on, feed has `<itunes:episode>42` → `My Podcast - Ep. 42 - Episode Title`
- [ ] Podcast name off, number on → `Ep. 42 - Episode Title`
- [ ] Name on, number off → `My Podcast - Episode Title`
- [ ] Both off → `Episode Title`
- [ ] Number on but feed has no episode number → no `Ep.` prefix, no error
- [ ] `<podcast:episode display="42a">42</podcast:episode>` → `Ep. 42a - …` (display wins)
- [ ] Item with no `<title>` → `Untitled Episode`
- [ ] Feed with no `<title>` and no name override → `Podcast`
- [ ] **No 300-char guard:** long name + long title → submission fails with only a generic toast/log (see §6.4)

### 2.4 Flair (`server.ts:1182-1193`)
- [ ] Valid `postFlairId`, no text → template's own text applied
- [ ] Valid id + `postFlairText` on a text-editable template → override text shown
- [ ] `postFlairText` set with **no** id → text silently ignored
- [ ] Invalid/foreign template UUID → post still created and visible; error logged, no toast
- [ ] Whitespace-only id → treated as unset
- [ ] Non-editable template + text override → `setPostFlair` errors, post keeps no flair
- [ ] Flair applies to all three post types

---

## Tier 3 — Feed configuration & adapters

### 3.1 `feedUrls` parsing (`getFeeds`, `server.ts:121-146`)
- [ ] Bare URL → title comes from the RSS `<title>`
- [ ] `url | My Show` → post titles and card header use `My Show`; feed selector labels it without a fetch
- [ ] `url | | https://site.com/listen` → Listen target is the site URL for `custom` and `link` posts
- [ ] `# comment` line → skipped
- [ ] Blank / whitespace-only line → skipped
- [ ] `| Name | Url` with no URL → line dropped entirely
- [ ] Extra 4th `|` segment → ignored
- [ ] Spaces around `|` → trimmed
- [ ] 3 feeds with one commented out → indices renumber over the filtered list

### 3.2 URL normalization (`normalizeRssUrl`, `src/server/feed-url.ts`)
Unit-covered by `src/server/feed-url.test.ts`; these check the real fetch path.
- [ ] `https://omnycontent.com/d/...` → fetches (rewritten to `traffic.omny.fm`)
- [ ] `https://www.omnycontent.com/d/...` → fetches (rewritten to `traffic.omny.fm`), case-insensitive
- [ ] `omnycontent.com/d/...` with **no scheme** → fetches (`https://` prepended, then rewritten)
- [ ] `https://feeds.buzzsprout.com/123.rss` → fetches (rewritten to `rss.buzzsprout.com`)
- [ ] `https://rss.buzzsprout.com/123.rss` → fetches unchanged
- [ ] `rss.libsyn.com/shows/{id}/destinations/{id}.xml`, `feeds.libsyn.com/{id}` and `feeds.libsyn.com/{id}/rss` (redirects to `rss.libsyn.com`) all work; `{show}.libsyn.com/rss` fails (not allowlisted, no alias)
- [ ] `feeds.hubhopper.com/{id}.rss` works
- [ ] `http://...` on an allowlisted host → fetches (upgraded to `https://`)
- [ ] `https://rss.pdrl.fm/{id}/feeds.megaphone.fm/...` → fetches (Podtrac wrapper stripped)
- [ ] `https://rss.pdrl.fm/{id}/www.omnycontent.com/d/...` → fetches (unwrapped, then rewritten to `traffic.omny.fm`)
- [ ] Non-allowlisted host → picker toast `Couldn't load episodes from that feed.`; cron logs `Error checking feed N` with no user-visible warning

### 3.3 Manual posting flow (`server.ts:908-960`, `1334-1436`)
- [ ] Works even with `appEnabled = false` (deliberate, `server.ts:1335`)
- [ ] **0 feeds** → toast `No feeds configured. Opening App Settings…` **and** navigates to settings
- [ ] **1 feed** → episode picker opens directly, no feed-selection step
- [ ] **2+ feeds** → feed selector with resolved names (override → Spreaker show → Audioboom channel → RSS title → `Feed N`)
- [ ] One broken feed among good ones → that row reads `Feed 2`, others resolve
- [ ] Episode option labels are `YYYY-MM-DD — Title`, truncated at 100 chars with `…`
- [ ] Item with no `pubDate` → no date prefix, still selectable
- [ ] GUID containing a `|` → still parses and posts (split on first `|` only)
- [ ] Toast matrix: `No episode selected.` / `Invalid episode selection.` / `Feed no longer exists.` / `Episode not found in feed.` / `Error posting episode: unknown error`
- [ ] Pick a feed, then edit `feedUrls` (reorder/delete) before submitting → `Selected feed not found.` or `Feed no longer exists.`, no crash
- [ ] **Baseline side effect:** manually post an *old* episode, wait for a cron tick → the newest episode gets posted (see §6.5)

### 3.4 `feedHistoryLimit` (`server.ts:861-865`)
- [ ] Unset / `0` / negative / non-numeric → 50 options
- [ ] `10.6` → 11 options
- [ ] `1` → exactly 1 option
- [ ] `500` on an RSS feed → slices to what's available, picker still loads inside the 30s timeout
- [ ] Change the value on a Spreaker/Audioboom feed → cache key changes, first load refetches (slower), then fast

### 3.5 Spreaker adapter (`server.ts:216-404`)
- [ ] `https://www.spreaker.com/show/{id}` and `.../show/{id}/episodes/feed` both work
- [ ] Picker lists episodes; >100 episodes paginate via `next_url`
- [ ] Show title falls back correctly when `/v2/shows/{id}` fails
- [ ] Duration: normal episode correct; an episode under 86 seconds displays correctly (ms-vs-seconds heuristic)
- [ ] Details tab is sparse (no PC2.0, no episode number, no explicit) — expected
- [ ] 50-min cache: publish a new Spreaker episode → posts within ~50 min + cron interval
- [ ] Privacy boilerplate is **not** stripped (see §6.6)
- [ ] **GUID mismatch:** manually post a Spreaker episode, then wait for a cron tick → check for a duplicate of the newest episode (see §6.7)

### 3.6 Audioboom adapter (`server.ts:406-511`)
- [ ] Both `/channel/{id}` and `/channels/{id}` accepted
- [ ] Picker lists clips; channel title resolves in the feed selector
- [ ] Link post points at `https://audioboom.com/posts/{id}`
- [ ] Clip with no `high_mp3` → Listen button hidden, post still created
- [ ] Picking an episode deeper than `feedHistoryLimit` is not possible — expected
- [ ] Privacy boilerplate is **not** stripped (see §6.6)

### 3.7 RSS/Atom parsing (`server.ts:709-839`)
- [ ] An Atom feed (`<feed>`/`<entry>`) parses
- [ ] Feed with a single `<item>` (object, not array) parses
- [ ] Feed returning an HTML error page → toast `No episodes found in that feed.`
- [ ] Feed with malformed `pubDate`s → those items sort to the bottom; verify the picker's "newest first" ordering holds
- [ ] Item with no guid/id/link → silently dropped (picker shows fewer than the feed has)
- [ ] Description precedence: `content:encoded` wins over `description` / `itunes:summary`
- [ ] Duration formats: `HH:MM:SS`, `MM:SS`, bare seconds all render; garbage → Duration row hidden
- [ ] Explicit: `yes`/`true` → 🤬; `clean`/`no` → 😇; channel-level explicit marks **every** episode
- [ ] Author / email fallback chains resolve (item → channel → `<author>` parens / `itunes:owner`)
- [ ] `itunes:keywords` comma-split, empties dropped
- [ ] `episodeType`: a `trailer` and a `bonus` item show a Type row; `full` shows nothing
- [ ] Feed with no channel description → **Show tab does not render at all**
- [ ] Channel `itunes:subtitle` → italic tagline under the podcast name

### 3.8 Subtitle redundancy suppression (`server.ts:729-755`)
- [ ] Subtitle identical to the description's first line → subtitle hidden
- [ ] Subtitle with a Markdown link matching the description's HTML `<a>` → still hidden
- [ ] Subtitle with curly quotes/em dashes vs. the description's entities → still hidden
- [ ] Genuinely distinct subtitle → shown above the description in the Episode tab

### 3.9 Podcasting 2.0 (`server.ts:593-679`)
- [ ] `<podcast:person>`: item-level wins over channel-level; `group="writing"` filtered out; `role` shown in parens; `href` makes it a link
- [ ] `<podcast:funding>`: channel-level only (item-level ignored); deduped by URL; empty text → `Support the show`; Episode tab only
- [ ] `<podcast:chapters>`: first occurrence → Details "View chapters" link works
- [ ] `<podcast:soundbite>`: valid ones render as `M:SS` "Key Moments"; one missing `duration` or `startTime` is dropped
- [ ] `<podcast:season>` with `@name` → Details shows `3 — Season Name`; `itunes:season` wins for the number
- [ ] `<podcast:transcript>`: first `@url` → Details "Transcript" link works
- [ ] Zero/negative season or episode numbers treated as absent

### 3.10 Privacy stripping (`server.ts:181-210`)
- [ ] Omny feed → trailing `See omnystudio.com/listener for privacy information.` gone
- [ ] Acast feed → `Hosted on Acast. See acast.com/privacy…` gone
- [ ] Megaphone / Simplecast / Art19 / Libsyn / Podtrac boilerplate gone
- [ ] Applied to the channel description on the Show tab too
- [ ] **Over-broad regex check:** a description that legitimately mentions "privacy policy" mid-paragraph → verify the sentence isn't truncated (see §6.6)
- [ ] **Over-broad regex check:** a legitimate `iheartpodcastnetwork.com` link in the notes → verify the whole line isn't deleted

---

## Tier 4 — WebView client (`custom` posts)

### 4.1 States (`App.tsx:140-144`, `349-357`)
- [ ] Fresh post → brief `Loading episode…` then the card
- [ ] Post whose Redis snapshot is gone → `Episode data unavailable.`
- [ ] Server down / 500 → `Couldn't load episode: HTTP 500`
- [ ] Load a post, then break the server → **still renders from the `localStorage` cache** (`pp_post_data:{postId}`)
- [ ] Corrupt the cache entry in devtools → falls back to a normal fetch cleanly

### 4.2 Live display settings (no re-post needed, `server.ts:1236-1262`)
- [ ] Change `webViewFont` → reload an **existing** post → new font. Test all 7: `reddit`, `figtree`, `inter`, `ibm-plex-sans`, `merriweather`, `atkinson`, `system`
- [ ] Garbage font value → falls back to `reddit`
- [ ] `listenButtonColor = #ff5733` → recolors Listen button, links, tab underline, soundbite timestamps, expand FAB
- [ ] `listenButtonColor = coral` and an `oklch(...)` value → applied
- [ ] `listenButtonColor = not-a-color` → stays Reddit blue, no crash
- [ ] Blank color → default
- [ ] Change `listenButtonPosition` → existing post's button moves (top = between tabs and panel; bottom = after tabs, before footer)
- [ ] First paint after a settings change briefly shows the cached old settings — confirm acceptable

### 4.3 Tabs & content
- [ ] Episode tab always present; Details always present; Show tab only when the feed has a channel description
- [ ] Sit on the Show tab, then swap to a feed without one → falls back to Episode, no blank panel
- [ ] All Details rows render correctly and each is hidden when absent
- [ ] Email copy button → 📋 flips to ✅ "Copied" for 2 s; denial is silent
- [ ] Markdown: tables, strikethrough, autolinks (remark-gfm) render
- [ ] Show notes containing a **relative** link or `mailto:` → rendered as plain text, not a link (by design, `App.tsx:360-371`)
- [ ] Long unbroken URL in the notes → wraps, no horizontal scroll
- [ ] Footer: bot disclosure, "Add this to your subreddit" link, modmail compose link all work

### 4.4 Listen button (`App.tsx:373-393`)
- [ ] URL preference `postLinkUrl` → `linkUrl` → `audioUrl`
- [ ] All three empty → button not rendered at all
- [ ] `http://` URL → upgraded to `https://`
- [ ] **iOS:** feed with `feedUrl` present → opens the default podcast app via `podcast://`; falls back to the listen URL
- [ ] **Android:** uses the plain URL (the `podcast://` scheme errors there)
- [ ] An **old post created before `feedUrl` was stored** → falls back cleanly on iOS

### 4.5 Expand / overflow (`App.tsx:184-267`)
- [ ] Short episode → no bottom fade, no expand-hint FAB
- [ ] Long episode → blurred bottom fade + round expand FAB appear
- [ ] Tap expand → both affordances disappear, scrolling works
- [ ] Collapse → affordances return
- [ ] Top-right expand icon hidden while expanded
- [ ] Test all of the above on Android app, iOS app, and desktop web

### 4.6 Mobile blank-WebView workaround (`App.tsx:249-267`)
- [ ] Mobile app → open post → tap Listen → wait **>8 s** → return → content reappears (near-instant from cache)
- [ ] Round trip **<8 s** → does **not** reload
- [ ] Devvit's preloaded hidden desktop/mobile entrypoints don't trigger a spurious reload

### 4.7 Theming & a11y (`styles.css`)
- [ ] Light and dark Reddit themes both legible
- [ ] Custom accent color → check contrast in **both** themes (only `--pp-link` and `--pp-button-bg` are overridden)
- [ ] Cyrillic / CJK / Greek episode title → falls back to the system font (web fonts are Latin-range only). Test with each font setting.
- [ ] Keyboard: tab through tabs, Listen, footer links, copy button → visible focus ring
- [ ] Narrow phone width with 3 tabs present → tab bar doesn't overflow (no wrap/scroll configured)
- [ ] Wide desktop → card centered at 760px max-width

---

## Tier 5 — Error paths & routing

- [ ] `GET /api/post-data` on a **self** or **link** post → 404 (expected)
- [ ] `/api/post-data?x=1` (any query string) → 404, since routing is exact-match (`server.ts:45`)
- [ ] Unknown endpoint → `404 {"error":"not found"}`
- [ ] Force a server throw → confirm the **stack trace** in the 500 JSON never surfaces in a mod- or user-visible UI (`server.ts:25-31`)
- [ ] Client error reporting: trigger a JS error → appears in `GET /api/client-errors` (as a moderator), capped at 50, newest first
- [ ] `GET /api/client-errors` as a non-moderator (or logged out) → `403 {"error":"forbidden"}`, no log entries returned
- [ ] Send malformed JSON to `/api/log-client-error` → a `{ts, parseError}` entry is stored, response is still `{ok:true}`
- [ ] **Noise check:** expand/collapse a post ~10 times → confirm every mode change is logged as a client "error" and evicts real errors from the 50-entry ring (see §6.7)

---

## 6. Behaviors to confirm or decide (found while reading; not necessarily bugs)

Each of these is a real, reproducible behavior. Decide intended vs. bug during testing rather than after.

1. **Episodes published while disabled are permanently skipped.** Off→on re-seeds instead of catching up (`cron-policy.ts:23-32`).
2. **New feed added while already enabled is not seeded** → its latest episode posts immediately. Asymmetric with a fresh install (`server.ts:1495`).
3. **Self posts ignore the `Link URL` column** — `buildSelfPostBody` uses `audioUrl || linkUrl` (`server.ts:1092`), while interactive (`App.tsx:373`) and link posts (`server.ts:1158`) prefer `postLinkUrl`.
4. **No 300-char title guard** (`server.ts:1140-1142`) → submission fails with only a generic toast.
5. **Manually posting an old episode rewrites the feed baseline** (`server.ts:1425`) → next cron tick posts the newest episode, possibly duplicating an earlier post.
6. **Privacy stripping skips Spreaker and Audioboom** (`server.ts:289`, `:454`), and two regexes are over-broad enough to truncate legitimate text (`server.ts:193`, `:201`).
7. **Spreaker GUID mismatch:** the picker emits `episode_id` (`server.ts:376`) while cron stores `rss_guid` (`server.ts:286`) → a manual Spreaker post can trigger an immediate duplicate.
8. **`viewClientErrorsForm` / `onMenuViewClientErrors` are dead code** — no menu item exists in `devvit.json`, yet `README.md:38` advertises it. Client errors are only readable via `GET /api/client-errors` or `devvit logs`.
9. **Re-stickying overrides manual unstickies:** kept posts are re-stickied unconditionally on each push (`server.ts:1067-1077`), so a post you unstickied by hand comes back.
10. **Stray repo files:** `assets/icon.png.old2`, `.old3`, plus committed `temp_schema.json`, `pod-poster.jpg/.png`, and an `undefined/` directory.

---

## Verification aids

```bash
node --test --experimental-strip-types src/server/cron-policy.test.ts src/server/markdown.test.ts
```

```bash
npm run type-check
```

Stream logs while testing cron and posting (replace the sub name):

```bash
npx devvit logs podcast_poster_dev
```

Redis keys worth inspecting between steps: `app_enabled_state`, `sticky_highlights`, `last_posted_guid:url:{sha1-12}`, `post_data:{postId}`, `client_errors`.

To force a cron run rather than waiting for `*/15`, either wait for the next quarter hour with logs streaming, or temporarily narrow `feedHistoryLimit` and use the manual picker to simulate the post path.
