import type { IncomingMessage, ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import { cache, context, reddit, redis, settings } from "@devvit/web/server";
import type { TaskResponse } from "@devvit/web/server";
import type {
  MenuItemRequest,
  PartialJsonValue,
  TriggerResponse,
  UiResponse,
} from "@devvit/web/shared";
import { ApiEndpoint } from "../shared/api.ts";
import { XMLParser } from "fast-xml-parser";

import { NodeHtmlMarkdown } from "node-html-markdown";

// ---------------------------------------------------------------------------
// Bot footer
// ---------------------------------------------------------------------------

const BOT_REQUEST_SUBJECT = encodeURIComponent("Thought this might be handy");
const BOT_REQUEST_MESSAGE = encodeURIComponent(
  "Hey mods!\n\n" +
  "One of my favorite things about podcast subreddits is having a place to discuss the latest episodes and dig into the details. " +
  "I came across a free Devvit app called Pod Poster that automatically creates a post whenever a new episode drops — " +
  "it can help create discussion posts automatically and offload moderator or individual posting responsibilities.\n\n" +
  "Check it out here: https://developers.reddit.com/apps/podcast-poster\n\n" +
  "Please consider adding it!"
);

// ---------------------------------------------------------------------------
// HTTP entry point
// ---------------------------------------------------------------------------

export async function serverOnRequest(
  req: IncomingMessage,
  rsp: ServerResponse,
): Promise<void> {
  try {
    await onRequest(req, rsp);
  } catch (err) {
    const msg = `server error; ${err instanceof Error ? err.stack : err}`;
    console.error(msg);
    writeJSON<ErrorResponse>(500, { error: msg, status: 500 }, rsp);
  }
}

async function onRequest(
  req: IncomingMessage,
  rsp: ServerResponse,
): Promise<void> {
  const url = req.url;

  if (!url || url === "/") {
    writeJSON<ErrorResponse>(404, { error: "not found", status: 404 }, rsp);
    return;
  }

  const endpoint = url as ApiEndpoint;

  let body: UiResponse | TaskResponse | TriggerResponse | ErrorResponse;
  switch (endpoint) {
    case ApiEndpoint.OnPostCreate:
      body = await onMenuPostLatest();
      break;
    case ApiEndpoint.EditPostBodyMenu:
      body = await onMenuEditPostBody(req);
      break;
    case ApiEndpoint.EditPostBodySubmit:
      body = await onFormEditPostBodySubmit(req);
      break;
    case ApiEndpoint.SelectFeedSubmit:
      body = await onFormSelectFeedSubmit(req);
      break;
    case ApiEndpoint.OpenSettings:
      body = await onMenuOpenSettings();
      break;
    case ApiEndpoint.CheckRSS:
      body = await onCheckRSS();
      break;
    case ApiEndpoint.OnAppInstall:
      body = await onAppInstall();
      break;
    default:
      endpoint satisfies never;
      body = { error: "not found", status: 404 };
      break;
  }

  writeJSON<PartialJsonValue>("error" in body ? (body as ErrorResponse).status : 200, body, rsp);
}

type ErrorResponse = {
  error: string;
  status: number;
};

// ---------------------------------------------------------------------------
// Feed configuration
// ---------------------------------------------------------------------------

type FeedConfig = {
  index: number;        // 1-based position in the feedUrls setting
  url: string;
  nameOverride: string; // may be empty — fall back to RSS <title>
  postLinkUrl?: string;
};

type EpisodeData = {
  guid: string;
  podcastTitle: string;  // resolved: nameOverride ?? RSS title
  episodeTitle: string;
  description: string;
  audioUrl: string;
  linkUrl: string;
  postLinkUrl?: string;
};

async function getFeeds(): Promise<FeedConfig[]> {
  const feedUrls = (await settings.get<string>("feedUrls")) || "";
  const lines = feedUrls
    .split("\n")
    .map(line => line.trim())
    .filter(line => line && !line.startsWith("#"));

  const feeds: FeedConfig[] = [];
  lines.forEach((line, idx) => {
    const parts = line.split("|").map(p => p.trim());
    const url = parts[0];
    const nameOverride = parts[1] || "";
    const postLinkUrl = parts[2] || "";

    if (url) {
      feeds.push({
        index: idx + 1,
        url,
        nameOverride,
        postLinkUrl,
      });
    }
  });

  return feeds;
}

// Stable per-feed Redis key (independent of the feed's position in settings).
// Reordering or inserting feeds no longer corrupts last-posted-GUID tracking.
function feedRedisKey(feed: FeedConfig): string {
  const hash = createHash("sha1").update(feed.url).digest("hex").slice(0, 12);
  return `last_posted_guid:url:${hash}`;
}

/**
 * Reads the last-posted GUID for a feed, migrating from the legacy
 * positional key (`last_posted_guid:{index}`) on first access.
 */
async function readLastPostedGuid(feed: FeedConfig): Promise<string | undefined> {
  const stableKey = feedRedisKey(feed);
  const fromStable = await redis.get(stableKey);
  if (fromStable) return fromStable;

  const legacyKey = `last_posted_guid:${feed.index}`;
  const fromLegacy = await redis.get(legacyKey);
  if (fromLegacy) {
    // Best-effort migration. Don't block on the cleanup.
    await redis.set(stableKey, fromLegacy);
    await redis.del(legacyKey).catch(() => {});
    return fromLegacy;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Privacy notice stripping
// ---------------------------------------------------------------------------

// Patterns are matched against the *Markdown* description (post HTML→MD conversion).
// Each entry covers a known host's standard boilerplate suffix.
const PRIVACY_PATTERNS: RegExp[] = [
  // Omny Studio
  /\n*See [^\n]*omnystudio\.com[^\n]*/gi,
  // Megaphone / Spotify ad choices
  /\n*Learn more about your ad choices[^\n]*\n?[^\n]*megaphone\.fm[^\n]*/gi,
  // Acast
  /\n*Hosted on Acast[^\n]*/gi,
  // Simplecast / AdsWizz
  /\n*Hosted by Simplecast[^\n]*/gi,
  // Art19 / Amazon
  /\n*See Privacy Policy at [^\n]*art19\.com[^\n]*/gi,
  // iHeart / Triton
  /\n*[^\n]*iheartpodcastnetwork\.com[^\n]*/gi,
  // Podtrac
  /\n*Learn more about your ad choices[^\n]*\n?[^\n]*podtrac\.com[^\n]*/gi,
  // Libsyn
  /\n*Learn more about your ad choices[^\n]*\n?[^\n]*libsyn\.com[^\n]*/gi,
  // Generic trailing "Learn more about your ad choices" with any URL
  /\n*Learn more about your ad choices[^\n]*/gi,
  // Generic trailing privacy policy sentence
  /\n*(?:For )?(?:our )?[Pp]rivacy [Pp]olicy[,:]?\s*[^\n]*/gi,
];

function stripPrivacyNotices(text: string): string {
  let result = text;
  for (const pattern of PRIVACY_PATTERNS) {
    result = result.replace(pattern, "");
  }
  return result.trimEnd();
}

// ---------------------------------------------------------------------------
// RSS helpers
// ---------------------------------------------------------------------------

type SpreakerListResponse = {
  response: { items: Array<{ episode_id: number }> };
};

type SpreakerEpisodeDetail = {
  episode_id: number;
  title?: string;
  description?: string;
  description_html?: string;
  rss_guid?: string;
  download_url?: string;
  playback_url?: string;
  media_url?: string;
  site_url?: string;
  show?: { title?: string };
};

type SpreakerDetailResponse = {
  response: { episode: SpreakerEpisodeDetail };
};

function extractSpreakerShowId(url: string): string | null {
  return url.match(/spreaker\.com\/show\/(\d+)/)?.[1] ?? null;
}

// Cached for slightly less than the hourly-poll interval so two back-to-back
// checks don't double-fetch the Spreaker API. Per-show, not per-feed: feed-specific
// overrides (nameOverride, postLinkUrl) are applied below the cache.
const SPREAKER_TTL_SECONDS = 50 * 60;

async function fetchSpreakerEpisode(feed: FeedConfig): Promise<EpisodeData | null> {
  const showId = extractSpreakerShowId(feed.url)!;

  const ep = await cache(
    async () => {
      const fetchOpts = {
        headers: { "X-Fetch-Reason": "Fetching Spreaker episode data to post to Reddit" },
      };

      const listResp = await fetch(
        `https://api.spreaker.com/v2/shows/${showId}/episodes?limit=1`,
        fetchOpts,
      );
      if (!listResp.ok) throw new Error(`Spreaker episodes list failed: ${listResp.status}`);
      const listData = (await listResp.json()) as SpreakerListResponse;
      const episodeId = listData.response?.items?.[0]?.episode_id;
      if (!episodeId) return null;

      const detailResp = await fetch(
        `https://api.spreaker.com/v2/episodes/${episodeId}`,
        fetchOpts,
      );
      if (!detailResp.ok) throw new Error(`Spreaker episode detail failed: ${detailResp.status}`);
      const detailData = (await detailResp.json()) as SpreakerDetailResponse;
      return detailData.response?.episode ?? null;
    },
    { key: `spreaker_show:${showId}`, ttl: SPREAKER_TTL_SECONDS },
  );

  if (!ep) return null;

  const podcastTitle = feed.nameOverride || ep.show?.title || "Podcast";
  const guid = ep.rss_guid || String(ep.episode_id);
  const episodeTitle = ep.title ?? "Untitled Episode";
  const rawDescription = ep.description_html || ep.description || "";
  const description = NodeHtmlMarkdown.translate(rawDescription).trim();
  const audioUrl = ep.download_url || ep.playback_url || ep.media_url || "";
  const linkUrl = ep.site_url || "";

  return { guid, podcastTitle, episodeTitle, description, audioUrl, linkUrl, postLinkUrl: feed.postLinkUrl };
}

// Narrow types for the subset of RSS / Atom fields we actually consume.
// fast-xml-parser returns a loose object shape; we treat it as `unknown` and
// pluck only the fields we rely on.
type RssEnclosure = { "@_url"?: string };
type RssGuid = string | { "#text"?: string };
type RssItem = {
  guid?: RssGuid;
  id?: string;
  link?: string;
  title?: string;
  description?: string;
  content?: string;
  enclosure?: RssEnclosure;
  "itunes:summary"?: string;
  "content:encoded"?: string;
};
type RssChannel = {
  title?: string;
  item?: RssItem | RssItem[];
  entry?: RssItem | RssItem[];
};
type RssDocument = {
  rss?: { channel?: RssChannel };
  feed?: RssChannel;
};

function readGuid(g: RssGuid | undefined): string {
  if (!g) return "";
  if (typeof g === "string") return g;
  return g["#text"] ?? "";
}

async function fetchLatestEpisode(feed: FeedConfig): Promise<EpisodeData | null> {
  if (extractSpreakerShowId(feed.url)) {
    return fetchSpreakerEpisode(feed);
  }

  const response = await fetch(feed.url, {
    headers: {
      "X-Fetch-Reason": "Fetching RSS feed to check for new podcast episodes to post to Reddit",
    },
  });
  if (!response.ok) {
    throw new Error(`RSS fetch failed for feed ${feed.index}: ${response.status}`);
  }
  const xmlData = await response.text();

  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });
  const result = parser.parse(xmlData) as RssDocument;

  const channel = result.rss?.channel ?? result.feed;
  if (!channel) return null;

  const podcastTitle = feed.nameOverride || channel.title || "Podcast";

  const rawItems = channel.item ?? channel.entry;
  if (!rawItems) return null;
  const items: RssItem[] = Array.isArray(rawItems) ? rawItems : [rawItems];
  if (items.length === 0) return null;

  const item = items[0]!;

  const guid = readGuid(item.guid) || item.id || item.link || "";
  const episodeTitle = item.title ?? "Untitled Episode";
  const rawDescription =
    item.description ??
    item["itunes:summary"] ??
    item.content ??
    item["content:encoded"] ??
    "";

  // Convert HTML to Markdown for plain-text body
  const description = stripPrivacyNotices(NodeHtmlMarkdown.translate(rawDescription).trim());

  const audioUrl = item.enclosure?.["@_url"] ?? item.link ?? "";
  const linkUrl = item.link ?? "";

  if (!guid || !episodeTitle) return null;

  return { guid, podcastTitle, episodeTitle, description, audioUrl, linkUrl, postLinkUrl: feed.postLinkUrl };
}

async function createEpisodePost(episode: EpisodeData): Promise<string> {
  const subredditName = context.subredditName;
  if (!subredditName) {
    throw new Error("subredditName missing from context");
  }

  const title = `${episode.podcastTitle} - ${episode.episodeTitle}`;
  const resolvedLinkUrl = episode.postLinkUrl || episode.linkUrl || episode.audioUrl;

  let body = episode.description;
  if (resolvedLinkUrl) {
    body += `\n\n# [Listen to this episode](${resolvedLinkUrl})`;
  }

  const requestUrl =
    `https://www.reddit.com/message/compose?to=r/` +
    `&subject=${BOT_REQUEST_SUBJECT}&message=${BOT_REQUEST_MESSAGE}`;
  body +=
    `\n\n---\n*This is a bot that posts new episodes automatically. ` +
    `[Add this to your subreddit](https://developers.reddit.com/apps/podcast-poster) ` +
    `or [request mods use it](${requestUrl}).*`;

  const [flairIdRaw, flairTextRaw] = await Promise.all([
    settings.get<string>("postFlairId"),
    settings.get<string>("postFlairText"),
  ]);
  const flairId = flairIdRaw?.trim() || undefined;
  const flairText = flairTextRaw?.trim() || undefined;

  const post = await reddit.submitPost({
    subredditName,
    title,
    text: body,
    ...(flairId ? { flairId, flairText } : {}),
  });

  console.log(`New post created: ${post.url}`);
  return post.url;
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

function settingsUrl(): string {
  return `https://developers.reddit.com/r/${context.subredditName}/apps/${context.appSlug}`;
}

/** Subreddit menu → "Configure Pod Poster" */
async function onMenuOpenSettings(): Promise<UiResponse> {
  return { navigateTo: settingsUrl() };
}

/**
 * Post menu → "Edit post body" (moderator only)
 * Shows a pre-populated form with the current post body.
 * Stores the post ID in Redis so the submit handler can retrieve it.
 */
async function onMenuEditPostBody(req: IncomingMessage): Promise<UiResponse> {
  const { targetId } = await readBody<MenuItemRequest>(req);
  const post = await reddit.getPostById(targetId as `t3_${string}`);
  const currentBody = post.body ?? "";
  const userId = context.userId ?? "unknown";

  await redis.set(`pending_edit:${userId}`, targetId, {
    expiration: new Date(Date.now() + 600_000), // 10 minutes
  });

  return {
    showForm: {
      name: "editPostBodyForm",
      form: {
        title: "Edit Post Body",
        description: "Edit the body of this episode post using Reddit markdown syntax.",
        acceptLabel: "Save changes",
        fields: [
          {
            type: "paragraph",
            name: "body",
            label: "Post body (markdown)",
            helpText: "Supports Reddit markdown syntax (e.g. **bold**, *italic*, [links](url), > blockquote).",
            required: true,
            defaultValue: currentBody,
            lineHeight: 15,
          },
        ],
      },
      data: { body: currentBody },
    },
  };
}

/**
 * Form submit → saves the edited body to the post.
 * Retrieves the target post ID from Redis using the current user's ID.
 */
async function onFormEditPostBodySubmit(req: IncomingMessage): Promise<UiResponse> {
  const { body } = await readBody<{ body: string }>(req);
  const userId = context.userId ?? "unknown";
  const postId = await redis.get(`pending_edit:${userId}`);

  if (!postId) {
    return { showToast: { text: "Session expired — please try again.", appearance: "neutral" } };
  }

  const post = await reddit.getPostById(postId as `t3_${string}`);
  await post.edit({ text: body });
  await redis.del(`pending_edit:${userId}`);

  return {
    showToast: { text: "Post updated.", appearance: "success" },
    navigateTo: `https://www.reddit.com${post.permalink}`,
  };
}

type FeedPostResult =
  | { kind: "posted"; feed: FeedConfig; episodeTitle: string; postUrl: string }
  | { kind: "skipped"; feed: FeedConfig; reason: string }
  | { kind: "error"; feed: FeedConfig; reason: string };

async function postOneFeed(feed: FeedConfig): Promise<FeedPostResult> {
  try {
    const episode = await fetchLatestEpisode(feed);
    if (!episode) {
      return { kind: "skipped", feed, reason: "no episodes found" };
    }
    const postUrl = await createEpisodePost(episode);
    await redis.set(feedRedisKey(feed), episode.guid);
    return { kind: "posted", feed, episodeTitle: episode.episodeTitle, postUrl };
  } catch (e) {
    console.error(`Error posting feed ${feed.index}:`, e);
    const msg = e instanceof Error ? e.message : String(e);
    const reason = msg.includes("is not allowed") ? "domain not allowlisted" : "unknown error";
    return { kind: "error", feed, reason };
  }
}

/**
 * Shared helper — posts the latest episode from each feed in the given list, in
 * parallel. Each feed's success/failure is independent. Returns a UiResponse
 * toast (+ navigateTo on success).
 */
async function postFromFeeds(feeds: FeedConfig[]): Promise<UiResponse> {
  const results = await Promise.all(feeds.map(postOneFeed));

  const posted = results.filter((r): r is Extract<FeedPostResult, { kind: "posted" }> => r.kind === "posted");
  const issues = results.filter(r => r.kind !== "posted");

  if (posted.length > 0) {
    const summary = posted.length === 1
      ? `Posted: ${posted[0]!.episodeTitle}`
      : `Posted ${posted.length} episodes`;
    return {
      showToast: { text: summary, appearance: "success" },
      navigateTo: posted[0]!.postUrl,
    };
  }

  return {
    showToast: {
      text: issues.length > 0
        ? `Errors: ${issues.map(r => `Feed ${r.feed.index}: ${r.reason}`).join("; ")}`
        : "Nothing to post.",
      appearance: "neutral",
    },
  };
}

/**
 * Subreddit menu → "Post most recent episode"
 * With 1 feed: posts immediately.
 * With 2+ feeds: shows a select modal to choose which feed (or all).
 */
async function onMenuPostLatest(): Promise<UiResponse> {
  const isEnabled = await settings.get<boolean>("appEnabled");
  if (isEnabled === false) {
    return { showToast: { text: "App is disabled in settings.", appearance: "neutral" } };
  }

  const feeds = await getFeeds();

  if (feeds.length === 0) {
    return {
      showToast: { text: "No feeds configured. Opening App Settings…", appearance: "neutral" },
      navigateTo: settingsUrl(),
    };
  }

  if (feeds.length === 1) {
    return postFromFeeds(feeds);
  }

  return {
    showForm: {
      name: "selectFeedForm",
      form: {
        title: "Post episode from...",
        fields: [
          {
            type: "select",
            name: "feedIndex",
            label: "Choose a feed",
            required: true,
            options: [
              { label: "All Feeds", value: "all" },
              ...feeds.map(f => ({
                label: f.nameOverride || f.url,
                value: String(f.index),
              })),
            ],
          },
        ],
      },
    },
  };
}

/**
 * Form submit → posts from the selected feed (or all feeds).
 */
async function onFormSelectFeedSubmit(req: IncomingMessage): Promise<UiResponse> {
  const { feedIndex } = await readBody<{ feedIndex: string[] }>(req);
  const selected = feedIndex?.[0];
  const allFeeds = await getFeeds();

  if (!selected || allFeeds.length === 0) {
    return { showToast: { text: "No feeds configured.", appearance: "neutral" } };
  }

  const feedsToPost = selected === "all"
    ? allFeeds
    : allFeeds.filter(f => String(f.index) === selected);

  if (feedsToPost.length === 0) {
    return { showToast: { text: "Selected feed not found.", appearance: "neutral" } };
  }

  return postFromFeeds(feedsToPost);
}

async function checkOneFeed(feed: FeedConfig): Promise<void> {
  try {
    const episode = await fetchLatestEpisode(feed);
    if (!episode) {
      console.log(`Feed ${feed.index}: no episodes found.`);
      return;
    }

    const lastPostedGuid = await readLastPostedGuid(feed);
    if (episode.guid === lastPostedGuid) {
      console.log(`Feed ${feed.index}: already posted "${episode.episodeTitle}"`);
      return;
    }

    await createEpisodePost(episode);
    await redis.set(feedRedisKey(feed), episode.guid);
  } catch (error) {
    console.error(`Error checking feed ${feed.index}:`, error);
  }
}

/**
 * Scheduler cron (every 15 min) → posts conditionally based on configured rate.
 * Each feed is checked in parallel and tracked independently via its own
 * URL-keyed Redis entry.
 */
async function onCheckRSS(): Promise<TaskResponse> {
  const [isEnabled, freqRaw, weeklyDayRaw] = await Promise.all([
    settings.get<boolean>("appEnabled"),
    settings.get<string>("pollingFrequency"),
    settings.get<string>("weeklyPollingDay"),
  ]);

  if (isEnabled === false) {
    console.log("Podcast poster is disabled in settings.");
    return { status: "ok" };
  }

  const freq = freqRaw || "hourly";
  const weeklyDay = weeklyDayRaw || "0";

  const now = new Date();
  const todayDateString = now.toISOString().split("T")[0] ?? ""; // YYYY-MM-DD
  const todayDayOfWeek = now.getUTCDay().toString(); // 0-6

  if (freq === "weekly" && todayDayOfWeek !== weeklyDay) {
    console.log(`Polling set to weekly on day ${weeklyDay}, but today is day ${todayDayOfWeek}. Skipping.`);
    return { status: "ok" };
  }

  if (freq === "daily" || freq === "weekly") {
    const lastCheckDate = await redis.get("last_global_check_date");
    if (lastCheckDate === todayDateString) return { status: "ok" };
  }

  const feeds = await getFeeds();
  if (feeds.length === 0) return { status: "ok" };

  await Promise.all(feeds.map(checkOneFeed));

  if (freq === "daily" || freq === "weekly") {
    await redis.set("last_global_check_date", todayDateString);
  }

  return { status: "ok" };
}

/** App install trigger */
async function onAppInstall(): Promise<TriggerResponse> {
  console.log("podcast-poster installed. Configure RSS feeds in App Settings.");
  return { status: "ok" };
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function readBody<T>(req: IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk: Buffer) => { raw += chunk.toString(); });
    req.on("end", () => { resolve(JSON.parse(raw) as T); });
    req.on("error", reject);
  });
}

function writeJSON<T extends PartialJsonValue>(
  status: number,
  json: Readonly<T>,
  rsp: ServerResponse,
): void {
  const body = JSON.stringify(json) ?? "";
  const len = Buffer.byteLength(body);
  rsp.writeHead(status, {
    "Content-Length": len,
    "Content-Type": "application/json",
  });
  rsp.end(body);
}
