import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const __dirname = dirname(fileURLToPath(import.meta.url));

const RULES = {
  'siteglide-core': join(__dirname, 'rules', 'siteglide-core.md')
};

const GUIDES = {
  conventions: join(__dirname, 'guides', 'conventions.md')
};
/**
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 */
export function registerSiteglideTools(server) {
  server.registerTool(
    'siteglide_rules',
    {
      description: 'Load Siteglide agent rules (MUST / prefer conventions for Siteglide projects).',
      inputSchema: {
        name: z.enum(['siteglide-core']).optional().describe('Rule set name. Defaults to siteglide-core.')
      }
    },
    async (args) => {
      const name = args.name ?? 'siteglide-core';
      const text = readFileSync(RULES[name], 'utf8');
      return { content: [{ type: 'text', text }] };
    }
  );

  server.registerTool(
    'siteglide_guide',
    {
      description: 'Load a short Siteglide guidance doc (e.g. platformOS terminology conflicts).',
      inputSchema: {
        name: z.enum(['conventions']).optional().describe('Guide name. Defaults to conventions.')
      }
    },
    async (args) => {
      const name = args.name ?? 'conventions';
      const text = readFileSync(GUIDES[name], 'utf8');
      return { content: [{ type: 'text', text }] };
    }
  );
}
