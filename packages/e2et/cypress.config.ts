import { defineConfig } from "cypress";
import { clerkSetup } from "@clerk/testing/cypress";
import { consumeRuntimeEnvironment } from "./cypress/config/runtime.js";
import { mergeHarnessEnvironment } from "./cypress/config/harnessEnv.js";
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

// The sqldev Go CLI injects the stage-aware runtime (target origin + the raw
// CyTestUsersJson secret) into this process. We consume and validate it once;
// the raw secret key is deleted from process.env before Cypress starts, and
// only the validated tuple reaches config.env.
const runtime = consumeRuntimeEnvironment(process.env);

export default defineConfig({
  e2e: {
    // Stage-selected base URL: localhost for dev, deployed origin for staging.
    baseUrl: runtime.expectedOrigin,
    // before:run / after:run also fire for `cypress open` when this is set.
    experimentalInteractiveRunEvents: true,
    async setupNodeEvents(on, config) {
      const runId = createRunId();

      on("before:run", (details) =>
        initializeSuite(details, runId, {
          stage: runtime.stage,
          expectedOrigin: runtime.expectedOrigin,
        }),
      );
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
        // Manual maintenance only, and local stages only. Specs delete the
        // exact keys they prepare; this whole-bucket task must never run
        // against a deployed stage such as staging.
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

      // clerkSetup consumes the stage Clerk credentials and returns Cypress env
      // entries (frontend API, testing token). Preserve every entry it returns
      // and add only the harness-owned keys.
      const withClerk = await clerkSetup({ config });
      withClerk.env = mergeHarnessEnvironment(
        withClerk.env ?? {},
        runtime,
        runId,
      );
      return withClerk;
    },
    taskTimeout: 120000,
  },
});
