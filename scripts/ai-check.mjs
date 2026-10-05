import { runConfiguredAIHealthCheck } from '../dist/server.mjs';

try {
  const result = await runConfiguredAIHealthCheck(process.env);
  if (result.status === 'disabled') {
    console.log('[ai:check] skipped: AI_ENABLED is not true');
  } else {
    console.log(`[ai:check] passed: provider=${result.provider}`);
  }
} catch (error) {
  console.error(`[ai:check] failed: ${error instanceof Error ? error.message : 'unknown error'}`);
  process.exitCode = 1;
}
