# src/base

The foundation every page object is built on. Page objects should never call raw Playwright `Locator`/`Page`/`expect` APIs directly — they call through the wrappers here instead, which gives every interaction structured console logging and a matching step in the Playwright HTML report/trace viewer for free.

## Files

### `base.page.ts` — `BasePage`

Abstract class every page object extends. Owns the `Page` instance and instantiates one `ElementActions`, `ElementAssertions`, and `GenericAssertions` per page object (available as `this.elements`, `this.elementAssert`, `this.assert`).

Scoped to **page/browser-level** concerns only — navigation and page-level assertions, not element interaction:

| Method | Purpose |
|---|---|
| `navigate(url?, options?)` | Goes to `url` (defaults to `uiEndPoints.login`) and waits for `domcontentloaded` |
| `getTitle()` | Returns `page.title()` |
| `reload(options?)` | Reloads and waits for `domcontentloaded` |
| `goBack(options?)` / `goForward(options?)` | Browser history navigation |
| `close(options?)` | Closes the page |
| `waitForLoadState(state?, options?)` | Waits for a load state (`load` / `domcontentloaded` / `networkidle`) |
| `waitForURL(url, options?)` | Waits for the page URL to match a pattern |
| `toHaveURL(url, options?)` | Asserts `expect(page).toHaveURL(...)` |
| `toHaveTitle(title, options?)` | Asserts `expect(page).toHaveTitle(...)` |

**Usage** — extend it, declare locators in the constructor, expose `Actions`/`Assertions` methods:

```ts
import type { Page, Locator } from "@playwright/test";
import { BasePage } from "@base/base.page.ts";

export class MyPage extends BasePage {
    protected readonly submitButton: Locator;

    constructor(page: Page) {
        super(page);
        this.submitButton = this.page.locator('#submit');
    }

    // ─── Actions ──────────────────────────────
    async submit(): Promise<void> {
        await this.elements.click(this.submitButton, 'submit button');
    }

    // ─── Assertions ───────────────────────────
    async expectSubmitVisible(): Promise<void> {
        await this.elementAssert.toBeVisible(this.submitButton, 'submit button');
    }
}
```

### `ElementActions.util.ts` — `ElementActions`

Wraps `Locator` interaction methods, each logged via `logger.action(...)`:

- `click(locator, description, options?)`
- `fill(locator, value, description, options?)` — pass `{ mask: true }` in `options` for any sensitive **or identifying** field and the logged value becomes `********`. Masking covers the `test.step()` name too, so it keeps the value out of the HTML report and trace, not just the console. A `/password|secret|token|creditcard/i` description sniff remains as a backstop only: masking is a call-site decision because no honest name for an identity field (`'email field'`, `'member number'`) matches a keyword list
- `check(locator, description, options?)` / `uncheck(locator, description, options?)`
- `selectOption(locator, values, description, options?)`
- `getText(locator, description, options?)` — returns the element's text content
- `waitForVisible(locator, description, options?)` / `waitForHidden(locator, description, options?)`

Accessed via `this.elements` on any `BasePage` subclass — never instantiate directly.

### `ElementAssertions.util.ts` — `ElementAssertions`

Wraps locator-level `expect(...)` matchers, each logged via `logger.action(...)`:

- `toBeVisible(locator, description, options?)` / `toBeHidden(locator, description, options?)`
- `toHaveText(locator, expected, description, options?)` — exact match
- `toContainText(locator, expected, description, options?)` — substring match
- `toBeEnabled(locator, description, options?)`
- `toBeChecked(locator, description, options?)`

Accessed via `this.elementAssert` on any `BasePage` subclass.

### `GenericAssertions.util.ts` — `GenericAssertions`

Wraps plain-value `expect(...)` matchers (no `Locator` involved) for comparing data returned from a page — e.g. the result of `elements.getText(...)`. Logged at `LogLevel.DEBUG`, so they only print when `LOG_LEVEL=DEBUG`:

- `toEqual(actual, expected, description)`
- `toContain(collection, item, description)`
- `toBeTruthy(value, description)`
- `toBeGreaterThan(actual, expected, description)`

Accessed via `this.assert` on any `BasePage` subclass.

## Conventions

- Every action/assertion call takes a human-readable `description` string (e.g. `'sign in button'`) — it drives the log output (`Clicking element "sign in button"`, `Asserting element "sign in button" is VISIBLE`) and the step name in the HTML report/trace viewer. Write descriptions so that sentence reads naturally.
- Option types (`ClickOptions`, `FillOptions`, `ToBeVisibleOptions`, etc.) come from [`@constants/locator-types.config.ts`](../constants/locator-types.config.ts) and [`@constants/page-types.config.ts`](../constants/page-types.config.ts), derived via `Parameters<...>` directly from the installed Playwright API — when wrapping a new Playwright method, add its option type there the same way rather than hand-writing an interface.
- All three util classes take a `SmartLogger` in their constructor and are wired up automatically by `BasePage` — page objects never construct them.
