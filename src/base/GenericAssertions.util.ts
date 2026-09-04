import { expect } from '@playwright/test';
import type { SmartLogger } from '@utils/logger/SmartLogger.util.ts';
import { LogLevel } from '@utils/logger/LogLevel.util.ts';

export class GenericAssertions {

    constructor(private readonly logger: SmartLogger) {}

    async toEqual<T>(actual: T, expected: T, description: string): Promise<void> {
        await this.logger.action(
            `Asserting equal: ${description}`,
            () => expect(actual as unknown).toEqual(expected),
            `Confirmed equal: ${description}`,
            `Not equal: ${description}`,
            LogLevel.DEBUG
        );
    }

    async toContain<T>(collection: T[] | string, item: T, description: string): Promise<void> {
        await this.logger.action(
            `Asserting contains: ${description}`,
            () => expect(collection as unknown).toContain(item),
            `Confirmed contains: ${description}`,
            `Does not contain: ${description}`,
            LogLevel.DEBUG
        );
    }

    async toBeTruthy(value: unknown, description: string): Promise<void> {
        await this.logger.action(
            `Asserting truthy: ${description}`,
            () => expect(value).toBeTruthy(),
            `Confirmed truthy: ${description}`,
            `Not truthy: ${description}`,
            LogLevel.DEBUG
        );
    }

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
