export type CheckRSSRequest = {};

export const ApiEndpoint = {
  OnPostCreate: "/internal/menu/post-create",
  EditPostBodyMenu: "/internal/menu/edit-post-body",
  EditPostBodySubmit: "/internal/form/edit-post-body-submit",
  SelectFeedSubmit: "/internal/form/select-feed-submit",
  OpenSettings: "/internal/menu/open-settings",
  OnAppInstall: "/internal/on-app-install",
  CheckRSS: "/internal/cron/check-rss",
} as const;

export type ApiEndpoint = (typeof ApiEndpoint)[keyof typeof ApiEndpoint];
