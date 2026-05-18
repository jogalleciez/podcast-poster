# Design: Remove Debug Menu Item + Episode Number in Title Setting

**Date:** 2026-05-18
**Branch:** feat/custom-post-webview-client

---

## Summary

Two small, independent changes to `devvit.json` and `server.ts`:

1. **Remove the "View Client Error Log" mod menu item** — no setting, just delete the static entry.
2. **Add an `includeEpisodeNumberInTitle` boolean setting** — when enabled, prepends `Ep. N - ` to the episode title portion of the post title.

---

## Change 1: Remove Debug Menu Item

### Problem

The "View Client Error Log" subreddit menu item is cluttering the mod menu. Devvit menu items are declared statically in `devvit.json` and cannot be shown/hidden at runtime, so a settings toggle is not possible.

### Decision

Remove the `"View Client Error Log"` entry from `menu.items` in `devvit.json`. The backend endpoint (`/internal/menu/view-client-errors`), handler (`onMenuViewClientErrors`), form registration (`viewClientErrorsForm`), and Redis key (`client_errors`) are **left in place** — they remain callable and the infrastructure is intact. Dead-code cleanup is out of scope for this change.

### Files touched

- `devvit.json` — remove one item from `menu.items`

---

## Change 2: Include Episode Number in Post Title

### New setting

| Field | Value |
|---|---|
| Key | `includeEpisodeNumberInTitle` |
| Type | `boolean` |
| Label | Include Episode Number in Post Title |
| Default | `false` |
| Help text | When enabled, the episode number is added to the post title. Example: `My Podcast - Ep. 42 - Great Interview`. If a feed doesn't provide an episode number, the title falls back to the normal format. |

The default of `false` means existing subreddits see no change.

### Title construction logic

Reading the new setting is added to the existing `Promise.all` in `createEpisodePost` (alongside `postFlairId`, `postFlairText`, `includePodcastNameInTitle`, `stickyPost`).

Episode label resolution (prefers `episodeDisplay` over raw number, consistent with how the Details tab displays it):

```ts
const epLabel = episode.episodeDisplay
  ?? (episode.episodeNumber != null ? String(episode.episodeNumber) : null);
const epPrefix = includeEpisodeNumber && epLabel ? `Ep. ${epLabel} - ` : "";
```

Title assembly (unchanged structure, prefix injected into episode-title slot):

```ts
const title = includePodcastName !== false
  ? `${episode.podcastTitle} - ${epPrefix}${episode.episodeTitle}`
  : `${epPrefix}${episode.episodeTitle}`;
```

**Examples:**

| includePodcastName | includeEpisodeNumber | episodeNumber | Result |
|---|---|---|---|
| true | true | 42 | `My Podcast - Ep. 42 - Great Interview` |
| true | true | none | `My Podcast - Great Interview` (fallback) |
| false | true | 42 | `Ep. 42 - Great Interview` |
| true | false | 42 | `My Podcast - Great Interview` (unchanged) |

### Files touched

- `devvit.json` — add `includeEpisodeNumberInTitle` to `settings.subreddit`
- `src/server/server.ts` — update `createEpisodePost` to read the setting and compute `epPrefix`

### No shared-type changes

`EpisodeData` already carries `episodeNumber` and `episodeDisplay`. No changes to `src/shared/api.ts` or the client.

---

## Out of scope

- Removing backend debug endpoint/handler code (`onMenuViewClientErrors`, `ViewClientErrorsMenu`, `viewClientErrorsForm`) — separate cleanup task.
- Applying episode number to anything other than the Reddit post title (e.g. the WebView header).
