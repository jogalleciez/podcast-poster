import type { IncomingMessage, ServerResponse } from "node:http";
import { context, reddit, redis, settings } from "@devvit/web/server";
import type {
  MenuItemRequest,
  PartialJsonValue,
  TriggerResponse,
  UiResponse,
} from "@devvit/web/shared";
import {
  ApiEndpoint,
  type CheckRSSResponse,
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

  let body: UiResponse | CheckRSSResponse | TriggerResponse | ErrorResponse;
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
  linkUrl: string;
  postLinkUrl?: string;
};

async function getFeeds(): Promise<FeedConfig[]> {
  const feedUrls = await settings.get<string>("feedUrls") || "";
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
        description: "",
        postLinkUrl,
      });
    }
  });

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
  const linkUrl: string = item.link ?? "";

  if (!guid || !episodeTitle) return null;

  return { guid, podcastTitle, episodeTitle, description, audioUrl, linkUrl, postLinkUrl: feed.postLinkUrl };
}

async function createEpisodePost(episode: EpisodeData): Promise<string> {
  const subreddit = await reddit.getCurrentSubreddit();
  const title = `${episode.podcastTitle} - ${episode.episodeTitle}`;

  let linkUrl: string;
  if (episode.postLinkUrl === "link") {
    linkUrl = episode.linkUrl;
  } else {
    linkUrl = episode.postLinkUrl || episode.audioUrl;
  }
  const body = linkUrl
    ? `${episode.description}\n\n[Listen to this episode](${linkUrl})`
    : episode.description;

  const flairId = (await settings.get<string>("postFlairId"))?.trim() || undefined;
  const flairText = (await settings.get<string>("postFlairText"))?.trim() || undefined;

  const post = await reddit.submitPost({
    subredditName: subreddit.name,
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

/**
 * Shared helper — posts the latest episode from each feed in the given list.
 * Returns a UiResponse toast (+ navigateTo on success).
 */
async function postFromFeeds(feeds: FeedConfig[]): Promise<UiResponse> {
  const posted: string[] = [];
  const failed: string[] = [];
  let firstPostUrl: string | undefined;

  for (const feed of feeds) {
    try {
      const episode = await fetchLatestEpisode(feed);
      if (!episode) {
        failed.push(`Feed ${feed.index}: no episodes found`);
        continue;
      }

      const postUrl = await createEpisodePost(episode);
      firstPostUrl ??= postUrl;
      await redis.set(`last_posted_guid:${feed.index}`, episode.guid);
      posted.push(episode.episodeTitle);
    } catch (e) {
      console.error(`Error posting feed ${feed.index}:`, e);
      const msg = e instanceof Error ? e.message : String(e);
      const reason = msg.includes("is not allowed")
        ? "domain not allowlisted"
        : "unknown error";
      failed.push(`Feed ${feed.index}: ${reason}`);
    }
  }

  if (posted.length > 0) {
    const summary = posted.length === 1
      ? `Posted: ${posted[0]}`
      : `Posted ${posted.length} episodes`;
    return {
      showToast: { text: summary, appearance: "success" },
      ...(firstPostUrl ? { navigateTo: firstPostUrl } : {}),
    };
  }

  return {
    showToast: {
      text: failed.length > 0 ? `Errors: ${failed.join("; ")}` : "Nothing to post.",
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
    return { showToast: { text: "No feeds configured. Add an RSS URL in App Settings.", appearance: "neutral" } };
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

  // Backward compatibility: migrate old single-feed settings to new multi-feed format
  try {
    const oldFeedUrl = await settings.get<string>("feedUrl");
    const oldFeedName = await settings.get<string>("feedName");
    const oldPostLinkUrl = await settings.get<string>("postLinkUrl");

    if (oldFeedUrl && oldFeedUrl.trim()) {
      // Check if feedUrls is already set (skip if already migrated)
      const newFeedUrls = await settings.get<string>("feedUrls");
      if (!newFeedUrls || !newFeedUrls.trim()) {
        // Construct new multi-feed format
        let migratedLine = oldFeedUrl.trim();
        if (oldFeedName && oldFeedName.trim()) {
          migratedLine += ` | ${oldFeedName.trim()}`;
        } else if (oldPostLinkUrl && oldPostLinkUrl.trim()) {
          migratedLine += " | ";
        }
        if (oldPostLinkUrl && oldPostLinkUrl.trim()) {
          migratedLine += ` | ${oldPostLinkUrl.trim()}`;
        }

        console.log(
          `Migrating old single-feed settings to new multi-feed format: ${migratedLine}`
        );
      }
    }
  } catch (err) {
    console.error("Error during backward compatibility migration:", err);
  }

  return {};
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
