import { useEffect, useState, type ReactElement, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { context, getWebViewMode, navigateTo, requestExpandedMode } from "@devvit/web/client";
import {
  ApiEndpoint,
  formatDuration,
  type ClientErrorReport,
  type DisplaySettings,
  type EpisodeData,
  type PostDataResponse,
} from "../shared/api.ts";

function reportClientError(r: Partial<ClientErrorReport> & { message: string }): void {
  try {
    fetch(ApiEndpoint.LogClientError, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...r, userAgent: navigator.userAgent }),
      keepalive: true,
    }).catch(() => {});
  } catch {}
}


function formatSoundbiteTime(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function safeUrl(url: string): string {
  return url.startsWith("http://") ? "https://" + url.slice(7) : url;
}

function navigateToNewTab(url: string, mobileFallbackUrl?: string): void {
  const safe = safeUrl(url);
  try {
    if (context.client != null) {
      try {
        navigateTo(safe);
      } catch {
        if (mobileFallbackUrl) navigateTo(safeUrl(mobileFallbackUrl));
      }
      return;
    }
    const win = window.open(safe, "_blank", "noopener,noreferrer");
    if (!win) navigateTo(safe);
  } catch (err) {
    reportClientError({
      context: "navigateToNewTab",
      message: String((err as Error)?.message ?? err),
      stack: (err as Error)?.stack,
      source: safe,
    });
  }
}

function LinkButton({ href, mobileFallbackHref, className, style, children }: {
  href: string;
  mobileFallbackHref?: string;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}): ReactElement {
  const safe = safeUrl(href);
  const isMailto = href.startsWith("mailto:");
  if (isMobile) {
    if (isMailto) {
      return <span className={className} style={style}>{children}</span>;
    }
    return (
      <button className={className} style={style} onClick={() => navigateToNewTab(href, mobileFallbackHref)}>
        {children}
      </button>
    );
  }
  if (isMailto) {
    return (
      <a
        href={safe}
        className={className}
        style={style}
        onClick={(e: ReactMouseEvent) => {
          e.preventDefault();
          try { navigateTo(safe); } catch {}
        }}
      >
        {children}
      </a>
    );
  }
  return (
    <a
      href={safe}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      style={style}
      onClick={(e: ReactMouseEvent) => {
        e.preventDefault();
        navigateToNewTab(href, mobileFallbackHref);
      }}
    >
      {children}
    </a>
  );
}

function CopyableEmail({ email }: { email: string }): ReactElement {
  const [copied, setCopied] = useState(false);
  function handleCopy(): void {
    navigator.clipboard.writeText(email).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  }
  return (
    <>
      <span className="author-email" onClick={handleCopy}>{email}</span>
      <button className="copy-btn" onClick={handleCopy} aria-label={copied ? "Email copied" : "Copy email"}>
        <span aria-hidden="true">{copied ? "✅" : "📋"}</span>
        <span>{copied ? "Copied" : "Copy"}</span>
      </button>
    </>
  );
}

type FetchState =
  | { kind: "loading" }
  | { kind: "ready"; episode: EpisodeData; display: DisplaySettings }
  | { kind: "missing" }
  | { kind: "error"; message: string };

const BOT_REQUEST_SUBJECT = encodeURIComponent("Thought this might be handy");
const BOT_REQUEST_MESSAGE = encodeURIComponent(
  "Hey mods!\n\n" +
    "One of my favorite things about podcast subreddits is having a place to discuss the latest episodes and dig into the details. " +
    "I came across a free Devvit app called Pod Poster that automatically creates a post whenever a new episode drops — " +
    "it can help create discussion posts automatically and offload moderator or individual posting responsibilities.\n\n" +
    "Check it out here: https://developers.reddit.com/apps/podcast-poster\n\n" +
    "Please consider adding it!",
);
const BOT_REQUEST_URL = `https://www.reddit.com/message/compose?to=r/&subject=${BOT_REQUEST_SUBJECT}&message=${BOT_REQUEST_MESSAGE}`;
const APP_URL = "https://developers.reddit.com/apps/podcast-poster";

const isMobile = context.client != null;
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);

const CACHE_KEY = "pp_post_data:" + window.location.href;

function readCache(): Extract<FetchState, { kind: "ready" }> | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as PostDataResponse;
    if ("error" in data || !("episode" in data)) return null;
    return { kind: "ready", episode: data.episode, display: data.display };
  } catch {
    return null;
  }
}

function writeCache(data: PostDataResponse): void {
  try {
    if (!("error" in data)) localStorage.setItem(CACHE_KEY, JSON.stringify(data));
  } catch {}
}

export function App(): ReactElement {
  const [state, setState] = useState<FetchState>(() => readCache() ?? { kind: "loading" });
  const [activeTab, setActiveTab] = useState<"episode" | "show" | "details">("episode");
  const [webViewMode, setWebViewMode] = useState(getWebViewMode);
  const [hasOverflow, setHasOverflow] = useState(false);

  useEffect(() => {
    const root = document.getElementById("root");
    if (!root) return;
    const measure = (): void => {
      setHasOverflow(root.scrollHeight > root.clientHeight + 4);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    Array.from(root.children).forEach(c => ro.observe(c));
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [state.kind, activeTab]);

  const handleExpand = (e: ReactMouseEvent): void => {
    try {
      requestExpandedMode(e.nativeEvent, isMobile ? "mobile" : "desktop");
    } catch (err) {
      reportClientError({
        context: "expand-button",
        message: String((err as Error)?.message ?? err),
        stack: (err as Error)?.stack,
      });
      setWebViewMode(getWebViewMode());
    }
  };

  // Devvit fires "focus" on the window when returning from expanded → inline.
  useEffect(() => {
    const onFocus = () => setWebViewMode(getWebViewMode());
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  useEffect(() => {
    if (state.kind !== "ready") return;
    const root = document.documentElement;
    const { accentColor, fontFamily } = state.display;
    if (accentColor) {
      root.style.setProperty("--pp-link", accentColor);
      root.style.setProperty("--pp-button-bg", accentColor);
    }
    if (fontFamily) {
      root.style.setProperty("--pp-font-family", fontFamily);
    }
  }, [state]);

  useEffect(() => {
    const onError = (e: ErrorEvent) => reportClientError({
      context: "onerror",
      message: e.message,
      source: e.filename,
      lineno: e.lineno,
      colno: e.colno,
      stack: e.error?.stack,
    });
    const onRejection = (e: PromiseRejectionEvent) => {
      const reason = e.reason as { message?: string; stack?: string } | undefined;
      reportClientError({
        context: "unhandledrejection",
        message: String(reason?.message ?? e.reason),
        stack: reason?.stack,
      });
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch(ApiEndpoint.PostData);
        if (resp.status === 404) {
          if (!cancelled) setState({ kind: "missing" });
          return;
        }
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = (await resp.json()) as PostDataResponse;
        if (cancelled) return;
        if ("error" in data) setState({ kind: "missing" });
        else {
          writeCache(data);
          setState({ kind: "ready", episode: data.episode, display: data.display });
        }
      } catch (e) {
        if (cancelled) return;
        const message = e instanceof Error ? e.message : String(e);
        setState({ kind: "error", message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.kind === "loading") {
    return <div className="status">Loading episode…</div>;
  }
  if (state.kind === "missing") {
    return <div className="status">Episode data unavailable.</div>;
  }
  if (state.kind === "error") {
    return <div className="status">Couldn't load episode: {state.message}</div>;
  }

  const { episode, display } = state;
  const markdownComponents: Components = {
    a: ({ href, children }: { href?: string; children?: ReactNode }) => {
      if (!href || (!href.startsWith("http://") && !href.startsWith("https://"))) {
        return <>{children}</>;
      }
      return (
        <LinkButton className="footer-link" href={href}>
          {children}
        </LinkButton>
      );
    },
  };

  const listenUrl = episode.postLinkUrl || episode.linkUrl || episode.audioUrl;
  const atTop = display.listenButtonPosition === "top";

  // On iOS, try the podcast:// scheme to open the user's default podcast app.
  // Android does not handle this scheme and shows ERR_UNKNOWN_URL_SCHEME instead.
  // Strip http(s):// and prepend podcast:// — the iOS-standard format for feed deep links.
  // Falls back to listenUrl if feedUrl is absent (old posts) or the scheme is rejected.
  const podcastSchemeUrl = episode.feedUrl
    ? "podcast://" + episode.feedUrl.replace(/^https?:\/\//, "")
    : null;

  const listenButton = listenUrl ? (
    <LinkButton
      className="listen-button"
      style={{ textDecoration: "none" }}
      href={isIOS && podcastSchemeUrl ? podcastSchemeUrl : listenUrl}
      mobileFallbackHref={isIOS && podcastSchemeUrl ? listenUrl : undefined}
    >
      Listen to this episode
    </LinkButton>
  ) : null;

  return (
    <article className="episode">
      {webViewMode === "inline" && (
        <button
          className="expand-button"
          onClick={handleExpand}
          title="Expand post"
          aria-label="Expand post"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 2h4v4M6 14H2v-4M14 2L9.5 6.5M2 14l4.5-4.5" />
          </svg>
        </button>
      )}
      <header className="episode-header">
        <p className="podcast-name">{episode.podcastTitle}</p>
        {episode.podcastTagline && (
          <p className="tagline">{episode.podcastTagline}</p>
        )}
        <h1 className="episode-title">{episode.episodeTitle}</h1>
      </header>
      {(() => {
        const showShowTab = !!episode.podcastDescription;
        const current = showShowTab ? activeTab : activeTab === "show" ? "episode" : activeTab;
        const body =
          current === "show" ? episode.podcastDescription : episode.description;
        return (
          <div className="tabs-container">
            <div className="tab-bar" role="tablist">
              <button
                className="tab-button"
                role="tab"
                aria-selected={current === "episode"}
                onClick={() => setActiveTab("episode")}
              >
                Episode
              </button>
              {showShowTab && (
                <button
                  className="tab-button"
                  role="tab"
                  aria-selected={current === "show"}
                  onClick={() => setActiveTab("show")}
                >
                  Show
                </button>
              )}
              <button
                className="tab-button"
                role="tab"
                aria-selected={current === "details"}
                onClick={() => setActiveTab("details")}
              >
                Details
              </button>
            </div>
            {atTop && listenButton}
            <div className="tab-panel" role="tabpanel">
              {current === "details" ? (
                <dl className="details-list">
                  {episode.pubDate && (<>
                    <dt>Published</dt>
                    <dd>{new Date(episode.pubDate).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}</dd>
                  </>)}
                  {episode.durationSecs != null && (<>
                    <dt>Duration</dt>
                    <dd>{formatDuration(episode.durationSecs)}</dd>
                  </>)}
                  {episode.seasonNumber != null && (<>
                    <dt>Season</dt>
                    <dd>{episode.seasonName ? `${episode.seasonNumber} — ${episode.seasonName}` : String(episode.seasonNumber)}</dd>
                  </>)}
                  {(episode.episodeDisplay != null || episode.episodeNumber != null) && (<>
                    <dt>Episode</dt>
                    <dd>{episode.episodeDisplay ?? episode.episodeNumber}</dd>
                  </>)}
                  {episode.explicit != null && (<>
                    <dt>Explicit</dt>
                    <dd>{episode.explicit ? "🤬" : "😇"}</dd>
                  </>)}
                  {episode.episodeAuthor && (<>
                    <dt>Author</dt>
                    <dd>{episode.episodeAuthor}</dd>
                  </>)}
                  {episode.authorEmail && (<>
                    <dt>Email</dt>
                    <dd><CopyableEmail email={episode.authorEmail} /></dd>
                  </>)}
                  {episode.people && episode.people.length > 0 && (<>
                    <dt>People</dt>
                    <dd>{episode.people.map((p, i) => (
                      <span key={i}>
                        {i > 0 && ", "}
                        {p.href
                          ? <LinkButton className="footer-link" href={p.href!}>{p.name}</LinkButton>
                          : p.name}
                        {p.role && ` (${p.role})`}
                      </span>
                    ))}</dd>
                  </>)}
                  {episode.transcriptUrl && (<>
                    <dt>Transcript</dt>
                    <dd><LinkButton className="footer-link" href={episode.transcriptUrl!}>Transcript</LinkButton></dd>
                  </>)}
                  {episode.chaptersUrl && (<>
                    <dt>Chapters</dt>
                    <dd><LinkButton className="footer-link" href={episode.chaptersUrl!}>View chapters</LinkButton></dd>
                  </>)}
                  {episode.episodeType && episode.episodeType !== "full" && (<>
                    <dt>Type</dt>
                    <dd style={{ textTransform: "capitalize" }}>{episode.episodeType}</dd>
                  </>)}
                  {episode.keywords && episode.keywords.length > 0 && (<>
                    <dt>Keywords</dt>
                    <dd>{episode.keywords.join(", ")}</dd>
                  </>)}
                </dl>
              ) : (
                <>
                  {current === "episode" && episode.episodeSubtitle && (
                    <p className="episode-subtitle">{episode.episodeSubtitle}</p>
                  )}
                  <Markdown components={markdownComponents} remarkPlugins={[remarkGfm]}>{body}</Markdown>
                  {current === "episode" && episode.soundbites && episode.soundbites.length > 0 && (
                    <div className="soundbites">
                      <h2 className="soundbites-heading">Key Moments</h2>
                      <ul className="soundbites-list">
                        {episode.soundbites.map((sb, i) => (
                          <li key={i}>
                            <span className="soundbite-time">{formatSoundbiteTime(sb.startTimeSecs)}</span>
                            {sb.title && <span className="soundbite-title"> — {sb.title}</span>}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {current === "episode" && episode.fundingLinks && episode.fundingLinks.length > 0 && (
                    <div className="funding">
                      {episode.fundingLinks.map((f, i) => (
                        <LinkButton key={i} className="footer-link" href={f.url}>
                          {f.label}
                        </LinkButton>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        );
      })()}
      {!atTop && listenButton}
      <p className="footer">
        This is a bot that posts new episodes automatically.{" "}
        <LinkButton className="footer-link" href={APP_URL}>
          Add this to your subreddit
        </LinkButton>{" "}
        or{" "}
        <LinkButton className="footer-link" href={BOT_REQUEST_URL}>
          request mods use it
        </LinkButton>
        .
      </p>
      {isMobile && webViewMode === "inline" && hasOverflow && (
        <div className="overflow-fade" aria-hidden="true" />
      )}
      {isMobile && webViewMode === "inline" && hasOverflow && (
        <button
          className="expand-hint"
          onClick={handleExpand}
          aria-label="Expand post for full content"
        >
          <span className="expand-hint-icon">
            <svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 2h4v4M6 14H2v-4M14 2L9.5 6.5M2 14l4.5-4.5" />
            </svg>
          </span>
        </button>
      )}
    </article>
  );
}
