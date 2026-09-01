// ─────────────────────────────────────────────
//  endpoints.ts
//  Single source of truth for all API endpoints.
//  Import this wherever you need a URL — never
//  hardcode paths directly in tests or API classes.
// ─────────────────────────────────────────────

export const apiEndPoints = {
    health: {
        check: '/notes/api',
    },

    users: {
        login:          '/notes/api/users/login',
        logout:         '/notes/api/users/logout',
        register:       '/notes/api/users/register',
        profile:        '/notes/api/users/profile',
        changePassword: '/notes/api/users/change-password',
        deleteAccount:  '/notes/api/users/delete-account',
    },
    
    notes: {
        all:                '/notes/api/notes',
        byId: (id: string) => '/notes/api/notes/${id}',
    },
} as const

export type APIEndPoints = typeof apiEndPoints;

export const uiEndPoints = {
    login: '/login',
} as const

export type UIEndPoints = typeof uiEndPoints;