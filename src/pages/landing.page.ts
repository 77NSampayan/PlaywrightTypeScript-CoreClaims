import type { Page, Locator } from "@playwright/test";
import { BasePage } from "@base/base.page.ts";

export class LandingPage extends BasePage {

    protected readonly greetingHeading: Locator;
    protected readonly dateText: Locator;
    protected readonly yourAppsTitle: Locator;
    protected readonly yourAppsSection: Locator;

    constructor(page: Page) {
        super(page);    // Passes page up to BasePage

        // Scoped by the app's own stable ids rather than its hashed
        // styled-components classnames, which shift on rebuild.
        this.greetingHeading  = this.page.locator('#content-layout h2');
        this.dateText         = this.page.locator('#content-layout h2 + span');
        this.yourAppsTitle    = this.page.locator('#your-apps-title');
        this.yourAppsSection  = this.page.locator('#your-apps');
    };

    // ─── Actions ──────────────────────────────

    getAppCard(appName: string): Locator {
        // hasText does substring matching, which would make "Amplify Health Core
        // Claims" also match the "...Claims SB" card — match the title exactly instead.
        return this.yourAppsSection
            .locator('.ant-card')
            .filter({ has: this.page.getByText(appName, { exact: true }) });
    };

    async clickApp(appName: string): Promise<Page> {
        // Each app card opens its app in a new tab (same browser context, separate
        // Page) rather than navigating in place — without capturing that "page"
        // event here, the popup is unreachable and the caller is left on this page.
        const [newPage] = await Promise.all([
            this.page.context().waitForEvent('page'),
            this.elements.click(this.getAppCard(appName), `"${appName}" app card`),
        ]);

        await newPage.waitForLoadState('domcontentloaded');
        return newPage;
    };

    // ─── Assertions ───────────────────────────

    async expectLandingPageVisible(): Promise<void> {
        await this.elementAssert.toBeVisible(this.greetingHeading, 'Landing page greeting');
        await this.elementAssert.toBeVisible(this.dateText, "Today's date");
        await this.elementAssert.toBeVisible(this.yourAppsTitle, 'Your apps title');
        await this.elementAssert.toBeVisible(this.yourAppsSection, 'Your apps section');
    };

    async expectAppAvailable(appName: string): Promise<void> {
        await this.elementAssert.toBeVisible(this.getAppCard(appName), `"${appName}" app card`);
    };

    async expectTodaysDateDisplayed(): Promise<void> {
        // Computed rather than hardcoded — the displayed date is "today" from the
        // app's own perspective, so a literal string would go stale the next day.
        const today = new Date().toLocaleDateString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
        });

        await this.elementAssert.toHaveText(this.dateText, today, "Today's date");
    };
};
