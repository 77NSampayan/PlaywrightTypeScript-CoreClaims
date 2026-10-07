// ─────────────────────────────────────────────
//  BasePage.ts
//  SmartLogger is integrated at this level.
//  All child pages get structured logging for
//  free — no logger calls needed in tests or
//  in child page methods.
// ─────────────────────────────────────────────

import { type Page, type Response, type Request, expect } from '@playwright/test';
import type { SmartLogger } from '@utils/logger/SmartLogger.util.ts';
import { logger } from '@utils/logger/SmartLogger.util.ts';
import { ElementActions } from './ElementActions.util.ts';
import { ElementAssertions } from './ElementAssertions.util.ts';
import { GenericAssertions } from './GenericAssertions.util.ts';
import type {
    GotoOptions,
    ReloadOptions,
    GoBackOptions,
    GoForwardOptions,
    LoadState,
    WaitForLoadOptions,
    WaitForURLPattern,
    WaitForURLOptions,
    PageCloseOptions,
    ToHaveTitleOptions,
    ToHaveURLOptions,
    ToHaveURLPattern,
    ViewportSize,
    WaitForResponseUrl,
    WaitForResponseOptions,
    WaitForRequestUrl,
    WaitForRequestOptions,
} from '@constants/page-types.config.ts'
import { uiEndPoints } from '@constants/endpoint.config.ts';

/**
 * Abstract foundation every page object extends.
 *
 * `BasePage` owns the Playwright {@link Page} and wraps **page/browser-level**
 * actions (navigation, waits, page-level assertions) so each call is logged via
 * `SmartLogger` and shows up as a step in the HTML report / trace viewer — page
 * objects and tests never call raw Playwright `Page`/`expect` APIs directly.
 *
 * Element-level work lives in the util classes composed here:
 * - {@link ElementActions} → `this.elements` (click, fill, getText, …)
 * - {@link ElementAssertions} → `this.elementAssert` (toBeVisible, toHaveText, …)
 * - {@link GenericAssertions} → `this.assert` (toEqual, toContain, …)
 *
 * @example Extending BasePage in a page object
 * ```ts
 * import type { Page, Locator } from '@playwright/test';
 * import { BasePage } from '@base/base.page.ts';
 *
 * export class LoginPage extends BasePage {
 *     private readonly signInButton: Locator;
 *
 *     constructor(page: Page) {
 *         super(page);
 *         this.signInButton = this.page.locator('#sign-in');
 *     }
 *
 *     // ─── Actions ──────────────────────────────
 *     async open(): Promise<void> {
 *         await this.navigate();            // inherited from BasePage
 *         await this.elements.click(this.signInButton, 'sign in button');
 *     }
 * }
 * ```
 */
export abstract class BasePage {

    // Shared Playwright instance available to all subclasses

    protected readonly page: Page;
    protected readonly logger: SmartLogger;

    // Element interactions and assertions live in their own classes —
    // BasePage stays scoped to page/browser-level actions only.
    protected readonly elements: ElementActions;
    protected readonly elementAssert: ElementAssertions;
    protected readonly assert: GenericAssertions;

    constructor(page: Page) {
        this.page = page;
        this.logger = logger;
        this.elements = new ElementActions(logger);
        this.elementAssert = new ElementAssertions(logger);
        this.assert = new GenericAssertions(logger);
    }

    // protected async step<T>(stepName: string, fn: () => Promise<T>): Promise<T> {
    //     return this.logger.step(stepName, fn);
    // }

    // ─── Browser Interaction ─────────────────────────

    /**
     * Navigates to `url` and waits for the `domcontentloaded` state.
     *
     * @param url - Path or absolute URL to open. Defaults to `uiEndPoints.login`;
     *              relative paths resolve against `baseURL` from `playwright.config.ts`.
     * @param options - Playwright `page.goto()` options (`waitUntil`, `timeout`, `referer`).
     * @returns Resolves once the DOM content has loaded.
     *
     * @example Open the default login page
     * ```ts
     * await loginPage.navigate();
     * ```
     * @example Open a specific route
     * ```ts
     * await dashboardPage.navigate(uiEndPoints.dashboard);
     * ```
     */
    async navigate(url: string = uiEndPoints.login, options?: GotoOptions): Promise<void> {
        await this.logger.action(
            `Navigating to ${url}`, async () => {
                await this.page.goto(url, options);
                await this.page.waitForLoadState('domcontentloaded');
            },
            () => `Page loaded. Current URL: ${this.page.url()}`,
            `Failed to load ${url}`
        );
    };

    /**
     * Returns the current page title (`<title>` text).
     *
     * @returns The page title string.
     *
     * @example
     * ```ts
     * const title = await loginPage.getTitle();
     * expect(title).toContain('Amplify Health');
     * ```
     */
    async getTitle(): Promise<string> {
        return this.logger.action(
            'Getting page title',
            () => this.page.title(),
            (title) => `Page title: ${title}`,
            'Failed to get page title'
        );
    }

    /**
     * Reloads the current page and waits for the `domcontentloaded` state.
     *
     * @param options - Playwright `page.reload()` options (`waitUntil`, `timeout`).
     * @returns Resolves once the reloaded DOM content has loaded.
     *
     * @example
     * ```ts
     * await dashboardPage.reload();
     * ```
     */
    async reload(options?: ReloadOptions): Promise<void> {
        await this.logger.action(
            'Reloading page',
            async () => {
                await this.page.reload(options);
                await this.page.waitForLoadState('domcontentloaded');
            },
            () => `Page reloaded. Current URL: ${this.page.url()}`,
            'Failed to reload page'
        );
    }

    /**
     * Navigates to the previous entry in the browser history (back button).
     *
     * @param options - Playwright `page.goBack()` options (`waitUntil`, `timeout`).
     * @returns Resolves after navigating; no-op if there is no previous entry.
     *
     * @example
     * ```ts
     * await dashboardPage.goBack();
     * ```
     */
    async goBack(options?: GoBackOptions): Promise<void> {
        await this.logger.action(
            'Navigating back',
            () => this.page.goBack(options),
            (response) => `Navigated back${response ? '' : ' (no previous history entry)'}. Current URL: ${this.page.url()}`,
            'Failed to navigate back'
        );
    }

    /**
     * Navigates to the next entry in the browser history (forward button).
     *
     * @param options - Playwright `page.goForward()` options (`waitUntil`, `timeout`).
     * @returns Resolves after navigating; no-op if there is no forward entry.
     *
     * @example
     * ```ts
     * await dashboardPage.goForward();
     * ```
     */
    async goForward(options?: GoForwardOptions): Promise<void> {
        await this.logger.action(
            'Navigating forward',
            () => this.page.goForward(options),
            (response) => `Navigated forward${response ? '' : ' (no forward history entry)'}. Current URL: ${this.page.url()}`,
            'Failed to navigate forward'
        );
    }

    /**
     * Closes the current page/tab.
     *
     * @param options - Playwright `page.close()` options (`runBeforeUnload`, `reason`).
     * @returns Resolves once the page is closed.
     *
     * @example
     * ```ts
     * await popupPage.close();
     * ```
     */
    async close(options?: PageCloseOptions): Promise<void> {
        await this.logger.action(
            'Closing page',
            () => this.page.close(options),
            () => `Page closed. Last URL: ${this.page.url()}`,
            'Failed to close page'
        );
    }

    /**
     * Brings this page/tab to the front and gives it focus. Useful when working
     * with multiple tabs and you need this one to be the active window.
     *
     * @returns Resolves once the page is activated.
     *
     * @example
     * ```ts
     * await reportPage.bringToFront();
     * ```
     */
    async bringToFront(): Promise<void> {
        await this.logger.action(
            'Bringing page to front',
            () => this.page.bringToFront(),
            'Page brought to front',
            'Failed to bring page to front'
        );
    }

    /**
     * Sets the viewport (window content area) to an exact size — handy for
     * responsive-layout checks. Note the chromium project runs with
     * `viewport: null` (full window), so calling this pins a fixed size.
     *
     * @param size - Target viewport as `{ width, height }` in pixels.
     * @returns Resolves once the viewport is resized.
     *
     * @example Emulate a mobile-width viewport
     * ```ts
     * await dashboardPage.setViewportSize({ width: 375, height: 812 });
     * ```
     */
    async setViewportSize(size: ViewportSize): Promise<void> {
        await this.logger.action(
            `Setting viewport size to ${size.width}x${size.height}`,
            () => this.page.setViewportSize(size),
            `Viewport size set to ${size.width}x${size.height}`,
            `Failed to set viewport size to ${size.width}x${size.height}`
        );
    }

    // ─── Page State ────────────────────────────────

    /**
     * Returns the page's current URL.
     *
     * @returns The current URL string.
     *
     * @example
     * ```ts
     * const url = await dashboardPage.getUrl();
     * expect(url).toContain('/dashboard');
     * ```
     */
    async getUrl(): Promise<string> {
        return this.logger.action(
            'Getting current URL',
            () => this.page.url(),
            (url) => `Current URL: ${url}`,
            'Failed to get current URL'
        );
    }

    /**
     * Returns the full HTML markup of the page. Only the content length is
     * logged (never the body), so the report stays clean and no sensitive
     * markup is published.
     *
     * @returns The serialized page HTML.
     *
     * @example
     * ```ts
     * const html = await dashboardPage.getContent();
     * expect(html).toContain('Welcome back');
     * ```
     */
    async getContent(): Promise<string> {
        return this.logger.action(
            'Getting page content',
            () => this.page.content(),
            (html) => `Retrieved page content (${html.length} chars)`,
            'Failed to get page content'
        );
    }

    /**
     * Reports whether this page has been closed.
     *
     * @returns `true` if the page is closed, otherwise `false`.
     *
     * @example
     * ```ts
     * if (!(await popupPage.isClosed())) {
     *     await popupPage.close();
     * }
     * ```
     */
    async isClosed(): Promise<boolean> {
        return this.logger.action(
            'Checking if page is closed',
            () => this.page.isClosed(),
            (closed) => `Page is ${closed ? 'CLOSED' : 'OPEN'}`,
            'Failed to determine if page is closed'
        );
    }

    /**
     * Returns the current viewport size, or `null` when the page uses the full
     * window (as the chromium project does with `viewport: null`).
     *
     * @returns `{ width, height }` in pixels, or `null` if no fixed viewport is set.
     *
     * @example
     * ```ts
     * const size = await dashboardPage.getViewportSize();
     * if (size) expect(size.width).toBeGreaterThan(1024);
     * ```
     */
    async getViewportSize(): Promise<ViewportSize | null> {
        return this.logger.action(
            'Getting viewport size',
            () => this.page.viewportSize(),
            (size) => size ? `Viewport: ${size.width}x${size.height}` : 'Viewport: null (full window)',
            'Failed to get viewport size'
        );
    }

    // ─── Configuration ────────────────────────────────

    /**
     * Sets the default timeout (in ms) for all subsequent actions and waits on
     * this page (e.g. clicks, `waitForURL`). Overrides the config-level timeout
     * for this page instance only.
     *
     * @param timeout - Timeout in milliseconds.
     * @returns Resolves once the default is applied.
     *
     * @example Give a slow page more time
     * ```ts
     * await reportPage.setDefaultTimeout(60_000);
     * ```
     */
    async setDefaultTimeout(timeout: number): Promise<void> {
        await this.logger.action(
            `Setting default timeout to ${timeout}ms`,
            () => this.page.setDefaultTimeout(timeout),
            `Default timeout set to ${timeout}ms`,
            `Failed to set default timeout to ${timeout}ms`
        );
    }

    /**
     * Sets the default timeout (in ms) specifically for navigation actions
     * (`navigate`, `reload`, `goBack`, `goForward`, `waitForURL`).
     *
     * @param timeout - Navigation timeout in milliseconds.
     * @returns Resolves once the default is applied.
     *
     * @example
     * ```ts
     * await dashboardPage.setDefaultNavigationTimeout(45_000);
     * ```
     */
    async setDefaultNavigationTimeout(timeout: number): Promise<void> {
        await this.logger.action(
            `Setting default navigation timeout to ${timeout}ms`,
            () => this.page.setDefaultNavigationTimeout(timeout),
            `Default navigation timeout set to ${timeout}ms`,
            `Failed to set default navigation timeout to ${timeout}ms`
        );
    }

    // ─── Waits ────────────────────────────────

    /**
     * Waits until the page reaches a given load state.
     *
     * @param state - `'load'` | `'domcontentloaded'` | `'networkidle'`. Defaults to `'load'`.
     * @param options - Playwright `waitForLoadState()` options (`timeout`).
     * @returns Resolves once the state is reached.
     *
     * @example Wait for the network to settle
     * ```ts
     * await dashboardPage.waitForLoadState('networkidle');
     * ```
     */
    async waitForLoadState(state?: LoadState, options?: WaitForLoadOptions): Promise<void> {
        await this.logger.action(
            `Waiting for load state: ${state ?? 'load'}`,
            () => this.page.waitForLoadState(state, options),
            `Load state reached: ${state ?? 'load'}`,
            `Load state not reached: ${state ?? 'load'}`
        );
    }

    /**
     * Waits until the page URL matches the given string, glob, or RegExp.
     *
     * @param url - URL pattern to match (string, glob, or `RegExp`).
     * @param options - Playwright `waitForURL()` options (`waitUntil`, `timeout`).
     * @returns Resolves once the URL matches.
     *
     * @example Wait for the post-login redirect
     * ```ts
     * await loginPage.waitForURL(/.*\/dashboard/);
     * ```
     */
    async waitForURL(url: WaitForURLPattern, options?: WaitForURLOptions): Promise<void> {
        await this.logger.action(
            `Waiting for URL: ${url}`,
            () => this.page.waitForURL(url, options),
            () => `URL matched. Current URL: ${this.page.url()}`,
            `URL did not match: ${url}`
        );
    }

    /**
     * Hard-waits for a fixed duration.
     *
     * ⚠️ Prefer web-first waits ({@link waitForURL}, {@link waitForLoadState}, or
     * element assertions) over this — a fixed sleep is flaky and slows the suite.
     * Use only as a last resort (e.g. debounced UI with no observable signal).
     *
     * @param timeout - Duration to wait, in milliseconds.
     * @returns Resolves after the delay.
     *
     * @example
     * ```ts
     * await dashboardPage.waitForTimeout(500); // wait out a 500ms debounce
     * ```
     */
    async waitForTimeout(timeout: number): Promise<void> {
        await this.logger.action(
            `Waiting for ${timeout}ms`,
            () => this.page.waitForTimeout(timeout),
            `Waited ${timeout}ms`,
            `Failed while waiting ${timeout}ms`
        );
    }

    /**
     * Waits for an HTTP response matching a URL pattern or predicate, and
     * returns it. Trigger the action that causes the response *inside* the same
     * `await` (e.g. via `Promise.all`) to avoid a race.
     *
     * @param urlOrPredicate - URL string/glob/RegExp, or `(response) => boolean`.
     * @param options - Playwright `waitForResponse()` options (`timeout`).
     * @returns The matching Playwright {@link Response}.
     *
     * @example Wait for an API call while clicking
     * ```ts
     * const [response] = await Promise.all([
     *     dashboardPage.waitForResponse('**\/api/claims'),
     *     dashboardPage.elements.click(searchButton, 'search button'),
     * ]);
     * expect(response.status()).toBe(200);
     * ```
     */
    async waitForResponse(urlOrPredicate: WaitForResponseUrl, options?: WaitForResponseOptions): Promise<Response> {
        const target = typeof urlOrPredicate === 'function' ? '[predicate]' : String(urlOrPredicate);
        return this.logger.action(
            `Waiting for response: ${target}`,
            () => this.page.waitForResponse(urlOrPredicate, options),
            (response) => `Response received: ${response.status()} ${response.url()}`,
            `No matching response for: ${target}`
        );
    }

    /**
     * Waits for an HTTP request matching a URL pattern or predicate, and
     * returns it. As with {@link waitForResponse}, start the waiter before (or
     * alongside) the action that fires the request.
     *
     * @param urlOrPredicate - URL string/glob/RegExp, or `(request) => boolean`.
     * @param options - Playwright `waitForRequest()` options (`timeout`).
     * @returns The matching Playwright {@link Request}.
     *
     * @example
     * ```ts
     * const [request] = await Promise.all([
     *     dashboardPage.waitForRequest('**\/api/claims'),
     *     dashboardPage.elements.click(searchButton, 'search button'),
     * ]);
     * expect(request.method()).toBe('GET');
     * ```
     */
    async waitForRequest(urlOrPredicate: WaitForRequestUrl, options?: WaitForRequestOptions): Promise<Request> {
        const target = typeof urlOrPredicate === 'function' ? '[predicate]' : String(urlOrPredicate);
        return this.logger.action(
            `Waiting for request: ${target}`,
            () => this.page.waitForRequest(urlOrPredicate, options),
            (request) => `Request sent: ${request.method()} ${request.url()}`,
            `No matching request for: ${target}`
        );
    }

    // ─── Assertions ────────────────────────────────

    /**
     * Asserts the page URL matches the expected value (auto-retries until it
     * matches or times out). Fails the test if it never matches.
     *
     * @param url - Expected URL (string, glob, or `RegExp`).
     * @param options - Playwright `toHaveURL()` options (`timeout`, `ignoreCase`).
     * @returns Resolves when the assertion passes.
     *
     * @example
     * ```ts
     * await loginPage.toHaveURL(/.*\/dashboard/);
     * ```
     */
    async toHaveURL(url: ToHaveURLPattern, options?: ToHaveURLOptions): Promise<void> {
        await this.logger.action(
            `Asserting URL: ${url}`,
            () => expect(this.page).toHaveURL(url, options),
            () => `Confirmed URL: ${this.page.url()}`,
            `URL did not match: ${url}`
        );
    }

    /**
     * Asserts the page title matches the expected value (auto-retries until it
     * matches or times out). Fails the test if it never matches.
     *
     * @param title - Expected title (string or `RegExp`).
     * @param options - Playwright `toHaveTitle()` options (`timeout`).
     * @returns Resolves when the assertion passes.
     *
     * @example
     * ```ts
     * await dashboardPage.toHaveTitle('Amplify Health Product Portal');
     * ```
     */
    async toHaveTitle(title: string | RegExp, options?: ToHaveTitleOptions): Promise<void> {
        await this.logger.action(
            `Asserting title: ${title}`,
            () => expect(this.page).toHaveTitle(title, options),
            () => `Confirmed title: ${title}`,
            `Title did not match: ${title}`
        );
    }

}
