// Shared stage classification for Cypress Node tasks. The Go CLI injects
// SQLDEV_E2E_STAGE; STAGE/SST_STAGE remain as compatibility fallbacks for the
// existing local guards.

const LOCAL_STAGES = new Set(["dev", "local", "development"]);

export function currentStage(): string {
  return (
    process.env.SQLDEV_E2E_STAGE ??
    process.env.STAGE ??
    process.env.SST_STAGE ??
    ""
  );
}

export function isLocalStage(stage: string): boolean {
  return LOCAL_STAGES.has(stage) && !/prod/i.test(stage);
}

export function isExactStaging(stage: string): boolean {
  return stage === "staging";
}
