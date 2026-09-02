import { expect, type Locator } from '@playwright/test';
import type { SmartLogger } from '../utils/logger/SmartLogger.util.ts';
import type {
    ToBeVisibleOptions,
    ToBeHiddenOptions,
    ToHaveTextOptions,
    ToContainTextOptions,
    ToBeEnabledOptions,
    ToBeCheckedOptions,
} from '../config/locator-types.config.ts';

export class ElementAssertions {

    constructor(private readonly logger: SmartLogger) {}

    async toBeVisible(locator: Locator, description: string, options?: ToBeVisibleOptions): Promise<void> {
        await this.logger.action(
            `Asserting element "${description}" is VISIBLE`,
            () => expect(locator).toBeVisible(options),
            `Element "${description}" is visible!`,
            `Element "${description}" is not visible!`,
        );
    }

    async toBeHidden(locator: Locator, description: string, options?: ToBeHiddenOptions): Promise<void> {
        await this.logger.action(
            `Asserting element "${description}" is HIDDEN`,
            () => expect(locator).toBeHidden(options),  
            `Element "${description}" is hidden!`,
            `Element "${description}" is still visible!`,
        );
    }

    async toHaveText(locator: Locator, expected: string | RegExp, description: string, options?: ToHaveTextOptions): Promise<void> {
        await this.logger.action(
            `Asserting element "${description}" exactly MATCHES TEXT: "${expected}"`,
            () => expect(locator).toHaveText(expected, options),
            `Element "${description}" contains "${expected}"`,
            `Element "${description}" does not contain "${expected}"`,
        );
    }

    async toContainText(locator: Locator, expected: string | RegExp, description: string, options?: ToContainTextOptions): Promise<void> {
        await this.logger.action(
            `Asserting element "${description}" CONTAINS TEXT fragment: "${expected}"`,
            () => expect(locator).toContainText(expected, options),
            `Element "${description}" contains "${expected}"`,
            `Element "${description}" does not contain "${expected}"`,
        );
    }

    async toBeEnabled(locator: Locator, description: string, options?: ToBeEnabledOptions): Promise<void> {
        await this.logger.action(
            `Asserting element "${description}" is ENABLED`,
            () => expect(locator).toBeEnabled(options),
            `Element "${description}" is enabled!`,
            `Element "${description}" is disabled!`,
        );
    }

    async toBeChecked(locator: Locator, description: string, options?: ToBeCheckedOptions): Promise<void> {
        await this.logger.action(
            `Asserting element "${description}" is CHECKED`,
            () => expect(locator).toBeChecked(options),
            `Element "${description}" is checked!`,
            `Element "${description}" is not checked!`,
        );
    }
}
