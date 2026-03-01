export type InitResponse = {
  type: "init";
  postId: string;
  username: string;
  audioUrl?: string;
  imageUrl?: string;
  episodeTitle?: string;
  podcastTitle?: string;
};



export type CheckRSSRequest = {};

export type CheckRSSResponse = {};

export const ApiEndpoint = {
  Init: "/api/init",
  OnPostCreate: "/internal/menu/post-create",
  OnAppInstall: "/internal/on-app-install",
  CheckRSS: "/internal/cron/check-rss",
  EpisodeFormSubmit: "/internal/forms/episode-submit",
} as const;

export type ApiEndpoint = (typeof ApiEndpoint)[keyof typeof ApiEndpoint];
