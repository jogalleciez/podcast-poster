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

function navigateToNewTab(url: string, mobileFallbackUrl?: string): void {
  const safeUrl = url.startsWith("http://") ? "https://" + url.slice(7) : url;
  try {
    if (context.client != null) {
      // Mobile native app: window.open is blocked. Use Devvit's navigateTo.
      // podcast:// and other custom schemes may be rejected — fall back to web URL.
      try {
        navigateTo(safeUrl);
      } catch {
        if (mobileFallbackUrl) {
          const safeFallback = mobileFallbackUrl.startsWith("http://")
            ? "https://" + mobileFallbackUrl.slice(7)
            : mobileFallbackUrl;
          navigateTo(safeFallback);
        }
      }
      return;
    }
    const win = window.open(safeUrl, "_blank", "noopener,noreferrer");
    if (!win) navigateTo(safeUrl);
  } catch (err) {
    reportClientError({
      context: "navigateToNewTab",
      message: String((err as Error)?.message ?? err),
      stack: (err as Error)?.stack,
      source: safeUrl,
    });
  }
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

export function App(): ReactElement {
  const [state, setState] = useState<FetchState>({ kind: "loading" });
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
        else setState({ kind: "ready", episode: data.episode, display: data.display });
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
        <button className="footer-link" onClick={() => navigateToNewTab(href)}>
          {children}
        </button>
      );
    },
  };

  const listenUrl = episode.postLinkUrl || episode.linkUrl || episode.audioUrl;
  const buttonStyle: CSSProperties | undefined = display.listenButtonColor
    ? { background: display.listenButtonColor }
    : undefined;
  const atTop = display.listenButtonPosition === "top";

  // On iOS, try the podcast:// scheme to open the user's default podcast app.
  // Android does not handle this scheme and shows ERR_UNKNOWN_URL_SCHEME instead.
  // Strip http(s):// and prepend podcast:// — the iOS-standard format for feed deep links.
  // Falls back to listenUrl if feedUrl is absent (old posts) or the scheme is rejected.
  const podcastSchemeUrl = episode.feedUrl
    ? "podcast://" + episode.feedUrl.replace(/^https?:\/\//, "")
    : null;

  const listenButton = listenUrl ? (
    <button
      className="listen-button"
      style={buttonStyle}
      onClick={() =>
        navigateToNewTab(
          isIOS && podcastSchemeUrl ? podcastSchemeUrl : listenUrl,
          isIOS && podcastSchemeUrl ? listenUrl : undefined,
        )
      }
    >
      Listen to this episode
    </button>
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
          ⛶
        </button>
      )}
      {atTop && listenButton}
      <p className="podcast-name">{episode.podcastTitle}</p>
      {episode.podcastTagline && (
        <p className="tagline">{episode.podcastTagline}</p>
      )}
      <h1 className="episode-title">{episode.episodeTitle}</h1>
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
                  {episode.people && episode.people.length > 0 && (<>
                    <dt>People</dt>
                    <dd>{episode.people.map((p, i) => (
                      <span key={i}>
                        {i > 0 && ", "}
                        {p.href
                          ? <button className="footer-link" onClick={() => navigateToNewTab(p.href!)}>{p.name}</button>
                          : p.name}
                        {p.role && ` (${p.role})`}
                      </span>
                    ))}</dd>
                  </>)}
                  {episode.transcriptUrl && (<>
                    <dt>Transcript</dt>
                    <dd><button className="footer-link" onClick={() => navigateToNewTab(episode.transcriptUrl!)}>Transcript</button></dd>
                  </>)}
                  {episode.chaptersUrl && (<>
                    <dt>Chapters</dt>
                    <dd><button className="footer-link" onClick={() => navigateToNewTab(episode.chaptersUrl!)}>View chapters</button></dd>
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
                        <button key={i} className="footer-link" onClick={() => navigateToNewTab(f.url)}>
                          {f.label}
                        </button>
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
        <button className="footer-link" onClick={() => navigateToNewTab(APP_URL)}>
          Add this to your subreddit
        </button>{" "}
        or{" "}
        <button className="footer-link" onClick={() => navigateToNewTab(BOT_REQUEST_URL)}>
          request mods use it
        </button>
        .
      </p>
      {isMobile && webViewMode === "inline" && hasOverflow && (
        <button
          className="expand-hint"
          onClick={handleExpand}
          aria-label="Expand post for full content"
        >
          <span className="expand-hint-text">Tap to expand for full content</span>
        </button>
      )}
    </article>
  );
}
