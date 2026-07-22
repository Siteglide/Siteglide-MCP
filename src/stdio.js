import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { composeServer } from './supervisor/compose.js';

/**
 * Start Siteglide MCP over stdio (desktop IDE agents).
 * @param {{ projectDir: string, configPath?: string }} opts
 */
export async function startSiteglideMcp(opts) {
  const projectDir = resolve(opts.projectDir);
  try {
    const st = statSync(projectDir);
    if (!st.isDirectory()) {
      throw new Error(`Not a directory: ${projectDir}`);
    }
  } catch (error) {
    console.error(`[siteglide-mcp] Invalid --project: ${error.message}`);
    process.exit(1);
  }

  const log = (msg) => console.error(`[siteglide-mcp] ${msg}`);
  const { server, shutdown } = await composeServer({
    projectDir,
    configPath: opts.configPath,
    log
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log(`listening on stdio (project: ${projectDir})`);

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      void shutdown(signal).finally(() => process.exit(0));
    });
  }

  return { server, shutdown };
}
