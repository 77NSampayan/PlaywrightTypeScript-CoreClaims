// ─────────────────────────────────────────────
//  endpoint.config.ts
//  Single source of truth for UI route paths.
//  Import this wherever you need a URL — never
//  hardcode paths directly in tests or page objects.
// ─────────────────────────────────────────────

export const uiEndPoints = {
    login: '/login',
    landing: '/',
    // Absolute URL, not relative to baseURL — a different origin entirely
    // (Azure Portal, not the Core Claims app). Deep link straight to the
    // "Shared access signature" blade for the mpinew storage account, so
    // automation never has to click through Storage accounts → mpinew →
    // Security + networking → Shared access signature.
    azureStorageSas: 'https://portal.azure.com/#@medicardphils.com/resource/subscriptions/55e4144e-b310-4f7a-b583-542f534cbc98/resourceGroups/mc-prod-storage-rg/providers/Microsoft.Storage/storageAccounts/mpinew/sas',
} as const

export type UIEndPoints = typeof uiEndPoints;
