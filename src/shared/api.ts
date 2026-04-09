export type CheckRSSRequest = {};
export type CheckRSSResponse = {};

export const ApiEndpoint = {
  OnPostCreate: "/internal/menu/post-create",
  EditPostBodyMenu: "/internal/menu/edit-post-body",
  EditPostBodySubmit: "/internal/form/edit-post-body-submit",
  SelectFeedSubmit: "/internal/form/select-feed-submit",
  OnAppInstall: "/internal/on-app-install",
  CheckRSS: "/internal/cron/check-rss",
} as const;

export type ApiEndpoint = (typeof ApiEndpoint)[keyof typeof ApiEndpoint];
