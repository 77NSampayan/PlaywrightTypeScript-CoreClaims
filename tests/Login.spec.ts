import { test } from '@fixtures/base.fixture.ts';
import { test_credentials } from '@root/playwright.config.ts';
import { CoreClaimsHomePage } from '@pages/core-claims-home.page.ts';

test.beforeEach(async ({ loginPage, logger }) => {
    await logger.step('NAVIGATE TO LOGIN PAGE', async () => {
        await logger.info(`Opening URL: ${process.env.BASE_URL}`);
        await loginPage.navigate();
    });
});

test.describe('Amplify Health Product Portal - Login', () => {
    test('Successful login via Microsoft SSO with valid credentials', async ({ loginPage, microsoftLoginPage, landingPage, logger }) => {
        await logger.step('VERIFY_LOGIN_PAGE', async () => {
            await loginPage.expectLoginPageVisible();
        });

        await logger.step('ENTER_PORTAL_EMAIL', async () => {
            await loginPage.login(test_credentials.valid_username_1);
        });

        await logger.step('COMPLETE_MICROSOFT_SIGN_IN', async () => {
            await microsoftLoginPage.login(
                test_credentials.valid_username_1,
                test_credentials.valid_password_1,
                test_credentials.valid_otp_secret_1
            );
        });

        await logger.step('VERIFY_REDIRECT_TO_PORTAL', async () => {
            await microsoftLoginPage.expectRedirectedBackToApp();
        });

        await logger.step('VERIFY_LANDING_PAGE', async () => {
            await landingPage.expectLandingPageVisible();
            await landingPage.expectTodaysDateDisplayed();
            await landingPage.expectAppAvailable('Amplify Health Core Claims');
            await landingPage.expectAppAvailable('Amplify Health Core Claims SB');
        });


        let coreClaimsHomePage!: CoreClaimsHomePage;

        await logger.step('CLICK_AMPLIFY_HEALTH_APP_PREPROD', async () => {
            const coreClaimsPage = await landingPage.clickApp('Amplify Health Core Claims');
            coreClaimsHomePage = new CoreClaimsHomePage(coreClaimsPage);

            await coreClaimsHomePage.expectHomePageVisible();
        });

        await logger.step('VERIFY_SIDEBAR_NAV', async () => {
            await coreClaimsHomePage.openNavMenu();
            await coreClaimsHomePage.expectSidebarNavVisible();
        });
    });

});
