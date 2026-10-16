# Maintain this handbook

The handbook is a local Svelte site built from repository Markdown. Detailed specifications stay in `docs/`; practical guides live in `handbook/pages/`. The catalog explicitly lists approved public pages with their audience, title and summary. There is no database or hosted content service.

## Run it locally

```powershell
pnpm handbook:dev
```

Open the loopback URL printed by Vite. The site has local full-text search, grouped navigation, section links, mobile navigation, previous/next pages, source links and a downloadable agent edition. No deployment is performed.

For a static preview:

```powershell
pnpm handbook:build
pnpm handbook:preview
```

The generated site goes into ignored `handbook/dist/`. Its hash-based routes work on an ordinary static server without rewrite rules. Assets, page content and dependency notices are local. External reference/source links open only when selected.

## Update a page

Edit the canonical Markdown file whenever behavior changes. The site compiles that file directly; do not create a second manually maintained copy of its technical specification. Update examples, limitations and recovery steps together. Put past observations in historical records and identify their version, rather than presenting them as current release certification.

## Add a page

Add the Markdown file and a record in `handbook/catalog.mjs`. Choose a group that matches its intended reader. Use normal relative Markdown links to other source pages. Heading links are checked against generated section IDs. Source-code and other repository-file links point to the public repository; screenshots referenced by approved documents are copied into the local build.

Raw HTML is shown as text. The compiler accepts normal Markdown and approved local image files, and rejects unsafe URL schemes. Do not add remote image trackers, scripts or private repository paths.

## Keep the agent edition aligned

```powershell
pnpm handbook:sync
pnpm handbook:check
```

`handbook/agents.md` is the complete generated Markdown edition. The root `AGENTS.md` is its concise contributor entry point. The site serves the complete edition as `agents.md`. Its contents are source-backed reference material; command examples are not authorization to execute actions.

The check verifies catalog coverage, unique routes, local documentation links and headings, and exact agreement with the committed agent edition. `pnpm handbook:test` builds the site and exercises actual browser navigation, search, deep links, keyboard access, code copying and all pages at desktop/mobile widths. CI runs both commands. After changing documentation, commit the regenerated edition with the source edits. Do not edit it by hand.

## Public-source boundary

Only catalog-listed files from this repository are eligible. Do not scan parent workspaces, include acceptance logs or copy personal inventories into a page. Keep credentials and game/mod payloads outside both Git and the handbook output. Building or updating the site does not publish it.
