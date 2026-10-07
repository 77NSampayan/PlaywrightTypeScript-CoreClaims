import type { Page, Locator } from "@playwright/test";
import { BasePage } from "@base/base.page.ts";

// The 7 navigation cards on the Core Claims home page, keyed by their routed
// href (the stable identifier) alongside the label shown for reporting/assertion.
const NAV_CARDS = [
    { href: '/customer-ui/dashboard', label: 'Dashboard' },
    { href: '/customer-ui/claims', label: 'Claims Management' },
    { href: '/customer-ui/benefits', label: 'Benefits Management' },
    { href: '/rules-ui', label: 'Rules Management' },
    { href: '/customer-ui/tariff', label: 'Tariffs Management' },
    { href: '/customer-ui/users', label: 'Users Management' },
    { href: '/customer-ui/mdm', label: 'Master Data Management' },
] as const;

// The sidebar nav, keyed by the real `id` each item already carries in markup
// (the stable identifier here — unlike the home page cards, no href-collision
// risk since ids are unique by definition). Each top-level item may expand to
// its own set of sub-menu items.
const SIDEBAR_MENU_ITEMS = [
    { id: 'dashboard-menu', label: 'Dashboard', children: [] },
    {
        id: 'claims-menu', label: 'Claims Management', children: [
            { id: 'manual-adjudication-sub-menu', label: 'Manual Adjudication' },
            { id: 'claims-capture-v2-sub-menu', label: 'Claims Capture' },
            { id: 'claims-query-sub-menu', label: 'Claims Query' },
            { id: 'claims-settings-sub-menu', label: 'Claims Settings' },
        ],
    },
    {
        id: 'benefits-menu', label: 'Benefits Management', children: [
            { id: 'product-configuration-sub-menu', label: 'Product Configuration' },
            { id: 'templates-sub-menu', label: 'Templates' },
        ],
    },
    { id: 'rules-menu', label: 'Rules Management', children: [] },
    {
        id: 'tariffs-menu', label: 'Tariffs Management', children: [
            { id: 'tariff-manager-sub-menu', label: 'Tariff Manager' },
            { id: 'tariff-approval-sub-menu', label: 'Tariff Approval' },
        ],
    },
    {
        id: 'users-menu', label: 'Users Management', children: [
            { id: 'user-overview-sub-menu', label: 'User Overview' },
            { id: 'approvals-sub-menu', label: 'Approvals' },
            { id: 'permissions-sub-menu', label: 'Permissions' },
            { id: 'teams-sub-menu', label: 'Teams' },
        ],
    },
    {
        id: 'mdm-menu', label: 'Master Data Management', children: [
            { id: 'clinical-codes-sub-menu', label: 'Clinical Assets' },
            { id: 'reason-codes-sub-menu', label: 'Reason Codes' },
            { id: 'provider-networks-sub-menu', label: 'Provider Networks' },
        ],
    },
] as const;

export class CoreClaimsHomePage extends BasePage {

    protected readonly logo: Locator;

    // No id/class of its own — fingerprinted by its path data, the only
    // stable thing available. Fragile if the icon is ever redrawn.
    protected readonly menuToggleButton: Locator;

    constructor(page: Page) {
        super(page);    // Passes page up to BasePage

        this.logo = this.page.locator('lib-icon-logo');
        this.menuToggleButton = this.page.locator(
            'svg:has(path[d^="M3 6.75C3 6.33579 3.33579 6 3.75 6H20.25"])'
        );
    };

    // ─── Actions ──────────────────────────────

    getNavCard(href: string): Locator {
        return this.page.locator(`app-home-page a[href="${href}"]`);
    };

    getMenuItem(id: string): Locator {
        return this.page.locator(`#${id}`);
    };

    // The <li> ancestor that carries the "open" class controlling whether this
    // parent's child-menu-list is expanded — only relevant for items with children.
    getMenuGroup(parentId: string): Locator {
        return this.page.locator(`li.menu-group:has(#${parentId})`);
    };

    async openNavMenu(): Promise<void> {
        await this.elements.click(this.menuToggleButton, 'Navigation menu toggle button');
    };

    async clickMenuItem(id: string, label: string): Promise<void> {
        await this.elements.click(this.getMenuItem(id), `"${label}" menu item`);
    };

    // Sidebar top-level items with children are a real accordion — a child's
    // <a> is only visible/clickable once its parent <li> has the "open" class.
    // Only clicks the parent if it isn't already expanded, since clicking an
    // already-open group would collapse it instead.
    async expandMenuGroup(parentId: string): Promise<void> {
        const alreadyOpen = await this.getMenuGroup(parentId)
            .evaluate((el) => el.classList.contains('open'))
            .catch(() => false);

        if (!alreadyOpen) {
            await this.elements.click(this.getMenuItem(parentId), `Expand "${parentId}" menu group`);
        }
    };

    async clickSidebarSubMenuItem(parentId: string, childId: string, childLabel: string): Promise<void> {
        await this.expandMenuGroup(parentId);
        await this.elements.click(this.getMenuItem(childId), `"${childLabel}" menu item`);
    };

    // ─── Assertions ───────────────────────────

    async expectLogoVisible(): Promise<void> {
        await this.elementAssert.toBeVisible(this.logo, 'App logo');
    };

    async expectNavCardVisible(href: string, label: string): Promise<void> {
        const navCard = this.getNavCard(href);

        await this.elementAssert.toBeVisible(navCard, `"${label}" nav card`);
        await this.elementAssert.toContainText(navCard, label, `"${label}" nav card`);
    };

    async expectHomePageVisible(): Promise<void> {
        await this.expectLogoVisible();

        for (const { href, label } of NAV_CARDS) {
            await this.expectNavCardVisible(href, label);
        }
    };

    async expectMenuItemVisible(id: string, label: string): Promise<void> {
        const menuItem = this.getMenuItem(id);

        await this.elementAssert.toBeVisible(menuItem, `"${label}" menu item`);
        await this.elementAssert.toContainText(menuItem, label, `"${label}" menu item`);
    };

    async expectSidebarNavVisible(): Promise<void> {
        for (const item of SIDEBAR_MENU_ITEMS) {
            await this.expectMenuItemVisible(item.id, item.label);

            if (item.children.length > 0) {
                await this.expandMenuGroup(item.id);
            }

            for (const child of item.children) {
                await this.expectMenuItemVisible(child.id, child.label);
            }
        }
    };
};
