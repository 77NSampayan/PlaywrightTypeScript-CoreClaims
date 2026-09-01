// ─────────────────────────────────────────────
//  LocatorTypes.ts
//  Parameter types extracted directly from
//  Playwright's Locator API for element
//  interaction methods.
//
//  These stay in sync automatically with whatever
//  version of Playwright is installed — no manual
//  maintenance needed.
// ─────────────────────────────────────────────

import { expect, type Locator } from '@playwright/test';

// Playwright doesn't export its assertion-matcher interface (e.g. `LocatorAssertions`)
// by name, so it's derived indirectly through `expect`'s own call signature instead.
type LocatorMatchers = ReturnType<typeof expect<Locator>>;

// ─── locator.click() ──────────────────────────
// Clicks the element.
// Options: button, clickCount, delay, force, modifiers, position, timeout, trial, signal
export type ClickOptions = Parameters<Locator['click']>[0];

// ─── locator.fill() ───────────────────────────
// Fills the element with the given value.
// Parameters: value (index 0), options (index 1)
// Options: force, timeout, signal, noWaitAfter
export type FillOptions = Parameters<Locator['fill']>[1];

// ─── locator.check() ──────────────────────────
// Checks a checkbox/radio element.
// Options: force, position, timeout, trial, signal, noWaitAfter
export type CheckOptions = Parameters<Locator['check']>[0];

// ─── locator.uncheck() ────────────────────────
// Unchecks a checkbox element.
// Options: force, position, timeout, trial, signal, noWaitAfter
export type UncheckOptions = Parameters<Locator['uncheck']>[0];

// ─── locator.selectOption() ───────────────────
// Selects one or more options in a <select> element.
// Parameters: values (index 0), options (index 1)
// Values: string | string[] | ElementHandle | option-descriptor(s)
export type SelectOptionValues  = Parameters<Locator['selectOption']>[0];
export type SelectOptionOptions = Parameters<Locator['selectOption']>[1];

// ─── locator.waitFor() ────────────────────────
// Waits until the element reaches a given state.
// Used by waitForVisible/waitForHidden, which fix `state`
// themselves — only the remaining options (e.g. timeout) are exposed.
export type WaitForOptions = Parameters<Locator['waitFor']>[0];

export type GetTextOptions = Parameters<Locator['textContent']>[0];


// ─── expect(locator) assertions ───────────────
// Options types for LocatorAssertions matchers — index 0 for
// options-only matchers, index 1 for matchers that take an
// `expected` value before their options.
export type ToBeVisibleOptions   = Parameters<LocatorMatchers['toBeVisible']>[0];
export type ToBeHiddenOptions    = Parameters<LocatorMatchers['toBeHidden']>[0];
export type ToBeEnabledOptions   = Parameters<LocatorMatchers['toBeEnabled']>[0];
export type ToBeCheckedOptions   = Parameters<LocatorMatchers['toBeChecked']>[0];
export type ToHaveTextOptions    = Parameters<LocatorMatchers['toHaveText']>[1];
export type ToContainTextOptions = Parameters<LocatorMatchers['toContainText']>[1];