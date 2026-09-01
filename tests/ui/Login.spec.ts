import { test } from '../../src/ui/fixtures/base.fixture.ts';
import { test_credentials } from '../../playwright.config.ts';
import { uiEndPoints } from '../../src/ui/config/endpoint.config.ts';

test.beforeEach(async ({ page, loginPage, logger }) => {
    await logger.step('NAVIGATE TO LOGIN PAGE', async () => {
        await logger.info(`Opening URL: ${process.env.BASE_URL}`);
        await loginPage.navigate(`${uiEndPoints.login}`);
    });
});

test.describe('SmartLogger Demo - Login Page', () => {
    test('Successful login with valid credentials', async ({ loginPage, secureAreaPage, logger }) => {
        await logger.step(`LOGIN_TEST_USER_(${test_credentials.valid_username_1})`, async () => {
            await loginPage.login(
                test_credentials.valid_username_1,
                test_credentials.valid_password_1
            );
        });

        await logger.step('VERIFY_LOGIN_SUCCESS', async () => {
            await loginPage.expectLoginSuccess();
        });

        await logger.step('VERIFY_LANDING_PAGE', async () => {
            await secureAreaPage.verifySecureAreaPage(test_credentials.valid_username_1);
        });
    });

});