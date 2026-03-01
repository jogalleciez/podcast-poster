import type { IncomingMessage, ServerResponse } from "node:http";
import { context, reddit, redis } from "@devvit/web/server";
import type {
  PartialJsonValue,
  TriggerResponse,
  UiResponse,
} from "@devvit/web/shared";
import {
  ApiEndpoint,
  type InitResponse,
  type CheckRSSResponse,
} from "../shared/api.ts";
import { XMLParser } from "fast-xml-parser";

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

  let body: ApiResponse | UiResponse | ErrorResponse;
  switch (endpoint) {
    case ApiEndpoint.Init:
      body = await onInit();
      break;
    case ApiEndpoint.OnPostCreate:
      body = await onMenuNewPost();
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

type ApiResponse = InitResponse | CheckRSSResponse;

type ErrorResponse = {
  error: string;
  status: number;
};

function getPostId(): string {
  if (!context.postId) {
    throw Error("no post ID");
  }
  return context.postId;
}



async function onInit(): Promise<InitResponse> {
  const postId = getPostId();

  // Attempt to fetch the rich data saved for this specific post
  let postData = {
    audioUrl: "",
    imageUrl: "",
    episodeTitle: "Unknown Episode",
    podcastTitle: "Podcast"
  };

  try {
    const redisData = await redis.get(`postData:${postId}`);
    if (redisData) {
      postData = JSON.parse(redisData);
    }
  } catch (e) {
    console.error("Failed to parse post metadata from redis", e);
  }

  return {
    type: "init",
    postId,
    username: context.username ?? "user",
    audioUrl: postData.audioUrl,
    imageUrl: postData.imageUrl,
    episodeTitle: postData.episodeTitle,
    podcastTitle: postData.podcastTitle
  };
}



async function onMenuNewPost(): Promise<UiResponse> {
  const rssFeedUrlSetting = await settings.get("rssFeedUrl");
  const RSS_URL = typeof rssFeedUrlSetting === "string" ? rssFeedUrlSetting : "https://rss.art19.com/get-played";

  try {
    const response = await fetch(RSS_URL);
    if (!response.ok) throw new Error("Fetch failed");
    const xmlData = await response.text();

    // Quick parse just to get the latest item for the manual post
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });
    const result = parser.parse(xmlData);
    const channel = result?.rss?.channel || result?.feed;
    const podcastTitle = channel?.title || "Podcast";
    const items = [].concat(channel?.item || channel?.entry || []);

    if (items.length > 0) {
      const latestItem: any = items[0];
      const episodeTitle = latestItem.title;
      const link = latestItem.link;
      const audioUrl = latestItem.enclosure?.["@_url"] || link;
      const imageUrl = latestItem?.["itunes:image"]?.["@_href"] || channel?.image?.url || channel?.["itunes:image"]?.["@_href"];

      const currentSubreddit = await reddit.getCurrentSubreddit();
      const post = await reddit.submitPost({
        title: `[${podcastTitle}] - ${episodeTitle}`,
        subredditName: currentSubreddit.name,
        url: link
      });

      // Save the specific data for this new post ID
      const postData = { audioUrl, imageUrl, episodeTitle, podcastTitle };
      await redis.set(`postData:${post.id}`, JSON.stringify(postData));

      return {
        showToast: { text: `Post ${post.id} created.`, appearance: "success" },
        navigateTo: post.url,
      };
    }
  } catch (e) {
    console.error("Error creating post manually", e);
  }

  // Fallback if RSS fails
  const post = await reddit.submitCustomPost({ title: context.appName });
  return {
    showToast: { text: `Fallback custom post ${post.id} created.`, appearance: "success" },
    navigateTo: post.url,
  };
}

async function onAppInstall(): Promise<TriggerResponse> {
  await reddit.submitCustomPost({
    title: "podcast-poster",
  });

  return {};
}

import { settings } from "@devvit/web/server";

async function onCheckRSS(): Promise<CheckRSSResponse> {
  const rssFeedUrlSetting = await settings.get("rssFeedUrl");
  const RSS_URL = typeof rssFeedUrlSetting === "string" ? rssFeedUrlSetting : "https://rss.art19.com/get-played";
  const REDIS_KEY = "last_posted_rss_guid";

  try {
    const response = await fetch(RSS_URL);
    if (!response.ok) {
      throw new Error(`Failed to fetch RSS feed: ${response.status}`);
    }
    const xmlData = await response.text();

    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_"
    });
    const result = parser.parse(xmlData);

    const channel = result?.rss?.channel || result?.feed;
    const podcastTitle = channel?.title || "Podcast";

    let items = channel?.item || channel?.entry || [];
    if (!Array.isArray(items)) {
      items = [items];
    }

    if (items.length === 0) {
      console.log("No RSS items found.");
      return {};
    }

    const latestItem = items[0];
    const guid = latestItem.guid?.["#text"] || latestItem.guid || latestItem.id || latestItem.link;
    const episodeTitle = latestItem.title;
    const link = latestItem.link;

    // Extract audio URL from enclosure or link
    const audioUrl = latestItem.enclosure?.["@_url"] || link;

    // Extract image (try item specific first, then channel fallback)
    const imageUrl = latestItem?.["itunes:image"]?.["@_href"] ||
      channel?.image?.url ||
      channel?.["itunes:image"]?.["@_href"];

    if (!guid || !episodeTitle || !audioUrl) {
      console.error("Missing required metadata in RSS item:", latestItem);
      return {};
    }

    const lastPostedGuid = await redis.get(REDIS_KEY);
    if (lastPostedGuid !== guid) {
      const currentSubreddit = await reddit.getCurrentSubreddit();
      const postTitle = `[${podcastTitle}] - ${episodeTitle}`;

      const newPost = await reddit.submitPost({
        title: postTitle,
        subredditName: currentSubreddit.name,
        url: link,
      });
      console.log(`Posted new episode: ${newPost.url}`);

      // Save the latest GUID so we don't double post
      await redis.set(REDIS_KEY, guid);

      // Save the specific data for this new post ID so the frontend can retrieve it
      const postData = {
        audioUrl,
        imageUrl,
        episodeTitle,
        podcastTitle
      };
      await redis.set(`postData:${newPost.id}`, JSON.stringify(postData));

    } else {
      console.log("Latest episode already posted:", episodeTitle);
    }
  } catch (error) {
    console.error("Error in onCheckRSS:", error);
  }

  return {};
}

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


