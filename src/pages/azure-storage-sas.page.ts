import type { Page, Locator } from "@playwright/test";
import { BasePage } from "@base/base.page.ts";

// Azure Portal's "Shared access signature" blade for the mpinew storage
// account — generates a fresh account-level SAS (same mechanism as the
// scoped tokens this project's intake-upload automation already uses),
// so automation never has to copy-paste one from the Portal manually.
export class AzureStorageSasPage extends BasePage {

    // "Allowed resource types" — all unchecked by default; "Generate" stays
    // disabled until at least one is checked. The intake upload needs all
    // three (matches the original captured SAS's srt=sco).
    protected readonly serviceCheckbox: Locator;
    protected readonly containerCheckbox: Locator;
    protected readonly objectCheckbox: Locator;

    protected readonly generateButton: Locator;

    // Output field revealed after clicking Generate — the account-root
    // Blob SAS URL (https://mpinew.blob.core.windows.net/?sv=...&sig=...).
    // The intake-upload code appends the container/folder path itself, same
    // as it already does with a manually-copied SAS.
    protected readonly blobServiceSasUrlField: Locator;

    constructor(page: Page) {
        super(page);    // Passes page up to BasePage

        this.serviceCheckbox   = this.page.getByRole('checkbox', { name: 'Service', exact: true });
        this.containerCheckbox = this.page.getByRole('checkbox', { name: 'Container', exact: true });
        this.objectCheckbox    = this.page.getByRole('checkbox', { name: 'Object', exact: true });

        this.generateButton = this.page.getByRole('button', { name: 'Generate SAS and connection string', exact: true });

        this.blobServiceSasUrlField = this.page.getByRole('textbox', { name: 'Blob service SAS URL', exact: true });
    };

    // ─── Actions ──────────────────────────────

    // "Allowed services" (Blob/File/Queue/Table) and "Allowed permissions"
    // already default to all-checked on this blade — only "Allowed resource
    // types" needs explicit action.
    async enableAllResourceTypes(): Promise<void> {
        await this.elements.check(this.serviceCheckbox, 'Service resource type checkbox');
        await this.elements.check(this.containerCheckbox, 'Container resource type checkbox');
        await this.elements.check(this.objectCheckbox, 'Object resource type checkbox');
    };

    async clickGenerate(): Promise<void> {
        await this.elements.click(this.generateButton, 'Generate SAS and connection string button');
    };

    async getBlobServiceSasUrl(): Promise<string> {
        await this.elements.waitForVisible(this.blobServiceSasUrlField, 'Blob service SAS URL field');
        return this.elements.getValue(this.blobServiceSasUrlField, 'Blob service SAS URL field');
    };

    // ─── Assertions ───────────────────────────

    async expectGenerateButtonEnabled(): Promise<void> {
        await this.elementAssert.toBeEnabled(this.generateButton, 'Generate SAS and connection string button');
    };
};
