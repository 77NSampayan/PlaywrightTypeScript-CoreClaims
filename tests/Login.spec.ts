import { test } from '@fixtures/base.fixture.ts';

// The sign-in itself is under test here, so opt out of the saved session the
// msedge project otherwise loads (see tests/auth.setup.ts) and start signed out.
test.use({ storageState: { cookies: [], origins: [] } });

test.beforeEach(async ({ loginPage, logger }) => {
    await logger.step('NAVIGATE TO LOGIN PAGE', async () => {
        await logger.info(`Opening URL: ${process.env.BASE_URL}`);
        await loginPage.navigate();
    });
});

test.describe('Amplify Health Product Portal - Login', () => {
    test('Successful login via Microsoft SSO with valid credentials', async ({ account, loginPage, microsoftLoginPage, landingPage, logger }) => {
        // Up to 30s waiting for a fresh OTP code, on top of the SSO round-trip.
        test.setTimeout(90_000);

        await logger.step('VERIFY_LOGIN_PAGE', async () => {
            await loginPage.expectLoginPageVisible();
        });

        await logger.step('ENTER_PORTAL_EMAIL', async () => {
            await loginPage.login(account.username);
        });

        await logger.step('COMPLETE_MICROSOFT_SIGN_IN', async () => {
            // The setup project signed in moments ago — wait out its OTP code.
            await microsoftLoginPage.waitForFreshOtpCode();
            await microsoftLoginPage.login(
                account.username,
                account.password,
                account.otpSecret
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


    //     let coreClaimsHomePage!: CoreClaimsHomePage;

    //     await logger.step('CLICK_AMPLIFY_HEALTH_APP_PREPROD', async () => {
    //         const coreClaimsPage = await landingPage.clickApp('Amplify Health Core Claims');
    //         coreClaimsHomePage = new CoreClaimsHomePage(coreClaimsPage);

    //         await coreClaimsHomePage.expectHomePageVisible();
    //     });

    //     await logger.step('VERIFY_SIDEBAR_NAV', async () => {
    //         await coreClaimsHomePage.openNavMenu();
    //         await coreClaimsHomePage.expectSidebarNavVisible();
    //     });
    });

});
