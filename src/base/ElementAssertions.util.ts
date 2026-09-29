import { expect, type Locator } from '@playwright/test';
import type { SmartLogger } from '@utils/logger/SmartLogger.util.ts';
import type {
    ToBeVisibleOptions,
    ToBeHiddenOptions,
    ToHaveTextOptions,
    ToContainTextOptions,
    ToBeEnabledOptions,
    ToBeCheckedOptions,
} from '@constants/locator-types.config.ts';

/**
 * Locator-level `expect` assertions, each wrapped in `logger.action(...)` so
 * every check logs a START/END line and opens a matching step in the HTML report
 * and trace viewer. `BasePage` constructs one instance per page object and
 * exposes it as `this.elementAssert` — page objects call these instead of
 * writing raw `expect(locator)...` calls, which is what keeps the report complete
 * and failures reported at the caller's call site.
 *
 * These are **web-first assertions**: Playwright auto-retries each one until it
 * passes or the timeout elapses, so they are the right tool for asserting UI
 * that settles asynchronously (no manual waits needed). A failure throws and
 * fails the test. For comparing plain, already-resolved values (strings,
 * numbers, arrays), use `this.assert` ({@link GenericAssertions}) instead.
 *
 * Every method takes a human-readable `description` (e.g. `'sign in button'`)
 * embedded in the log/step text — write it so `Asserting element "X" is VISIBLE`
 * reads naturally.
 *
 * @example Inside a page object
 * ```ts
 * export class LoginPage extends BasePage {
 *     private readonly signInButton = this.page.getByRole('button', { name: 'Sign in' });
 *
 *     async expectLoginPageVisible(): Promise<void> {
 *         await this.elementAssert.toBeVisible(this.signInButton, 'sign in button');
 *     }
 * }
 * ```
 */
export class ElementAssertions {

    constructor(private readonly logger: SmartLogger) {}

    /**
     * Asserts an element is visible (auto-retries until it is, or the timeout
     * elapses). Fails the test if it never becomes visible.
     *
     * @param locator - The target element.
     * @param description - Human-readable name for logs/report (e.g. `'sign in button'`).
     * @param options - Playwright `toBeVisible()` options (`timeout`, `visible`).
     * @returns Resolves when the assertion passes.
     *
     * @example
     * ```ts
     * await this.elementAssert.toBeVisible(this.dashboardHeader, 'dashboard header');
     * ```
     */
    async toBeVisible(locator: Locator, description: string, options?: ToBeVisibleOptions): Promise<void> {
        await this.logger.action(
            `Asserting element "${description}" is VISIBLE`,
            () => expect(locator).toBeVisible(options),
            `Element "${description}" is visible!`,
            `Element "${description}" is not visible!`,
        );
    }

    /**
     * Asserts an element is hidden or not attached (auto-retries). Fails the test
     * if it is still visible after the timeout — use it to confirm something
     * disappears (spinner, toast, closed modal).
     *
     * @param locator - The target element.
     * @param description - Human-readable name for logs/report.
     * @param options - Playwright `toBeHidden()` options (`timeout`).
     * @returns Resolves when the assertion passes.
     *
     * @example
     * ```ts
     * await this.elementAssert.toBeHidden(this.loadingSpinner, 'loading spinner');
     * ```
     */
    async toBeHidden(locator: Locator, description: string, options?: ToBeHiddenOptions): Promise<void> {
        await this.logger.action(
            `Asserting element "${description}" is HIDDEN`,
            () => expect(locator).toBeHidden(options),
            `Element "${description}" is hidden!`,
            `Element "${description}" is still visible!`
        );
    }

    /**
     * Asserts an element's text **exactly** matches `expected` (auto-retries).
     * With a string, the whole text must match (whitespace-normalised); with a
     * `RegExp`, the pattern must match. For a substring/partial match, use
     * {@link toContainText} instead.
     *
     * @param locator - The target element.
     * @param expected - Exact text (string) or pattern (`RegExp`) to match.
     * @param description - Human-readable name for logs/report.
     * @param options - Playwright `toHaveText()` options (`timeout`, `ignoreCase`, `useInnerText`).
     * @returns Resolves when the assertion passes.
     *
     * @example
     * ```ts
     * await this.elementAssert.toHaveText(this.pageHeading, 'Claims Dashboard', 'page heading');
     * ```
     */
    async toHaveText(locator: Locator, expected: string | RegExp, description: string, options?: ToHaveTextOptions): Promise<void> {
        await this.logger.action(
            `Asserting element "${description}" exactly MATCHES TEXT: "${expected}"`,
            () => expect(locator).toHaveText(expected, options),
            `Element "${description}" contains "${expected}"`,
            `Element "${description}" does not contain "${expected}"`
        );
    }

    /**
     * Asserts an element's text **contains** `expected` as a substring/partial
     * match (auto-retries). Looser than {@link toHaveText} — use it when the
     * element has extra surrounding text you don't want to pin down.
     *
     * @param locator - The target element.
     * @param expected - Text fragment (string) or pattern (`RegExp`) to look for.
     * @param description - Human-readable name for logs/report.
     * @param options - Playwright `toContainText()` options (`timeout`, `ignoreCase`, `useInnerText`).
     * @returns Resolves when the assertion passes.
     *
     * @example
     * ```ts
     * await this.elementAssert.toContainText(this.welcomeBanner, 'Welcome', 'welcome banner');
     * ```
     */
    async toContainText(locator: Locator, expected: string | RegExp, description: string, options?: ToContainTextOptions): Promise<void> {
        await this.logger.action(
            `Asserting element "${description}" CONTAINS TEXT fragment: "${expected}"`,
            () => expect(locator).toContainText(expected, options),
            `Element "${description}" contains "${expected}"`,
            `Element "${description}" does not contain "${expected}"`
        );
    }

    /**
     * Asserts an element is enabled — not disabled (auto-retries).
     *
     * @param locator - The target element.
     * @param description - Human-readable name for logs/report.
     * @param options - Playwright `toBeEnabled()` options (`timeout`, `enabled`).
     * @returns Resolves when the assertion passes.
     *
     * @example
     * ```ts
     * await this.elementAssert.toBeEnabled(this.submitButton, 'submit button');
     * ```
     */
    async toBeEnabled(locator: Locator, description: string, options?: ToBeEnabledOptions): Promise<void> {
        await this.logger.action(
            `Asserting element "${description}" is ENABLED`,
            () => expect(locator).toBeEnabled(options),
            `Element "${description}" is enabled!`,
            `Element "${description}" is disabled!`
        );
    }

    /**
     * Asserts a checkbox or radio button is checked (auto-retries).
     *
     * @param locator - The checkbox/radio element.
     * @param description - Human-readable name for logs/report.
     * @param options - Playwright `toBeChecked()` options (`timeout`, `checked`).
     * @returns Resolves when the assertion passes.
     *
     * @example Assert a specific state
     * ```ts
     * await this.elementAssert.toBeChecked(this.termsCheckbox, 'accept terms checkbox');
     * // or assert it is NOT checked:
     * await this.elementAssert.toBeChecked(this.termsCheckbox, 'accept terms checkbox', { checked: false });
     * ```
     */
    async toBeChecked(locator: Locator, description: string, options?: ToBeCheckedOptions): Promise<void> {
        await this.logger.action(
            `Asserting element "${description}" is CHECKED`,
            () => expect(locator).toBeChecked(options),
            `Element "${description}" is checked!`,
            `Element "${description}" is not checked!`
        );
    }
}
