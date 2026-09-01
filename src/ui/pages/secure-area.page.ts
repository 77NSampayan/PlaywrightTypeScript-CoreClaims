import type { Page, Locator } from '@playwright/test'
import { BasePage } from "../base/base.page.ts";

const headerText = "Secure Area page for Automation Testing Practice";
const logoutText = "Logout"

export class SecureAreaPage extends BasePage {

    protected readonly headerText: Locator;
    protected readonly greetingsText: Locator;
    protected readonly logoutButton: Locator;

    constructor(page: Page) {
        super(page);    // Passes page up to BasePage

        this.headerText = this.page.locator(`.container > h1`)
        this.greetingsText = this.page.locator('#username')
        this.logoutButton = this.page.locator(`[href="/logout"]`);
        
    };

    // ─── Actions ──────────────────────────────

    

    // ─── Assertions ───────────────────────────

    async verifySecureAreaPage(username: string): Promise<void> {
        await this.elementAssert.toBeVisible(this.headerText, 'Secure Area Header');
        await this.elementAssert.toBeVisible(this.greetingsText, 'Greetings text for user');
        await this.elementAssert.toBeVisible(this.logoutButton, 'Logout Button');

        await this.elementAssert.toHaveText(this.headerText, headerText, 'Secure Area Header');
        await this.elementAssert.toHaveText(this.greetingsText, `Hi, ${username}!`, 'Greetings text for user');
        await this.elementAssert.toHaveText(this.logoutButton, logoutText, 'Logout Button');
    };

};