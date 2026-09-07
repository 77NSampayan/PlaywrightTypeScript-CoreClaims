# src/constants

## `page-types.config.ts` & `locator-types.config.ts`

These two files are the **only** place option types for wrapped Playwright methods should be declared. If you're adding a new method to `BasePage`, `ElementActions`, or `ElementAssertions` that forwards `options` to a Playwright `Page`/`Locator`/`expect(...)` call, get the option type from here — never hand-write an options interface.

### Why

Every type in these files is derived with `Parameters<T>[n]` directly from the Playwright API that's actually installed (`@playwright/test`), instead of being retyped by hand:

```ts
export type ClickOptions = Parameters<Locator['click']>[0];
```

That means:
- The type always matches the real method signature — no risk of it drifting out of sync with what `locator.click()` actually accepts.
- Bumping the `@playwright/test` version updates these types automatically; a hand-written interface would need to be manually kept in sync (or silently go stale).
- Assertion option types, which Playwright doesn't export by name (e.g. `LocatorAssertions`), are recovered indirectly through `expect`'s own call signature:

  ```ts
  type LocatorMatchers = ReturnType<typeof expect<Locator>>;
  export type ToBeVisibleOptions = Parameters<LocatorMatchers['toBeVisible']>[0];
  ```

### What's in each file

**`page-types.config.ts`** — types for `Page`-level methods, consumed by `BasePage` ([`../base/README.md`](../base/README.md)):

`GotoOptions`, `ReloadOptions`, `GoBackOptions`, `GoForwardOptions`, `LoadState`, `WaitForLoadOptions`, `WaitForURLPattern`, `WaitForURLOptions`, `PageCloseOptions`, `ToHaveURLPattern`, `ToHaveURLOptions`, `ToHaveTitleOptions`

**`locator-types.config.ts`** — types for `Locator`-level methods, consumed by `ElementActions` and `ElementAssertions`:

`ClickOptions`, `FillOptions`, `FillActionOptions`, `CheckOptions`, `UncheckOptions`, `SelectOptionValues`, `SelectOptionOptions`, `WaitForOptions`, `GetTextOptions`, `ToBeVisibleOptions`, `ToBeHiddenOptions`, `ToBeEnabledOptions`, `ToBeCheckedOptions`, `ToHaveTextOptions`, `ToContainTextOptions`

### The one deliberate extension

`FillActionOptions` is `NonNullable<FillOptions> & { mask?: boolean }` — Playwright's real fill options plus one framework flag that forces the logged value to be masked.

This is the sanctioned exception to "never hand-write an option shape", and the boundary is worth stating: **the Playwright half stays derived, and only a genuinely framework-owned concern is added on top.** `mask` qualifies because Playwright has no opinion about what we log. Anything Playwright *does* accept must still come from `Parameters<...>`, so a version bump keeps updating it for you.

If you extend another wrapper this way, intersect with `NonNullable<...>` as above — a bare `FillOptions` includes `undefined`, and intersecting that with an object type collapses in ways that are easy to misread.

### How to add a new wrapped method

Say you're adding `hover()` to `ElementActions`. Instead of writing the option type inline or hand-rolling an interface:

1. **Add the derived type** to `locator-types.config.ts` (or `page-types.config.ts` for a `Page` method), next to the other `Locator`-level types, following the existing comment-banner style:

   ```ts
   // ─── locator.hover() ───────────────────────────
   // Hovers over the element.
   // Options: force, modifiers, position, timeout, trial, noWaitAfter, signal
   export type HoverOptions = Parameters<Locator['hover']>[0];
   ```

2. **Import and use it** in the wrapper method:

   ```ts
   import type { HoverOptions } from '@constants/locator-types.config.ts';

   async hover(locator: Locator, description: string, options?: HoverOptions): Promise<void> {
       await this.logger.action(
           `Hovering over element "${description}"`,
           () => locator.hover(options),
           `Hovered over element "${description}"`,
           `Failed to hover over element "${description}"`
       );
   }
   ```

For a matcher without an `expected` argument (like `toBeVisible`), the options type is index `[0]`. For a matcher that takes an expected value first (like `toHaveText`), the options type is index `[1]` — mirror whichever existing type is closest to what you're adding.

### Don't

- Don't write `options?: { timeout?: number; force?: boolean }` (or any other hand-rolled shape) inline in a wrapper method — derive it here instead.
- Don't import `Locator['click']`-style `Parameters<...>` expressions directly inside a page object or util class — keep the derivation centralized in these two files so every option type has one definition.

## `endpoint.config.ts`

Single source of truth for UI route paths (`uiEndPoints`). Not part of the type-derivation pattern above — see the main [project README](../../README.md) and [`../fixtures/README.md`](../fixtures/README.md) for how it's consumed. Add new routes here rather than hardcoding paths in a page object or test.

`BasePage.navigate()` defaults to `uiEndPoints.login`, so any new route added here is immediately usable as a `navigate()` argument.
