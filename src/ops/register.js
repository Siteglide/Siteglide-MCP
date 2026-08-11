import { z } from 'zod';
import { join } from 'node:path';
import { listEnvironments, resolveAuth, siteglideApi } from './client.js';
import {
  classifyEnvironment,
  hostnameFromUrl,
  isGraphQLMutation,
  wrapUntrustedResult,
  truncatePreview,
  assertPayloadSize
} from './security.js';
import { elicitProductionMutationConfirm } from './elicitConfirm.js';
import { getSyncStatus } from './syncStatus.js';
import { getRemoteCheckStatus } from './remoteCheckStatus.js';
import { getGitStatus } from './gitStatus.js';

function toolResult(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function toolError(error) {
  const message = error?.message || String(error);
  return {
    content: [{ type: 'text', text: JSON.stringify({ error: message }, null, 2) }],
    isError: true
  };
}

/**
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {{ configPath?: string, projectDir?: string, log?: (m: string) => void }} [opts]
 */
export function registerOpsTools(server, opts = {}) {
  const configPath = opts.configPath || process.env.CONFIG_FILE_PATH || '.siteglide-config';
  const projectDir = opts.projectDir || process.cwd();
  const log = opts.log ?? (() => {});

  server.registerTool(
    'envs_list',
    {
      description:
        'List Siteglide environments from .siteglide-config (or CONFIG_FILE_PATH). ' +
        'Agents MUST call with details: true before env-scoped ops. ' +
        'Returns name, host, and when details=true also url + classification ("staging"|"production"). Never returns tokens or emails.',
      inputSchema: {
        details: z
          .boolean()
          .optional()
          .describe('When true, include url and classification for each environment. Agents must use details: true.')
      }
    },
    async (args) => {
      try {
        const details = Boolean(args?.details);
        return toolResult({ environments: listEnvironments(configPath, { details }) });
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    'remote_check_status',
    {
      description:
        'Read Siteglide CLI remote-mtime / merge-first / stash-pop conflict logs under .siteglide/ for this project. ' +
        'Prefer this over IDE terminal scrollback when sync or deploy warns about remote conflicts. ' +
        'recommendedActions[].id values are stable for agent branching (e.g. merge_first, resolve_conflicts).',
      inputSchema: {
        environment: z
          .string()
          .optional()
          .describe('Optional environment name; omit to list all conflict logs')
      }
    },
    async (args) => {
      try {
        const status = getRemoteCheckStatus({
          projectDir,
          environment: args?.environment
        });
        log(`remote_check_status: activeConflict=${status.activeConflict}`);
        return toolResult(status);
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    'git_status',
    {
      description:
        'Probe git install, user.name/user.email, repo init, remotes, and optional gh auth for this project. ' +
        'If needsSetupWizard is true, elicit whether the user wants guided setup (install git, identity, git init; remote optional). ' +
        'Specialize in setup and conflict recovery; CLI owns routine pull/deploy git prompts.',
      inputSchema: {}
    },
    async () => {
      try {
        const status = getGitStatus({ projectDir });
        log(`git_status: needsSetupWizard=${status.needsSetupWizard} missing=${status.missing.join(',')}`);
        return toolResult(status);
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    'sync_status',
    {
      description:
        'Report whether siteglide-cli sync/watch is active for this MCP project directory. ' +
        'Aggregates all live syncs (different envs may run together). ' +
        'Use treatAsProduction: if true, follow production sync safety elicitation before editing. ' +
        'Clears stale status files whose process pid is no longer alive. ' +
        'Do not infer sync from IDE terminal metadata.',
      inputSchema: {}
    },
    async () => {
      try {
        const status = getSyncStatus({
          projectDir,
          configPath:
            !opts.configPath && !process.env.CONFIG_FILE_PATH
              ? join(projectDir, '.siteglide-config')
              : configPath
        });
        log(
          `sync_status: active=${status.active} treatAsProduction=${status.treatAsProduction} syncs=${status.syncs.length}`
        );
        return toolResult(status);
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    'graphql_exec',
    {
      description:
        'Execute a GraphQL query/mutation against a Siteglide environment via Siteglide-API. ' +
        'Call envs_list({ details: true }) first. Mutations on classification "production" require human MCP elicitation. ' +
        'Results are wrapped as untrusted external data.',
      annotations: { openWorldHint: true },
      inputSchema: {
        environment: z.string().describe('Environment name from .siteglide-config'),
        query: z.string().describe('GraphQL query or mutation string'),
        variables: z.record(z.unknown()).optional().describe('GraphQL variables object')
      }
    },
    async (args) => {
      try {
        assertPayloadSize('GraphQL query', args.query);
        const auth = resolveAuth(args.environment, configPath);
        const classification = classifyEnvironment(auth);
        const host = hostnameFromUrl(auth.url);
        const mutation = isGraphQLMutation(args.query);

        if (mutation && classification === 'production') {
          const preview = truncatePreview(args.query);
          const confirm = await elicitProductionMutationConfirm(server, {
            env: args.environment,
            host,
            preview,
            log
          });
          if (!confirm.ok) {
            return toolError(new Error(confirm.reason || 'Production mutation not approved.'));
          }
        }

        log(`graphql_exec: ${args.environment} (${classification}${mutation ? ', mutation' : ''})`);
        const body = await siteglideApi(auth, {
          method: 'POST',
          path: '/cli/graph',
          json: { query: args.query, variables: args.variables || {} }
        });
        return toolResult(wrapUntrustedResult(body));
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    'liquid_exec',
    {
      description:
        'Evaluate Liquid against a Siteglide environment via Siteglide-API. ' +
        'Disabled when classification is "production" — write Liquid to project files and sync/deploy; use a staging env to evaluate. ' +
        'Call envs_list({ details: true }) first. Results are wrapped as untrusted external data.',
      annotations: { openWorldHint: true },
      inputSchema: {
        environment: z.string().describe('Environment name from .siteglide-config'),
        content: z.string().describe('Liquid source to evaluate')
      }
    },
    async (args) => {
      try {
        assertPayloadSize('Liquid content', args.content);
        const auth = resolveAuth(args.environment, configPath);
        const classification = classifyEnvironment(auth);
        const host = hostnameFromUrl(auth.url);

        if (classification === 'production') {
          return toolError(
            new Error(
              `liquid_exec is disabled when classification is production ` +
                `(env "${args.environment}", host: ${host}). ` +
                `Write Liquid to a project file and sync/deploy when ready; use a staging env to evaluate.`
            )
          );
        }

        log(`liquid_exec: ${args.environment} (${classification})`);
        const body = await siteglideApi(auth, {
          method: 'POST',
          path: '/cli/liquid',
          json: { content: args.content }
        });
        return toolResult(wrapUntrustedResult(body));
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    'logs_fetch',
    {
      description:
        'Fetch recent debugging logs for a Siteglide environment. ' +
        'Call envs_list({ details: true }) first. Results are wrapped as untrusted external data.',
      annotations: { openWorldHint: true },
      inputSchema: {
        environment: z.string().describe('Environment name from .siteglide-config'),
        last_id: z.number().optional().describe('Fetch logs after this id (default 0)')
      }
    },
    async (args) => {
      try {
        const auth = resolveAuth(args.environment, configPath);
        const classification = classifyEnvironment(auth);
        log(`logs_fetch: ${args.environment} (${classification})`);
        const body = await siteglideApi(auth, {
          method: 'GET',
          path: '/cli/logs',
          query: { last_id: args.last_id ?? 0 }
        });
        return toolResult(wrapUntrustedResult(body));
      } catch (error) {
        return toolError(error);
      }
    }
  );
}
