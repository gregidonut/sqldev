import { defineConfig } from "cypress";
import { clerkSetup } from "@clerk/testing/cypress";
import { createClerkSignInToken } from "./cypress/tasks/createClerkSignInToken.js";

export default defineConfig({
  e2e: {
    async setupNodeEvents(on, config) {
      on("task", {
        createClerkSignInToken(identifier: string) {
          return createClerkSignInToken(identifier);
        },
      });
      return clerkSetup({ config });
    },
    baseUrl: "http://localhost:4321",
  },
});
