const path = require('node:path');
const { inspectNativePackage } = require('./native-package.cjs');

function createNativePreview() {
  let inspecting = false;
  return async function preview(chooseFile) {
    if (inspecting)
      throw new Error('Wait for the current package inspection to finish.');
    inspecting = true;
    try {
      const file = await chooseFile();
      if (!file) return null;
      if (
        typeof file !== 'string' ||
        path.extname(file).toLowerCase() !== '.loadstone'
      )
        throw new Error('Choose a .loadstone package.');
      let result;
      try {
        result = await inspectNativePackage(file);
      } catch {
        throw new Error(
          'The package could not be verified. It may be damaged, unsupported or contain unsafe entries.',
        );
      }
      const { recipe, summary, recipeSha256 } = result;
      return {
        name: recipe.name,
        version: recipe.version,
        author: recipe.author,
        game: recipe.game,
        profile: recipe.launch.profile,
        requiredGames: summary.requiredGames,
        outputs: summary.outputs,
        installBytes: summary.installBytes,
        downloadSources: recipe.sources.filter((v) =>
          ['nexus-archive', 'https-archive'].includes(v.type),
        ).length,
        gameSources: recipe.sources.filter((v) => v.type === 'game-file')
          .length,
        payloadSources: recipe.sources.filter((v) => v.type === 'payload')
          .length,
        recipeSha256,
        saveCompatibility: recipe.saveCompatibility,
      };
    } finally {
      inspecting = false;
    }
  };
}
module.exports = { createNativePreview };
