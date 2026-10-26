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
    // Absolute URL — Outlook on the web, used by tests/test.auth.spec.ts as a
    // stand-in Microsoft SSO app to prove a saved session skips the OTP.
    outlookMail: 'https://outlook.office.com/mail/',
    // Absolute URL — Microsoft's sign-in origin, where its SSO session
    // cookies live (used to check a saved session actually carries one).
    microsoftLogin: 'https://login.microsoftonline.com',
} as const

export type UIEndPoints = typeof uiEndPoints;
