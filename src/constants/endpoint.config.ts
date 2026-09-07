// ─────────────────────────────────────────────
//  endpoint.config.ts
//  Single source of truth for UI route paths.
//  Import this wherever you need a URL — never
//  hardcode paths directly in tests or page objects.
// ─────────────────────────────────────────────

export const uiEndPoints = {
    login: '/login',
} as const

export type UIEndPoints = typeof uiEndPoints;
