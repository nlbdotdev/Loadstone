# The Loadstone handbook

Your next playthrough starts with a setup you can understand. This handbook explains how to install, inspect, maintain and create Loadstone setups, with the same source documentation used by the project itself.

Loadstone is a Windows developer preview built with Svelte and Electron. Native installation, source verification, recovery and library tools are implemented. Complete featured packages and 1.0 release acceptance are still in progress. A successful file check or a game reaching its menu is not a completed gameplay test.

## Choose your path

- **Players:** begin with [Your first setup](quick-start.md), then [install a native setup](../../docs/native-guided-install.md). Learn what review screens mean before admitting a candidate to your library.
- **Creators:** follow the [creator workflow](creator-workflow.md), starting with the installed version as evidence and tracing every required file to a reproducible source.
- **Contributors:** read the [development guide](development.md), [contribution rules](../../CONTRIBUTING.md) and [agent guide](../../AGENTS.md). Behavior and documentation should change together.

## Game support direction

| Game | Direction | What this means today |
| --- | --- | --- |
| Fallout: New Vegas | Primary support target | Native workflows are implemented; each setup still needs its own acceptance. |
| Fallout 3 | Through Tale of Two Wastelands | Standalone Fallout 3 is outside the supported direction. TTW requires the appropriate owned source games. |
| Fallout 4 | In development | Do not infer a tested setup from game detection or an example catalog entry. |
| Skyrim | In development | Source/edition requirements must be declared by the setup. |
| Starfield | Planned | Currently unsupported. |

## Three different things to verify

**Source identity:** the archive or owned-game file is exactly the version a recipe requests. **Reconstruction:** the resulting files and declared timestamps match the recipe. **Playable acceptance:** that particular game, profile and application version actually launch, play, save and reload correctly. Each answers a different question.

## About this edition

This is a local, searchable handbook. The pages are compiled from an explicit list of repository Markdown files; they are not fetched from a hosted service. Search includes page text. Source links lead to the matching public repository file. The complete Markdown agent edition is available from the navigation footer. Historical pages live in Archive and describe their own versions.

For current release gates, use [Path to 1.0](../../docs/1.0-plan.md). For definitions, use the [glossary](glossary.md). For a failed operation, start with [troubleshooting](troubleshooting.md).
