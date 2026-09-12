/// <reference types="cypress" />

declare namespace Cypress {
  interface TestUser {
    user_id: string;
  }

  interface Chainable {
    signInAsUser(user: 0 | 1): Chainable<void>;
    task(event: "createClerkSignInToken", identifier: string): Chainable<string>;
    task(
      event: "createIgPostAsUser",
      args: {
        identifier: string;
        p_text_content: string;
        p_public?: boolean;
      },
    ): Chainable<{ post_id: string }>;
    task(
      event: "createTdsTodoSpaceAsUser",
      args: {
        identifier: string;
        p_name: string;
        p_public?: boolean;
      },
    ): Chainable<{ todo_space_id: string }>;
    task(event: "supabaseDbReset"): Chainable<null>;
  }
}
