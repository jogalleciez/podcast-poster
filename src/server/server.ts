import type { IncomingMessage, ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import { cache, context, reddit, redis, settings } from "@devvit/web/server";
import type { TaskResponse } from "@devvit/web/server";
import type {
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
    case ApiEndpoint.SelectFeedSubmit:
      body = await onFormSelectFeedSubmit(req);
      break;
    case ApiEndpoint.SelectEpisodeSubmit:
      body = await onFormSelectEpisodeSubmit(req);
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

type SpreakerListItem = {
  episode_id: number;
  title?: string;
  published_at?: string;
};

type SpreakerListResponse = {
  response: { items: SpreakerListItem[]; next_url?: string };
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

type SpreakerShowMeta = {
  title?: string;
  description?: string;
  image_url?: string;
  catchphrase?: string;
};

type SpreakerShowDetailResponse = {
  response: { show?: SpreakerShowMeta };
};

function extractSpreakerShowId(url: string): string | null {
  return url.match(/spreaker\.com\/show\/(\d+)/)?.[1] ?? null;
}

// Cached for slightly less than the hourly-poll interval so two back-to-back
// checks don't double-fetch the Spreaker API. Per-show, not per-feed: feed-specific
// overrides (nameOverride, postLinkUrl) are applied below the cache.
const SPREAKER_TTL_SECONDS = 50 * 60;

async function fetchSpreakerShowMeta(showId: string): Promise<SpreakerShowMeta | null> {
  return cache(
    async () => {
      const resp = await fetch(`https://api.spreaker.com/v2/shows/${showId}`, {
        headers: { "X-Fetch-Reason": "Fetching Spreaker show metadata for episode post" },
      });
      if (!resp.ok) return null;
      const data = (await resp.json()) as SpreakerShowDetailResponse;
      return data.response?.show ?? null;
    },
    { key: `spreaker_show_meta:${showId}`, ttl: SPREAKER_TTL_SECONDS },
  );
}

function spreakerDetailToEpisode(ep: SpreakerEpisodeDetail, feed: FeedConfig, showMeta?: SpreakerShowMeta | null): EpisodeData {
  const podcastTitle = feed.nameOverride || ep.show?.title || showMeta?.title || "Podcast";
  const guid = ep.rss_guid || String(ep.episode_id);
  const episodeTitle = ep.title ?? "Untitled Episode";
  const rawDescription = ep.description_html || ep.description || "";
  const description = NodeHtmlMarkdown.translate(rawDescription).trim();
  const audioUrl = ep.download_url || ep.playback_url || ep.media_url || "";
  const linkUrl = ep.site_url || "";
  const podcastTagline = ep.show?.catchphrase || showMeta?.catchphrase || undefined;
  const rawShowDesc = ep.show?.description || showMeta?.description || "";
  const podcastDescription = rawShowDesc
    ? NodeHtmlMarkdown.translate(rawShowDesc).trim() || undefined
    : undefined;
  const pubDate = safeIsoDate(ep.published_at);
  // Spreaker returns duration in milliseconds; divide by 1000 to get seconds.
  // Guard: if the value is already ≤ 86400 it can't be ms for any real episode
  // (that would be ≤ 86 seconds), so treat it as seconds to avoid dividing
  // correctly-scaled values from future API changes.
  const rawDuration = typeof ep.duration === "number" && ep.duration > 86400
    ? ep.duration / 1000
    : ep.duration;
  const durationSecs = parseDurationSecs(rawDuration);

  return { guid, podcastTitle, episodeTitle, description, audioUrl, linkUrl, postLinkUrl: feed.postLinkUrl, feedUrl: feed.url, podcastTagline, podcastDescription, pubDate, durationSecs };
}

async function fetchSpreakerEpisode(feed: FeedConfig): Promise<EpisodeData | null> {
  const showId = extractSpreakerShowId(feed.url)!;

  const [ep, showMeta] = await Promise.all([
    cache(
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
    ),
    fetchSpreakerShowMeta(showId),
  ]);

  if (!ep) return null;
  return spreakerDetailToEpisode(ep, feed, showMeta);
}

// Spreaker caps `limit` at 100 per page. Walk `next_url` to gather more.
const SPREAKER_PAGE_SIZE = 100;

async function fetchSpreakerListItems(feed: FeedConfig, limit: number): Promise<SpreakerListItem[]> {
  const showId = extractSpreakerShowId(feed.url)!;
  return cache(
    async () => {
      const headers = { "X-Fetch-Reason": "Fetching Spreaker episode list for episode picker" };
      const items: SpreakerListItem[] = [];
      let url: string | undefined =
        `https://api.spreaker.com/v2/shows/${showId}/episodes?limit=${Math.min(limit, SPREAKER_PAGE_SIZE)}`;

      while (url && items.length < limit) {
        const resp = await fetch(url, { headers });
        if (!resp.ok) throw new Error(`Spreaker episodes list failed: ${resp.status}`);
        const data = (await resp.json()) as SpreakerListResponse;
        const page = data.response?.items ?? [];
        items.push(...page);
        url = page.length > 0 ? data.response?.next_url : undefined;
      }

      return items.slice(0, limit);
    },
    { key: `spreaker_picklist:${showId}:${limit}`, ttl: SPREAKER_TTL_SECONDS },
  );
}

async function fetchSpreakerPickList(feed: FeedConfig, limit: number): Promise<EpisodePickItem[]> {
  const items = await fetchSpreakerListItems(feed, limit);
  return items.map(it => ({
    guid: String(it.episode_id),
    title: it.title ?? "Untitled Episode",
    pubDate: safeIsoDate(it.published_at),
  }));
}

async function fetchSpreakerEpisodeByGuid(feed: FeedConfig, guid: string): Promise<EpisodeData | null> {
  // Picker uses episode_id stringified as guid; if rss_guid was used elsewhere
  // it would not match here, but the picker we built always emits episode_id.
  const episodeId = guid;
  const showId = extractSpreakerShowId(feed.url)!;
  const [detail, showMeta] = await Promise.all([
    cache(
      async () => {
        const resp = await fetch(
          `https://api.spreaker.com/v2/episodes/${episodeId}`,
          { headers: { "X-Fetch-Reason": "Fetching Spreaker episode detail for moderator-picked post" } },
        );
        if (!resp.ok) throw new Error(`Spreaker episode detail failed: ${resp.status}`);
        const data = (await resp.json()) as SpreakerDetailResponse;
        return data.response?.episode ?? null;
      },
      { key: `spreaker_episode:${episodeId}`, ttl: SPREAKER_TTL_SECONDS },
    ),
    fetchSpreakerShowMeta(showId),
  ]);
  if (!detail) return null;
  return spreakerDetailToEpisode(detail, feed, showMeta);
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

function audioboomClipToEpisode(
  clip: AudioboomClip,
  channelDetail: AudioboomChannelDetail | null,
  feed: FeedConfig,
): EpisodeData | null {
  const guid = clip.id != null ? String(clip.id) : "";
  if (!guid) return null;

  const podcastTitle = feed.nameOverride || clip.channel?.title || channelDetail?.title || "Podcast";
  const episodeTitle = clip.title ?? "Untitled Episode";
  const rawDescription = clip.formatted_description || clip.description || "";
  const description = NodeHtmlMarkdown.translate(rawDescription).trim();
  const audioUrl = clip.urls?.high_mp3 ?? "";
  const linkUrl = clip.id != null ? `https://audioboom.com/posts/${clip.id}` : "";
  const rawShowDesc = channelDetail?.description || "";
  const podcastDescription = rawShowDesc
    ? NodeHtmlMarkdown.translate(rawShowDesc).trim() || undefined
    : undefined;
  const pubDate = safeIsoDate(clip.uploaded_at);
  const durationSecs = parseDurationSecs(clip.duration);

  return { guid, podcastTitle, episodeTitle, description, audioUrl, linkUrl, postLinkUrl: feed.postLinkUrl, feedUrl: feed.url, podcastDescription, pubDate, durationSecs };
}

async function fetchAudioboomChannelDetail(channelId: string): Promise<AudioboomChannelDetail | null> {
  const fetchOpts = { headers: { "X-Fetch-Reason": "Fetching Audioboom channel metadata" } };
  return cache(
    async () => {
      const resp = await fetch(`https://api.audioboom.com/channels/${channelId}`, fetchOpts);
      if (!resp.ok) return null;
      const data = (await resp.json()) as AudioboomChannelResponse;
      return data.body?.channel ?? null;
    },
    { key: `audioboom_channel_meta:${channelId}`, ttl: AUDIOBOOM_TTL_SECONDS },
  );
}

async function fetchAudioboomEpisodes(feed: FeedConfig, limit: number): Promise<EpisodeData[]> {
  const channelId = extractAudioboomChannelId(feed.url)!;
  const fetchOpts = { headers: { "X-Fetch-Reason": "Fetching Audioboom episode list to post to Reddit" } };

  const [clips, channelDetail] = await Promise.all([
    cache(
      async () => {
        const resp = await fetch(
          `https://api.audioboom.com/channels/${channelId}/audio_clips?limit=${limit}`,
          fetchOpts,
        );
        if (!resp.ok) throw new Error(`Audioboom clips list failed: ${resp.status}`);
        const data = (await resp.json()) as AudioboomClipsResponse;
        return data.body?.audio_clips ?? [];
      },
      { key: `audioboom_channel_clips:${channelId}:${limit}`, ttl: AUDIOBOOM_TTL_SECONDS },
    ),
    fetchAudioboomChannelDetail(channelId),
  ]);

  const episodes: EpisodeData[] = [];
  for (const clip of clips) {
    const ep = audioboomClipToEpisode(clip, channelDetail, feed);
    if (ep) episodes.push(ep);
  }
  return episodes;
}

async function fetchAudioboomEpisode(feed: FeedConfig): Promise<EpisodeData | null> {
  const episodes = await fetchAudioboomEpisodes(feed, 1);
  return episodes[0] ?? null;
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
  author?: string;
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
  "itunes:owner"?: { "itunes:name"?: string; "itunes:email"?: string };
  managingEditor?: string;
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
function safeIsoDate(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function extractEmail(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const match = raw.match(/[\w.+-]+@[\w.-]+\.\w+/);
  return match?.[0] || undefined;
}

function extractRfc2822Name(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const match = raw.match(/\((.+)\)/);
  return match?.[1]?.trim() || undefined;
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

function parseRssItem(item: RssItem, channel: RssChannel, feed: FeedConfig): EpisodeData | null {
  const podcastTitle = feed.nameOverride || channel.title || "Podcast";
  const podcastTagline = channel["itunes:subtitle"] || undefined;
  const rawShowDesc = channel["content:encoded"] ?? channel.description ?? channel["itunes:summary"] ?? "";
  const podcastDescription = rawShowDesc
    ? stripPrivacyNotices(NodeHtmlMarkdown.translate(rawShowDesc).trim()) || undefined
    : undefined;

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

  const rawSubtitle = item["itunes:subtitle"]
    ? stripPrivacyNotices(NodeHtmlMarkdown.translate(item["itunes:subtitle"]).trim()) || undefined
    : undefined;
  const collapse = (s: string) => s.replace(/\s+/g, " ");
  // Resolve [text](url) links to just text before stripping other markdown chars,
  // so HTML <a> tags in content:encoded don't break substring matching against
  // plain-text itunes:subtitle (which has no URLs).
  const stripMd = (s: string) => s
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`#\[\]]/g, "");
  // Normalize typographic punctuation to ASCII so smart quotes / en-dashes from
  // HTML entities in content:encoded don't prevent matching plain-text itunes:subtitle.
  const normPunct = (s: string) => s
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...");
  const norm = (s: string) => normPunct(collapse(stripMd(s)));
  const subtitleRedundant = rawSubtitle && description && (
    norm(description).startsWith(norm(rawSubtitle)) ||
    norm(rawSubtitle).startsWith(norm(description)) ||
    norm(description).includes(norm(rawSubtitle))
  );
  const episodeSubtitle = subtitleRedundant ? undefined : rawSubtitle;

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
  const pubDate = safeIsoDate(item.pubDate);
  const durationSecs = parseDurationSecs(item["itunes:duration"]);
  const itemExplicit = parseExplicit(item["itunes:explicit"]);
  const channelExplicit = parseExplicit(channel["itunes:explicit"]);
  const explicit = itemExplicit === true || channelExplicit === true
    ? true
    : itemExplicit ?? channelExplicit;
  const episodeAuthor = item["itunes:author"] || channel["itunes:author"]
    || extractRfc2822Name(item.author) || undefined;
  const authorEmail = extractEmail(item.author)
    || channel["itunes:owner"]?.["itunes:email"]
    || extractEmail(channel.managingEditor)
    || undefined;
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

  return { guid, podcastTitle, episodeTitle, description, audioUrl, linkUrl, postLinkUrl: feed.postLinkUrl, feedUrl: feed.url, podcastTagline, podcastDescription, pubDate, durationSecs, episodeNumber, seasonNumber, explicit, episodeAuthor, authorEmail, transcriptUrl, episodeSubtitle, keywords, episodeType, people, chaptersUrl, fundingLinks, seasonName, episodeDisplay, soundbites };
}

async function fetchRssEpisodes(feed: FeedConfig, limit: number): Promise<EpisodeData[]> {
  const response = await fetch(feed.url, {
    headers: {
      "X-Fetch-Reason": "Fetching RSS feed to list episodes for posting",
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
  if (!channel) return [];

  const rawItems = channel.item ?? channel.entry;
  if (!rawItems) return [];
  const items: RssItem[] = Array.isArray(rawItems) ? rawItems : [rawItems];

  const episodes: EpisodeData[] = [];
  for (const it of items) {
    const ep = parseRssItem(it, channel, feed);
    if (ep) episodes.push(ep);
  }

  // Most RSS feeds publish newest-first; sort defensively in case they don't.
  episodes.sort((a, b) => {
    const aTs = a.pubDate ? Date.parse(a.pubDate) : 0;
    const bTs = b.pubDate ? Date.parse(b.pubDate) : 0;
    return bTs - aTs;
  });

  return episodes.slice(0, limit);
}

async function fetchLatestEpisode(feed: FeedConfig): Promise<EpisodeData | null> {
  if (extractSpreakerShowId(feed.url)) {
    return fetchSpreakerEpisode(feed);
  }
  if (extractAudioboomChannelId(feed.url)) {
    return fetchAudioboomEpisode(feed);
  }
  const eps = await fetchRssEpisodes(feed, 1);
  return eps[0] ?? null;
}

// ---------------------------------------------------------------------------
// Episode picker — list episodes for the moderator selector and resolve a
// single episode by its GUID for posting.
// ---------------------------------------------------------------------------

type EpisodePickItem = { guid: string; title: string; pubDate?: string };

const DEFAULT_EPISODE_HISTORY_LIMIT = 50;

async function getEpisodeHistoryLimit(): Promise<number> {
  const raw = await settings.get<number>("feedHistoryLimit");
  const n = typeof raw === "number" && raw > 0 ? Math.round(raw) : DEFAULT_EPISODE_HISTORY_LIMIT;
  return Math.max(1, n);
}

async function fetchEpisodePickList(feed: FeedConfig, limit: number): Promise<EpisodePickItem[]> {
  if (extractSpreakerShowId(feed.url)) {
    return fetchSpreakerPickList(feed, limit);
  }
  if (extractAudioboomChannelId(feed.url)) {
    const eps = await fetchAudioboomEpisodes(feed, limit);
    return eps.map(e => ({ guid: e.guid, title: e.episodeTitle, pubDate: e.pubDate }));
  }
  const eps = await fetchRssEpisodes(feed, limit);
  return eps.map(e => ({ guid: e.guid, title: e.episodeTitle, pubDate: e.pubDate }));
}

async function fetchEpisodeByGuid(feed: FeedConfig, guid: string, limit: number): Promise<EpisodeData | null> {
  if (extractSpreakerShowId(feed.url)) {
    return fetchSpreakerEpisodeByGuid(feed, guid);
  }
  if (extractAudioboomChannelId(feed.url)) {
    const eps = await fetchAudioboomEpisodes(feed, limit);
    return eps.find(e => e.guid === guid) ?? null;
  }
  const eps = await fetchRssEpisodes(feed, limit);
  return eps.find(e => e.guid === guid) ?? null;
}

function feedUrlHash(url: string): string {
  return createHash("sha1").update(url).digest("hex").slice(0, 12);
}

function findFeedByHash(feeds: FeedConfig[], hash: string): FeedConfig | undefined {
  return feeds.find(f => feedUrlHash(f.url) === hash);
}

function truncateLabel(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

function formatEpisodeOptionLabel(item: EpisodePickItem): string {
  const datePrefix = item.pubDate ? `${item.pubDate.slice(0, 10)} — ` : "";
  return truncateLabel(`${datePrefix}${item.title}`, 100);
}

async function showEpisodePicker(feed: FeedConfig, limit: number): Promise<UiResponse> {
  let items: EpisodePickItem[];
  try {
    items = await fetchEpisodePickList(feed, limit);
  } catch (e) {
    console.error(`Failed to load episode list for feed ${feed.index}:`, e);
    return { showToast: { text: "Couldn't load episodes from that feed.", appearance: "neutral" } };
  }

  if (items.length === 0) {
    return { showToast: { text: "No episodes found in that feed.", appearance: "neutral" } };
  }

  const hash = feedUrlHash(feed.url);

  return {
    showForm: {
      name: "selectEpisodeForm",
      form: {
        title: "Pick an episode to post",
        fields: [
          {
            type: "select",
            name: "episodePick",
            label: "Choose an episode (newest first)",
            required: true,
            options: items.map(it => ({
              label: formatEpisodeOptionLabel(it),
              value: `${hash}|${it.guid}`,
            })),
          },
        ],
      },
    },
  };
}

async function fetchFeedTitle(feed: FeedConfig): Promise<string> {
  if (feed.nameOverride) return feed.nameOverride;

  try {
    const showId = extractSpreakerShowId(feed.url);
    if (showId) {
      const meta = await fetchSpreakerShowMeta(showId);
      return meta?.title ?? `Feed ${feed.index}`;
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

  const [flairIdRaw, flairTextRaw, includePodcastName, shouldSticky, includeEpisodeNumber] = await Promise.all([
    settings.get<string>("postFlairId"),
    settings.get<string>("postFlairText"),
    settings.get<boolean>("includePodcastNameInTitle"),
    settings.get<boolean>("stickyPost"),
    settings.get<boolean>("includeEpisodeNumberInTitle"),
  ]);

  const epLabel = episode.episodeDisplay
    ?? (episode.episodeNumber != null ? String(episode.episodeNumber) : null);
  const epPrefix = includeEpisodeNumber && epLabel ? `Ep. ${epLabel} - ` : "";

  const title = includePodcastName !== false
    ? `${episode.podcastTitle} - ${epPrefix}${episode.episodeTitle}`
    : `${epPrefix}${episode.episodeTitle}`;

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

const SYSTEM_STACK = `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`;
const FONT_FAMILY_BY_KEY: Record<string, string> = {
  reddit: `-apple-system, BlinkMacSystemFont, "Segoe UI", "IBM Plex Sans", Roboto, "Helvetica Neue", Arial, sans-serif`,
  figtree: `"Figtree", ${SYSTEM_STACK}`,
  inter: `"Inter", ${SYSTEM_STACK}`,
  "ibm-plex-sans": `"IBM Plex Sans", ${SYSTEM_STACK}`,
  merriweather: `"Merriweather", Georgia, "Times New Roman", serif`,
  atkinson: `"Atkinson Hyperlegible", ${SYSTEM_STACK}`,
  system: SYSTEM_STACK,
};

/** Client `GET /api/post-data` → returns EpisodeData + current display settings for the current post. */
async function onGetPostData(): Promise<PostDataResponse> {
  const postId = context.postId;
  if (!postId) return { error: "not_found" };

  const [stored, buttonColor, buttonPosition, webViewFont] = await Promise.all([
    redis.get(postDataKey(postId)),
    settings.get<string>("listenButtonColor"),
    settings.get<string>("listenButtonPosition"),
    settings.get<string>("webViewFont"),
  ]);

  if (!stored) return { error: "not_found" };

  // Devvit select settings may return an array (e.g. ["top"]) or a string.
  const resolvedPosition = Array.isArray(buttonPosition)
    ? (buttonPosition as string[])[0]
    : buttonPosition;
  const resolvedFont = Array.isArray(webViewFont) ? (webViewFont as string[])[0] : webViewFont;

  const display: DisplaySettings = {
    accentColor: buttonColor || undefined,
    listenButtonPosition: (resolvedPosition as "top" | "bottom" | undefined) ?? "bottom",
    fontFamily: FONT_FAMILY_BY_KEY[resolvedFont ?? "reddit"] ?? FONT_FAMILY_BY_KEY["reddit"],
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

/**
 * Subreddit menu → "Post an episode"
 * With 1 feed: opens the episode picker directly.
 * With 2+ feeds: shows a feed selector first, which then opens the episode picker.
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

  const limit = await getEpisodeHistoryLimit();

  if (feeds.length === 1) {
    return showEpisodePicker(feeds[0]!, limit);
  }

  const feedLabels = await Promise.all(feeds.map(fetchFeedTitle));

  return {
    showForm: {
      name: "selectFeedForm",
      form: {
        title: "Pick a feed",
        fields: [
          {
            type: "select",
            name: "feedIndex",
            label: "Choose a feed",
            required: true,
            options: feeds.map((f, i) => ({
              label: feedLabels[i] ?? f.url,
              value: String(f.index),
            })),
          },
        ],
      },
    },
  };
}

/**
 * Form submit → opens the episode picker for the selected feed.
 */
async function onFormSelectFeedSubmit(req: IncomingMessage): Promise<UiResponse> {
  const { feedIndex } = await readBody<{ feedIndex: string[] }>(req);
  const selected = feedIndex?.[0];
  const allFeeds = await getFeeds();

  if (!selected || allFeeds.length === 0) {
    return { showToast: { text: "No feeds configured.", appearance: "neutral" } };
  }

  const feed = allFeeds.find(f => String(f.index) === selected);
  if (!feed) {
    return { showToast: { text: "Selected feed not found.", appearance: "neutral" } };
  }

  const limit = await getEpisodeHistoryLimit();
  return showEpisodePicker(feed, limit);
}

/** Form submit → posts the chosen individual episode. */
async function onFormSelectEpisodeSubmit(req: IncomingMessage): Promise<UiResponse> {
  const { episodePick } = await readBody<{ episodePick: string[] }>(req);
  const raw = episodePick?.[0];
  if (!raw) {
    return { showToast: { text: "No episode selected.", appearance: "neutral" } };
  }

  const sep = raw.indexOf("|");
  if (sep < 0) {
    return { showToast: { text: "Invalid episode selection.", appearance: "neutral" } };
  }
  const hash = raw.slice(0, sep);
  const guid = raw.slice(sep + 1);

  const feeds = await getFeeds();
  const feed = findFeedByHash(feeds, hash);
  if (!feed) {
    return { showToast: { text: "Feed no longer exists.", appearance: "neutral" } };
  }

  try {
    const limit = await getEpisodeHistoryLimit();
    const episode = await fetchEpisodeByGuid(feed, guid, limit);
    if (!episode) {
      return { showToast: { text: "Episode not found in feed.", appearance: "neutral" } };
    }
    const postUrl = await createEpisodePost(episode);
    await redis.set(feedRedisKey(feed), episode.guid);
    return {
      showToast: { text: `Posted: ${episode.episodeTitle}`, appearance: "success" },
      navigateTo: postUrl,
    };
  } catch (e) {
    console.error(`Failed to post selected episode (feed ${feed.index}):`, e);
    const msg = e instanceof Error ? e.message : String(e);
    const reason = msg.includes("is not allowed") ? "domain not allowlisted" : "unknown error";
    return { showToast: { text: `Error posting episode: ${reason}`, appearance: "neutral" } };
  }
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

/** Scheduler cron (every 15 min) → posts any new episodes found across all feeds. */
async function onCheckRSS(): Promise<TaskResponse> {
  const isEnabled = await settings.get<boolean>("appEnabled");
  if (isEnabled === false) {
    console.log("Podcast poster is disabled in settings.");
    return { status: "ok" };
  }

  const feeds = await getFeeds();
  if (feeds.length === 0) return { status: "ok" };

  await Promise.all(feeds.map(checkOneFeed));
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
