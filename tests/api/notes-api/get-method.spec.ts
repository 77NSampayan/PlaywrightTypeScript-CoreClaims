import { test, apiEndPoints } from '../../../fixtures/base.fixture.js'
import { expect } from '@playwright/test';

test.describe("Validate Notes API Health Check", ()=> {

    test("Verify Health Check for Successful Request (200)", async ({ request }) => {
        const response = await request.get(
            apiEndPoints.health.check
        );

        const body = await response.json()
        await console.log(JSON.stringify(body, null, 2));

        await expect(body.success).toBe(true);
        await expect(body.status).toBe(200);
        await expect(body.message).toBe("Notes API is Running");
    });

    test("Verify Health Check for Internal Error Server (500)", async ({ playwright }) => {
        
    });
});