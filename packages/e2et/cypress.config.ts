import { defineConfig } from "cypress";
import { clerkSetup } from "@clerk/testing/cypress";
import { createClerkSignInToken } from "./cypress/tasks/createClerkSignInToken.js";
import { supabaseDbReset } from "./cypress/tasks/supabaseDbReset.js";

export default defineConfig({
  e2e: {
    async setupNodeEvents(on, config) {
      on("task", {
        createClerkSignInToken(identifier: string) {
          return createClerkSignInToken(identifier);
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
