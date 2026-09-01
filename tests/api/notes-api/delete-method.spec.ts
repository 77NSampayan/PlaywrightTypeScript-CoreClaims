import { test, apiEndPoints } from '../../../src/ui/fixtures/base.fixture.ts'
import { expect } from '@playwright/test';

test.describe("Validate Logout API", () => {

    test("Veirify Logout API Response", async ({ request, authentication }) => {

        const token = await authentication.authenticateUser(request);

        await new Promise(resolve => setTimeout(resolve, 2000));

        const logoutResponse = await request.delete(
            apiEndPoints.users.logout,
            {
                headers: {
                    "x-auth-token": token
                }
            }
        );

        const logoutResponseBody = await logoutResponse.json();

        await console.log(JSON.stringify(logoutResponseBody, null, 2))
    })
})