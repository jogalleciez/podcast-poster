import type { IncomingMessage, ServerResponse } from "node:http";
import { context, reddit, redis, settings } from "@devvit/web/server";
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
// RSS helpers
// ---------------------------------------------------------------------------

type EpisodeData = {
  guid: string;
  podcastTitle: string;
  episodeTitle: string;
  description: string;
  audioUrl: string;
  imageUrl: string;
};

async function getRssFeedUrl(): Promise<string> {
  const setting = await settings.get("rssFeedUrl");
  return typeof setting === "string" && setting.trim()
    ? setting.trim()
    : "https://rss.art19.com/get-played";
}

async function fetchLatestEpisode(): Promise<EpisodeData | null> {
  const RSS_URL = await getRssFeedUrl();
  const response = await fetch(RSS_URL);
  if (!response.ok) {
    throw new Error(`RSS fetch failed: ${response.status}`);
  }
  const xmlData = await response.text();

  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });
  const result = parser.parse(xmlData);

  const channel = result?.rss?.channel ?? result?.feed;
  if (!channel) return null;

  const podcastTitle: string = channel.title ?? "Podcast";

  let items: any[] = channel.item ?? channel.entry ?? [];
  if (!Array.isArray(items)) items = [items];
  if (items.length === 0) return null;

  const item = items[0];

  const guid: string =
    item.guid?.["#text"] ?? item.guid ?? item.id ?? item.link ?? "";

  const episodeTitle: string = item.title ?? "Untitled Episode";

  // Episode description — prefer `<description>` then `<itunes:summary>`
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

/** Subreddit menu → "Post most recent episode" */
async function onMenuPostLatest(): Promise<UiResponse> {
  try {
    const episode = await fetchLatestEpisode();
    if (!episode) {
      return { showToast: { text: "No episodes found in the RSS feed.", appearance: "neutral" } };
    }

    const url = await createEpisodePost(episode);

    // Remember this as last-posted so the cron doesn't double-post it
    await redis.set("last_posted_rss_guid", episode.guid);

    return {
      showToast: { text: `Posted: ${episode.episodeTitle}`, appearance: "success" },
      navigateTo: url,
    };
  } catch (e) {
    console.error("Error in onMenuPostLatest:", e);
    return { showToast: { text: `Failed to post: ${e}`, appearance: "neutral" } };
  }
}

/** Scheduler cron → only posts when a new episode is detected */
async function onCheckRSS(): Promise<CheckRSSResponse> {
  const REDIS_KEY = "last_posted_rss_guid";
  try {
    const episode = await fetchLatestEpisode();
    if (!episode) {
      console.log("No episodes found in RSS feed.");
      return {};
    }

    const lastPostedGuid = await redis.get(REDIS_KEY);
    if (episode.guid === lastPostedGuid) {
      console.log("Latest episode already posted:", episode.episodeTitle);
      return {};
    }

    await createEpisodePost(episode);
    await redis.set(REDIS_KEY, episode.guid);
  } catch (error) {
    console.error("Error in onCheckRSS:", error);
  }

  return {};
}

/** App install trigger */
async function onAppInstall(): Promise<TriggerResponse> {
  console.log("podcast-poster installed, scheduler will auto-post new episodes.");
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
