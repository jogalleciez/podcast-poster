export type CheckRSSRequest = {};

export const ApiEndpoint = {
  OnPostCreate: "/internal/menu/post-create",
  EditPostBodyMenu: "/internal/menu/edit-post-body",
  EditPostBodySubmit: "/internal/form/edit-post-body-submit",
  SelectFeedSubmit: "/internal/form/select-feed-submit",
  OpenSettings: "/internal/menu/open-settings",
  OnAppInstall: "/internal/on-app-install",
  CheckRSS: "/internal/cron/check-rss",
  PostData: "/api/post-data",
  LogClientError: "/api/log-client-error",
  ListClientErrors: "/api/client-errors",
  ViewClientErrorsMenu: "/internal/menu/view-client-errors",
  ViewClientErrorsSubmit: "/internal/form/view-client-errors-submit",
} as const;

export type ApiEndpoint = (typeof ApiEndpoint)[keyof typeof ApiEndpoint];

export type Person = { name: string; role?: string; href?: string };
export type FundingLink = { label: string; url: string };
export type Soundbite = { title?: string; startTimeSecs: number; durationSecs: number };

/**
 * Episode payload rendered by the React client. Persisted server-side under
 * the Redis key `post_data:{postId}` at post creation, served by
 * `GET /api/post-data`, and updated by the "Edit post body" moderator form.
 */
export type EpisodeData = {
  guid: string;
  podcastTitle: string;
  episodeTitle: string;
  description: string;
  audioUrl: string;
  linkUrl: string;
  postLinkUrl?: string;
  podcastArtworkUrl?: string;
  podcastTagline?: string;
  podcastDescription?: string;
  // Details tab metadata
  pubDate?: string;
  durationSecs?: number;
  episodeNumber?: number;
  seasonNumber?: number;
  explicit?: boolean;
  episodeAuthor?: string;
  transcriptUrl?: string;
  // Additional description fields
  episodeSubtitle?: string;
  keywords?: string[];
  episodeType?: "full" | "trailer" | "bonus";
  // Podcasting 2.0 namespace enrichments
  people?: Person[];
  chaptersUrl?: string;
  fundingLinks?: FundingLink[];
  seasonName?: string;
  episodeDisplay?: string;
  soundbites?: Soundbite[];
};

export type DisplaySettings = {
  listenButtonColor?: string;
  listenButtonPosition?: "top" | "bottom";
};

export type ClientErrorReport = {
  message: string;
  source?: string;
  lineno?: number;
  colno?: number;
  stack?: string;
  userAgent?: string;
  context?: string;
};

export type PostDataResponse =
  | { episode: EpisodeData; display: DisplaySettings }
  | { error: "not_found" };
