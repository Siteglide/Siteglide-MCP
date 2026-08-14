Here’s a boss-friendly summary you can paste or trim.

---

## What we’re doing

We’re extending Siteglide’s CLI and AI tooling so agents (Cursor, Claude, and later our own web AI) can **run Siteglide work safely and consistently**, while still **riding platformOS’s latest AI validation tools** instead of reinventing them.

## Two pieces (plus skills)

**1. Siteglide MCP server (new experimental repo)**  
An MCP server is how AI tools get a standard set of “capabilities” (validate code, run queries, fetch logs, load Siteglide rules, etc.).

We’re putting that in **`Siteglide-MCP`**, not inside the CLI, so we can:
- version and ship it separately  
- later run it in **Docker / on the web** for browser-based AI agents  
- keep Siteglide-specific tooling in one place  

GraphQL, Liquid, logs, and env listing are **MCP ops tools** (they talk to Siteglide-API directly). Agents use MCP; humans can still use the existing GUI evaluators.

**2. CLI wiring (thin)**  
- `siteglide-cli mcp` — starts the composed MCP server (stdio)  
- On **`siteglide-cli pull`**, if Siteglide MCP is not already registered, the CLI adds a `siteglide` entry to Cursor, Claude Code, GitHub Copilot/VS Code, and Windsurf configs — **only adding our key**, never overwriting other MCP servers or an existing Siteglide entry  

**Also: AI skills (already in use)**  
We already guide agents with Siteglide **skills** (e.g. docs search, how our conventions differ from platformOS). Skills are **guidance**; MCP is **callable actions** with structured results. They coexist—skills don’t replace MCP, and MCP doesn’t replace skills.

On pull, module-shipped skills under `.agents` are merged and IDE skill folders are scaffolded (same pull flow that registers MCP).

## How we avoid reinventing platformOS

platformOS already ships a modern, slim MCP “supervisor” that mainly does **`validate_code`** (check Liquid/GraphQL/YAML before an agent writes bad code). That lives in their **platformos-tools** monorepo and is designed to **not depend on the old pos-cli stack**.

Our approach: **compose, don’t fork**.
- Depend on their package and take updates with a normal version bump  
- Add a **Siteglide layer on top** (our rules, guides, ops tools)  
- So when they improve validation, we inherit it without rewriting our wrapper  

There is an older, heavier “pos-supervisor” with more tools (including a big development guide). We’re **not** building on that; we want the **new thin one**.

### Siteglide layout vs platformOS (`marketplace_builder` vs `app`)

Many Siteglide sites historically used **`marketplace_builder/`** instead of modern **`app/`**.

platformOS’s tooling expects **`app/`**. Their advice: rename the folder.

**What we do:** on **`siteglide-cli pull`**, we write into the project's existing site root (`app/` if present, otherwise `marketplace_builder/`). We do **not** rename between those folders.

**For agents:** `marketplace_builder/` is the legacy name for the same site root. When platformOS node modules / docs only talk about `app/`, apply the same paths under `marketplace_builder/` if that is what is on disk.

## Auth (who needs what)

| Capability | Needs Siteglide / site auth? |
| --- | --- |
| Upstream `validate_code` | **No** — local filesystem lint only |
| Siteglide ops tools (GraphQL, Liquid, logs, list envs) | **Yes** — via Siteglide-CLI config / Siteglide-API (same path as the CLI) |

No conflict with platformOS auth: their validator doesn’t use our login; our ops tools don’t depend on pos-cli credentials.

## Near-term vs later

**Near term (v1)**  
- Local/IDE use over stdio (how Cursor/Claude talk to MCP today)  
- Ops tools like GraphQL, Liquid, logs, list environments (via MCP)  
- Siteglide rules/guides for agents (alongside existing skills)  
- Pull keeps existing `marketplace_builder/` or `app/` (no rename); agents treat them as equivalent site roots  
- CLI `mcp` launcher; MCP registration on `pull` (Cursor, Claude, Copilot, Windsurf)  

**Later**  
- Same toolset over **HTTP**, runnable in **Docker**, called by a **backend** that serves our web AI UI (browser never holds site secrets)

## Why split CLI and MCP

Same reason platformOS split their supervisor out of pos-cli: independent releases, cleaner ownership, and the MCP can serve **IDE agents and future web agents** without forcing a full CLI install.

## Why MCP if we already have skills?

Skills help the agent **know** Siteglide. MCP lets the agent **do** Siteglide work with a shared contract (validate, query, logs) across IDEs and, later, our web AI—without each client inventing its own scripts.

## Bottom line

We’re investing in **agent-ready Siteglide tooling** that stays aligned with platformOS’s AI direction, keeps our Siteglide rules modular, respects real Siteglide project layout (not only `app/`), and is structured so we can move from “developers’ IDE” to “hosted web AI” without starting over.
