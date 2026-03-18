import type { IncomingMessage, ServerResponse } from "node:http";
import { context, reddit, redis, settings } from "@devvit/web/server";
import type {
  JsonObject,
  PartialJsonValue,
  TriggerResponse,
  UiResponse,
} from "@devvit/web/shared";
import {
  ApiEndpoint,
  type CheckRSSResponse,
  type InitResponse,
} from "../shared/api.ts";
import { XMLParser } from "fast-xml-parser";

import { NodeHtmlMarkdown } from 'node-html-markdown';

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

  let body: UiResponse | CheckRSSResponse | TriggerResponse | InitResponse | ErrorResponse;
  switch (endpoint) {
    case ApiEndpoint.Init:
      body = await onInit();
      break;
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

  writeJSON<PartialJsonValue>("status" in body ? (body as ErrorResponse).status : 200, body, rsp);
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
  description: string;
  postLinkUrl?: string;
};

type EpisodeData = {
  guid: string;
  podcastTitle: string;  // resolved: nameOverride ?? RSS title
  episodeTitle: string;
  description: string;
  audioUrl: string;
  imageUrl: string;
  postLinkUrl?: string;
};

async function getFeeds(): Promise<FeedConfig[]> {
  const feeds: FeedConfig[] = [];
  
  const url = await settings.get<string>("feedUrl");
  const nameOverride = await settings.get<string>("feedName") || "";
  const postLinkUrl = await settings.get<string>("postLinkUrl") || "";

  if (url && url.trim()) {
    // We use index 1 so the `last_posted_guid:1` duplication protection logic remains backward compatible
    feeds.push({ 
      index: 1, 
      url: url.trim(), 
      nameOverride: nameOverride.trim(), 
      description: "",
      postLinkUrl: postLinkUrl.trim()
    });
  }

  return feeds;
}

// ---------------------------------------------------------------------------
// RSS helpers
// ---------------------------------------------------------------------------

async function fetchLatestEpisode(feed: FeedConfig): Promise<EpisodeData | null> {
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

  // Convert HTML to Markdown for plain-text body
  const description = NodeHtmlMarkdown.translate(rawDescription).trim();

  const audioUrl: string = item.enclosure?.["@_url"] ?? item.link ?? "";

  const imageUrl: string =
    item["itunes:image"]?.["@_href"] ??
    channel?.image?.url ??
    channel?.["itunes:image"]?.["@_href"] ??
    "";

  if (!guid || !episodeTitle) return null;

  return { guid, podcastTitle, episodeTitle, description, audioUrl, imageUrl, postLinkUrl: feed.postLinkUrl };
}

async function createEpisodePost(episode: EpisodeData): Promise<string> {
  const subreddit = await reddit.getCurrentSubreddit();
  const title = `${episode.podcastTitle} - ${episode.episodeTitle}`;

  // postData is capped at 2KB by Devvit — truncate the description to be safe
  const MAX_DESCRIPTION = 1100;
  const truncatedDescription = episode.description.length > MAX_DESCRIPTION
    ? episode.description.slice(0, MAX_DESCRIPTION) + "…"
    : episode.description;

  // Some CDN image URLs can be very long — cap them too
  const MAX_URL = 500;
  const rawImageUrl = episode.imageUrl.length > MAX_URL ? "" : episode.imageUrl;

  // Fall back to subreddit community icon if the RSS feed has no episode art
  const communityIcon = subreddit.settings.communityIcon ?? "";
  const imageUrl = rawImageUrl || (communityIcon.length <= MAX_URL ? communityIcon : "");

  const postData: JsonObject = {
    episodeTitle: episode.episodeTitle,
    podcastTitle: episode.podcastTitle,
    description: truncatedDescription,
    audioUrl: episode.audioUrl,
    imageUrl,
    postLinkUrl: episode.postLinkUrl ?? episode.audioUrl ?? "",
  };

  const serialized = JSON.stringify(postData);
  console.log(`postData size: ${Buffer.byteLength(serialized)} bytes`);

  const post = await reddit.submitCustomPost({
    subredditName: subreddit.name,
    title,
    entry: "default",
    postData,
    textFallback: {
      text: [
        `**${episode.episodeTitle}**`,
        "",
        episode.postLinkUrl || episode.audioUrl
          ? `🎙️ [Listen](${episode.postLinkUrl || episode.audioUrl})`
          : "",
        "",
        episode.description,
      ].filter(Boolean).join("\n"),
    },
  });

  console.log(`New post created: ${post.url}`);
  return post.url;
}

// ---------------------------------------------------------------------------
// Init handler — returns episode data from postData for the client webview
// ---------------------------------------------------------------------------

async function onInit(): Promise<InitResponse> {
  const postData = context.postData as JsonObject | null;

  return {
    type: "init",
    episodeTitle: (postData?.episodeTitle as string) ?? "Podcast Episode",
    podcastTitle: (postData?.podcastTitle as string) ?? "",
    description: (postData?.description as string) ?? "",
    audioUrl: (postData?.audioUrl as string) ?? "",
    imageUrl: (postData?.imageUrl as string) ?? "",
    postLinkUrl: (postData?.postLinkUrl as string) ?? "",
  };
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
  const isEnabled = await settings.get<boolean>("appEnabled");
  if (isEnabled === false) {
    return {
      showToast: {
        text: "App is disabled in settings.",
        appearance: "neutral",
      },
    };
  }

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
 * Scheduler cron (every 15 min) → posts conditionally based on configured rate.
 * Each feed is tracked independently via its own Redis key.
 */
async function onCheckRSS(): Promise<CheckRSSResponse> {
  const isEnabled = await settings.get<boolean>("appEnabled");
  if (isEnabled === false) {
    console.log("Podcast poster is disabled in settings.");
    return {};
  }

  const feeds = await getFeeds();

  const freq = await settings.get<string>("pollingFrequency") || "15m";
  const weeklyDay = await settings.get<string>("weeklyPollingDay") || "0";
  
  const now = new Date();
  const todayDateString = now.toISOString().split("T")[0] ?? ""; // YYYY-MM-DD
  const todayDayOfWeek = now.getUTCDay().toString(); // 0-6
  
  // Weekly gating
  if (freq === "weekly" && todayDayOfWeek !== weeklyDay) {
    console.log(`Polling set to weekly on day ${weeklyDay}, but today is day ${todayDayOfWeek}. Skipping.`);
    return {};
  }

  // Daily or Weekly duplicate-check gating
  if (freq === "daily" || freq === "weekly") {
    const lastCheckDate = await redis.get("last_global_check_date");
    if (lastCheckDate === todayDateString) {
      // We already checked successfully today
      return {};
    }
  }

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

  // Mark that we have checked today so the 15m polling ignores remainder of the day
  if (freq === "daily" || freq === "weekly") {
    await redis.set("last_global_check_date", todayDateString);
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
  const body = JSON.stringify(json) ?? "";
  const len = Buffer.byteLength(body);
  rsp.writeHead(status, {
    "Content-Length": len,
    "Content-Type": "application/json",
  });
  rsp.end(body);
}
