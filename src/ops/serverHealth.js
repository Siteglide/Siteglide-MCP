import { readMcpSessionMarker, mcpSessionMarkerPath } from './sessionMarker.js';

/** Shown in MCP server instructions and mcp_server_status for agents diagnosing client-side timeouts. */
export const MCP_TIMEOUT_GUIDANCE = {
  summary:
    'A tool call timeout with a connection/transport error usually means the Siteglide MCP stdio process is hung, crashed, or not connected — not that the specific tool is slow.',
  catalogStaleWarning:
    'The IDE tool catalog can still list Siteglide tools while the live MCP session is dead. Do not trust "namespace ready" alone.',
  firstStep:
    'Call mcp_server_status first when unsure. If mcp_server_status also times out, report a dead MCP session to the user — do not substitute shell probes for envs_list or other ops tools.',
  userRecovery:
    'Ask the user to restart the Siteglide MCP server in Cursor MCP settings, or run Developer: Reload Window. If it keeps failing, verify siteglide-mcp starts: `siteglide-mcp --project <site-root>` and check the Output panel for [siteglide-mcp] lines.',
  commonCause:
    'A prior tool may have blocked the single-threaded stdio server (historically gh auth status without a timeout). After restart, retry mcp_server_status then envs_list.',
  filesystemFallback:
    'When MCP is unreachable, the user can inspect .siteglide/user/mcp-session.json for the last recorded server pid and startedAt (marker is written on successful MCP connect).'
};

export const MCP_SERVER_INSTRUCTIONS = [
  'Siteglide MCP runs as a single stdio process per Cursor session.',
  'If ANY tool (including envs_list or git_status) times out with a connection error while the tool catalog still shows Siteglide tools, treat the MCP session as dead — not the individual tool.',
  'Call mcp_server_status to verify connectivity; if that times out too, tell the user to restart Siteglide MCP or Reload Window.',
  'Do not run local shell/git probes as a substitute for envs_list, graphql_exec, or other MCP ops when the failure was a transport timeout.',
  'Before env-scoped ops, call envs_list with details: true. NEVER read .siteglide-config.',
  'For live sync detection, call sync_status (reads .siteglide/user/sync/).'
].join(' ');

/**
 * @param {{ projectDir: string, version: string, startedAt: string, startedAtMs: number }} meta
 */
export function getServerHealth(meta) {
  const uptimeMs = Math.max(0, Date.now() - meta.startedAtMs);
  const marker = readMcpSessionMarker(meta.projectDir);

  return {
    ok: true,
    alive: true,
    pid: process.pid,
    uptimeMs,
    projectDir: meta.projectDir,
    version: meta.version,
    startedAt: meta.startedAt,
    sessionMarker: {
      path: mcpSessionMarkerPath(meta.projectDir),
      present: Boolean(marker),
      pid: marker?.pid,
      startedAt: marker?.startedAt
    },
    timeoutGuidance: MCP_TIMEOUT_GUIDANCE,
    nextSteps: [
      'If this response arrived, the MCP stdio server is handling requests.',
      'If other tools time out but mcp_server_status works, report which tool hung and ask the user to restart MCP.',
      'If mcp_server_status times out, follow timeoutGuidance.userRecovery for the user.'
    ]
  };
}
