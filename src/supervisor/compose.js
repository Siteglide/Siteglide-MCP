import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerSiteglideTools } from '../siteglide/register.js';
import { registerOpsTools } from '../ops/register.js';
import { registerHealthTools } from '../ops/registerHealth.js';
import { MCP_SERVER_INSTRUCTIONS } from '../ops/serverHealth.js';
import { registerValidateCode } from './validateCode.js';

const SERVER_NAME = 'siteglide-mcp';
const DEFAULT_VERSION = '0.1.0';
const __dirname = dirname(fileURLToPath(import.meta.url));

function packageVersion() {
  try {
    const pkg = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8'));
    return pkg.version || DEFAULT_VERSION;
  } catch {
    return DEFAULT_VERSION;
  }
}

/**
 * Build the composed MCP server (tools registered; transport not connected).
 * Uses platformOS check-node for validate_code (same engine as platformos-mcp-supervisor)
 * plus Siteglide rules and ops tools. Site root may be `app/` or legacy
 * `marketplace_builder/` (equivalent; pull does not rename).
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
  const version = opts.version ?? packageVersion();
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const serverMeta = { projectDir, version, startedAt, startedAtMs };

  const server = new McpServer({
    name: SERVER_NAME,
    version,
    instructions: MCP_SERVER_INSTRUCTIONS
  });

  registerHealthTools(server, { serverMeta, log });
  registerValidateCode(server, { projectDir, log });
  registerSiteglideTools(server);
  registerOpsTools(server, { configPath: opts.configPath, projectDir, log, serverMeta });

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
    context: { projectDir, log, serverMeta }
  };
}
