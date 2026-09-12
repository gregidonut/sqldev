import { defineConfig } from "cypress";
import { clerkSetup } from "@clerk/testing/cypress";
import { createClerkSignInToken } from "./cypress/tasks/createClerkSignInToken.js";
import { createIgPostAsUser } from "./cypress/tasks/createIgPostAsUser.js";
import type { CreateIgPostAsUserArgs } from "./cypress/tasks/createIgPostAsUser.js";
import { supabaseDbReset } from "./cypress/tasks/supabaseDbReset.js";

export default defineConfig({
  e2e: {
    async setupNodeEvents(on, config) {
      on("task", {
        createClerkSignInToken(identifier: string) {
          return createClerkSignInToken(identifier);
        },
        createIgPostAsUser(args: CreateIgPostAsUserArgs) {
          return createIgPostAsUser(args);
        },
        supabaseDbReset() {
          return supabaseDbReset();
        },
      });
      return clerkSetup({ config });
    },
    baseUrl: "http://localhost:4321",
    taskTimeout: 120000,
  },
});
