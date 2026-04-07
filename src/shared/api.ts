export type CheckRSSRequest = {};
export type CheckRSSResponse = {};

export const ApiEndpoint = {
  OnPostCreate: "/internal/menu/post-create",
  OnAppInstall: "/internal/on-app-install",
  CheckRSS: "/internal/cron/check-rss",
} as const;

export type ApiEndpoint = (typeof ApiEndpoint)[keyof typeof ApiEndpoint];
