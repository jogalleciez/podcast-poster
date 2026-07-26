// Decides what the RSS-check cron should do on a given run, based on whether the
// app is enabled and whether it was already enabled on the previous run.
//
// The problem this solves: a feed with no stored last-posted GUID is treated as
// having a brand-new latest episode, so it gets posted. When the app is first
// installed (appEnabled defaults to true) or a moderator toggles it off→on, the
// first cron run would otherwise post the latest episode of *every* configured
// feed — a surprise backlog dump. Instead, the transition into the enabled state
// "seeds" each feed's baseline GUID without posting, so only episodes published
// afterward are posted.

/** What the cron should do this run. */
export type CronAction =
  | "disabled" // App is off — do nothing.
  | "seed" // First enabled run — record current latest GUIDs, post nothing.
  | "post"; // Steady state — post any genuinely new episodes.

/**
 * @param isEnabled       Current value of the `appEnabled` setting.
 * @param prevEnabledState The persisted enabled-state from the previous run
 *   (`"true"`/`"false"`, or `null` when never recorded, e.g. first run).
 */
export function decideCronAction(
  isEnabled: boolean,
  prevEnabledState: string | null,
): CronAction {
  if (!isEnabled) return "disabled";
  // Enabled now, but not known-enabled last run → we just transitioned on
  // (or this is the very first run). Seed baselines instead of dumping backlog.
  if (prevEnabledState !== "true") return "seed";
  return "post";
}
