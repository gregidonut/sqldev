// Shared reproducible property-test configuration for Bun + fast-check tests.
// Honors FC_SEED so a reported failure can be replayed; runs at least 100 cases.

export function fcParams(): { numRuns: number; seed: number } {
  const raw = process.env.FC_SEED;
  const parsed = raw === undefined ? Number.NaN : Number(raw);
  const seed = Number.isFinite(parsed) ? parsed : 1;
  return { numRuns: 100, seed };
}
