import { test, expect, request } from '@playwright/test';

const baseURL = "https://practice.expandtesting.com/notes/api"

const endPoints = {
    "healthCheck": baseURL,
    "login": baseURL+"/users/login",
    "logout": baseURL+"/users/logout"
}

export class AuthenticationAPI {
    
    async authenticateUser(request: any): Promise<string> {
        const response = await request.post(
            endPoints.login,
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

        var user_token = body.data.token;

        await console.log(JSON.stringify(body, null, 2));
        return user_token
    }
};

// test.describe("Validate Login API", ()=> {

//     test("Verify Login ", async ({ request }) => {
//         const response = await request.post(
//             endPoints.login,
//             {
//                 data: {
//                     email: "nemuel.sampayan@gmail.com",
//                     password: "test123456"
//                 },
//                 headers: {
//                     "Content-Type": "application/json"
//                 }
//             }
//         );

//         const body = await response.json();

//         // token = body.data.token;

//         await console.log(JSON.stringify(body, null, 2));
//     });

//     // test("Testing token", async ({ request }) => {
//     //     // console.log("Token is: " + token)
//     // });
// });