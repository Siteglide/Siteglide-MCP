import { isAbsolute, join } from 'node:path';
import { z } from 'zod';
import { lintBuffer, Severity } from '@platformos/platformos-check-node';

const SEVERITY = {
  [Severity.ERROR]: 'error',
  [Severity.WARNING]: 'warning',
  [Severity.INFO]: 'info'
};

export const VALIDATE_CODE_INPUT = {
  file_path: z
    .string()
    .describe('Path of the file under edit (absolute, or relative to the project root).'),
  content: z.string().describe('The file contents to validate (the in-memory buffer).'),
  mode: z
    .enum(['full', 'quick'])
    .optional()
    .describe('Analysis depth. full (default) or quick.')
};

function toDiagnostic(offense) {
  return {
    check: offense.check,
    severity: SEVERITY[offense.severity] ?? 'error',
    message: offense.message,
    line: offense.start.line + 1,
    column: offense.start.character + 1,
    end_line: offense.end.line + 1,
    end_column: offense.end.character + 1
  };
}

function assembleResult(diagnostics, _mode) {
  const errors = diagnostics.filter((d) => d.severity === 'error');
  const warnings = diagnostics.filter((d) => d.severity === 'warning');
  const infos = diagnostics.filter((d) => d.severity === 'info');
  const status = errors.length > 0 ? 'error' : warnings.length > 0 ? 'warning' : 'ok';

  return {
    status,
    must_fix_before_write: errors.length > 0,
    errors,
    warnings,
    infos,
    proposed_fixes: [],
    clusters: [],
    scorecard: [],
    parse_error: null,
    tips: [],
    domain_guide: null,
    structural: null
  };
}

/**
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {object} ctx
 */
export function registerValidateCode(server, ctx) {
  server.registerTool(
    'validate_code',
    {
      description:
        'Validate a Siteglide / platformOS Liquid, GraphQL, or YAML file before writing it. ' +
        'Returns structured errors, warnings, and a must_fix_before_write gate. ' +
        'Expects a modern app/ project layout (siteglide-cli pull migrates marketplace_builder → app).',
      inputSchema: VALIDATE_CODE_INPUT
    },
    async (args) => {
      const mode = args.mode ?? 'full';
      const absoluteFilePath = isAbsolute(args.file_path)
        ? args.file_path
        : join(ctx.projectDir, args.file_path);

      ctx.log(`validate_code: ${args.file_path} (${mode})`);

      const offenses = await lintBuffer({
        root: ctx.projectDir,
        filePath: absoluteFilePath,
        content: args.content
      });
      const result = assembleResult(offenses.map(toDiagnostic), mode);

      return {
        content: [{ type: 'text', text: JSON.stringify(result) }]
      };
    }
  );
}
