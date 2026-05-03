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
import { ApiEndpoint, type ClientErrorReport, type DisplaySettings, type EpisodeData, type FundingLink, type Person, type PostDataResponse, type Soundbite } from "../shared/api.ts";
import { XMLParser } from "fast-xml-parser";

import { NodeHtmlMarkdown } from "node-html-markdown";

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

  let body: UiResponse | TaskResponse | TriggerResponse | PostDataResponse | { ok: true } | { entries: string } | ErrorResponse;
  let status = 200;
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
    case ApiEndpoint.PostData:
      body = await onGetPostData();
      if ("error" in body) status = 404;
      break;
    case ApiEndpoint.LogClientError:
      body = await onLogClientError(req);
      break;
    case ApiEndpoint.ListClientErrors:
      body = await onListClientErrors();
      break;
    case ApiEndpoint.ViewClientErrorsMenu:
      body = await onMenuViewClientErrors();
      break;
    case ApiEndpoint.ViewClientErrorsSubmit:
      body = { showToast: { text: "Closed.", appearance: "neutral" } };
      break;
    default:
      endpoint satisfies never;
      body = { error: "not found", status: 404 };
      break;
  }

  if ("error" in body && "status" in body) status = (body as ErrorResponse).status;
  writeJSON<PartialJsonValue>(status, body, rsp);
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
  duration?: number;
  published_at?: string;
  show?: {
    title?: string;
    image_url?: string;
    description?: string;
    catchphrase?: string;
  };
};

type SpreakerDetailResponse = {
  response: { episode: SpreakerEpisodeDetail };
};

type SpreakerShowDetailResponse = {
  response: { show?: { title?: string } };
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
  const podcastArtworkUrl = ep.show?.image_url || undefined;
  const podcastTagline = ep.show?.catchphrase || undefined;
  const rawShowDesc = ep.show?.description || "";
  const podcastDescription = rawShowDesc
    ? NodeHtmlMarkdown.translate(rawShowDesc).trim() || undefined
    : undefined;
  const pubDate = ep.published_at ? new Date(ep.published_at).toISOString() : undefined;
  const durationSecs = parseDurationSecs(ep.duration);

  return { guid, podcastTitle, episodeTitle, description, audioUrl, linkUrl, postLinkUrl: feed.postLinkUrl, podcastArtworkUrl, podcastTagline, podcastDescription, pubDate, durationSecs };
}

// ---------------------------------------------------------------------------
// Audioboom (audioboom.com) — RSS lives on audioboom.com, which Devvit's
// allowlist won't accept. Route through api.audioboom.com JSON API instead,
// mirroring the Spreaker workaround.
// ---------------------------------------------------------------------------

type AudioboomClip = {
  id?: number;
  title?: string;
  description?: string;
  formatted_description?: string;
  duration?: number;
  uploaded_at?: string;
  urls?: { high_mp3?: string; image?: string };
  channel?: { title?: string };
};

type AudioboomClipsResponse = {
  body?: { audio_clips?: AudioboomClip[] };
};

type AudioboomChannelDetail = {
  title?: string;
  description?: string;
  urls?: { logo_image?: { original?: string } };
};

type AudioboomChannelResponse = {
  body?: { channel?: AudioboomChannelDetail };
};

function extractAudioboomChannelId(url: string): string | null {
  return url.match(/audioboom\.com\/channels?\/(\d+)/)?.[1] ?? null;
}

const AUDIOBOOM_TTL_SECONDS = 50 * 60;

async function fetchAudioboomEpisode(feed: FeedConfig): Promise<EpisodeData | null> {
  const channelId = extractAudioboomChannelId(feed.url)!;
  const fetchOpts = { headers: { "X-Fetch-Reason": "Fetching Audioboom episode data to post to Reddit" } };

  const [clip, channelDetail] = await Promise.all([
    cache(
      async () => {
        const resp = await fetch(
          `https://api.audioboom.com/channels/${channelId}/audio_clips?limit=1`,
          fetchOpts,
        );
        if (!resp.ok) throw new Error(`Audioboom clips list failed: ${resp.status}`);
        const data = (await resp.json()) as AudioboomClipsResponse;
        return data.body?.audio_clips?.[0] ?? null;
      },
      { key: `audioboom_channel:${channelId}`, ttl: AUDIOBOOM_TTL_SECONDS },
    ),
    cache(
      async () => {
        const resp = await fetch(
          `https://api.audioboom.com/channels/${channelId}`,
          fetchOpts,
        );
        if (!resp.ok) return null;
        const data = (await resp.json()) as AudioboomChannelResponse;
        return data.body?.channel ?? null;
      },
      { key: `audioboom_channel_meta:${channelId}`, ttl: AUDIOBOOM_TTL_SECONDS },
    ),
  ]);

  if (!clip) return null;

  const podcastTitle = feed.nameOverride || clip.channel?.title || channelDetail?.title || "Podcast";
  const guid = clip.id != null ? String(clip.id) : "";
  const episodeTitle = clip.title ?? "Untitled Episode";
  const rawDescription = clip.formatted_description || clip.description || "";
  const description = NodeHtmlMarkdown.translate(rawDescription).trim();
  const audioUrl = clip.urls?.high_mp3 ?? "";
  const linkUrl = clip.id != null ? `https://audioboom.com/posts/${clip.id}` : "";
  const podcastArtworkUrl = channelDetail?.urls?.logo_image?.original || undefined;
  const rawShowDesc = channelDetail?.description || "";
  const podcastDescription = rawShowDesc
    ? NodeHtmlMarkdown.translate(rawShowDesc).trim() || undefined
    : undefined;
  const pubDate = clip.uploaded_at ? new Date(clip.uploaded_at).toISOString() : undefined;
  const durationSecs = parseDurationSecs(clip.duration);

  if (!guid) return null;

  return { guid, podcastTitle, episodeTitle, description, audioUrl, linkUrl, postLinkUrl: feed.postLinkUrl, podcastArtworkUrl, podcastDescription, pubDate, durationSecs };
}

// Narrow types for the subset of RSS / Atom fields we actually consume.
// fast-xml-parser returns a loose object shape; we treat it as `unknown` and
// pluck only the fields we rely on.
type RssEnclosure = { "@_url"?: string };
type RssGuid = string | { "#text"?: string };
type PodcastTranscript = { "@_url"?: string; "@_type"?: string };
type PodcastPerson = { "#text"?: string; "@_role"?: string; "@_group"?: string; "@_href"?: string };
type PodcastChapters = { "@_url"?: string };
type PodcastFunding = { "#text"?: string; "@_url"?: string };
type PodcastSoundbite = { "#text"?: string; "@_startTime"?: string; "@_duration"?: string };
// fast-xml-parser emits a plain number/string when no attributes are present,
// or { "#text": number|string, "@_...": string } when attributes are present.
type PodcastSeasonVal = number | string | { "#text"?: number | string; "@_name"?: string };
type PodcastEpisodeVal = number | string | { "#text"?: number | string; "@_display"?: string };
type RssItem = {
  guid?: RssGuid;
  id?: string;
  link?: string;
  title?: string;
  description?: string;
  content?: string;
  enclosure?: RssEnclosure;
  "itunes:summary"?: string;
  "itunes:subtitle"?: string;
  "itunes:keywords"?: string;
  "itunes:episodeType"?: string;
  "content:encoded"?: string;
  pubDate?: string;
  "itunes:duration"?: string | number;
  "itunes:episode"?: number | string;
  "itunes:season"?: number | string;
  "itunes:explicit"?: string | boolean;
  "itunes:author"?: string;
  "podcast:transcript"?: PodcastTranscript | PodcastTranscript[];
  "podcast:person"?: PodcastPerson | PodcastPerson[];
  "podcast:chapters"?: PodcastChapters | PodcastChapters[];
  "podcast:soundbite"?: PodcastSoundbite | PodcastSoundbite[];
  "podcast:season"?: PodcastSeasonVal;
  "podcast:episode"?: PodcastEpisodeVal;
};
type RssChannel = {
  title?: string;
  description?: string;
  "content:encoded"?: string;
  "itunes:subtitle"?: string;
  "itunes:summary"?: string;
  "itunes:keywords"?: string;
  "itunes:image"?: { "@_href"?: string } | string;
  image?: { url?: string };
  item?: RssItem | RssItem[];
  entry?: RssItem | RssItem[];
  "itunes:explicit"?: string | boolean;
  "itunes:author"?: string;
  "podcast:funding"?: PodcastFunding | PodcastFunding[];
  "podcast:person"?: PodcastPerson | PodcastPerson[];
};

function parseDurationSecs(val: string | number | undefined): number | undefined {
  if (val == null) return undefined;
  if (typeof val === "number") return val > 0 ? Math.round(val) : undefined;
  const parts = String(val).split(":").map(Number);
  if (parts.some(isNaN)) return undefined;
  if (parts.length === 3) return parts[0]! * 3600 + parts[1]! * 60 + parts[2]!;
  if (parts.length === 2) return parts[0]! * 60 + parts[1]!;
  return Math.round(Number(val)) || undefined;
}

function parseExplicit(val: string | boolean | undefined): boolean | undefined {
  if (val == null) return undefined;
  if (typeof val === "boolean") return val;
  if (!val) return undefined;
  const v = val.toLowerCase();
  if (v === "yes" || v === "true") return true;
  if (v === "no" || v === "false" || v === "clean") return false;
  return undefined;
}

function firstTranscriptUrl(t: PodcastTranscript | PodcastTranscript[] | undefined): string | undefined {
  if (!t) return undefined;
  const first = Array.isArray(t) ? t[0] : t;
  return first?.["@_url"] || undefined;
}

function readItunesImage(val: { "@_href"?: string } | string | undefined): string | undefined {
  if (!val) return undefined;
  if (typeof val === "string") return val || undefined;
  return val["@_href"] || undefined;
}

function extractPeople(
  itemVal: PodcastPerson | PodcastPerson[] | undefined,
  channelVal: PodcastPerson | PodcastPerson[] | undefined,
): Person[] | undefined {
  const raw = itemVal ?? channelVal;
  if (!raw) return undefined;
  const arr = Array.isArray(raw) ? raw : [raw];
  const people = arr
    .filter(p => !!p["#text"] && (!p["@_group"] || p["@_group"].toLowerCase() === "cast"))
    .map(p => ({
      name: (p["#text"] as string).trim(),
      role: p["@_role"]?.toLowerCase() || undefined,
      href: p["@_href"] || undefined,
    }));
  return people.length > 0 ? people : undefined;
}

function firstChaptersUrl(val: PodcastChapters | PodcastChapters[] | undefined): string | undefined {
  if (!val) return undefined;
  const first = Array.isArray(val) ? val[0] : val;
  return first?.["@_url"] || undefined;
}

function extractFunding(val: PodcastFunding | PodcastFunding[] | undefined): FundingLink[] | undefined {
  if (!val) return undefined;
  const arr = Array.isArray(val) ? val : [val];
  const seen = new Set<string>();
  const links: FundingLink[] = [];
  for (const f of arr) {
    const url = f["@_url"];
    if (url && !seen.has(url)) {
      seen.add(url);
      links.push({ label: (f["#text"] ?? "Support the show").trim() || "Support the show", url });
    }
  }
  return links.length > 0 ? links : undefined;
}

function extractSoundbites(val: PodcastSoundbite | PodcastSoundbite[] | undefined): Soundbite[] | undefined {
  if (!val) return undefined;
  const arr = Array.isArray(val) ? val : [val];
  const bites: Soundbite[] = [];
  for (const s of arr) {
    const start = parseFloat(s["@_startTime"] ?? "");
    const dur = parseFloat(s["@_duration"] ?? "");
    if (!isNaN(start) && !isNaN(dur)) {
      bites.push({ title: s["#text"]?.trim() || undefined, startTimeSecs: start, durationSecs: dur });
    }
  }
  return bites.length > 0 ? bites : undefined;
}

function readPodcastSeasonVal(val: PodcastSeasonVal | undefined): { number?: number; name?: string } {
  if (val == null) return {};
  if (typeof val === "number") return { number: val > 0 ? Math.round(val) : undefined };
  if (typeof val === "string") {
    const n = Number(val.trim());
    return { number: !isNaN(n) && n > 0 ? Math.round(n) : undefined };
  }
  const text = val["#text"];
  const n = text != null ? Number(text) : NaN;
  return {
    number: !isNaN(n) && n > 0 ? Math.round(n) : undefined,
    name: val["@_name"]?.trim() || undefined,
  };
}

function readPodcastEpisodeVal(val: PodcastEpisodeVal | undefined): { number?: number; display?: string } {
  if (val == null) return {};
  if (typeof val === "number") return { number: val > 0 ? Math.round(val) : undefined };
  if (typeof val === "string") {
    const n = Number(val.trim());
    return { number: !isNaN(n) && n > 0 ? Math.round(n) : undefined };
  }
  const text = val["#text"];
  const n = text != null ? Number(text) : NaN;
  return {
    number: !isNaN(n) && n > 0 ? Math.round(n) : undefined,
    display: val["@_display"]?.trim() || undefined,
  };
}
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
  if (extractAudioboomChannelId(feed.url)) {
    return fetchAudioboomEpisode(feed);
  }

  const response = await fetch(feed.url, {
    headers: {
      "X-Fetch-Reason": "Fetching RSS feed to check for new podcast episodes to post to Reddit",
      "Accept-Encoding": "identity",
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
  const podcastArtworkUrl = readItunesImage(channel["itunes:image"]) ?? channel.image?.url;
  const podcastTagline = channel["itunes:subtitle"] || undefined;
  const rawShowDesc = channel["content:encoded"] ?? channel.description ?? channel["itunes:summary"] ?? "";
  const podcastDescription = rawShowDesc
    ? stripPrivacyNotices(NodeHtmlMarkdown.translate(rawShowDesc).trim()) || undefined
    : undefined;

  const rawItems = channel.item ?? channel.entry;
  if (!rawItems) return null;
  const items: RssItem[] = Array.isArray(rawItems) ? rawItems : [rawItems];
  if (items.length === 0) return null;

  const item = items[0]!;

  const guid = readGuid(item.guid) || item.id || item.link || "";
  const episodeTitle = item.title ?? "Untitled Episode";
  const rawDescription =
    item["content:encoded"] ??
    item.content ??
    item.description ??
    item["itunes:summary"] ??
    item["itunes:subtitle"] ??
    "";

  const description = stripPrivacyNotices(NodeHtmlMarkdown.translate(rawDescription).trim());

  const episodeSubtitle = item["itunes:subtitle"]
    ? stripPrivacyNotices(NodeHtmlMarkdown.translate(item["itunes:subtitle"]).trim()) || undefined
    : undefined;

  const rawKeywords = item["itunes:keywords"] || channel["itunes:keywords"];
  const keywords = rawKeywords
    ? rawKeywords.split(",").map(k => k.trim()).filter(Boolean)
    : undefined;

  const episodeTypeRaw = item["itunes:episodeType"]?.toLowerCase();
  const episodeType =
    episodeTypeRaw === "full" || episodeTypeRaw === "trailer" || episodeTypeRaw === "bonus"
      ? episodeTypeRaw
      : undefined;

  const audioUrl = item.enclosure?.["@_url"] ?? item.link ?? "";
  const linkUrl = item.link ?? "";
  const pubDate = item.pubDate ? new Date(item.pubDate).toISOString() : undefined;
  const durationSecs = parseDurationSecs(item["itunes:duration"]);
  const explicit = parseExplicit(item["itunes:explicit"] ?? channel["itunes:explicit"]);
  const episodeAuthor = item["itunes:author"] || channel["itunes:author"] || undefined;
  const transcriptUrl = firstTranscriptUrl(item["podcast:transcript"]);

  const podcastEp = readPodcastEpisodeVal(item["podcast:episode"]);
  const podcastSeason = readPodcastSeasonVal(item["podcast:season"]);
  // Prefer itunes: numbers (broader compat); fall back to podcast: if absent.
  const episodeNumber = item["itunes:episode"] != null ? Number(item["itunes:episode"]) : podcastEp.number;
  const seasonNumber  = item["itunes:season"]  != null ? Number(item["itunes:season"])  : podcastSeason.number;
  const episodeDisplay = podcastEp.display;
  const seasonName = podcastSeason.name;

  const people = extractPeople(item["podcast:person"], channel["podcast:person"]);
  const chaptersUrl = firstChaptersUrl(item["podcast:chapters"]);
  const fundingLinks = extractFunding(channel["podcast:funding"]);
  const soundbites = extractSoundbites(item["podcast:soundbite"]);

  if (!guid || !episodeTitle) return null;

  return { guid, podcastTitle, episodeTitle, description, audioUrl, linkUrl, postLinkUrl: feed.postLinkUrl, podcastArtworkUrl, podcastTagline, podcastDescription, pubDate, durationSecs, episodeNumber, seasonNumber, explicit, episodeAuthor, transcriptUrl, episodeSubtitle, keywords, episodeType, people, chaptersUrl, fundingLinks, seasonName, episodeDisplay, soundbites };
}

async function fetchFeedTitle(feed: FeedConfig): Promise<string> {
  if (feed.nameOverride) return feed.nameOverride;

  try {
    const showId = extractSpreakerShowId(feed.url);
    if (showId) {
      const title = await cache(
        async () => {
          const resp = await fetch(`https://api.spreaker.com/v2/shows/${showId}`, {
            headers: { "X-Fetch-Reason": "Fetching Spreaker show title for feed selector" },
          });
          if (!resp.ok) return null;
          const data = (await resp.json()) as SpreakerShowDetailResponse;
          return data.response?.show?.title ?? null;
        },
        { key: `spreaker_show_title:${showId}`, ttl: SPREAKER_TTL_SECONDS },
      );
      return title ?? `Feed ${feed.index}`;
    }

    const audioboomChannelId = extractAudioboomChannelId(feed.url);
    if (audioboomChannelId) {
      const title = await cache(
        async () => {
          const resp = await fetch(`https://api.audioboom.com/channels/${audioboomChannelId}`, {
            headers: { "X-Fetch-Reason": "Fetching Audioboom channel title for feed selector" },
          });
          if (!resp.ok) return null;
          const data = (await resp.json()) as AudioboomChannelResponse;
          return data.body?.channel?.title ?? null;
        },
        { key: `audioboom_channel_title:${audioboomChannelId}`, ttl: AUDIOBOOM_TTL_SECONDS },
      );
      return title ?? `Feed ${feed.index}`;
    }

    const response = await fetch(feed.url, {
      headers: {
        "X-Fetch-Reason": "Fetching RSS channel title for feed selector",
        "Accept-Encoding": "identity",
      },
    });
    if (!response.ok) return `Feed ${feed.index}`;
    const xmlData = await response.text();
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });
    const result = parser.parse(xmlData) as RssDocument;
    const channel = result.rss?.channel ?? result.feed;
    return channel?.title || `Feed ${feed.index}`;
  } catch {
    return `Feed ${feed.index}`;
  }
}

function postDataKey(postId: string): string {
  return `post_data:${postId}`;
}

async function createEpisodePost(episode: EpisodeData): Promise<string> {
  const subredditName = context.subredditName;
  if (!subredditName) {
    throw new Error("subredditName missing from context");
  }

  const [flairIdRaw, flairTextRaw, includePodcastName, shouldSticky] = await Promise.all([
    settings.get<string>("postFlairId"),
    settings.get<string>("postFlairText"),
    settings.get<boolean>("includePodcastNameInTitle"),
    settings.get<boolean>("stickyPost"),
  ]);

  const title = includePodcastName !== false
    ? `${episode.podcastTitle} - ${episode.episodeTitle}`
    : episode.episodeTitle;

  const flairId = flairIdRaw?.trim() || undefined;
  const flairText = flairTextRaw?.trim() || undefined;

  const post = await reddit.submitCustomPost({
    subredditName,
    title,
    ...(flairId ? { flairId, flairText } : {}),
  });

  await redis.set(postDataKey(post.id), JSON.stringify(episode));

  console.log(`New post created: ${post.url}`);

  if (shouldSticky) {
    try {
      await post.sticky(1);
    } catch (e) {
      console.error("Failed to sticky post (subreddit may already have 2 stickies):", e);
    }
  }

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
  const userId = context.userId ?? "unknown";

  const stored = await redis.get(postDataKey(targetId));
  if (!stored) {
    return {
      showToast: {
        text: "This post predates the React UI and can't be edited here.",
        appearance: "neutral",
      },
    };
  }
  const episode = JSON.parse(stored) as EpisodeData;

  await redis.set(`pending_edit:${userId}`, targetId, {
    expiration: new Date(Date.now() + 600_000), // 10 minutes
  });

  return {
    showForm: {
      name: "editPostBodyForm",
      form: {
        title: "Edit Episode Description",
        description: "Edit the description shown in the episode post using Markdown.",
        acceptLabel: "Save changes",
        fields: [
          {
            type: "paragraph",
            name: "body",
            label: "Description (markdown)",
            helpText: "Supports Markdown (e.g. **bold**, *italic*, [links](url), > blockquote).",
            required: true,
            defaultValue: episode.description,
            lineHeight: 15,
          },
        ],
      },
      data: { body: episode.description },
    },
  };
}

/**
 * Form submit → updates the episode description stored under
 * `post_data:{postId}` so the React client renders the new text on next load.
 */
async function onFormEditPostBodySubmit(req: IncomingMessage): Promise<UiResponse> {
  const { body } = await readBody<{ body: string }>(req);
  const userId = context.userId ?? "unknown";
  const postId = await redis.get(`pending_edit:${userId}`);

  if (!postId) {
    return { showToast: { text: "Session expired — please try again.", appearance: "neutral" } };
  }

  const stored = await redis.get(postDataKey(postId));
  if (!stored) {
    await redis.del(`pending_edit:${userId}`);
    return { showToast: { text: "Post data missing — can't edit.", appearance: "neutral" } };
  }
  const episode = JSON.parse(stored) as EpisodeData;
  const updated: EpisodeData = { ...episode, description: body };
  await redis.set(postDataKey(postId), JSON.stringify(updated));
  await redis.del(`pending_edit:${userId}`);

  const post = await reddit.getPostById(postId as `t3_${string}`);
  return {
    showToast: { text: "Episode description updated.", appearance: "success" },
    navigateTo: `https://www.reddit.com${post.permalink}`,
  };
}

/** Client `GET /api/post-data` → returns EpisodeData + current display settings for the current post. */
async function onGetPostData(): Promise<PostDataResponse> {
  const postId = context.postId;
  if (!postId) return { error: "not_found" };

  const [stored, buttonColor, buttonPosition] = await Promise.all([
    redis.get(postDataKey(postId)),
    settings.get<string>("listenButtonColor"),
    settings.get<string>("listenButtonPosition"),
  ]);

  if (!stored) return { error: "not_found" };

  const display: DisplaySettings = {
    listenButtonColor: buttonColor || undefined,
    listenButtonPosition: (buttonPosition as "top" | "bottom" | undefined) ?? "bottom",
  };

  return { episode: JSON.parse(stored) as EpisodeData, display };
}

const CLIENT_ERRORS_KEY = "client_errors";
const CLIENT_ERRORS_MAX = 50;

async function appendClientError(entry: Record<string, unknown>): Promise<void> {
  const current = await redis.get(CLIENT_ERRORS_KEY);
  let arr: Record<string, unknown>[] = [];
  if (current) {
    try { arr = JSON.parse(current) as Record<string, unknown>[]; } catch { arr = []; }
  }
  arr.unshift(entry);
  if (arr.length > CLIENT_ERRORS_MAX) arr.length = CLIENT_ERRORS_MAX;
  await redis.set(CLIENT_ERRORS_KEY, JSON.stringify(arr));
}

async function onLogClientError(req: IncomingMessage): Promise<{ ok: true }> {
  try {
    const r = await readBody<ClientErrorReport>(req);
    await appendClientError({ ...r, ts: new Date().toISOString() });
  } catch (e) {
    try {
      await appendClientError({ ts: new Date().toISOString(), parseError: e instanceof Error ? e.message : String(e) });
    } catch {}
  }
  return { ok: true };
}

async function onListClientErrors(): Promise<{ entries: string }> {
  const raw = (await redis.get(CLIENT_ERRORS_KEY)) ?? "[]";
  return { entries: raw };
}

async function onMenuViewClientErrors(): Promise<UiResponse> {
  const raw = (await redis.get(CLIENT_ERRORS_KEY)) ?? "[]";
  let pretty = raw;
  let count = 0;
  try {
    const arr = JSON.parse(raw) as unknown[];
    count = arr.length;
    pretty = JSON.stringify(arr, null, 2);
  } catch {}
  if (count === 0) {
    return { showToast: { text: "No client errors captured yet.", appearance: "neutral" } };
  }
  return {
    showForm: {
      name: "viewClientErrorsForm",
      form: {
        title: `Client errors (${count})`,
        description: "Most recent first. Read-only.",
        acceptLabel: "Close",
        fields: [
          {
            type: "paragraph",
            name: "errors",
            label: "Captured errors",
            defaultValue: pretty.slice(0, 10000),
            lineHeight: 20,
          },
        ],
      },
      data: {},
    },
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

  const feedLabels = await Promise.all(feeds.map(fetchFeedTitle));

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
              ...feeds.map((f, i) => ({
                label: feedLabels[i] ?? f.url,
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
