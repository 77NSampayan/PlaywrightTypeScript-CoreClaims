// ─────────────────────────────────────────────
//  BasePage.ts
//  SmartLogger is integrated at this level.
//  All child pages get structured logging for
//  free — no logger calls needed in tests or
//  in child page methods.
// ─────────────────────────────────────────────

import { type Page, expect } from '@playwright/test';
import type { SmartLogger } from '../utils/logger/SmartLogger.util.ts';
import { logger } from '../utils/logger/SmartLogger.util.ts';
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
    ToHaveTitleOtpions,
    ToHaveURLOptions,
    ToHaveURLPattern,
} from '../config/page-types.config.ts'

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

    protected async step<T>(stepName: string, fn: () => Promise<T>): Promise<T> {
        return this.logger.step(stepName, fn);
    }

    // ─── Browser Interaction ─────────────────────────

    async navigate(url: string, options?: GotoOptions): Promise<void> {
        await this.logger.action(
            `Navigating to ${url}`,
            async () => {
                await this.page.goto(url, options);
                await this.page.waitForLoadState('domcontentloaded');
            },
            () => `Page loaded. Current URL: ${this.page.url()}`,
            `Failed to load ${url}`,
        );
    };

    async getTitle(): Promise<string> {
        return this.logger.action(
            'Getting page title',
            () => this.page.title(),
            (title) => `Page title: ${title}`,
            'Failed to get page title',
        );
    }

    async reload(options?: ReloadOptions): Promise<void> {
        await this.logger.action(
            'Reloading page',
            async () => {
                await this.page.reload(options);
                await this.page.waitForLoadState('domcontentloaded');
            },
            () => `Page reloaded. Current URL: ${this.page.url()}`,
            'Failed to reload page',
        );
    }

    async goBack(options?: GoBackOptions): Promise<void> {
        await this.logger.action(
            'Navigating back',
            () => this.page.goBack(options),
            (response) => `Navigated back${response ? '' : ' (no previous history entry)'}. Current URL: ${this.page.url()}`,
            'Failed to navigate back',
        );
    }

    async goForward(options?: GoForwardOptions): Promise<void> {
        await this.logger.action(
            'Navigating forward',
            () => this.page.goForward(options),
            (response) => `Navigated forward${response ? '' : ' (no forward history entry)'}. Current URL: ${this.page.url()}`,
            'Failed to navigate forward',
        );
    }

    async close(options?: PageCloseOptions): Promise<void> {
        await this.logger.action(
            'Closing page',
            () => this.page.close(options),
            () => `Page closed. Last URL: ${this.page.url()}`,
            'Failed to close page',
        );
    }

    // ─── Waits ────────────────────────────────

    async waitForLoadState(state?: LoadState, options?: WaitForLoadOptions): Promise<void> {
        await this.logger.action(
            `Waiting for load state: ${state ?? 'load'}`,
            () => this.page.waitForLoadState(state, options),
            `Load state reached: ${state ?? 'load'}`,
            `Load state not reached: ${state ?? 'load'}`,
        );
    }

    async waitForURL(url: WaitForURLPattern, options?: WaitForURLOptions): Promise<void> {
        await this.logger.action(
            `Waiting for URL: ${url}`,
            () => this.page.waitForURL(url, options),
            () => `URL matched. Current URL: ${this.page.url()}`,
            `URL did not match: ${url}`,
        );
    }

    // ─── Assertions ────────────────────────────────

    async toHaveURL(url: ToHaveURLPattern, options?: ToHaveURLOptions): Promise<void> {
        await this.logger.action(
            `Asserting URL: ${url}`,
            () => expect(this.page).toHaveURL(url, options),
            () => `Confirmed URL: ${this.page.url()}`,
            `URL did not match: ${url}`,
        );
    }

    async toHaveTitle(title: string | RegExp, options?: ToHaveTitleOtpions): Promise<void> {
        await this.logger.action(
            `Asserting title: ${title}`,
            () => expect(this.page).toHaveTitle(title, options),
            `Confirmed title: ${title}`,
            `Title did not match: ${title}`,
        );
    }

}