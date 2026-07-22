import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerSiteglideTools } from '../siteglide/register.js';
import { registerOpsTools } from '../ops/register.js';
import { registerValidateCode } from './validateCode.js';

const SERVER_NAME = 'siteglide-mcp';
const DEFAULT_VERSION = '0.1.0';

/**
 * Build the composed MCP server (tools registered; transport not connected).
 * Uses platformOS check-node for validate_code (same engine as platformos-mcp-supervisor)
 * plus Siteglide rules and ops tools. Projects should use `app/` (pull migrates
 * marketplace_builder → app).
 *
 * @param {object} opts
 * @param {string} opts.projectDir
 * @param {(msg: string) => void} [opts.log]
 * @param {string} [opts.version]
 * @param {string} [opts.configPath]
 */
export async function composeServer(opts) {
  const log = opts.log ?? ((msg) => console.error(`[${SERVER_NAME}] ${msg}`));
  const projectDir = opts.projectDir;

  const server = new McpServer({
    name: SERVER_NAME,
    version: opts.version ?? DEFAULT_VERSION
  });

  registerValidateCode(server, { projectDir, log });
  registerSiteglideTools(server);
  registerOpsTools(server, { configPath: opts.configPath, log });

  let closed = false;
  const shutdown = async (reason) => {
    if (closed) {
      return;
    }
    closed = true;
    if (reason) {
      log(`shutting down (${reason})`);
    }
    await server.close();
  };

  return {
    server,
    shutdown,
    context: { projectDir, log }
  };
}
