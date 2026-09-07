import { test } from '@fixtures/base.fixture.ts';
import { test_credentials } from '@root/playwright.config.ts';

test.beforeEach(async ({ loginPage, logger }) => {
    await logger.step('NAVIGATE TO LOGIN PAGE', async () => {
        await logger.info(`Opening URL: ${process.env.BASE_URL}`);
        await loginPage.navigate();
    });
});

test.describe('Amplify Health Product Portal - Login', () => {
    test('Successful login via Microsoft SSO with valid credentials', async ({ loginPage, microsoftLoginPage, logger }) => {
        await logger.step('VERIFY_LOGIN_PAGE', async () => {
            await loginPage.expectLoginPageVisible();
        });

        await logger.step(`ENTER_PORTAL_EMAIL_(${test_credentials.valid_username_1})`, async () => {
            await loginPage.login(test_credentials.valid_username_1);
        });

        await logger.step('COMPLETE_MICROSOFT_SIGN_IN', async () => {
            await microsoftLoginPage.login(
                test_credentials.valid_username_1,
                test_credentials.valid_password_1
            );
        });

        await logger.step('VERIFY_REDIRECT_TO_PORTAL', async () => {
            await microsoftLoginPage.expectRedirectedBackToApp();
        });
    });

});
