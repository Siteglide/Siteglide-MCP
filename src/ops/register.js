import { z } from 'zod';
import { listEnvironments, resolveAuth, siteglideApi } from './client.js';

function toolResult(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function toolError(error) {
  return {
    content: [{ type: 'text', text: JSON.stringify({ error: error.message }, null, 2) }],
    isError: true
  };
}

/**
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {{ configPath?: string, log?: (m: string) => void }} [opts]
 */
export function registerOpsTools(server, opts = {}) {
  const configPath = opts.configPath || process.env.CONFIG_FILE_PATH || '.siteglide-config';
  const log = opts.log ?? (() => {});

  server.registerTool(
    'envs_list',
    {
      description: 'List Siteglide environments from .siteglide-config (or CONFIG_FILE_PATH).',
      inputSchema: {
        unused: z.boolean().optional().describe('Unused; reserved for future filters.')
      }
    },
    async () => {
      try {
        return toolResult({ environments: listEnvironments(configPath) });
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    'graphql_exec',
    {
      description: 'Execute a GraphQL query against a Siteglide environment via Siteglide-API.',
      inputSchema: {
        environment: z.string().describe('Environment name from .siteglide-config'),
        query: z.string().describe('GraphQL query or mutation string'),
        variables: z.record(z.unknown()).optional().describe('GraphQL variables object')
      }
    },
    async (args) => {
      try {
        const auth = resolveAuth(args.environment, configPath);
        log(`graphql_exec: ${args.environment}`);
        const body = await siteglideApi(auth, {
          method: 'POST',
          path: '/cli/graph',
          json: { query: args.query, variables: args.variables || {} }
        });
        return toolResult(body);
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    'liquid_exec',
    {
      description: 'Evaluate Liquid against a Siteglide environment via Siteglide-API.',
      inputSchema: {
        environment: z.string().describe('Environment name from .siteglide-config'),
        content: z.string().describe('Liquid source to evaluate')
      }
    },
    async (args) => {
      try {
        const auth = resolveAuth(args.environment, configPath);
        log(`liquid_exec: ${args.environment}`);
        const body = await siteglideApi(auth, {
          method: 'POST',
          path: '/cli/liquid',
          json: { content: args.content }
        });
        return toolResult(body);
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    'logs_fetch',
    {
      description: 'Fetch recent debugging logs for a Siteglide environment.',
      inputSchema: {
        environment: z.string().describe('Environment name from .siteglide-config'),
        last_id: z.number().optional().describe('Fetch logs after this id (default 0)')
      }
    },
    async (args) => {
      try {
        const auth = resolveAuth(args.environment, configPath);
        log(`logs_fetch: ${args.environment}`);
        const body = await siteglideApi(auth, {
          method: 'GET',
          path: '/cli/logs',
          query: { last_id: args.last_id ?? 0 }
        });
        return toolResult(body);
      } catch (error) {
        return toolError(error);
      }
    }
  );
}
