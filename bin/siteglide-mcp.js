#!/usr/bin/env node
/**
 * Stdio MCP entry — stdout is reserved for JSON-RPC; log only to stderr.
 */
import { resolve } from 'node:path';
import { startSiteglideMcp } from '../src/stdio.js';

const args = process.argv.slice(2);
const projectFlagIndex = args.indexOf('--project');
const projectDir = resolve(
  (projectFlagIndex !== -1 && args[projectFlagIndex + 1]) ||
    args.find((arg) => arg.startsWith('--project='))?.slice('--project='.length) ||
    process.env.SITEGLIDE_MCP_PROJECT_DIR ||
    process.env.POS_SUPERVISOR_PROJECT_DIR ||
    process.cwd()
);

await startSiteglideMcp({ projectDir });
