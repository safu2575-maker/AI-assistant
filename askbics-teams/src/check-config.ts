import { loadConfig } from './config.js';
try {
  const config = loadConfig();
  console.log(`Configuration structure passed for ${config.model.name}. This does not verify cloud permissions or credentials.`);
} catch (error) { console.error(error instanceof Error ? error.message : 'Configuration failed'); process.exitCode = 1; }
