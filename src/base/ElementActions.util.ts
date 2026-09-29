import { errors, type Locator } from '@playwright/test';
import type { SmartLogger } from '@utils/logger/SmartLogger.util.ts';
import type {
    ClickOptions,
    FillActionOptions,
    CheckOptions,
    UncheckOptions,
    SelectOptionValues,
    SelectOptionOptions,
    WaitForOptions,
    GetTextOptions,
    IsEnabledOptions,
    IsEditableOptions,
    IsDisabledOptions,
    IsCheckedOptions
} from '@constants/locator-types.config.ts';

/**
 * Locator-level interactions, each wrapped in `logger.action(...)` so every
 * call logs a START/END line and opens a matching step in the HTML report and
 * trace viewer. `BasePage` constructs one instance per page object and exposes
 * it as `this.elements` — page objects call these methods instead of touching
 * raw Playwright locators, which is what keeps the logs and report complete.
 *
 * Every method takes a human-readable `description` (e.g. `'sign in button'`)
 * that is embedded in the log/step text — write it so `Clicking element "X"`
 * reads naturally.
 *
 * @example Inside a page object
 * ```ts
 * export class LoginPage extends BasePage {
 *     private readonly signInButton = this.page.getByRole('button', { name: 'Sign in' });
 *
 *     async submit(): Promise<void> {
 *         await this.elements.click(this.signInButton, 'sign in button');
 *     }
 * }
 * ```
 */
export class ElementActions {

    constructor(private readonly logger: SmartLogger) {}

    /**
     * Clicks an element (Playwright auto-waits for it to be actionable first).
     *
     * @param locator - The target element.
     * @param description - Human-readable name for logs/report (e.g. `'sign in button'`).
     * @param options - Playwright `locator.click()` options (`force`, `button`, `clickCount`, `position`, …).
     * @returns Resolves once the click completes.
     *
     * @example
     * ```ts
     * await this.elements.click(this.submitButton, 'submit button');
     * ```
     */
    async click(locator: Locator, description: string, options?: ClickOptions): Promise<void> {
        await this.logger.action(
            `Clicking element "${description}"`,
            () => locator.click(options),
            `Clicked element "${description}"`,
            `Failed to click element "${description}"`
        );
    }

    /**
     * Fills a text input/textarea with `value` (clears it first, like Playwright's `fill`).
     *
     * ⚠️ **Masking.** Pass `{ mask: true }` for any sensitive **or identifying**
     * field (password, email, member ID, …). The start message becomes the
     * `test.step()` name, so an unmasked value would be published to the console,
     * the HTML report **and** the trace. The `/password|secret|token|creditcard/i`
     * name sniff is only a backstop — do not rely on it, since no honest field
     * name matches that list.
     *
     * @param locator - The target input/textarea.
     * @param value - The text to type in.
     * @param description - Human-readable field name for logs/report.
     * @param options - Playwright `locator.fill()` options, plus `mask?: boolean`
     *                  (this class's own flag; stripped before reaching Playwright).
     * @returns Resolves once the field is filled.
     *
     * @example Ordinary field
     * ```ts
     * await this.elements.fill(this.searchBox, 'claims', 'claims search box');
     * ```
     * @example Sensitive / identifying field — always mask
     * ```ts
     * await this.elements.fill(this.passwordField, password, 'password field', { mask: true });
     * ```
     */
    async fill(locator: Locator, value: string, description: string, options?: FillActionOptions): Promise<void> {
        const { mask, ...fillOptions } = options ?? {};

        // `mask: true` is the reliable path. The keyword sniff below is only a
        // backstop for the obvious cases — it is not a guarantee, because no
        // natural name for an identity field contains any of these words.
        //
        // Masking matters more than it looks: this start message becomes the
        // `test.step()` name (SmartLogger.action → runStep), so an unmasked
        // value is published to the console, the HTML report AND the trace.
        const isSensitive = mask ?? /password|secret|token|creditcard/i.test(description);
        const displayValue = isSensitive ? '********' : value;

        await this.logger.action(
            `Filling "${displayValue}" into element "${description}"`,
            () => locator.fill(value, fillOptions),
            `Successfully filled text into element "${description}"`,
            `Failed to fill text into element "${description}"`
        );
    }

    /**
     * Checks a checkbox or radio button. No-op if it is already checked.
     *
     * @param locator - The checkbox/radio element.
     * @param description - Human-readable name for logs/report.
     * @param options - Playwright `locator.check()` options (`force`, `position`, …).
     * @returns Resolves once the element is checked.
     *
     * @example
     * ```ts
     * await this.elements.check(this.termsCheckbox, 'accept terms checkbox');
     * ```
     */
    async check(locator: Locator, description: string, options?: CheckOptions): Promise<void> {
        await this.logger.action(
            `Checking element "${description}"`,
            () => locator.check(options),
            `Checked element "${description}"`,
            `Failed to check element "${description}"`
        );
    }

    /**
     * Unchecks a checkbox. No-op if it is already unchecked.
     *
     * @param locator - The checkbox element.
     * @param description - Human-readable name for logs/report.
     * @param options - Playwright `locator.uncheck()` options (`force`, `position`, …).
     * @returns Resolves once the element is unchecked.
     *
     * @example
     * ```ts
     * await this.elements.uncheck(this.rememberMeCheckbox, 'remember me checkbox');
     * ```
     */
    async uncheck(locator: Locator, description: string, options?: UncheckOptions): Promise<void> {
        await this.logger.action(
            `Unchecking element "${description}"`,
            () => locator.uncheck(options),
            `Unchecked element "${description}"`,
            `Failed to uncheck element "${description}"`
        );
    }

    /**
     * Selects one or more options in a `<select>` dropdown, by value, label, or index.
     *
     * @param locator - The `<select>` element.
     * @param values - What to select: a value string, `{ label }` / `{ index }` / `{ value }`,
     *                 or an array of these for multi-select.
     * @param description - Human-readable dropdown name for logs/report.
     * @param options - Playwright `locator.selectOption()` options (`force`, `timeout`).
     * @returns Resolves once the option(s) are selected.
     *
     * @example By value
     * ```ts
     * await this.elements.selectOption(this.statusDropdown, 'approved', 'status dropdown');
     * ```
     * @example By visible label
     * ```ts
     * await this.elements.selectOption(this.statusDropdown, { label: 'Approved' }, 'status dropdown');
     * ```
     */
    async selectOption(locator: Locator, values: SelectOptionValues, description: string, options?: SelectOptionOptions): Promise<void> {
        // Stringify values array if multi-select to keep the console print clean
        const serializedValues = Array.isArray(values) ? values.join(', ') : String(values);

        await this.logger.action(
            `Selecting option "${serializedValues}" on dropdown "${description}"`,
            () => locator.selectOption(values, options),
            `Selected option "${serializedValues}" on dropdown "${description}"`,
            `Failed to select option on dropdown "${description}"`
        );
    }

    /**
     * Returns an element's text content, or `''` when it has none (never `null`).
     *
     * @param locator - The target element.
     * @param description - Human-readable name for logs/report.
     * @param options - Playwright `locator.textContent()` options (`timeout`).
     * @returns The element's text, or an empty string.
     *
     * @example
     * ```ts
     * const banner = await this.elements.getText(this.welcomeBanner, 'welcome banner');
     * // assert with this.assert.toContain(banner, 'Welcome', 'welcome banner text');
     * ```
     */
    async getText(locator: Locator, description: string, options?: GetTextOptions): Promise<string> {
        return this.logger.action(
            `Extracting text value from "${description}"`,
            async () => (await locator.textContent(options)) ?? '',
            // Ensure your SmartLogger natively handles string inputs here or accepts text callbacks
            `Successfully retrieved text content from "${description}"`,
            `Failed to extract text from "${description}"`
        );
    }

    /**
     * Waits until an element is visible. **Throws** (failing the test) if it does
     * not become visible within the timeout — use this for elements that *must*
     * appear. For genuinely optional UI, use {@link waitForVisibleSoft} instead.
     *
     * @param locator - The target element.
     * @param description - Human-readable name for logs/report.
     * @param options - Playwright `locator.waitFor()` options (`timeout`); `state` is forced to `'visible'`.
     * @returns Resolves once the element is visible.
     *
     * @example
     * ```ts
     * await this.elements.waitForVisible(this.dashboardHeader, 'dashboard header');
     * ```
     */
    async waitForVisible(locator: Locator, description: string, options?: WaitForOptions): Promise<void> {
        await this.logger.action(
            `Waiting for element "${description}" to be visible`,
            () => locator.waitFor({ ...options, state: 'visible' }),
            `Element "${description}" is now visible`,
            `Element "${description}" did not become visible within timeout limit`
        );
    }

    /**
     * Waits until an element is hidden (or detached). **Throws** if it is still
     * visible after the timeout — use it to confirm something disappears
     * (spinner, toast, modal).
     *
     * @param locator - The target element.
     * @param description - Human-readable name for logs/report.
     * @param options - Playwright `locator.waitFor()` options (`timeout`); `state` is forced to `'hidden'`.
     * @returns Resolves once the element is hidden.
     *
     * @example
     * ```ts
     * await this.elements.waitForHidden(this.loadingSpinner, 'loading spinner');
     * ```
     */
    async waitForHidden(locator: Locator, description: string, options?: WaitForOptions): Promise<void> {
        await this.logger.action(
            `Waiting for element "${description}" to be hidden`,
            () => locator.waitFor({ ...options, state: 'hidden' }),
            `Element "${description}" is now hidden`,
            `Element "${description}" did not hide within timeout limit`
        );
    }

    /**
     * Soft wait: resolves `true` if the element becomes visible within the
     * timeout, `false` if it never does. Unlike waitForVisible() this never
     * throws on a timeout — it is for genuinely optional UI (intermittent
     * prompts, conditionally-challenged MFA), not for elements that must be
     * there. Any other error (strict-mode violation, closed page, bad
     * selector) still propagates — those are real failures, not "absent".
     *
     * @param locator - The (optional) target element.
     * @param description - Human-readable name for logs/report.
     * @param options - Playwright `locator.waitFor()` options; pass a short `timeout`
     *                  so an absent element doesn't cost the full default wait.
     * @returns `true` if it appeared, `false` if it timed out without appearing.
     *
     * @example Branch on an intermittent prompt
     * ```ts
     * const shown = await this.elements.waitForVisibleSoft(this.cookieBanner, 'cookie banner', { timeout: 2_000 });
     * if (shown) await this.elements.click(this.acceptCookiesButton, 'accept cookies button');
     * ```
     */
    async waitForVisibleSoft(locator: Locator, description: string, options?: WaitForOptions): Promise<boolean> {
        const waited = options?.timeout ? `${options.timeout}ms` : 'the default timeout';

        return this.logger.action(
            `Waiting up to ${waited} for optional element "${description}"`,
            async () => {
                try {
                    await locator.waitFor({ ...options, state: 'visible' });
                    return true;
                } catch (err) {
                    if (err instanceof errors.TimeoutError) return false;
                    throw err;
                }
            },
            (appeared) => `Optional element "${description}" ${appeared ? 'appeared' : 'did not appear'}`,
            `Failed while waiting for optional element "${description}"`,
        );
    }

    // ─── Element State Checkers ─────────────────────────

    /**
     * Instantaneous visibility check — does **not** wait. Returns the element's
     * current visibility right now. To *wait* for an optional element, use
     * {@link waitForVisibleSoft}; to wait for a required one, {@link waitForVisible}.
     *
     * @param locator - The target element.
     * @param description - Human-readable name for logs/report.
     * @returns `true` if visible at the moment of the call, otherwise `false`.
     *
     * @example
     * ```ts
     * if (await this.elements.isVisible(this.errorBanner, 'error banner')) {
     *     // handle the already-rendered error
     * }
     * ```
     */
    async isVisible(locator: Locator, description: string): Promise<boolean> {
        return this.logger.action(
            `Checking visibility of element "${description}"`,
            () => locator.isVisible(),
            (visible) => `Element "${description}" is ${visible ? 'visible' : 'not visible'}`,
            `Failed to determine visibility of element "${description}"`
        );
    }

    /**
     * Reports whether an element is enabled (not disabled).
     *
     * @param locator - The target element.
     * @param description - Human-readable name for logs/report.
     * @param options - Playwright `locator.isEnabled()` options (`timeout`).
     * @returns `true` if enabled, otherwise `false`.
     *
     * @example
     * ```ts
     * const canSubmit = await this.elements.isEnabled(this.submitButton, 'submit button');
     * ```
     */
    async isEnabled(locator: Locator, description: string, options?: IsEnabledOptions): Promise<boolean> {
        return this.logger.action(
            `Checking if element "${description}" is enabled`,
            () => locator.isEnabled(options),
            (enabled) => `Element "${description}" is ${enabled ? 'enabled' : 'not enabled'}`,
            `Failed to determine enabled state of element "${description}"`
        );
    }

    /**
     * Reports whether a checkbox or radio button is checked.
     *
     * @param locator - The checkbox/radio element.
     * @param description - Human-readable name for logs/report.
     * @param options - Playwright `locator.isChecked()` options (`timeout`).
     * @returns `true` if checked, otherwise `false`.
     *
     * @example
     * ```ts
     * const accepted = await this.elements.isChecked(this.termsCheckbox, 'accept terms checkbox');
     * ```
     */
    async isChecked(locator: Locator, description: string, options?: IsCheckedOptions): Promise<boolean> {
        return this.logger.action(
            `Checking if element "${description}" is checked`,
            () => locator.isChecked(options),
            (checked) => `Element "${description}" is ${checked ? 'checked' : 'not checked'}`,
            `Failed to determine checked state of element "${description}"`
        );
    }

    /**
     * Reports whether an element is editable (visible, enabled, and not readonly).
     *
     * @param locator - The target element.
     * @param description - Human-readable name for logs/report.
     * @param options - Playwright `locator.isEditable()` options (`timeout`).
     * @returns `true` if editable, otherwise `false`.
     *
     * @example
     * ```ts
     * const editable = await this.elements.isEditable(this.notesField, 'notes field');
     * ```
     */
    async isEditable(locator: Locator, description: string, options?: IsEditableOptions): Promise<boolean> {
        return this.logger.action(
            `Checking if element "${description}" is editable`,
            () => locator.isEditable(options),
            (editable) => `Element "${description}" is ${editable ? 'editable' : 'not editable'}`,
            `Failed to determine editable state of element "${description}"`
        );
    }

    /**
     * Reports whether an element is disabled. The inverse of {@link isEnabled} —
     * use whichever reads more naturally at the call site.
     *
     * @param locator - The target element.
     * @param description - Human-readable name for logs/report.
     * @param options - Playwright `locator.isDisabled()` options (`timeout`).
     * @returns `true` if disabled, otherwise `false`.
     *
     * @example
     * ```ts
     * const locked = await this.elements.isDisabled(this.submitButton, 'submit button');
     * ```
     */
    async isDisabled(locator: Locator, description: string, options?: IsDisabledOptions): Promise<boolean> {
        return this.logger.action(
            `Checking if element "${description}" is disabled`,
            () => locator.isDisabled(options),
            (disabled) => `Element "${description}" is ${disabled ? 'disabled' : 'not disabled'}`,
            `Failed to determine disabled state of element "${description}"`
        );
    }
}
