# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**podcast-poster** is a Reddit Devvit application that automatically posts the latest episodes from one or more RSS podcast feeds to a subreddit. It runs on the Devvit platform (v0.12.18) with a Node.js backend and a browser-based webview for an embedded podcast player. The application handles RSS polling, post creation, and playback via a custom webview.

**Why it exists:** Subreddit moderators configure one or more RSS feeds per installation via a simple text setting. The app periodically checks each feed for new episodes and posts them automatically to the subreddit. Users can play episodes directly from the embedded webview player without leaving Reddit.

## Quick Start Commands

See **AGENTS.md** for full command details. Essential commands:

```bash
npm run dev          # Start local development environment (devvit playtest)
npm run build        # Production build (esbuild with minification)
npm run type-check   # TypeScript strict type checking (run after every edit)
npm run deploy       # Build and deploy to Devvit
npm run launch       # Build, deploy, and publish to app directory
```

**Critical:** Always run `npm run type-check` after editing—it enforces strict typing and catches errors that would break the build.

## Architecture Overview

The project uses a **three-module build system** compiled independently by a custom esbuild bundler:

### 1. Server Module (`src/server/`)
- **Purpose:** Backend logic running on Devvit's Node.js runtime
- **Responsibilities:**
  - HTTP request routing (4 endpoints in `src/server/server.ts`)
  - RSS feed fetching and parsing (`fast-xml-parser`)
  - Reddit post creation via Devvit SDK
  - Redis state management (tracking last-posted episode GUID)
  - Scheduled cron (every 15 minutes) gated by user's `pollingFrequency` setting
  - Moderator menu trigger for manual posting
- **Output:** `dist/server/index.js` (CommonJS for Node.js)

### 2. Client Module (`src/client/`)
- **Purpose:** Browser-based webview frontend
- **Responsibilities:**
  - Embedded HTML5 podcast player with audio controls
  - Progress bar, skip buttons, cover art display
  - Webview lifecycle management (pause audio on visibility change)
  - Episode metadata display (title, description, podcast name)
- **Output:** `public/splash.js` (IIFE bundle, inlined in webview HTML)

### 3. Shared Module (`src/shared/`)
- **Purpose:** Type definitions and API constants used by both server and client
- **Contents:** `api.ts` with shared endpoint definitions and types

### Build System: Custom esbuild Bundler

The `tools/build.ts` script:
- Runs esbuild separately for server and client contexts
- Server: CommonJS output for Node.js (requires `platform: "node"`)
- Client: IIFE output for browser environment (requires `platform: "browser"`)
- Supports `--watch` mode for development
- Supports `--minify` flag for production
- Generates metafiles (`dist/server.meta.json`, `dist/client.meta.json`) for bundle analysis

### TypeScript Configuration

Modular TypeScript configs in `tools/` use project references to separate concerns:
- `tsconfig.json` — Root config with project references
- `tsconfig.base.json` — Shared strict configuration
- `tsconfig.server.json` — Node.js-specific (Node lib)
- `tsconfig.client.json` — Browser-specific (DOM lib)
- `tsconfig.shared.json` — Shared types only

**Key setting:** `allowImportingTsExtensions: true` is needed because `.ts` extensions are **required in imports** (see Code Style in AGENTS.md).

## Key Files & Entry Points

| File | Purpose |
|------|---------|
| `src/server/index.ts` | Server entry point; initializes HTTP server |
| `src/server/server.ts` | Main HTTP router; defines 4 endpoints (~402 lines) |
| `src/client/splash.ts` | Webview frontend; podcast player UI and logic |
| `devvit.json` | App manifest: endpoints, scheduler, settings, domain allowlist |
| `tools/build.ts` | Custom esbuild bundler script |
| `package.json` | Dependencies: @devvit/web, fast-xml-parser, node-html-markdown |
| `public/index.html` | Webview HTML; loads compiled `splash.js` |

## Critical Patterns to Understand

### HTTP Endpoints (server.ts)
The server exposes 4 endpoints (all POST):
1. **`POST /api/init`** — Returns episode metadata for the webview to display
2. **`POST /internal/menu/post-create`** — Manual moderator trigger (from subreddit menu)
3. **`POST /internal/cron/check-rss`** — Scheduled cron job (every 15 minutes)
4. **`POST /internal/on-app-install`** — Installation hook

Request/response types are defined in `src/shared/api.ts`.

### Redis State Management
The app tracks the last-posted episode GUID per-feed to avoid duplicates:
```
Key: `last_posted_guid:{feed.index}`
Value: GUID string
```
Each feed gets a sequential 1-based index (1, 2, 3, ...) based on its position in the `feedUrls` setting. **Pattern:** Always namespace Redis keys with context to support multi-item features.

Additional keys:
- `pending_edit:{userId}` — Stores post ID during form edit (10-minute expiration)
- `last_global_check_date` — Tracks date of last global check for daily/weekly gating

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
The `getFeeds()` function (lines 99–118) parses the `feedUrls` setting and returns a `FeedConfig[]` array:
- Splits on newlines, trims whitespace, skips comments (lines starting with `#`)
- Each line is split on `|` to extract URL, optional name, optional link URL
- Feeds are assigned sequential indices (1, 2, 3, ...) for Redis key namespacing
- The loop handlers (`onCheckRSS`, `onMenuPostLatest`, `onMenuEditPostBody`) already iterate feeds correctly

### Webview Lifecycle
The podcast player in `src/client/splash.ts` must respect user viewport changes:
```typescript
document.addEventListener("visibilitychange", () => {
  if (document.hidden && isPlaying) {
    audio.pause(); // Pause when user scrolls away
  }
});
```

### RSS Fetching & Post Creation
1. Fetch RSS feed via HTTP (domain allowlisting required in devvit.json)
2. Parse XML with `fast-xml-parser`
3. Extract episode GUID, title, description, audio URL, cover art
4. Convert HTML descriptions to Markdown with `node-html-markdown`
5. Create Reddit post via `reddit.submitCustomPost`
6. Store GUID in Redis to prevent reposting

**Important:** Descriptions are truncated before posting due to Devvit's ~2KB `postData` payload limit (see Constraints below).

## Important Constraints

### Devvit Platform Limits
- **Payload Size:** `postData` is capped at ~2KB. Truncate long descriptions and URLs before submitting.
- **HTTP Domain Allowlisting:** External RSS feeds require pre-approved domains in `devvit.json`. Requests to unlisted domains will fail.
- **Redis-Only State:** No database access; use Redis for all persistent state.

### TypeScript & Build
- **File Extensions Required:** All relative imports must include `.ts` extension (e.g., `import { foo } from "./bar.ts"`). This is a Devvit bundler requirement.
- **Strict Mode:** All TypeScript configs use strict mode. No `any` types without explicit narrowing to `unknown`.
- **Type Exports:** Use explicit return types on all functions, especially exported endpoints.

### Runtime Requirements
- **Node.js 22.6.0+** — Required for native ES2023 support and type stripping
- **Devvit v0.12.13** — Specific version pinned in package.json

### Testing
The project targets Node.js 22+ and uses the native Node test runner (`node --test`). See AGENTS.md for test commands. Always run tests before pushing.

## Debugging Tips

- **Type errors after edits:** Run `npm run type-check` immediately to catch issues.
- **Build failures:** Check for missing `.ts` extensions in imports.
- **Webview not loading:** Verify `public/splash.js` is built and referenced in `public/index.html`.
- **RSS feed failures:** Confirm domain is allowlisted in `devvit.json` and check error logs in Devvit console.
- **Stale state:** Clear Redis keys manually if testing involves GUID tracking.

## Related Documentation

- **AGENTS.md** — Detailed code style guidelines, command reference, and AI agent directives
- **README.md** — User-facing documentation, feature overview, and limitations
- **devvit.json** — App manifest with HTTP endpoints, scheduler config, settings schema, and domain allowlist
- **package.json** — Project dependencies and npm scripts
