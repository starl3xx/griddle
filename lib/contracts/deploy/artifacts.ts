/**
 * Foundry-compiled bytecode + ABI for GriddlePremium and WordOracle,
 * embedded at build time so the admin Deploy tab can broadcast fresh
 * deployments from the browser via wagmi without needing forge.
 *
 * Regenerate with: `bun run scripts/regen-deploy-artifacts.ts` after
 * any contract change (script reads contracts/out/... and rewrites
 * this file).
 */

import griddlePremiumRaw from './griddle-premium.json' with { type: 'json' };
import wordOracleRaw from './word-oracle.json' with { type: 'json' };

export const griddlePremiumArtifact = griddlePremiumRaw as {
  abi: ReadonlyArray<unknown>;
  bytecode: `0x${string}`;
};

export const wordOracleArtifact = wordOracleRaw as {
  abi: ReadonlyArray<unknown>;
  bytecode: `0x${string}`;
};
