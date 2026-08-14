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
import { getTargetAudience } from './targetAudience.js';

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
        'Also reads .siteglide/sync/current-conflict.json — the live sync prompt awaiting the human. ' +
        'After YOU edit a file while sync_status.active is true: wait ~1–2s, then call with path (and changedAt ISO of your edit) ' +
        'to see if sync raised a remote conflict for that save. Use forPath.isCurrent / forPath.freshness (compare detectedAt vs changedAt). ' +
        'Advise the user; they must choose on the CLI prompt — do not assume merge/force/skip/cancel. ' +
        'Prefer this over IDE terminal scrollback. recommendedActions[].id values are stable (e.g. merge_first, resolve_conflicts).',
      inputSchema: {
        environment: z
          .string()
          .optional()
          .describe('Optional environment name; omit to list all conflict logs'),
        path: z
          .string()
          .optional()
          .describe(
            'Project or physical path you just changed (e.g. app/views/pages/home.liquid or views/pages/home.liquid). Used to match current-conflict / logs.'
          ),
        changedAt: z
          .string()
          .optional()
          .describe(
            'ISO timestamp of your edit/save. Compared to detectedAt / localMtimeAtDetect to decide if the warning is about this change.'
          )
      }
    },
    async (args) => {
      try {
        const status = getRemoteCheckStatus({
          projectDir,
          environment: args?.environment,
          path: args?.path,
          changedAt: args?.changedAt
        });
        log(
          `remote_check_status: activeConflict=${status.activeConflict} awaitingSync=${status.awaitingSyncUserDecision} forPath=${status.forPath?.freshness || 'n/a'}`
        );
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
        'When needsSetupWizard is true: at most once per unique chat, show setupOffer.message (git vs GitHub + why Siteglide recommends git), ' +
        'then ask setupOffer.question — do not re-pitch later in the same chat. ' +
        'If they accept: install git / identity / git init; unless they opt out, commit all files with message "initial commit" ' +
        'BEFORE any optional remote connect. ' +
        'During setup, ensure .gitignore includes .siteglide/ (local CLI state — updated during sync/deploy/pull; not for remotes) ' +
        'and .siteglide-config before the initial commit. Response includes siteglideMetadataGitignore (recommended, ignored, reason, actionNeeded). ' +
        'If they opt into a remote: elicit organisation, new vs existing repo (with options), and public/private; ' +
        'for existing remotes with history + local code, guide merge with --allow-unrelated-histories (never overwrite blindly). ' +
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
    'audience',
    {
      description:
        'Read or fill .siteglide/project-preferences.json target_audience (role, git, Siteglide CLI). ' +
        'Call early in a Siteglide session. If any value is null, prompt the user with the allowed options, then write the file. ' +
        'When complete, follow languageGuidance: define git terms for git beginners; explain sync/deploy/pull for Siteglide CLI beginners; ' +
        'pass role through and interpret it yourself. Pass answers here if the user already chose in chat (use siteglideCli for CLI experience).',
      inputSchema: {
        role: z
          .string()
          .optional()
          .describe('designer | business leader | developer | tester | marketing | seo | support | other'),
        git: z.string().optional().describe('beginner | advanced'),
        siteglideCli: z.string().optional().describe('Siteglide CLI experience: beginner | advanced')
      }
    },
    async (args) => {
      try {
        const status = await getTargetAudience({
          projectDir,
          server,
          answers: {
            role: args?.role,
            git: args?.git,
            siteglideCli: args?.siteglideCli
          }
        });
        log(`audience: complete=${status.complete} missing=${(status.missing || []).join(',')}`);
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
