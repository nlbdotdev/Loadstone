const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { candidateMetadata } = require('./native-library.cjs');
const { ordinaryFile } = require('./native-package.cjs');

// An update is a fresh, independent candidate. The selected registration is
// evidence for the version comparison, never a destination for writes.
class NativeUpdate {
  constructor(library, id) {
    library.available();
    this.library = library;
    this.id = id;
    this.snapshot = null;
  }
  review(recipe, context, destination) {
    const library = this.library;
    if (library.error) throw new Error(library.error);
    const entry = library.record(this.id);
    if (entry.status !== 'installed')
      throw new Error(
        'Choose an installed native setup before selecting another version.',
      );
    if (library.launcher.sessions.get(this.id)?.child)
      throw new Error(
        'Close the launched mod manager before preparing another version.',
      );
    ordinaryFile(library.file, 1_000_000);
    const registryHash = crypto
      .createHash('sha256')
      .update(fs.readFileSync(library.file))
      .digest('hex');
    if (registryHash !== library.savedHash)
      throw new Error(
        'Native library state changed outside this session. Restart Loadstone before continuing.',
      );
    const meta = candidateMetadata(entry.root, entry);
    const snapshot = JSON.stringify({ entry, registryHash });
    if (context && (!this.snapshot || this.snapshot !== snapshot))
      throw new Error(
        'The original setup changed. Select its update package again.',
      );
    if (
      recipe.id !== meta.recipe.id ||
      recipe.game.id !== meta.recipe.game.id ||
      recipe.game.variant !== meta.recipe.game.variant
    )
      throw new Error(
        'Choose a package for the same setup ID, game and game variant.',
      );
    if (recipe.version === meta.recipe.version)
      throw new Error(
        'This is the installed version. Use Repair native setup, or choose a different version.',
      );
    if (destination) {
      const original = path.resolve(entry.root).toLowerCase();
      const target = path.resolve(destination).toLowerCase();
      if (
        target === original ||
        target.startsWith(original + path.sep) ||
        original.startsWith(target + path.sep)
      )
        throw new Error(
          'Install the other version in a separate folder outside the original setup.',
        );
    }
    this.snapshot = snapshot;
    return {
      entryId: entry.id,
      name: entry.name,
      version: entry.version,
      root: entry.root,
    };
  }
}
module.exports = { NativeUpdate };
