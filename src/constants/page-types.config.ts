// ─────────────────────────────────────────────
//  PageTypes.ts
//  Parameter types extracted directly from
//  Playwright's Page API for navigation methods.
//
//  These stay in sync automatically with whatever
//  version of Playwright is installed — no manual
//  maintenance needed.
// ─────────────────────────────────────────────

import { expect, type Page } from '@playwright/test';

type LocatorMatchers = ReturnType<typeof expect<Page>>;

// ─── page.goto() ──────────────────────────────
// Navigates to a URL.
// Parameters: url (string), options (index 1)
// Options: referer, signal, timeout, waitUntil
export type GotoOptions = Parameters<Page['goto']>[1];

// ─── page.reload() ────────────────────────────
// Reloads the current page.
// Options: signal, timeout, waitUntil
export type ReloadOptions = Parameters<Page['reload']>[0];

// ─── page.goBack() ────────────────────────────
// Navigates to the previous page in history.
// Options: signal, timeout, waitUntil
export type GoBackOptions = Parameters<Page['goBack']>[0];

// ─── page.goForward() ─────────────────────────
// Navigates to the next page in history.
// Options: signal, timeout, waitUntil
export type GoForwardOptions = Parameters<Page['goForward']>[0];

// ─── page.waitForLoadState() ──────────────────
// Waits until a specific load state is reached.
// Parameters: state (index 0), options (index 1)
// State: 'load' | 'domcontentloaded' | 'networkidle'
// Options: signal, timeout
export type LoadState         = Parameters<Page['waitForLoadState']>[0];
export type WaitForLoadOptions = Parameters<Page['waitForLoadState']>[1];

// ─── page.waitForURL() ────────────────────────
// Waits until the page navigates to a given URL.
// Parameters: url (index 0), options (index 1)
// Options: signal, timeout, waitUntil
export type WaitForURLPattern = Parameters<Page['waitForURL']>[0];
export type WaitForURLOptions = Parameters<Page['waitForURL']>[1]

// ─── page.close() ─────────────────────────────
// Closes the page.
// Options: reason, runBeforeUnload
export type PageCloseOptions = Parameters<Page['close']>[0];

// ─── expect(page) assertions ─────────────────────────────
// Options types for LocatorAssertions matchers — index 0 for
// options-only matchers, index 1 for matchers that take an
// `expected` value before their options.
export type ToHaveURLPattern = Parameters<LocatorMatchers['toHaveURL']>[0];
export type ToHaveURLOptions = Parameters<LocatorMatchers['toHaveURL']>[1];
export type ToHaveTitleOptions = Parameters<LocatorMatchers['toHaveTitle']>[1];