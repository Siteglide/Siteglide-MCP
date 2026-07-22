# Siteglide MCP (Experimental)

Experimental **Siteglide MCP server** for desktop AI agents (Cursor, Claude Code, VS Code, Windsurf). HTTP/Docker for browser agents is deferred.

## Capabilities (stdio / desktop)

| Tool | Purpose | Auth |
| --- | --- | --- |
| `validate_code` | Lint Liquid/GraphQL/YAML before write (platformOS check engine) | None (local FS) |
| `siteglide_rules` | Load Siteglide agent rules | None |
| `siteglide_guide` | Load short Siteglide convention guide | None |
| `envs_list` | List environments from `.siteglide-config` | Config file |
| `graphql_exec` | Run GraphQL via Siteglide-API | Siteglide auth |
| `liquid_exec` | Evaluate Liquid via Siteglide-API | Siteglide auth |
| `logs_fetch` | Fetch recent site logs | Siteglide auth |

**Project layout:** use `app/` (platformOS modern root). `siteglide-cli pull` migrates `marketplace_builder/` → `app/` when needed (`git mv` in a git repo, otherwise rename).

## Run

```bash
cd Siteglide-MCP---Experimental
npm install
node bin/siteglide-mcp.js --project /path/to/site

# Or via siteglide-cli:
siteglide-cli pull staging   # also registers MCP in IDE configs if missing
siteglide-cli mcp --project .
```

## Compose model

Depends on `@platformos/platformos-check-node` (same engine as `@platformos/platformos-mcp-supervisor`) without forking supervisor source. Siteglide owns stdio lifecycle, rules, and ops tools.

## Workspace role

| Related root | Role |
| --- | --- |
| **This repo** | Source of truth for Siteglide MCP |
| `siteglide-cli` | `pull` (skills + MCP IDE registration + app layout migrate), thin `mcp` launcher |
| `platformos-tools` | Upstream supervisor / check architecture reference |
| `Siteglide-API` | Auth proxy for ops tools |

## Status

Desktop / stdio v1. HTTP/SSE + Docker later.
