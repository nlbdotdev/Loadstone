# Native MO2 configuration generation

Experimental creator support: a `mo2-config` action generates a new `ModOrganizer.ini` bound to the chosen candidate folder. It does not import an existing INI, copy account settings, run MO2 or certify a playable list. Existing copy/extract recipes remain supported unchanged; older Loadstone builds reject this new action.

## Recipe declaration

This is the only output kind without a static `bytes`/`sha256` pair or a source reference:

```json
{
  "path": "ModOrganizer.ini",
  "action": {
    "type": "mo2-config",
    "executables": [
      {
        "title": "New Vegas",
        "binary": "Game/FalloutNV.exe",
        "workingDirectory": "Game"
      }
    ]
  }
}
```

There must be 1–64 entries. Titles are unique without regard to case, trimmed, well-formed text of 1–100 characters without controls. Each binary is a safe, relative, declared `.exe` output. Its working directory is its exact relative parent, or `.` for an executable at the candidate root. The entry whose title exactly matches `launch.executable` must be under `launch.gameRoot`. The recipe must also declare an empty `portable.txt` output with the SHA-256 of zero bytes. A file cannot shadow `downloads`, `mods`, `profiles`, `overwrite` or `webcache`.

There are no arbitrary INI keys, scripts, executable arguments, environment variables or source-machine paths in this action. Tools needing arguments require additional typed support; do not silently remove their arguments and call the result equivalent. Supporting an executable entry does not run it during reconstruction.

## Deterministic rendering and verification

The canonical recipe fingerprint locks all generator inputs. Before creating a destination, the materializer renders UTF-8/LF configuration for that absolute Windows drive path and computes the resulting exact byte length and SHA-256. Stream verification and the final on-disk pass use this derived fingerprint. The receipt's `generatedConfigurations` array records `{path, generator, bytes, sha256}` without embedding the destination. Static copy/extract outputs retain their existing exact fingerprint contract. A `mo2-config` output cannot also declare a static fingerprint: rendered bytes depend on the destination.

The generator produces these sections in order, with a blank line between sections and a final LF:

- `General`: game name (`TTW`, `New Vegas`, `Skyrim Special Edition` or `Fallout 4`), local game path, selected profile and `first_start=false`.
- `Settings`: local base, downloads, mods, profiles, overwrite and webcache paths; `profile_local_inis=true` and `profile_local_saves=true` defaults.
- `customExecutables`: array size, then each entry's title, local binary, local working directory and empty arguments, preserving declared entry order.

Paths use `/`. Qt string values are double-quoted, escape backslash and quote, and double a leading `@`. Game path and selected profile use `@ByteArray(...)` with every UTF-8 byte encoded as lowercase `\xNN`. The implementation in `electron/native-mo2-config.cjs` defines the exact serialization; byte changes require a new generator action identity, not a silent change to an existing recipe's meaning.

Generated files are limited to 1 MB. Package inspection reserves that allowance in `installBytes` and exposes `generatedConfigurations`; the desktop explains the allowance. Destinations for this action are limited to local Windows drive paths of 2,048 characters without controls or literal `%BASE_DIR%`, which MO2 would interpret as a variable. Normal materializer protection, exclusive creation and cancellation rules still apply. Required empty MO2 state directories are created inside the candidate. A cancelled or failed candidate is retained.

## Scope and acceptance

This creates a fresh manager configuration. It does not preserve personal interface preferences, plugin-specific settings, external tools, account data or recent directories. Any behavior required by a featured baseline must be identified and modeled before claiming equivalence. Existing profile `settings.ini`, game INIs, plugin configuration and tool arguments still require review. In particular, the defaults above do **not** prove that an existing profile uses local saves: profile-specific flags can override defaults. Native candidates remain **Files verified · Launch untested**, outside the playable library.

Absolute paths are deliberately bound at installation. Moving a finished candidate does not automatically update them; rebuild into a new destination until relocation/repair is implemented. This action does not patch arbitrary existing text, transform mods, convert TTW, download sources or create shortcuts.

Path and executable semantics were checked against the [ModdingLinked MO2 settings implementation](https://github.com/ModdingLinked/modorganizer/blob/9c130cb/src/settings.cpp), [MO2 executable loading](https://github.com/ModOrganizer2/modorganizer/blob/master/src/executableslist.cpp), and [Qt INI serialization](https://github.com/qt/qtbase/blob/6.7/src/corelib/io/qsettings.cpp). The original generator does not copy upstream implementation code. MO2's mod-directory setting is `mod_directory` (singular); installed inventory now honors it.

Tests cover different destinations, non-ASCII and INI delimiter encoding, invalid references and fields, final-file tampering, destination refusal and the real Electron review/build/restart workflow. Inventory and existing launch-layout checks decode the generated UTF-8 byte arrays and quoted strings; unrelated binary INI state is not decoded or exported. A private interoperability check also read synthetic generated configuration through Qt 6.7.1's actual `QSettings`, including UTF-8 byte arrays, literal `@`, quoted delimiters and executable arrays. This verifies serialization, not MO2 launch or gameplay.
