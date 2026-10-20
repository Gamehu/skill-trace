// Folders to read are in settings.ts (detected, then overridable from the Settings page).

export const PORT = Number(process.env.PORT ?? 4317)

// A run with no new transcript lines for this long and no closing reply is shown as interrupted.
export const RUNNING_GRACE_MS = 2 * 60_000
