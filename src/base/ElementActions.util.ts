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
    PressSequentiallyOptions,
    IsEnabledOptions,
    IsEditableOptions,
    IsDisabledOptions,
    IsCheckedOptions
} from '@constants/locator-types.config.ts';

export class ElementActions {

    constructor(private readonly logger: SmartLogger) {}

    async click(locator: Locator, description: string, options?: ClickOptions): Promise<void> {
        await this.logger.action(
            `Clicking element "${description}"`,
            () => locator.click(options),
            `Clicked element "${description}"`,
            `Failed to click element "${description}"`
        );
    }

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
     * Types character by character instead of setting the value in bulk —
     * needed for components (e.g. PrimeNG's p-calendar) that parse input per
     * keystroke and never pick up a fill()-set value. Prefer fill() by default;
     * reach for this only when fill() demonstrably doesn't register.
     */
    async pressSequentially(locator: Locator, value: string, description: string, options?: PressSequentiallyOptions): Promise<void> {
        await this.logger.action(
            `Typing "${value}" into element "${description}"`,
            () => locator.pressSequentially(value, options),
            `Successfully typed text into element "${description}"`,
            `Failed to type text into element "${description}"`
        );
    }

    async check(locator: Locator, description: string, options?: CheckOptions): Promise<void> {
        await this.logger.action(
            `Checking element "${description}"`,
            () => locator.check(options),
            `Checked element "${description}"`,
            `Failed to check element "${description}"`
        );
    }

    async uncheck(locator: Locator, description: string, options?: UncheckOptions): Promise<void> {
        await this.logger.action(
            `Unchecking element "${description}"`,
            () => locator.uncheck(options),
            `Unchecked element "${description}"`,
            `Failed to uncheck element "${description}"`
        );
    }

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

    async getText(locator: Locator, description: string, options?: GetTextOptions): Promise<string> {
        return this.logger.action(
            `Extracting text value from "${description}"`,
            async () => (await locator.textContent(options)) ?? '',
            // Ensure your SmartLogger natively handles string inputs here or accepts text callbacks
            `Successfully retrieved text content from "${description}"`,
            `Failed to extract text from "${description}"`
        );
    }

    async waitForVisible(locator: Locator, description: string, options?: WaitForOptions): Promise<void> {
        await this.logger.action(
            `Waiting for element "${description}" to be visible`,
            () => locator.waitFor({ ...options, state: 'visible' }),
            `Element "${description}" is now visible`,
            `Element "${description}" did not become visible within timeout limit`
        );
    }

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

    /** Instantaneous visibility check — does NOT wait. Use waitForVisibleSoft() to wait for an optional element. */
    async isVisible(locator: Locator, description: string): Promise<boolean> {
        return this.logger.action(
            `Checking visibility of element "${description}"`,
            () => locator.isVisible(),
            (visible) => `Element "${description}" is ${visible ? 'visible' : 'not visible'}`,
            `Failed to determine visibility of element "${description}"`
        );
    }

    async isEnabled(locator: Locator, description: string, options?: IsEnabledOptions): Promise<boolean> {
        return this.logger.action(
            `Checking if element "${description}" is enabled`,
            () => locator.isEnabled(options),
            (enabled) => `Element "${description}" is ${enabled ? 'enabled' : 'not enabled'}`,
            `Failed to determine enabled state of element "${description}"`
        );
    }

    async isChecked(locator: Locator, description: string, options?: IsCheckedOptions): Promise<boolean> {
        return this.logger.action(
            `Checking if element "${description}" is checked`,
            () => locator.isChecked(options),
            (checked) => `Element "${description}" is ${checked ? 'checked' : 'not checked'}`,
            `Failed to determine checked state of element "${description}"`
        );
    }

    async isEditable(locator: Locator, description: string, options?: IsEditableOptions): Promise<boolean> {
        return this.logger.action(
            `Checking if element "${description}" is editable`,
            () => locator.isEditable(options),
            (editable) => `Element "${description}" is ${editable ? 'editable' : 'not editable'}`,
            `Failed to determine editable state of element "${description}"`
        );
    }

    async isDisabled(locator: Locator, description: string, options?: IsDisabledOptions): Promise<boolean> {
        return this.logger.action(
            `Checking if element "${description}" is disabled`,
            () => locator.isDisabled(options),
            (disabled) => `Element "${description}" is ${disabled ? 'disabled' : 'not disabled'}`,
            `Failed to determine disabled state of element "${description}"`
        );
    }
}
