# AGENTS.md

This document provides operational guidelines, commands, and code style rules for AI coding agents (and humans) operating within the `podcast-poster` repository.

## Project Overview

This is a Reddit Devvit application (v0.12.20) built with TypeScript and Node.js (v22.6.0+). The app automatically posts the latest episodes from one or more RSS podcast feeds to a subreddit as standard Reddit self-posts. Moderators configure feeds via app settings; the app polls RSS feeds on a schedule and creates text posts with the episode title, description (HTML converted to Markdown), and a listen link.

### Directory Structure
- `src/server/`: Backend execution context (HTTP request routing, RSS fetching, Reddit post creation, Redis state management). This is the only active source directory.
- `src/shared/`: Shared types, constants, and API endpoint definitions used by the server.
- `src/client/`: **Empty / legacy.** Previously housed the webview frontend for an embedded podcast player. The webview was removed; posts are now plain self-posts.
- `tools/`: Build scripts (`build.ts`) and modular TypeScript configuration files.
- `public/`: Contains a compiled `splash.js` artifact (legacy from the removed webview). The active build does not produce client bundles.

---

## Commands

### Build and Deployment
Always ensure the build and type-checks succeed before pushing code or creating a pull request.
- **Build Project:** `npm run build`
  Runs the custom esbuild script (`tools/build.ts`) with `--minify` to bundle the server into `dist/server/index.js` (CommonJS). The build only bundles the server; there is no active client bundle step.
- **Type Check:** `npm run type-check`
  Runs `tsc --build` across the TypeScript project references (server, shared). Never skip this step.
- **Start Local Dev Environment:** `npm run dev`
  Deploys a test version of the app to the configured Reddit test subreddit using `devvit playtest`. The `devvit.json` also defines a `"dev"` script that runs the build in `--watch` mode.
- **Deploy:** `npm run deploy`
  Builds and uploads the app to Devvit (`npm run build && devvit upload`).
- **Publish:** `npm run launch`
  Builds, deploys, and publishes the application to the Devvit app directory.

### Testing
*Note: This project currently has no test files. If you add tests, use the native Node.js test runner (`node --test`), which is the project's preferred standard.*

- **Run all tests (when tests exist):**
  ```bash
  node --test
  ```
- **Run a single test file:**
  ```bash
  node --test path/to/specific.test.ts
  ```

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
  - Existing keys:
    - `last_posted_guid:url:${sha1(feed.url).slice(0,12)}` — tracks the last posted episode GUID per feed using a stable URL hash.
    - `pending_edit:${userId}` — stores the post ID during a body-edit flow (10-minute expiration).
    - `last_global_check_date` — stores `YYYY-MM-DD` to gate daily/weekly polling frequency.
  - Do not rely solely on global keys if a feature might scale to multiple entities.
- **External Dependencies:** Only introduce external dependencies if absolutely necessary. The Devvit runtime is lightweight. When fetching external data, make sure to set appropriate headers like `X-Fetch-Reason` to comply with platform policies.
- **HTTP Domain Allowlisting:** All external RSS feed domains must be explicitly allowlisted in `devvit.json` under `permissions.http.domains`. Requests to unlisted domains will fail at runtime.

---

## AI Agent Directives

- **Do not assume test commands:** Always consult the "Commands" section above.
- **Do not break the build:** Run `npm run type-check` after *every* edit.
- **Proactive Context:** Use `grep` and `glob` to verify variables, imports, and function signatures before making changes.
- **Self-Correction:** If TypeScript throws an error, fix it immediately before proceeding to the next file.
- **Respect legacy artifacts:** The `src/client/` directory and `public/splash.js` are legacy remnants of a removed webview feature. Do not reintroduce client-side webview code unless explicitly asked.
