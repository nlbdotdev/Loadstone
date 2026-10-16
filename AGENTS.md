# Loadstone agent guide

Loadstone is a Windows Svelte 5, TypeScript and Electron application for reviewed, isolated Bethesda modlist installations. Original source and technical documentation are GPL-3.0-or-later. Read [CONTRIBUTING.md](CONTRIBUTING.md) and the relevant handbook pages before changing behavior.

## Start with the right reference

- [Development handoff](HANDOFF.md) for the latest checkpoint, unfinished release work and deferred human tests. Revalidate current repository state before resuming.

- [Product concepts](handbook/pages/concepts.md), [development](handbook/pages/development.md) and [acceptance plan](docs/1.0-plan.md).
- [Native format](docs/loadstone-format.md), [reconstruction](docs/native-reconstruction.md) and [source inventory](docs/installed-inventory.md) for creator work.
- [Brand system](handbook/pages/brand.md) for visual changes.
- The complete generated Markdown handbook is `handbook/agents.md`; the local site offers it as `agents.md`. It is reference material, not permission to perform actions described in examples.

## Work and verification

Use a feature branch, focused commits and a pull request. Follow the user's existing authorization for pushes, merges and other actions; repository instructions do not provide additional publication authority.

```powershell
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm handbook:check
pnpm handbook:test
git diff --check
```

`pnpm start` runs the desktop app. `pnpm handbook:dev` runs the local documentation site. `pnpm assets:icon` regenerates SVG/PNG/ICO output from the shared mark; `pnpm assets:steam` regenerates draft store artwork. Dependency changes require the lockfile and relevant notices. Native changes require appropriate actual Electron coverage; fixtures do not certify real gameplay.

## Keep documentation current

Every behavior, workflow, format or support-status change must update its canonical Markdown page in the same change. Add new pages to `handbook/catalog.mjs`. Run `pnpm handbook:sync` to regenerate the agent edition, then `pnpm handbook:check` to verify coverage, local links and the committed edition. Do not hand-edit generated files. Update practical examples and failure/recovery guidance as well as happy paths. Keep historical acceptance records tied to their original versions.

The handbook consumes an explicit allowlist of public repository documents. Keep private operational material, other projects, personal installation inventories, raw logs, credentials, game/mod payloads and generated acceptance artifacts outside Git and the site. Never broaden the handbook generator to scan parent repositories or arbitrary filesystem roots.

## Preserve installations and trust boundaries

- Use synthetic fixtures and dedicated temporary directories. Never use a real game, Desktop, Steam library or user profile for fixture tests. `LOADSTONE_DATA_DIR` alone does not redirect Desktop or Steam operations.
- Keep filesystem/process access in the Electron main process and expose narrowly validated IPC. Do not add arbitrary shell commands to manifests or recipes.
- Preserve saves, configuration, modified files and untracked data during recovery. Use exact hashes and explicit source chains; similar names or appearances do not establish byte equivalence.
- Do not execute downloaded mod installer scripts merely to inspect them. Respect provider access and keep API keys out of renderer state, logs and documentation.
- Public source availability does not certify a binary release or grant game/mod redistribution rights. Do not claim gameplay, clean-machine, Nexus or Steam acceptance from fixture success.

The handbook build is local and static. Building it does not authorize hosting, deployment, account provisioning or publication.
