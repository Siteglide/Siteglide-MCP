# Siteglide vs platformOS (short)

| Siteglide | platformOS | note |
| --- | --- | --- |
| marketplace_builder/ (legacy) | app/ | Prefer `app/`. `siteglide-cli pull` renames legacy folders |
| page template | layout | Similar role; Siteglide may use templates/ + numeric IDs |
| webapp | records / tables | CMS data models |
| siteglide-cli | pos-cli | Different auth; Siteglide goes through Siteglide-API |

When docs disagree on folder structure or CMS integration, prefer Siteglide guidance — and prefer `app/` for the project root.
