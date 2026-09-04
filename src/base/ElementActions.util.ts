import type { Locator } from '@playwright/test';
import type { SmartLogger } from '@utils/logger/SmartLogger.util.ts';
import type {
    ClickOptions,
    FillOptions,
    CheckOptions,
    UncheckOptions,
    SelectOptionValues,
    SelectOptionOptions,
    WaitForOptions,
    GetTextOptions,
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

    async fill(locator: Locator, value: string, description: string, options?: FillOptions): Promise<void> {
        // Simple security mask check for passwords/secrets
        const isSensitive = /password|secret|token|creditcard/i.test(description);
        const displayValue = isSensitive ? '********' : value;

        await this.logger.action(
            `Filling "${displayValue}" into element "${description}"`,
            () => locator.fill(value, options),
            `Successfully filled text into element "${description}"`,
            `Failed to fill text into element "${description}"`
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
}
