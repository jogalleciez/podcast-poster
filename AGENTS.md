# AGENTS.md

This document provides operational guidelines, commands, and code style rules for AI coding agents (and humans) operating within the `podcast-poster` repository. 

## Project Overview

This is a Reddit Devvit application built with TypeScript and Node.js (v22.6.0+). The app consists of a backend that interacts with the Reddit API and Devvit's Redis, and a custom post webview frontend.

### Directory Structure
- `src/server/`: Backend execution context (Reddit API, Redis, HTTP endpoints, Devvit SDK).
- `src/client/`: Webview frontend scripts (runs in the user's browser context).
- `src/shared/`: Shared types, constants, and API endpoints utilized by both client and server.
- `tools/`: Build scripts (e.g., esbuild).

---

## Commands

### Build and Deployment
Always ensure the build and type-checks succeed before pushing code or creating a pull request.
- **Build Project:** `npm run build`
  Runs the custom esbuild script (`tools/build.ts`) to bundle the frontend and backend.
- **Type Check:** `npm run type-check`
  Runs the TypeScript compiler to ensure strict type safety (`tsc --build`). Never skip this step.
- **Start Local Dev Environment:** `npm run dev`
  Deploys a test version of the app to your configured Reddit test subreddit using `devvit playtest`.
- **Deploy:** `npm run deploy`
  Builds and uploads the app to Devvit.
- **Publish:** `npm run launch`
  Builds, deploys, and publishes the application.

### Testing
*Note: Ensure tests are run before submitting code. If tests fail, fix them before proceeding.*
This project targets Node.js 22+. For testing, the native Node test runner (`node --test`) is the preferred standard unless another framework (like Vitest) is explicitly installed.

- **Run all tests:** 
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
- **Uncaught Promises:** Always `await` promises or attach a `.catch()` for background execution (e.g., `audio.play().catch(console.error);`).

### 6. Architecture & Platform Specifics
- **Defensive Data Limits:** Devvit sets limits on payload sizes (e.g., `postData` is capped at ~2KB). Always truncate large strings like descriptions or URLs before sending them via Devvit SDK methods (`reddit.submitCustomPost`).
- **Redis Key Management:** When adding new state or caching, namespace Redis keys logically. If state is per-feed or per-entity, include a unique ID in the key (e.g., `last_posted_guid:${feed.index}`). Do not rely solely on global keys if a feature might scale to multiple entities.
- **Webview Lifecycle:** In `src/client/`, always respect the user's viewport. Listen to the `visibilitychange` event to pause audio or heavy animations when the user scrolls away from the Devvit post.
  ```typescript
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && isPlaying) {
      audio.pause();
    }
  });
  ```
- **External Dependencies:** Only introduce external dependencies if absolutely necessary. The Devvit runtime is lightweight. When fetching external data, make sure to set appropriate headers like `X-Fetch-Reason` to comply with platform policies.

## AI Agent Directives
- **Do not assume test commands:** Always consult the "Commands" section above.
- **Do not break the build:** Run `npm run type-check` after *every* edit.
- **Proactive Context:** Use `grep` and `glob` to verify variables, imports, and function signatures before making changes.
- **Self-Correction:** If TypeScript throws an error, fix it immediately before proceeding to the next file.
