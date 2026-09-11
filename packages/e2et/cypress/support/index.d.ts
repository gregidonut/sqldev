/// <reference types="cypress" />

declare namespace Cypress {
  interface TestUser {
    user_id: string;
  }

  interface Chainable {
    signInAsUser(user: 0 | 1): Chainable<void>;
    task(event: "createClerkSignInToken", identifier: string): Chainable<string>;
  }
}
