import { getServerHealth } from './serverHealth.js';

function toolResult(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

/**
 * Lightweight connectivity probe — register before heavier ops tools.
 *
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {{ serverMeta: object, log?: (m: string) => void }} opts
 */
export function registerHealthTools(server, opts) {
  const serverMeta = opts.serverMeta;
  const log = opts.log ?? (() => {});

  server.registerTool(
    'server_health',
    {
      description:
        'Instant Siteglide MCP connectivity check (no git, network, or config reads). ' +
        'Call FIRST when any other Siteglide MCP tool times out with a connection error — ' +
        'if this tool also times out, the whole MCP stdio session is dead (catalog may still look ready). ' +
        'Returns pid, uptime, projectDir, session marker path, and timeoutGuidance for the user.',
      inputSchema: {}
    },
    async () => {
      const health = getServerHealth(serverMeta);
      log(`server_health: ok uptimeMs=${health.uptimeMs} pid=${health.pid}`);
      return toolResult(health);
    }
  );
}
