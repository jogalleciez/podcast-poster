# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**podcast-poster** is a Reddit Devvit app (`@devvit/web@0.13.7`) that posts episodes from RSS podcast feeds to a subreddit as **custom WebView posts** with a React client. Moderators configure one or more feeds via app settings; a cron job (every 15 minutes) polls feeds and creates posts. Moderators can also pick a feed/episode manually via subreddit menu items.

Note: this branch (`feat/custom-post-webview-client`) migrated away from plain self-posts. AGENTS.md still describes the old server-only/self-post architecture — prefer this file when they disagree.

## Quick Start

```bash
npm run dev          # devvit playtest (Devvit's own watch script bundles in parallel)
npm run build        # esbuild bundles both server and client with --minify
npm run type-check   # tsc --build across project references
npm run deploy       # build + devvit upload
npm run launch       # build + deploy + devvit publish
```

Always run `npm run type-check` after edits. There is no test suite yet; if you add tests, use `node --test`.

## Architecture

### Three source modules
- **`src/server/`** — Node.js backend. Single big router in `src/server/server.ts` dispatches all endpoints. Entry `src/server/index.ts`. Output: `dist/server/index.js` (CommonJS).
- **`src/client/`** — React 19 WebView client rendered inside the Reddit post. `index.tsx` mounts `App.tsx`, which fetches episode data from `/api/post-data` and renders it with `react-markdown` + `remark-gfm`. Static files (`index.html`, `styles.css`, `fonts/`) are copied into `dist/client/` by a custom esbuild plugin. Output: ESM browser bundle.
- **`src/shared/`** — `api.ts` holds the `ApiEndpoint` constant map and all shared types (`EpisodeData`, `DisplaySettings`, `PostDataResponse`, `ClientErrorReport`, etc.) used by both server and client.

### Build (`tools/build.ts`)
Custom esbuild script that builds server (cjs/node) and client (esm/browser, `jsx: automatic`) in parallel. A `copy-static` plugin copies `src/client/index.html`, `styles.css`, and the `fonts/` directory into `dist/client`. Flags: `--watch`, `--minify`. Metafiles written to `dist/{server,client}.meta.json`.

### TypeScript
Project references in `tools/`: `tsconfig.base.json` (strict), `tsconfig.server.json` (node lib), `tsconfig.client.json` (DOM + react jsx), `tsconfig.shared.json`. Root `tsconfig.json` references them. `allowImportingTsExtensions: true` because **all relative imports must end in `.ts`/`.tsx`** (Devvit bundler requirement).

### Endpoints (see `src/shared/api.ts` for the full list)
Routed by exact URL match in `server.ts`:

| Endpoint | Purpose |
|---|---|
| `POST /internal/menu/post-create` | Subreddit menu → opens "select feed" form |
| `POST /internal/form/select-feed-submit` | Form submit → opens "select episode" form for the chosen feed |
| `POST /internal/form/select-episode-submit` | Form submit → creates a custom post for the picked episode |
| `POST /internal/menu/open-settings` | Subreddit menu → navigates to app settings |
| `POST /internal/menu/view-client-errors` | Subreddit menu → opens form listing recent client errors |
| `POST /internal/form/view-client-errors-submit` | Form close handler |
| `POST /internal/cron/check-rss` | Cron `*/15 * * * *` — auto-posting |
| `POST /internal/on-app-install` | Install trigger |
| `GET  /api/post-data` | Called by the React client to load the episode payload for the current post |
| `POST /api/log-client-error` | Client error reporter (`reportClientError` in `App.tsx`) |
| `GET  /api/client-errors` | Read recent client errors (for the debug menu) |

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
- `sticky_highlights` — JSON array of currently-highlighted post IDs (newest first, capped at `MAX_STICKY_SLOTS`=4) when `stickyPost` is enabled. Each new post takes sticky slot 1 and shifts the rest down (1→2, 2→3, …); the oldest falls off the end and is unstickied (see `pushStickyHighlight`). Note: Reddit's 6-slot "community highlights" carousel is *not* usable here — its `AddPostToHighlights` RPC returns gRPC UNIMPLEMENTED on Devvit — so this uses `post.sticky()` (`SetSubredditSticky`), which in practice accepts up to 4 subreddit slots.

### Settings (`devvit.json` → `settings.subreddit`)
`appEnabled`, `feedUrls` (paragraph; `URL | Name | LinkUrl` per line, `#` for comments), `postFlairId`, `postFlairText`, `includePodcastNameInTitle`, `includeEpisodeNumberInTitle` (prepends `Ep. {N} - ` to the episode title), `stickyPost` (label "Highlight New Episode Posts"; stickies each new post and shifts older highlights down via `pushStickyHighlight`), `listenButtonColor` (accent color applied across the WebView UI), `listenButtonPosition` (`top`/`bottom`), `webViewFont` (font key resolved via `FONT_FAMILY_BY_KEY` in `server.ts`; default `reddit`), `feedHistoryLimit` (episodes loaded in the episode picker).

There is **no** `pollingFrequency` / `weeklyPollingDay` setting in this branch — the cron runs every 15 minutes and each feed is checked against its stored last-posted GUID.

### Feed pipeline
`getFeeds()` parses `feedUrls` into `FeedConfig[]`. For each feed: fetch RSS (or Spreaker/Audioboom JSON API — see below), parse with `fast-xml-parser`, extract GUID/title/description/audio plus Podcasting 2.0 metadata (`<podcast:person>`, `<podcast:funding>`, `<podcast:chapters>`, `<podcast:soundbite>`, `<podcast:season>`, `<podcast:transcript>`), convert HTML to Markdown via `node-html-markdown`, strip platform privacy-notice boilerplate via `PRIVACY_PATTERNS` / `stripPrivacyNotices`, build an `EpisodeData`, submit a custom post with `reddit.submitCustomPost`, then write `post_data:{postId}` and the per-feed GUID. Fetches run in parallel (`Promise.all` / `allSettled`) to stay under Devvit's 30s endpoint timeout.

### Non-RSS feed adapters
Two feeds use JSON APIs instead of RSS, because their RSS domains aren't in Devvit's allowlist or are otherwise unavailable:

- **Spreaker** — detected by `spreaker.com/show/{id}` in the URL. Uses `api.spreaker.com/v2/shows/{id}/episodes` + `/v2/episodes/{id}` + `/v2/shows/{id}` (show meta). Spreaker returns duration in **milliseconds**; the parser divides by 1000 if the value exceeds 86400.
- **Audioboom** — detected by `audioboom.com/channel(s)/{id}` in the URL. Uses `api.audioboom.com/channels/{id}/audio_clips` + `/channels/{id}` (show meta). Mirrors the Spreaker adapter structure: `fetchAudioboomEpisode`, `fetchAudioboomEpisodes`, and `audioboomClipToEpisode`.

Both adapters cache their API responses in Redis (TTL ~50 min) and expose the same three-function interface (`fetchLatestEpisode` / `fetchEpisodePickList` / `fetchEpisodeByGuid`) so the cron and picker code paths are adapter-agnostic.

## Constraints

- **Devvit endpoint timeout: 30s.** Parallelize all independent network calls.
- **HTTP domain allowlist.** Every RSS host must be in `devvit.json` → `permissions.http.domains` (capped at 25 entries by Devvit — see commit `c4087b7`).
- **Redis-only state.** No database.
- **Node 22.6.0+** required (`tools/build.ts` runs under `--experimental-strip-types`).
- **No `any` without narrowing to `unknown`.** Prefer `type` over `interface`. Explicit return types on exported functions and route handlers.

## Related docs
- `AGENTS.md` — code style and command reference (its architecture section is stale; treat with skepticism).
- `README.md` — user-facing feature overview.
- `devvit.json` — manifest: endpoints, scheduler, settings schema, domain allowlist.
