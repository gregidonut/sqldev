/// <reference types="cypress" />

declare namespace Cypress {
  interface TestUser {
    user_id: string;
  }

  interface Chainable {
    signInAsUser(user: 0 | 1): Chainable<void>;
    uniqueRecordName(label: string): Chainable<string>;
    waitForClerkLoaded(): Chainable<Window>;
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
    task(
      event: "createTdsTodosAsUser",
      args: {
        identifier: string;
        p_name: string;
        p_public?: boolean;
        todos: { p_title: string; p_description: string }[];
      },
    ): Chainable<{ todo_space_id: string; todo_ids: string[] }>;
    task(event: "emptyBucket"): Chainable<{ deleted: number }>;
    task(
      event: "registerPreparedObject",
      args: { storageObjectId: string; s3ObjectKey: string },
    ): Chainable<null>;
    task(event: "supabaseDbReset"): Chainable<null>;
  }
}
