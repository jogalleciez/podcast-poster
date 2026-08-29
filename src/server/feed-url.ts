// Normalizes RSS feed URLs pasted into the `feedUrls` setting.
//
// Some hosts serve the same RSS content from multiple domains, but only one of
// them is on the Devvit HTTP allowlist (`devvit.json` -> permissions.http.domains,
// capped at 25 entries). Rewriting known aliases here is cheaper than spending
// an allowlist slot per variant, and a non-allowlisted host fails at fetch time
// with no user-visible warning on the cron path.
//   • Omny Studio: omnycontent.com / www.omnycontent.com → traffic.omny.fm
//   • Buzzsprout:  rss.buzzsprout.com                    → feeds.buzzsprout.com
// In every case the path and query are identical between the aliases.

type HostAlias = {
  /** Alias host as pasted, without any leading `www.` (matched case-insensitively). */
  from: string;
  /** Allowlisted host to rewrite to. */
  to: string;
};

const HOST_ALIASES: HostAlias[] = [
  { from: "omnycontent.com", to: "traffic.omny.fm" },
  { from: "rss.buzzsprout.com", to: "feeds.buzzsprout.com" },
];

/**
 * Rewrites known alias hosts to their allowlisted equivalent, preserving the
 * scheme, path and query. Adds `https://` when the URL was pasted without a
 * scheme. URLs that match no alias are returned unchanged.
 */
export function normalizeRssUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return trimmed;

  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  for (const { from, to } of HOST_ALIASES) {
    const pattern = new RegExp(
      `^(https?://)(?:www\.)?${from.replace(/\./g, "\.")}(/|$)`,
      "i",
    );
    if (pattern.test(withScheme)) {
      return withScheme.replace(pattern, `$1${to}$2`);
    }
  }

  return withScheme;
}
