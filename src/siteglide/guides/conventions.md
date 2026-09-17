# Siteglide vs platformOS (short)

| Siteglide | platformOS | note |
| --- | --- | --- |
| marketplace_builder/ (legacy) | app/ | Same site-root role. Prefer whichever root the project already uses; `siteglide-cli pull` does **not** rename between them |
| page template | layout | Similar role; Siteglide may use templates/ + numeric IDs |
| webapp | records / tables | CMS data models |
| siteglide-cli | pos-cli | Different auth; Siteglide goes through Siteglide-API |
| .siteglide-config | (secrets) | NEVER read this file as an agent — use MCP `envs_list` / ops tools |
| .siteglide/user/ | local CLI runtime | Gitignore — sync status, locks, AI preferences; not for remotes |
| .siteglide/project/ | team settings | Commit — e.g. `modules.json` (`pull_behaviour`, cached `installed.<env>` from MCP); not gitignored |

## `app/` vs `marketplace_builder/`

`marketplace_builder/` is the **legacy Siteglide folder name** for what platformOS now calls **`app/`**. Content layout under either root is the same role (views, assets, schema, etc.).

- Keep the project's existing site root. **`siteglide-cli pull` does not rename** `marketplace_builder/` ↔ `app/`.
- If a project uses `marketplace_builder/` (or diagnostics/tools print `app/...` while disk uses the legacy name), treat **`app/` and `marketplace_builder/` as equivalent site roots**.
- platformOS node modules, docs, and checks often hardcode **`app/`**. Interpret those paths/globs/errors as applying just as validly under **`marketplace_builder/`** for the same relative path. Do not assume the project is broken solely because the on-disk root is named `marketplace_builder/`.

When docs disagree on folder structure or CMS integration, prefer Siteglide guidance — and do not invent a second site root.
