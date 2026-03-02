import type { IncomingMessage, ServerResponse } from "node:http";
import { reddit, redis, settings } from "@devvit/web/server";
import type {
  PartialJsonValue,
  TriggerResponse,
  UiResponse,
} from "@devvit/web/shared";
import {
  ApiEndpoint,
  type CheckRSSResponse,
} from "../shared/api.ts";
import { XMLParser } from "fast-xml-parser";

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

  let body: UiResponse | CheckRSSResponse | TriggerResponse | ErrorResponse;
  switch (endpoint) {
    case ApiEndpoint.OnPostCreate:
      body = await onMenuPostLatest();
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

  writeJSON<PartialJsonValue>("status" in body ? body.status : 200, body, rsp);
}

type ErrorResponse = {
  error: string;
  status: number;
};

// ---------------------------------------------------------------------------
// Feed configuration
// ---------------------------------------------------------------------------

type FeedConfig = {
  index: number;       // 1–5
  url: string;
  nameOverride: string; // may be empty — fall back to RSS <title>
};

type EpisodeData = {
  guid: string;
  podcastTitle: string;  // resolved: nameOverride ?? RSS title
  episodeTitle: string;
  description: string;
  audioUrl: string;
  imageUrl: string;
};

/** Read and return all feed slots that have a URL configured. */
async function getFeeds(): Promise<FeedConfig[]> {
  const feeds: FeedConfig[] = [];

  for (let i = 1; i <= 5; i++) {
    const urlSetting = await settings.get(`feed${i}Url`);
    const nameSetting = await settings.get(`feed${i}Name`);

    const url = typeof urlSetting === "string" ? urlSetting.trim() : "";
    const nameOverride = typeof nameSetting === "string" ? nameSetting.trim() : "";

    if (url) {
      feeds.push({ index: i, url, nameOverride });
    }
  }

  return feeds;
}

// ---------------------------------------------------------------------------
// RSS helpers
// ---------------------------------------------------------------------------

async function fetchLatestEpisode(feed: FeedConfig): Promise<EpisodeData | null> {
  const response = await fetch(feed.url);
  if (!response.ok) {
    throw new Error(`RSS fetch failed for feed ${feed.index}: ${response.status}`);
  }
  const xmlData = await response.text();

  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });
  const result = parser.parse(xmlData);

  const channel = result?.rss?.channel ?? result?.feed;
  if (!channel) return null;

  // Use the moderator-provided name override; fall back to RSS <title>
  const podcastTitle: string =
    feed.nameOverride || channel.title || "Podcast";

  let items: any[] = channel.item ?? channel.entry ?? [];
  if (!Array.isArray(items)) items = [items];
  if (items.length === 0) return null;

  const item = items[0];

  const guid: string =
    item.guid?.["#text"] ?? item.guid ?? item.id ?? item.link ?? "";

  const episodeTitle: string = item.title ?? "Untitled Episode";

  const rawDescription: string =
    item.description ??
    item["itunes:summary"] ??
    item.content ??
    item["content:encoded"] ??
    "";

  // Strip HTML tags for plain-text body
  const description = rawDescription.replace(/<[^>]*>/g, "").trim();

  const audioUrl: string = item.enclosure?.["@_url"] ?? item.link ?? "";

  const imageUrl: string =
    item["itunes:image"]?.["@_href"] ??
    channel?.image?.url ??
    channel?.["itunes:image"]?.["@_href"] ??
    "";

  if (!guid || !episodeTitle) return null;

  return { guid, podcastTitle, episodeTitle, description, audioUrl, imageUrl };
}

async function createEpisodePost(episode: EpisodeData): Promise<string> {
  const subreddit = await reddit.getCurrentSubreddit();
  const title = `${episode.podcastTitle} - ${episode.episodeTitle}`;

  const post = await reddit.submitPost({
    subredditName: subreddit.name,
    title,
    text: episode.description || `Listen to the latest episode: ${episode.episodeTitle}`,
  });

  console.log(`New post created: ${post.url}`);
  return post.url;
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/**
 * Subreddit menu → "Post most recent episode"
 * Posts the latest episode from every configured feed right now,
 * then updates the per-feed GUID so the cron won't double-post.
 */
async function onMenuPostLatest(): Promise<UiResponse> {
  const feeds = await getFeeds();

  if (feeds.length === 0) {
    return {
      showToast: {
        text: "No feeds configured. Add an RSS URL in App Settings.",
        appearance: "neutral",
      },
    };
  }

  const posted: string[] = [];
  const failed: string[] = [];

  for (const feed of feeds) {
    try {
      const episode = await fetchLatestEpisode(feed);
      if (!episode) {
        failed.push(`Feed ${feed.index}: no episodes found`);
        continue;
      }

      await createEpisodePost(episode);
      await redis.set(`last_posted_guid:${feed.index}`, episode.guid);
      posted.push(episode.episodeTitle);
    } catch (e) {
      console.error(`Error posting feed ${feed.index}:`, e);
      failed.push(`Feed ${feed.index}: ${e}`);
    }
  }

  if (posted.length > 0) {
    const summary = posted.length === 1
      ? `Posted: ${posted[0]}`
      : `Posted ${posted.length} episodes`;
    return { showToast: { text: summary, appearance: "success" } };
  }

  return {
    showToast: {
      text: failed.length > 0 ? `Errors: ${failed.join("; ")}` : "Nothing to post.",
      appearance: "neutral",
    },
  };
}

/**
 * Scheduler cron (every 15 min) → only posts when a new episode is detected.
 * Each feed is tracked independently via its own Redis key.
 */
async function onCheckRSS(): Promise<CheckRSSResponse> {
  const feeds = await getFeeds();

  for (const feed of feeds) {
    const REDIS_KEY = `last_posted_guid:${feed.index}`;
    try {
      const episode = await fetchLatestEpisode(feed);
      if (!episode) {
        console.log(`Feed ${feed.index}: no episodes found.`);
        continue;
      }

      const lastPostedGuid = await redis.get(REDIS_KEY);
      if (episode.guid === lastPostedGuid) {
        console.log(`Feed ${feed.index}: already posted "${episode.episodeTitle}"`);
        continue;
      }

      await createEpisodePost(episode);
      await redis.set(REDIS_KEY, episode.guid);
    } catch (error) {
      console.error(`Error checking feed ${feed.index}:`, error);
    }
  }

  return {};
}

/** App install trigger */
async function onAppInstall(): Promise<TriggerResponse> {
  console.log("podcast-poster installed. Configure RSS feeds in App Settings.");
  return {};
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function writeJSON<T extends PartialJsonValue>(
  status: number,
  json: Readonly<T>,
  rsp: ServerResponse,
): void {
  const body = JSON.stringify(json);
  const len = Buffer.byteLength(body);
  rsp.writeHead(status, {
    "Content-Length": len,
    "Content-Type": "application/json",
  });
  rsp.end(body);
}
