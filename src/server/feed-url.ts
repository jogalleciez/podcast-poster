// Normalizes RSS feed URLs pasted into the `feedUrls` setting.
//
// Some hosts serve the same RSS content from multiple domains, but only one of
// them is on the Devvit HTTP allowlist (`devvit.json` -> permissions.http.domains,
// capped at 25 entries). Rewriting known aliases here is cheaper than spending
// an allowlist slot per variant, and a non-allowlisted host fails at fetch time
// with no user-visible warning on the cron path.
//
// Steps, in order:
//   1. Scheme: add `https://` when missing, and upgrade `http://` to `https://`
//      (Devvit fetch only allows https).
//   2. Podtrac: unwrap `rss.pdrl.fm/{trackingId}/{real feed URL}`. Podtrac 302s
//      to the wrapped URL, and the wrapped host is usually already allowlisted.
//   3. Host aliases (path and query are identical between the aliases):
//        • Omny Studio: omnycontent.com / www.omnycontent.com → traffic.omny.fm
//        • Buzzsprout:  feeds.buzzsprout.com                  → rss.buzzsprout.com
//          (feeds. now 301s to rss., so rss. is the host that actually serves)

type HostAlias = {
  /** Alias host as pasted, without any leading `www.` (matched case-insensitively). */
  from: string;
  /** Allowlisted host to rewrite to. */
  to: string;
};

const HOST_ALIASES: HostAlias[] = [
  { from: "omnycontent.com", to: "traffic.omny.fm" },
  { from: "feeds.buzzsprout.com", to: "rss.buzzsprout.com" },
];

/** `https://rss.pdrl.fm/{id}/{wrapped}` where `{wrapped}` is non-empty. */
const PODTRAC_WRAPPER = /^https:\/\/rss\.pdrl\.fm\/[^/]+\/(.+)$/i;

function withHttps(url: string): string {
  if (/^https:\/\//i.test(url)) return url;
  if (/^http:\/\//i.test(url)) return url.replace(/^http:\/\//i, "https://");
  return `https://${url}`;
}

/**
 * Upgrades the scheme to https, unwraps Podtrac `rss.pdrl.fm` tracking URLs,
 * and rewrites known alias hosts to their allowlisted equivalent, preserving
 * the path and query. URLs that match nothing are returned with only the
 * scheme fixed.
 */
export function normalizeRssUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return trimmed;

  let normalized = withHttps(trimmed);

  const podtrac = PODTRAC_WRAPPER.exec(normalized);
  if (podtrac?.[1]) {
    normalized = withHttps(podtrac[1]);
  }

  for (const { from, to } of HOST_ALIASES) {
    const pattern = new RegExp(
      `^(https://)(?:www\\.)?${from.replace(/\./g, "\\.")}(/|$)`,
      "i",
    );
    if (pattern.test(normalized)) {
      return normalized.replace(pattern, `$1${to}$2`);
    }
  }

  return normalized;
}
