# AGENTS.md

This document provides operational guidelines, commands, and code style rules for AI coding agents (and humans) operating within the `podcast-poster` repository.

## Project Overview

This is a Reddit Devvit application (`@devvit/web@0.15.3`) built with TypeScript and Node.js (v22.6.0+). The app automatically posts the latest episodes from one or more RSS podcast feeds to a subreddit. By default it creates **custom WebView posts** rendered by a React client; the `postType` setting can switch them to self or link posts instead. Moderators configure feeds via app settings; a cron job polls feeds every 15 minutes and creates posts, and a subreddit menu item allows posting a chosen episode manually.

### Directory Structure
- `src/server/`: Backend execution context (HTTP request routing, RSS fetching, Reddit post creation, Redis state management). `server.ts` holds the router and every handler; `cron-policy.ts` and `markdown.ts` are pure helpers split out so they can be unit-tested outside the Devvit runtime.
- `src/shared/`: Shared types, constants, and API endpoint definitions used by both server and client.
- `src/client/`: React 19 WebView client rendered inside the Reddit post. `index.tsx` mounts `App.tsx`, which fetches from `/api/post-data` and renders with `react-markdown` + `remark-gfm`. Static assets (`index.html`, `styles.css`, `fonts/`) are copied into `dist/client/` by the build.
- `tools/`: Build scripts (`build.ts`) and modular TypeScript configuration files.

---

## Commands

### Build and Deployment
Always ensure the build and type-checks succeed before pushing code or creating a pull request.
- **Build Project:** `npm run build`
  Runs the custom esbuild script (`tools/build.ts`) with `--minify`. It bundles the server into `dist/server/index.js` (CommonJS) and the client into `dist/client/` (ESM browser bundle) in parallel.
- **Type Check:** `npm run type-check`
  Runs `tsc --build` across the TypeScript project references (server, client, shared). Never skip this step.
- **Start Local Dev Environment:** `npm run dev`
  Deploys a test version of the app to the configured Reddit test subreddit using `devvit playtest`. The `devvit.json` also defines a `"dev"` script that runs the build in `--watch` mode.
- **Deploy:** `npm run deploy`
  Builds and uploads the app to Devvit (`npm run build && devvit upload`).
- **Publish:** `npm run launch`
  Builds, deploys, and publishes the application to the Devvit app directory.

### Testing
There is no `npm test` script. Tests use the native Node.js test runner and are colocated as `*.test.ts` next to the module they cover. They import `.ts` paths directly, so `--experimental-strip-types` is required.

- **Run all tests:**
  ```bash
  node --test --experimental-strip-types src/server/*.test.ts
  ```
- **Run a single test file:**
  ```bash
  node --test --experimental-strip-types src/server/markdown.test.ts
  ```

Coverage is limited to the pure, dependency-free helpers (`cron-policy.test.ts`, `markdown.test.ts`). `server.ts` imports `context`/`redis`/`reddit`/`settings` from `@devvit/web/server`, which only resolve inside the Devvit runtime, so it cannot be imported from a test as written. Put new pure logic in its own module with its own test file. `TESTING.md` is the manual QA checklist for everything that cannot be unit-tested.

---

## Code Style Guidelines

### 1. TypeScript & Types
- **Strict Typing:** Always use strict typing. Avoid `any` where possible. Use `unknown` for unsafe casts and narrow the type safely.
- **Types over Interfaces:** Prefer `type` aliases over `interface` for data structures, configuration objects, and API responses.
  ```typescript
  // Preferred
  type FeedConfig = {
    index: number;
    url: string;
  };
  ```
- **Explicit Returns:** Explicitly define return types for all functions, especially exported ones and API endpoints (e.g., `async function init(): Promise<InitResponse>`).

### 2. Imports and Modules
- **File Extensions:** Always include the `.ts` extension in relative imports. This is strictly required by the Devvit bundler.
  ```typescript
  import { ApiEndpoint } from "../shared/api.ts"; // Good
  import { ApiEndpoint } from "../shared/api";    // Bad
  ```
- **Node Modules:** Prefix Node.js built-in modules with `node:` (e.g., `import type { IncomingMessage } from "node:http";`).
- **Type Imports:** Use `import type` for type-only imports to help the bundler optimize the output.

### 3. Naming Conventions
- **Variables & Functions:** Use `camelCase` (e.g., `podcastTitle`, `fetchLatestEpisode`).
- **Types & Constant Objects:** Use `PascalCase` (e.g., `InitResponse`, `ApiEndpoint`).
- **Constants:** Use `UPPER_SNAKE_CASE` for hardcoded constants or configuration limits inside functions (e.g., `MAX_DESCRIPTION`, `REDIS_KEY`).
- **DOM Elements:** Suffix DOM element variables with `El`, `Btn`, or `Icon` to clearly denote their DOM nature (e.g., `descriptionEl`, `playPauseBtn`, `playIcon`).

### 4. Formatting & File Structure
- **Indentation:** 2 spaces.
- **Quotes:** Use double quotes (`"`) for strings, unless a template literal is required for interpolation.
- **Semicolons:** Always use semicolons at the end of statements.
- **Visual Separators:** Use ASCII divider comments to visually separate logical sections in larger files. This maintains readability in dense logic files.
  ```typescript
  // ---------------------------------------------------------------------------
  // Feed configuration
  // ---------------------------------------------------------------------------
  ```

### 5. Error Handling & Robustness
- **Try/Catch Blocks:** Wrap network calls (like RSS fetching) and JSON parsing in `try...catch` blocks.
- **Graceful HTTP Responses:** When an API route fails, do not crash the runtime. Instead, return a safe HTTP status (e.g., 500) with a JSON error response.
  ```typescript
  writeJSON<ErrorResponse>(500, { error: msg, status: 500 }, rsp);
  ```
- **Logging:** Log critical errors using `console.error` for debugging in Devvit's telemetry logs.
- **Uncaught Promises:** Always `await` promises or attach a `.catch()` for background execution.

### 6. Architecture & Platform Specifics
- **Defensive Data Limits:** Devvit imposes limits on payload sizes and post bodies. Truncate large strings like descriptions before submitting posts via `reddit.submitPost`.
- **Redis Key Management:** When adding new state or caching, namespace Redis keys logically. If state is per-feed or per-entity, include a unique ID in the key.
  - Key highlights (see `CLAUDE.md` for the full annotated list):
    - `last_posted_guid:url:${sha1(feed.url).slice(0,12)}` tracks the last posted episode GUID per feed using a stable URL hash. Legacy positional keys (`last_posted_guid:{index}`) are migrated on first read.
    - `post_data:${postId}` holds the `EpisodeData` payload served to the WebView client. Written at post creation, `custom` post type only.
    - `app_enabled_state` snapshots the `appEnabled` setting so the cron can detect a disabled to enabled transition and seed baselines instead of dumping a backlog.
    - `sticky_highlights` is the JSON array of currently-highlighted post IDs.
    - Spreaker and Audioboom API responses are cached under `spreaker_*` / `audioboom_*` keys with a ~50 minute TTL.
  - Do not rely solely on global keys if a feature might scale to multiple entities.
- **External Dependencies:** Only introduce external dependencies if absolutely necessary. The Devvit runtime is lightweight. When fetching external data, make sure to set appropriate headers like `X-Fetch-Reason` to comply with platform policies.
- **HTTP Domain Allowlisting:** All external RSS feed domains must be explicitly allowlisted in `devvit.json` under `permissions.http.domains`. Requests to unlisted domains will fail at runtime.

---

## AI Agent Directives

- **Do not assume test commands:** Always consult the "Commands" section above.
- **Do not break the build:** Run `npm run type-check` after *every* edit.
- **Proactive Context:** Use `grep` and `glob` to verify variables, imports, and function signatures before making changes.
- **Self-Correction:** If TypeScript throws an error, fix it immediately before proceeding to the next file.
- **Mind the post type branches:** Both the cron and the manual picker funnel through `createEpisodePost`, which branches on `postType` (`custom` / `self` / `link`). A change to post rendering usually needs to be considered for all three.
- **Self and link Markdown must survive RTJSON conversion:** Reddit rejects list items nested more than 2 tiers. `buildSelfPostBody` runs its output through `clampListNesting` (`markdown.ts`). Do not emit deeper structure on those paths.
- **Respect the 30s endpoint timeout:** Parallelize independent network calls with `Promise.all` / `allSettled`.
