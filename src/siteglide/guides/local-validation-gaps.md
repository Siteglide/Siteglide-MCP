# Local validation gaps (MissingPartial on module refs)

`validate_code` runs **only against files on disk**. On a live Siteglide instance, module references often resolve to code that **cannot exist locally**. That produces `MissingPartial` (and `must_fix_before_write: true`) even when sync/deploy would work.

This is **expected**, not a bug in the page you are editing.

## Two independent reasons module files are absent locally

| Reason | What it means |
| --- | --- |
| **Pull skip** | `siteglide-cli pull` skips built-in Siteglide platform modules by default (e.g. `siteglide_system`, `module_357`). Override with `.siteglide/project/modules.json` `pull_behaviour.include` or `pull -m <name>`. |
| **Private module trees** | platformOS modules split into `public/` and `private/`. Pull and sync deliver **public files only**. **`private/` never downloads** — IP protection and server-side code is not exposed locally. No flag or pull option changes this. |

Both apply at once for many platform modules: skipped **and** mostly private.

Liquid references do not include `public/` or `private/` in the path (e.g. `modules/siteglide_system/constants`). The linter checks both trees on disk; the instance may resolve the target from **private** code you will never have locally.

## What does **not** fix MissingPartial here

- **`siteglide-cli pull -m siteglide_system`** — only fetches **public** files for that module; private targets stay missing.
- **`pull_behaviour.include`** — same public-only limit.
- **`{% doc %}` tags** — document parameters when a partial **exists locally** (`MissingRenderPartialArguments`). They do not create files or satisfy `MissingPartial`.
- **Rewriting every caller** — e.g. removing `{% render 'modules/siteglide_system/constants' %}` from every Studio page when the module is installed on the instance.

## Agent workflow when you see MissingPartial under `modules/`

1. Note the **module name** from the path (`modules/<name>/...`).
2. Call **`modules_list`** — is `<name>` installed on the site?
3. Check disk — does `./modules/<name>/` exist in the project?
4. Classify:

| modules_list | `modules/<name>/` on disk | Likely meaning |
| --- | --- | --- |
| installed | absent | Pull skip and/or never pulled; references may still work on instance |
| installed | present (public tree only) | Target may be **private-only** on instance — expected local gap |
| installed | present, custom module | Missing path may be a **real typo** — fix the reference or add the partial |
| not installed | — | Module may be missing from the site — **stop and ask the user** (see below) |

5. If the **same** `MissingPartial` appears on **many files** (typical for Studio pages + `siteglide_system`), treat it as **one root cause**, not N separate fixes.

## Module not on `modules_list` (MUST ask the user)

When `MissingPartial` references `modules/<name>/...` and **`modules_list` does not include `<name>`**:

1. **Do not** assume a local validation gap or proceed with writes that depend on that module.
2. **Do not** remove the reference or rewrite callers without confirmation.
3. **Ask the user** to confirm whether `<name>` should be installed on this site (Admin → Modules, or their usual install path).
4. **Ask whether they want to install it** — or, if the reference is wrong, whether to change/remove it instead.

Wait for their answer before installing, editing references, or treating the error as ignorable. A missing module on the instance is a **real deploy/runtime problem**, not the same as pull skip or private IP gaps.

## `must_fix_before_write` exception

Respect `must_fix_before_write` in general. **Exception:** when the **only** blocking findings are `MissingPartial` on `modules/<name>/...` paths classified above as **expected local gaps** (**and `<name>` appears on `modules_list`**), and you are editing **caller** files (Studio pages, app partials, layouts) — **not** authoring inside that missing module — you may proceed with your intended edit.

**No exception** when the module is **not** on `modules_list` — ask the user first (section above).

Still fix genuine issues in the same `validate_code` result: syntax errors, unknown filters, real missing partials under `app/` or a **custom module that is pulled locally**, parser-blocking scripts, etc.

## Example (Studio)

`MissingPartial`: `'modules/siteglide_system/constants' does not exist` on every Studio page.

- `modules_list` includes `siteglide_system`.
- `./modules/siteglide_system/` is absent (default pull skip) or present with only public files while the target lives under private.
- **Do not** strip the render from every page.
- **Do not** pull the module expecting local lint to pass.
- **Do** continue editing the Studio section or page you were asked to change; explain the gap to the user if helpful.

## When local validation **should** block you

- Typo in `app/` or `marketplace_builder/` partial paths.
- Custom module under `./modules/my_module/` where the referenced partial should exist in your repo but does not.
- Any non–MissingPartial blocking diagnostic in the same result.
