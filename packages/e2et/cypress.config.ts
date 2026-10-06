import { defineConfig } from "cypress";
import { clerkSetup } from "@clerk/testing/cypress";
import { createClerkSignInToken } from "./cypress/tasks/createClerkSignInToken.js";
import { createIgPostAsUser } from "./cypress/tasks/createIgPostAsUser.js";
import type { CreateIgPostAsUserArgs } from "./cypress/tasks/createIgPostAsUser.js";
import {
  createTdsTodoSpaceAsUser,
  createTdsTodosAsUser,
} from "./cypress/tasks/createTdsTodoSpaceAsUser.js";
import type {
  CreateTdsTodoSpaceAsUserArgs,
  CreateTdsTodosAsUserArgs,
} from "./cypress/tasks/createTdsTodoSpaceAsUser.js";
import { emptyBucket } from "./cypress/tasks/emptyBucket.js";
import { registerPreparedObject } from "./cypress/tasks/preparedObjects.js";
import { createRunId } from "./cypress/tasks/runLock.js";
import { finishSuite, initializeSuite } from "./cypress/tasks/suiteInit.js";
import { supabaseDbReset } from "./cypress/tasks/supabaseDbReset.js";

export default defineConfig({
  e2e: {
    // before:run / after:run also fire for `cypress open` when this is set.
    experimentalInteractiveRunEvents: true,
    async setupNodeEvents(on, config) {
      const runId = createRunId();
      config.env.E2E_RUN_ID = runId;

      on("before:run", (details) => initializeSuite(details, runId));
      on("after:run", () => finishSuite());

      on("task", {
        createClerkSignInToken(identifier: string) {
          return createClerkSignInToken(identifier);
        },
        createIgPostAsUser(args: CreateIgPostAsUserArgs) {
          return createIgPostAsUser(args);
        },
        createTdsTodoSpaceAsUser(args: CreateTdsTodoSpaceAsUserArgs) {
          return createTdsTodoSpaceAsUser(args);
        },
        createTdsTodosAsUser(args: CreateTdsTodosAsUserArgs) {
          return createTdsTodosAsUser(args);
        },
        // Manual maintenance only. Specs delete the exact keys they prepare.
        emptyBucket() {
          return emptyBucket();
        },
        registerPreparedObject(body: unknown) {
          return registerPreparedObject(body);
        },
        supabaseDbReset() {
          return supabaseDbReset();
        },
      });

      const next = await clerkSetup({ config });
      next.env = { ...next.env, E2E_RUN_ID: runId };
      return next;
    },
    baseUrl: "http://localhost:4321",
    taskTimeout: 120000,
  },
});
