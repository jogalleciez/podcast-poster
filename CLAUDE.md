# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**podcast-poster** is a Reddit Devvit application that automatically posts the latest episodes from one or more RSS podcast feeds to a subreddit as standard self-posts. It runs on the Devvit platform (`@devvit/web@0.12.20`) with a Node.js backend. There is no webview or client-side code — posts are plain text posts with episode metadata.

**Why it exists:** Subreddit moderators configure one or more RSS feeds via app settings. The app polls feeds on a schedule (hourly, daily, or weekly) and creates Reddit self-posts with the episode title, description (HTML converted to Markdown), and a listen link. Moderators can also manually trigger posts or edit existing post bodies.

## Quick Start Commands

See **AGENTS.md** for full command details. Essential commands:

```bash
npm run dev          # Start local development environment (devvit playtest)
npm run build        # Production build (esbuild with minification)
npm run type-check   # TypeScript strict type checking (run after every edit)
npm run deploy       # Build and deploy to Devvit
npm run launch       # Build, deploy, and publish to app directory
```

**Critical:** Always run `npm run type-check` after editing — it enforces strict typing and catches errors that would break the build.

## Architecture Overview

The project is a **server-only** Devvit Web app with two source directories:

### 1. Server Module (`src/server/`)
- **Purpose:** Backend logic running on Devvit's Node.js runtime
- **Responsibilities:**
  - HTTP request routing (7 endpoints in `src/server/server.ts`)
  - RSS feed fetching and parsing (`fast-xml-parser`)
  - Spreaker API fetching with `cache()` deduplication
  - Reddit post creation via Devvit SDK (`reddit.submitPost`)
  - Redis state management (tracking last-posted episode GUID per feed)
  - Scheduled cron (every 15 minutes) gated by user's `pollingFrequency` setting
  - Moderator menu triggers for manual posting, settings, and body editing
- **Output:** `dist/server/index.js` (CommonJS for Node.js)

### 2. Shared Module (`src/shared/`)
- **Purpose:** Type definitions and API endpoint constants used by the server
- **Contents:** `api.ts` with `ApiEndpoint` enum and request/response types

### Build System: Custom esbuild Bundler

The `tools/build.ts` script:
- Runs esbuild for the **server only** (no client bundle)
- Server: CommonJS output for Node.js (`platform: "node"`)
- Supports `--watch` mode for development
- Supports `--minify` flag for production
- Generates a metafile (`dist/server.meta.json`) for bundle analysis

### TypeScript Configuration

Modular TypeScript configs in `tools/` use project references:
- `tsconfig.json` — Root config with project references (server, shared)
- `tsconfig.base.json` — Shared strict configuration
- `tsconfig.server.json` — Node.js-specific (Node lib)
- `tsconfig.shared.json` — Shared types only

**Key setting:** `allowImportingTsExtensions: true` is needed because `.ts` extensions are **required in imports** (see Code Style in AGENTS.md).

## Key Files & Entry Points

| File | Purpose |
|------|---------|
| `src/server/index.ts` | Server entry point; initializes HTTP server |
| `src/server/server.ts` | Main HTTP router; defines 7 endpoints (~646 lines) |
| `devvit.json` | App manifest: endpoints, scheduler, settings, domain allowlist |
| `tools/build.ts` | Custom esbuild bundler script (server-only) |
| `package.json` | Project dependencies and npm scripts |

## Critical Patterns to Understand

### HTTP Endpoints (server.ts)
The server exposes 7 endpoints:
1. **`POST /internal/menu/post-create`** — Manual moderator trigger (subreddit menu)
2. **`POST /internal/menu/edit-post-body`** — Opens pre-filled form to edit post body (post menu)
3. **`POST /internal/form/edit-post-body-submit`** — Saves edited body to the post
4. **`POST /internal/form/select-feed-submit`** — Posts from selected feed (or all feeds)
5. **`POST /internal/menu/open-settings`** — Navigates to app settings page
6. **`POST /internal/cron/check-rss`** — Scheduled cron job (every 15 minutes)
7. **`POST /internal/on-app-install`** — Installation trigger

Request/response types are defined in `src/shared/api.ts`. Handlers return `UiResponse`, `TaskResponse`, or `TriggerResponse` shapes from `@devvit/web/shared` / `@devvit/web/server`.

### Redis State Management

The app tracks the last-posted episode GUID per-feed using **stable URL-hash keys** so reordering feeds does not corrupt history:
```
Key: last_posted_guid:url:{sha1(feed.url).slice(0,12)}
Value: GUID string
```

A best-effort migration reads legacy positional keys (`last_posted_guid:{index}`) on first access and writes the stable key.

Additional keys:
- `pending_edit:{userId}` — Stores post ID during form edit (10-minute expiration)
- `last_global_check_date` — Tracks date of last global check for daily/weekly gating
- `spreaker_show:{showId}` — Cached Spreaker API response (50-minute TTL)

### Subreddit Settings
Configured by moderators in the Devvit app settings:

| Setting | Type | Purpose |
|---------|------|---------|
| `appEnabled` | boolean | Enables/disables automatic posting |
| `feedUrls` | paragraph | Multi-feed configuration: one per line, format `URL [| Name [| LinkUrl]]` |
| `postFlairId` | string | Optional flair template ID to apply to each post |
| `postFlairText` | string | Optional flair text override |
| `pollingFrequency` | select | `hourly` / `daily` / `weekly` — controls posting cadence for all feeds |
| `weeklyPollingDay` | select | Day of week for weekly posting (0=Sunday … 6=Saturday) |

The cron job fires every 15 minutes but `onCheckRSS` skips posting if the current time doesn't match the configured `pollingFrequency`. All feeds share the same polling schedule.

### Multi-Feed Architecture
The `getFeeds()` function parses the `feedUrls` setting and returns a `FeedConfig[]` array:
- Splits on newlines, trims whitespace, skips comments (lines starting with `#`)
- Each line is split on `|` to extract URL, optional name, optional link URL
- Feeds are assigned sequential indices (1, 2, 3, ...) for display/selection only
- The actual Redis key is derived from a SHA-1 hash of the URL for stability

### RSS Fetching & Post Creation
1. Fetch RSS feed via HTTP (domain allowlisting required in `devvit.json`)
2. Spreaker feeds are fetched via the Spreaker JSON API instead of RSS
3. Parse XML with `fast-xml-parser`
4. Extract episode GUID, title, description, audio URL
5. Convert HTML descriptions to Markdown with `node-html-markdown`
6. Create Reddit self-post via `reddit.submitPost`
7. Store GUID in Redis to prevent reposting

Feeds are checked **in parallel** using `Promise.all` / `Promise.allSettled` to avoid the 30-second Devvit endpoint timeout.

## Important Constraints

### Devvit Platform Limits
- **Endpoint Timeout:** 30 seconds. Always parallelize independent network calls (RSS fetches, settings reads).
- **HTTP Domain Allowlisting:** External RSS feeds require pre-approved domains in `devvit.json`. Requests to unlisted domains will fail.
- **Redis-Only State:** No database access; use Redis for all persistent state.

### TypeScript & Build
- **File Extensions Required:** All relative imports must include `.ts` extension (e.g., `import { foo } from "./bar.ts"`). This is a Devvit bundler requirement.
- **Strict Mode:** All TypeScript configs use strict mode. No `any` types without explicit narrowing to `unknown`.
- **Type Exports:** Use explicit return types on all functions, especially exported endpoints.

### Runtime Requirements
- **Node.js 22.6.0+** — Required for native ES2023 support and type stripping
- **Devvit v0.12.20** — Pinned in package.json

### Testing
The project targets Node.js 22+ and uses the native Node test runner (`node --test`). See AGENTS.md for test commands. Always run tests before pushing.

## Debugging Tips

- **Type errors after edits:** Run `npm run type-check` immediately to catch issues.
- **Build failures:** Check for missing `.ts` extensions in imports.
- **RSS feed failures:** Confirm domain is allowlisted in `devvit.json` and check error logs in Devvit console.
- **Stale state:** Clear Redis keys manually if testing involves GUID tracking.
- **Endpoint timeout:** If you add more feeds or slower APIs, ensure fetches are parallelized.

## Related Documentation

- **AGENTS.md** — Detailed code style guidelines, command reference, and AI agent directives
- **README.md** — User-facing documentation, feature overview, and limitations
- **devvit.json** — App manifest with HTTP endpoints, scheduler config, settings schema, and domain allowlist
- **package.json** — Project dependencies and npm scripts
