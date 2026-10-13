import { GlobalRegistrator } from "@happy-dom/global-registrator";

// Register a browser-like global environment for component tests. This runs
// once before the test files. Pure-logic tests do not depend on it.
if (!(globalThis as { happyDomRegistered?: boolean }).happyDomRegistered) {
    GlobalRegistrator.register();
    (globalThis as { happyDomRegistered?: boolean }).happyDomRegistered = true;
}
