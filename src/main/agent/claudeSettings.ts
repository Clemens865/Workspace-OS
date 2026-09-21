/** Per-launch settings outrank a user's settings.json env block. Keep this
 * override local to Workspace OS; never rewrite the user's Claude settings. */
export function claudeSettings(disableAllHooks = true): string {
  return JSON.stringify({
    ...(disableAllHooks ? { disableAllHooks: true } : {}),
    env: { CLAUDE_CODE_MAX_OUTPUT_TOKENS: '32000' },
  })
}
