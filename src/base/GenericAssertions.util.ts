import { expect } from '@playwright/test';
import type { SmartLogger } from '@utils/logger/SmartLogger.util.ts';
import { LogLevel } from '@utils/logger/LogLevel.util.ts';

/**
 * Non-locator assertions for comparing plain, already-resolved values — strings,
 * numbers, booleans, arrays — rather than live DOM elements. `BasePage`
 * constructs one instance per page object and exposes it as `this.assert`.
 *
 * Use this when you already hold a value (e.g. text pulled via
 * `this.elements.getText(...)`, a computed count, an API field) and want to check
 * it. To assert on a live element instead — visibility, text, enabled/checked —
 * use `this.elementAssert` ({@link ElementAssertions}), whose matchers auto-retry.
 * These generic matchers do **not** retry: they evaluate the value they are given
 * once, so resolve any waiting *before* calling them.
 *
 * Each call is wrapped in `logger.action(...)` and logged at
 * {@link LogLevel.DEBUG} — quieter than element actions/assertions, since these
 * are usually low-level sub-checks. A failure still throws and fails the test,
 * and the failure line is always emitted at `ERROR` regardless of level.
 *
 * Every method takes a human-readable `description` embedded in the log/step text
 * — write it so `Asserting equal: X` reads naturally.
 *
 * @example Inside a page object — check extracted text
 * ```ts
 * const count = await this.elements.getText(this.resultCount, 'result count');
 * await this.assert.toEqual(count, '12 results', 'result count label');
 * ```
 */
export class GenericAssertions {

    constructor(private readonly logger: SmartLogger) {}

    /**
     * Asserts two values are deeply equal (Playwright/Jest `toEqual` semantics —
     * recursively compares objects and arrays by value).
     *
     * @typeParam T - Type of the values being compared.
     * @param actual - The value under test.
     * @param expected - The value it should equal.
     * @param description - Human-readable name for logs/report.
     * @returns Resolves when the assertion passes.
     *
     * @example
     * ```ts
     * await this.assert.toEqual(selectedTab, 'Claims', 'active tab');
     * await this.assert.toEqual(rowIds, ['A1', 'A2'], 'visible row ids');
     * ```
     */
    async toEqual<T>(actual: T, expected: T, description: string): Promise<void> {
        await this.logger.action(
            `Asserting equal: ${description}`,
            () => expect(actual as unknown).toEqual(expected),
            `Confirmed equal: ${description}`,
            `Not equal: ${description}`,
            LogLevel.DEBUG
        );
    }

    /**
     * Asserts a collection contains an item — an array element, or a substring of
     * a string.
     *
     * @typeParam T - Element type (for arrays); ignored for the string form.
     * @param collection - The array or string to search.
     * @param item - The element or substring expected to be present.
     * @param description - Human-readable name for logs/report.
     * @returns Resolves when the assertion passes.
     *
     * @example Array membership
     * ```ts
     * await this.assert.toContain(availableApps, 'Amplify Health Core Claims', 'available apps');
     * ```
     * @example Substring
     * ```ts
     * await this.assert.toContain(currentUrl, '/dashboard', 'current URL');
     * ```
     */
    async toContain<T>(collection: T[] | string, item: T, description: string): Promise<void> {
        await this.logger.action(
            `Asserting contains: ${description}`,
            () => expect(collection as unknown).toContain(item),
            `Confirmed contains: ${description}`,
            `Does not contain: ${description}`,
            LogLevel.DEBUG
        );
    }

    /**
     * Asserts a value is truthy (not `false`, `0`, `''`, `null`, `undefined`, or `NaN`).
     *
     * @param value - The value under test.
     * @param description - Human-readable name for logs/report.
     * @returns Resolves when the assertion passes.
     *
     * @example
     * ```ts
     * await this.assert.toBeTruthy(response.ok(), 'response was successful');
     * ```
     */
    async toBeTruthy(value: unknown, description: string): Promise<void> {
        await this.logger.action(
            `Asserting truthy: ${description}`,
            () => expect(value).toBeTruthy(),
            `Confirmed truthy: ${description}`,
            `Not truthy: ${description}`,
            LogLevel.DEBUG
        );
    }

    /**
     * Asserts `actual` is strictly greater than `expected`.
     *
     * @param actual - The number under test.
     * @param expected - The lower bound it must exceed.
     * @param description - Human-readable name for logs/report.
     * @returns Resolves when the assertion passes.
     *
     * @example
     * ```ts
     * await this.assert.toBeGreaterThan(rowCount, 0, 'search returned at least one row');
     * ```
     */
    async toBeGreaterThan(actual: number, expected: number, description: string): Promise<void> {
        await this.logger.action(
            `Asserting greater than: ${description}`,
            () => expect(actual).toBeGreaterThan(expected),
            `Confirmed greater than: ${description}`,
            `Not greater than: ${description}`,
            LogLevel.DEBUG
        );
    }
}
