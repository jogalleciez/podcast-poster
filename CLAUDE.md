# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**podcast-poster** is a Reddit Devvit app (`@devvit/web@0.15.3`) that posts episodes from RSS podcast feeds to a subreddit. By default posts are **custom WebView posts** rendered by a React client, but the `postType` setting can switch them to self or link posts. Moderators configure one or more feeds via app settings; a cron job (every 15 minutes) polls feeds and creates posts. Moderators can also pick a feed/episode manually via a subreddit menu item.

Note: the app migrated away from plain self-posts as the only format. If any doc still describes a server-only/self-post-only architecture, prefer this file.

## Quick Start

```bash
npm run dev          # devvit playtest (Devvit's own watch script bundles in parallel)
npm run build        # esbuild bundles both server and client with --minify
npm run type-check   # tsc --build across project references
npm run deploy       # build + devvit upload
npm run launch       # build + deploy + devvit publish
```

Always run `npm run type-check` after edits.

### Tests

There is no `npm test` script. Tests are plain `node:test` files colocated as `*.test.ts` next to the module they cover, and must be run with `--experimental-strip-types` (they import `.ts` paths directly):

```bash
node --test --experimental-strip-types src/server/*.test.ts
```

Single file:

```bash
node --test --experimental-strip-types src/server/markdown.test.ts
```

Current coverage is only `cron-policy.test.ts`, `markdown.test.ts`, and `feed-url.test.ts` — the pure, dependency-free helpers. `server.ts` imports `context`/`redis`/`reddit`/`settings` from `@devvit/web/server`, which only resolve inside the Devvit runtime, so importing it from a test is not viable as written; put new pure logic in its own module with a test file, the way `cron-policy.ts` and `markdown.ts` do. `TESTING.md` is the manual QA checklist for everything that can't be unit tested.

## Architecture

### Three source modules
- **`src/server/`** — Node.js backend. One ~1550-line module, `src/server/server.ts`, holds the router plus every handler, feed adapter, and parser. Entry `src/server/index.ts`. Three pure helper modules are split out so they can be unit-tested without the Devvit runtime: `cron-policy.ts` (`decideCronAction`), `markdown.ts` (`clampListNesting`), and `feed-url.ts` (`normalizeRssUrl`). Output: `dist/server/index.js` (CommonJS).
- **`src/client/`** — React 19 WebView client rendered inside the Reddit post. `index.tsx` mounts `App.tsx`, which fetches episode data from `/api/post-data` and renders it with `react-markdown` + `remark-gfm`. Static files (`index.html`, `styles.css`, `fonts/`) are copied into `dist/client/` by a custom esbuild plugin. Output: ESM browser bundle.
- **`src/shared/`** — `api.ts` holds the `ApiEndpoint` constant map and all shared types (`EpisodeData`, `DisplaySettings`, `PostDataResponse`, `ClientErrorReport`, etc.) used by both server and client.

### Build (`tools/build.ts`)
Custom esbuild script that builds server (cjs/node) and client (esm/browser, `jsx: automatic`) in parallel. A `copy-static` plugin copies `src/client/index.html`, `styles.css`, and the `fonts/` directory into `dist/client`. Flags: `--watch`, `--minify`. Metafiles written to `dist/{server,client}.meta.json`.

### TypeScript
Project references in `tools/`: `tsconfig.base.json` (strict), `tsconfig.server.json` (node lib), `tsconfig.client.json` (DOM + react jsx), `tsconfig.shared.json`. Root `tsconfig.json` references them. `allowImportingTsExtensions: true` because **all relative imports must end in `.ts`/`.tsx`** (Devvit bundler requirement).

### Endpoints (see `src/shared/api.ts` for the full list)
Routed by **exact URL match** in `server.ts` (a `switch` over `ApiEndpoint` with `endpoint satisfies never` in the default case, so adding an entry to `ApiEndpoint` forces a handler). Exact match means any query string 404s.

| Endpoint | Purpose |
|---|---|
| `POST /internal/menu/post-create` | Subreddit menu → opens "select feed" form (or skips straight to the episode picker with 1 feed) |
| `POST /internal/form/select-feed-submit` | Form submit → opens "select episode" form for the chosen feed |
| `POST /internal/form/select-episode-submit` | Form submit → creates a post for the picked episode, honoring the form's per-post `postTypeOverride` |
| `POST /internal/menu/open-settings` | Subreddit menu → navigates to app settings |
| `POST /internal/menu/view-client-errors` | **Dead code** — routed and implemented, but `devvit.json` has no menu item for it |
| `POST /internal/form/view-client-errors-submit` | **Dead code** — close handler for the above |
| `POST /internal/cron/check-rss` | Cron `*/15 * * * *` — auto-posting |
| `POST /internal/on-app-install` | Install trigger |
| `GET  /api/post-data` | Called by the React client to load the episode payload for the current post; 404s for self/link posts |
| `POST /api/log-client-error` | Client error reporter (`reportClientError` in `App.tsx`) |
| `GET  /api/client-errors` | Read recent client errors. **Moderator-only** (`isCurrentUserModerator`, fails closed with 403), because `/api/*` is reachable from any viewer's client and the log holds user agents |

### Redis keys
- `last_posted_guid:url:{sha1(feed.url).slice(0,12)}` — per-feed last-posted GUID, keyed by a stable URL hash so reordering feeds doesn't lose history. Legacy positional keys (`last_posted_guid:{index}`) are migrated on first read.
- `post_data:{postId}` — `EpisodeData` payload served to the WebView client. Written at post creation.
- `spreaker_show:{showId}` — cached Spreaker latest-episode detail (TTL ~50 min).
- `spreaker_show_meta:{showId}` — cached Spreaker show metadata (TTL ~50 min).
- `spreaker_picklist:{showId}:{limit}` — cached Spreaker episode list for the episode picker.
- `spreaker_episode:{episodeId}` — cached individual Spreaker episode detail.
- `audioboom_channel_meta:{channelId}` — cached Audioboom channel metadata.
- `audioboom_channel_clips:{channelId}:{limit}` — cached Audioboom episode list.
- `audioboom_channel_title:{channelId}` — cached channel title for the feed selector.
- `client_errors` — JSON array of up to 50 most-recent client error reports (see `onLogClientError` / `onListClientErrors`).
- `app_enabled_state` — `"true"`/`"false"` snapshot of the `appEnabled` setting as of the previous cron run. Used by `onCheckRSS` (via `decideCronAction` in `cron-policy.ts`) to detect the disabled→enabled transition (and first run after install, since `appEnabled` defaults to `true`). On that transition it **seeds** each feed's `last_posted_guid:` to the current latest episode without posting (`seedFeedBaselines`), so enabling the app never dumps a backlog — only episodes published afterward get posted.
- `sticky_highlights` — JSON array of currently-highlighted post IDs (newest first, capped at `MAX_STICKY_SLOTS`=2) when `stickyPost` is enabled. Each new post takes sticky slot 1 and the previous highlight shifts to slot 2 (1→2); the older one falls off the end and is unstickied (see `pushStickyHighlight`). Note: Reddit's 6-slot "community highlights" carousel is *not* usable here — its `AddPostToHighlights` RPC returns gRPC UNIMPLEMENTED on Devvit — so this uses `post.sticky()` (`SetSubredditSticky`). Although `post.sticky()`'s type accepts positions 1–4, Reddit only supports **two** sticky slots per subreddit; `post.sticky(3)`/`(4)` fail with `400 Bad Request`.

### Settings (`devvit.json` → `settings.subreddit`)
`appEnabled`, `feedUrls` (paragraph; `URL | Name | LinkUrl` per line, `#` for comments), `postFlairId`, `postFlairText`, `includePodcastNameInTitle`, `includeEpisodeNumberInTitle` (prepends `Ep. {N} - ` to the episode title), `stickyPost` (label "Highlight New Episode Posts"; stickies each new post and shifts older highlights down via `pushStickyHighlight`), `listenButtonColor` (accent color applied across the WebView UI), `listenButtonPosition` (`top`/`bottom`), `webViewFont` (font key resolved via `FONT_FAMILY_BY_KEY` in `server.ts`; default `reddit`), `feedHistoryLimit` (episodes loaded in the episode picker), `postType` (select `custom`/`self`/`link`, default `custom` — see below).

There is **no** `pollingFrequency` / `weeklyPollingDay` setting — the cron runs every 15 minutes and each feed is checked against its stored last-posted GUID.

Devvit `select` settings come back as either a string or a one-element array; every read of `postType` / `listenButtonPosition` / `webViewFont` normalizes with `Array.isArray(raw) ? raw[0] : raw`.

### Feed pipeline
`getFeeds()` parses `feedUrls` into `FeedConfig[]`. For each feed: fetch RSS (or Spreaker/Audioboom JSON API — see below), parse with `fast-xml-parser`, extract GUID/title/description/audio plus Podcasting 2.0 metadata (`<podcast:person>`, `<podcast:funding>`, `<podcast:chapters>`, `<podcast:soundbite>`, `<podcast:season>`, `<podcast:transcript>`), convert HTML to Markdown via `node-html-markdown`, strip platform privacy-notice boilerplate via `PRIVACY_PATTERNS` / `stripPrivacyNotices`, build an `EpisodeData`, then hand off to `createEpisodePost()`, then write the per-feed GUID. Fetches run in parallel (`Promise.all` / `allSettled`) to stay under Devvit's 30s endpoint timeout.

### Cron flow (`onCheckRSS`)
`decideCronAction(isEnabled, prevEnabledState)` (`cron-policy.ts`) returns one of three actions each run:
- **`disabled`** — `appEnabled === false`. Writes `app_enabled_state = "false"` and returns. (Note `isEnabled` is `!== false`, so an unset setting counts as enabled, matching the schema default.)
- **`seed`** — enabled now, but `app_enabled_state` wasn't `"true"` last run (fresh install, or a disabled→enabled toggle). `seedFeedBaselines()` records each feed's current latest GUID and posts **nothing**, so enabling never dumps a backlog.
- **`post`** — steady state. `checkOneFeed` per feed in parallel; a feed that throws logs `Error checking feed N` and doesn't block the others.

Known consequences of this design, all deliberate but easy to mistake for bugs (see `TESTING.md` §6 for the full list): episodes published while the app was disabled are **permanently skipped** rather than caught up; a feed added while the app is already enabled is **not** seeded, so its latest episode posts on the next tick; and manually posting an *old* episode rewrites that feed's baseline, so the next cron tick posts the newest episode.

### Post types (`createEpisodePost`)
Both the cron and manual-picker paths funnel through `createEpisodePost(episode, postTypeOverride?)`, which branches on the `postType` setting — or, for manual posts, on the `postTypeOverride` select the episode picker adds (pre-selected to the global setting; only `custom`/`self`/`link` are accepted, anything else falls back to the setting).

- **`custom`** (default): `reddit.submitCustomPost` + writes `post_data:{postId}` so the React WebView client can render it. This is the only path that populates `post_data:`/`GET /api/post-data`.
- **`self`**: `reddit.submitPost({ text })` with a Markdown body from `buildSelfPostBody(episode, listenPosition)` (a large "Listen to this Episode" heading link + `episode.description`, ordered by the `listenButtonPosition` setting). No WebView, no `post_data:` write.
- **`link`**: `reddit.submitPost({ url })` pointing at `postLinkUrl || linkUrl || audioUrl`. Reddit link posts can't carry a body, so the same `buildSelfPostBody` Markdown is posted as a distinguished/stickied first comment via `reddit.submitComment` (best-effort). Falls back to a self post only when all three URLs are empty.

`createEpisodePost` returns `{ url, permalink }`, not a bare URL: for link posts `post.url` is the *external* episode URL, and passing only that to `navigateTo` shows the external-link confirmation dialog instead of the post. Devvit's navigation resolver uses `permalink` when `url` isn't a comments page.

Flair (`reddit.setPostFlair`) and sticky-highlight (`pushStickyHighlight`) run after creation and are post-type-agnostic.

**Markdown clamping:** `buildSelfPostBody` runs the body through `clampListNesting` (`markdown.ts`). Reddit converts self/link Markdown to RTJSON, which rejects list items nested more than 2 tiers (`INVALID_RTJSON`); podcast show notes (ATP especially) nest 3–4 deep. The clamp pulls deeper items up to tier 2 rather than dropping them, and leaves fenced code blocks alone. It applies **only** to self/link bodies — the `custom` path renders client-side with `react-markdown` and keeps the original nesting.

### Non-RSS feed adapters
Two feeds use JSON APIs instead of RSS, because their RSS domains aren't in Devvit's allowlist or are otherwise unavailable:

- **Spreaker** — detected by `spreaker.com/show/{id}` in the URL. Uses `api.spreaker.com/v2/shows/{id}/episodes` + `/v2/episodes/{id}` + `/v2/shows/{id}` (show meta). Spreaker returns duration in **milliseconds**; the parser divides by 1000 if the value exceeds 86400.
- **Audioboom** — detected by `audioboom.com/channel(s)/{id}` in the URL. Uses `api.audioboom.com/channels/{id}/audio_clips` + `/channels/{id}` (show meta). Mirrors the Spreaker adapter structure: `fetchAudioboomEpisode`, `fetchAudioboomEpisodes`, and `audioboomClipToEpisode`.

Both adapters cache their API responses in Redis (TTL ~50 min) and expose the same three-function interface (`fetchLatestEpisode` / `fetchEpisodePickList` / `fetchEpisodeByGuid`) so the cron and picker code paths are adapter-agnostic.

## Constraints

- **Devvit endpoint timeout: 30s.** Parallelize all independent network calls.
- **HTTP domain allowlist.** Every RSS host must be in `devvit.json` → `permissions.http.domains` (capped at 25 entries by Devvit, see commit `c4087b7`; currently 21 are used). Unlisted hosts fail at fetch time with no user-visible warning on the cron path, and every new domain goes through Devvit's manual review on the next upload. Where a host has aliases, prefer normalizing the URL in `normalizeRssUrl` over spending an allowlist slot. Normalize **toward** the host that actually serves the feed: if the allowlisted host only redirects to an unlisted one, the fetch may fail (this is why Buzzsprout's canonical host is `rss.buzzsprout.com`, since `feeds.buzzsprout.com` now 301s there). `normalizeRssUrl` also upgrades `http://` to `https://` (Devvit fetch is https-only) and unwraps Podtrac `rss.pdrl.fm/{id}/{feed URL}` wrappers.
- **Redis-only state.** No database.
- **Node 22.6.0+** required (`--experimental-strip-types` landed in 22.6.0, and both `tools/build.ts` and the test runner rely on it). Devvit 0.15.3 itself only declares `node >=20`, so 22.6.0 is this project's floor, not the platform's. `.nvmrc` pins `22.6.0`.
- **No `any` without narrowing to `unknown`.** Prefer `type` over `interface`. Explicit return types on exported functions and route handlers.
- **Reddit stickies: 2 slots max**, despite `post.sticky()`'s type accepting 1–4.
- **Self/link post Markdown must survive RTJSON conversion** — see the clamping note above before adding anything that emits deep structure.

## Related docs
- `TESTING.md` — manual QA checklist for a test subreddit, ordered by risk, plus a list of confirmed-but-surprising behaviors (§6). The authority on what has and hasn't been verified on a real sub.
- `AGENTS.md`: code style rules (naming, imports, formatting, error handling) plus a condensed commands/architecture section. Refreshed for 0.14.0; this file remains the more detailed architecture reference.
- `README.md`: moderator-facing setup guide. Deliberately non-technical, written for a podcaster installing the app: quick start, what each post type looks like, how to add a feed, the settings table, and a "Good to know" section covering the seeding/backlog behavior and the 2-sticky limit in plain language. Implementation detail does not belong here.
- `TECHNICAL.md`: the implementation-level counterpart to `README.md`, holding the technical framing the README used to carry before it was rewritten for moderators. Covers the feature list, cron vs manual posting flows, post-format behavior, the settings reference with types and defaults, the supported-host table, tech stack, and known limitations. Sits between `README.md` and this file in depth: more precise than the README, less internal than the architecture notes here. It documents *what the app does and why*; this file documents *how the code is laid out*.
- `devvit.json` — manifest: menu items, forms, scheduler, settings schema, domain allowlist.

**Doc drift hazard:** the supported-host table is duplicated in both `README.md` and `TECHNICAL.md`, and the real source of truth is `permissions.http.domains` in `devvit.json`. Adding a host means touching five places: the allowlist, both tables, the domain list in `PRIVACY_POLICY.md`, and the count in the HTTP allowlist constraint above. The tables group hosts by provider, so one row can list several hosts (Libsyn lists two); Spreaker and Audioboom rows list their JSON API host, since that is what the server fetches.
