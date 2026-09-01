import type { Locator } from '@playwright/test';
import type { SmartLogger } from '../logger/SmartLogger.util.ts';
import type {
    ClickOptions,
    FillOptions,
    CheckOptions,
    UncheckOptions,
    SelectOptionValues,
    SelectOptionOptions,
    WaitForOptions,
    GetTextOptions,
} from '../../../config/locator-types.config.ts';

export class ElementActions {

    constructor(private readonly logger: SmartLogger) {}

    async click(locator: Locator, description: string, options?: ClickOptions): Promise<void> {
        await this.logger.action(
            `Clicking element: "${description}"`,
            () => locator.click(options),
            `Element clicked: "${description}"`,
            `Failed to click element: "${description}"`,
        );
    }

    async fill(locator: Locator, value: string, description: string, options?: FillOptions): Promise<void> {
        await this.logger.action(
            `Filling: ${description}`,
            () => locator.fill(value, options),
            `Successfully filled in ${description}`,
            `Failed to fill in ${description}`,
        );
    }

    async check(locator: Locator, description: string, options?: CheckOptions): Promise<void> {
        await this.logger.action(
            `Checking: ${description}`,
            () => locator.check(options),
            `Checked: ${description}`,
            `Failed to check: ${description}`,
        );
    }

    async uncheck(locator: Locator, description: string, options?: UncheckOptions): Promise<void> {
        await this.logger.action(
            `Unchecking: ${description}`,
            () => locator.uncheck(options),
            `Unchecked: ${description}`,
            `Failed to uncheck: ${description}`,
        );
    }

    async selectOption(locator: Locator, values: SelectOptionValues, description: string, options?: SelectOptionOptions): Promise<void> {
        await this.logger.action(
            `Selecting option on: ${description}`,
            () => locator.selectOption(values, options),
            `Selected option on: ${description}`,
            `Failed to select option on: ${description}`,
        );
    }

    async getText(locator: Locator, description: string, options?: GetTextOptions): Promise<string> {
        return this.logger.action(
            `Getting text of: ${description}`,
            async () => (await locator.textContent(options)) ?? '',
            (text) => `Text of "${description}": "${text}"`,
            `Failed to get text of: ${description}`,
        );
    }

    async waitForVisible(locator: Locator, description: string, options?: WaitForOptions): Promise<void> {
        await this.logger.action(
            `Waiting for visible: ${description}`,
            () => locator.waitFor({ ...options, state: 'visible' }),
            `Now visible: ${description}`,
            `Element did not become visible: ${description}`,
        );
    }

    async waitForHidden(locator: Locator, description: string, options?: WaitForOptions): Promise<void> {
        await this.logger.action(
            `Waiting for hidden: ${description}`,
            () => locator.waitFor({ ...options, state: 'hidden' }),
            `Now hidden: ${description}`,
            `Element did not become hidden: ${description}`,
        );
    }
}
