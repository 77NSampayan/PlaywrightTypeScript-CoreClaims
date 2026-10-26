// ─────────────────────────────────────────────
//  totp.util.ts
//  Generates the same 6-digit TOTP code an
//  authenticator app would show, from the secret
//  captured once when registering it as a sign-in
//  method (Azure AD "Can't scan image?" screen).
// ─────────────────────────────────────────────

import { TOTP } from 'otpauth';

const PERIOD_SECONDS = 30;

/** Milliseconds until the current TOTP code rolls over to the next one. */
export function msUntilNextTotpPeriod(): number {
    const periodMs = PERIOD_SECONDS * 1000;
    return periodMs - (Date.now() % periodMs);
}

export function generateTOTP(secret: string, label?: string): string {
    const totp = new TOTP({
        issuer: 'Microsoft',
        label,
        secret,
        algorithm: 'SHA1',
        digits: 6,
        period: PERIOD_SECONDS,
    });

    return totp.generate();
}
