import { test, apiEndPoints } from '../../../fixtures/base.fixture.js'
import { expect } from '@playwright/test';

test.describe("Validate Login API", ()=> {

    test("Verify Login ", async ({ request }) => {
        const response = await request.post(
            apiEndPoints.users.login,
            {
                data: {
                    email: "nemuel.sampayan@gmail.com",
                    password: "test123456"
                },
                headers: {
                    "Content-Type": "application/json"
                }
            }
        );

        const body = await response.json();

        // token = body.data.token;

        await console.log(JSON.stringify(body, null, 2));
    });

    test("Testing token", async ({ request }) => {
        // console.log("Token is: " + token)
    });
});