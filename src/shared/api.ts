export type CheckRSSRequest = {};
export type CheckRSSResponse = {};

export const ApiEndpoint = {
  Init: "/api/init",
  OnPostCreate: "/internal/menu/post-create",
  OnAppInstall: "/internal/on-app-install",
  CheckRSS: "/internal/cron/check-rss",
} as const;

export type ApiEndpoint = (typeof ApiEndpoint)[keyof typeof ApiEndpoint];

export type InitResponse = {
  type: "init";
  episodeTitle: string;
  podcastTitle: string;
  description: string;
  audioUrl: string;
  imageUrl: string;
  postLinkUrl?: string;
};
