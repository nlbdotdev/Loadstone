const path = require('node:path');
const crypto = require('node:crypto');
const { inspectNativePackage, ordinaryFile } = require('./native-package.cjs');
const { archiveSource } = require('./native-downloads.cjs');
const { identity } = require('./native-build-recovery.cjs');

class NativeGuide {
  constructor(builder, options = {}) {
    this.builder = builder;
    this.options = options;
    this.draft = null;
    this.plan = null;
  }
  record(id) {
    if (!this.draft || this.draft.id !== id)
      throw new Error('Import the native package again.');
    return this.draft;
  }
  state() {
    const d = this.draft;
    if (!d) return null;
    const { recipe, summary, recipeSha256 } = d.inspected;
    return {
      id: d.id,
      recipeSha256,
      name: recipe.name,
      version: recipe.version,
      author: recipe.author,
      description: recipe.description,
      game: recipe.game,
      saveCompatibility: recipe.saveCompatibility,
      outputs: summary.outputs,
      installBytes: summary.installBytes,
      games: recipe.requirements.map((v) => ({
        id: v.id,
        store: v.store,
        folder: d.inputs.games[v.id] || null,
        detected: d.detected
          .filter((g) => g.id === v.id && g.source === v.store)
          .map(({ token, folder }) => ({ token, folder })),
      })),
      prerequisites: (recipe.prerequisites || []).map((v) => ({
        id: v.id,
        name: v.name,
        version: v.version,
        files: v.files.length,
        instructions: v.instructions,
        folder: d.inputs.prerequisites[v.id] || null,
      })),
      archives: recipe.sources.filter(archiveSource).map((v) => ({
        id: v.id,
        type: v.type,
        bytes: v.bytes,
        sha256: v.sha256,
        source:
          v.type === 'nexus-archive'
            ? `https://www.nexusmods.com/${v.game}/mods/${v.modId}?tab=files&file_id=${v.fileId}`
            : v.url,
        credit: v.credit.name,
        file: d.inputs.archives[v.id],
      })),
      parent: d.parent,
      resumeId: d.resumeId || null,
      ready:
        recipe.requirements.every((v) => Boolean(d.inputs.games[v.id])) &&
        (recipe.prerequisites || []).every((v) =>
          Boolean(d.inputs.prerequisites[v.id]),
        ) &&
        Boolean(d.parent),
      plan: this.plan?.id === this.builder.plan?.summary.id ? this.plan : null,
    };
  }
  async import(choose, resumeId) {
    return this.builder.select(async () => {
      this.plan = null;
      let job;
      if (resumeId !== undefined) {
        job = this.builder.jobs.find(
          (v) =>
            v.id === resumeId &&
            ['failed', 'cancelled', 'interrupted'].includes(v.status),
        );
        if (!job)
          throw new Error(
            'Choose an interrupted native installation to resume.',
          );
      }
      const file = await choose();
      if (!file) return null;
      if (
        typeof file !== 'string' ||
        path.extname(file).toLowerCase() !== '.loadstone'
      )
        throw new Error('Choose a .loadstone package.');
      const inspected = await inspectNativePackage(file);
      if (job && job.recipeSha256 !== inspected.recipeSha256)
        throw new Error(
          'Resume requires the exact recipe from this installation.',
        );
      const found = await this.discover();
      const detected = found.games
        .slice(0, 100)
        .filter((v) => {
          try {
            identity(v.folder, true);
            return true;
          } catch {
            return false;
          }
        })
        .map((v) => ({ ...v, token: crypto.randomUUID() }));
      const inputs = {
        games: Object.create(null),
        prerequisites: Object.create(null),
        archives: Object.create(null),
      };
      for (const required of inspected.recipe.requirements) {
        const choices = detected.filter(
          (v) => v.id === required.id && v.source === required.store,
        );
        if (choices.length === 1) inputs.games[required.id] = choices[0].folder;
      }
      for (const source of inspected.recipe.sources.filter(archiveSource))
        inputs.archives[source.id] = null;
      let parent = job
        ? path.dirname(job.destination)
        : this.options.defaultParent?.();
      try {
        identity(parent, true);
      } catch {
        parent = null;
      }
      this.draft = {
        id: crypto.randomUUID(),
        packageFile: file,
        inspected,
        inputs,
        parent,
        detected,
        resumeId,
      };
      return this.state();
    });
  }
  discover() {
    return this.options.discover
      ? this.options.discover()
      : Promise.resolve({ games: [] });
  }
  async select(id, kind, key, choose, token) {
    return this.builder.select(async () => {
      this.plan = null;
      const d = this.record(id),
        recipe = d.inspected.recipe;
      if (
        !['game', 'prerequisite', 'archive', 'download', 'parent'].includes(
          kind,
        )
      )
        throw new Error('Unsupported native selection.');
      if (kind === 'parent') {
        if (d.resumeId)
          throw new Error(
            'A resumed installation keeps its original destination.',
          );
        const parent = await choose();
        if (parent) {
          identity(parent, true);
          d.parent = path.resolve(parent);
        }
      } else {
        const requirement =
          kind === 'game'
            ? recipe.requirements.find((v) => v.id === key)
            : kind === 'prerequisite'
              ? (recipe.prerequisites || []).find((v) => v.id === key)
              : recipe.sources.find((v) => v.id === key && archiveSource(v));
        if (!requirement)
          throw new Error('That input is not declared by this recipe.');
        if (kind === 'download') d.inputs.archives[key] = null;
        else {
          let selected;
          if (token !== undefined) {
            const found = d.detected.find(
              (v) =>
                kind === 'game' &&
                v.token === token &&
                v.id === key &&
                v.source === requirement.store,
            );
            if (!found)
              throw new Error(
                'Choose a detected installation for this required game.',
              );
            selected = found.folder;
          } else selected = await choose();
          if (selected) {
            if (kind === 'archive') ordinaryFile(selected, 50_000_000_000);
            else identity(selected, true);
            const group =
              kind === 'game'
                ? 'games'
                : kind === 'prerequisite'
                  ? 'prerequisites'
                  : 'archives';
            d.inputs[group][key] = path.resolve(selected);
          }
        }
      }
      return this.state();
    });
  }
  async review(id, chooseTool) {
    const d = this.record(id);
    if (!this.state().ready)
      throw new Error(
        'Select each required game, prerequisite and installation parent.',
      );
    this.plan = null;
    this.plan = await this.builder.prepare(
      async () => ({
        packageFile: d.packageFile,
        recipeSha256: d.inspected.recipeSha256,
        inputs: d.inputs,
        parent: d.parent,
      }),
      chooseTool,
      d.resumeId,
    );
    return this.state();
  }
  start(id, planId) {
    this.record(id);
    if (!this.plan || this.plan.id !== planId)
      throw new Error('Review this native installation before starting.');
    const jobs = this.builder.start(planId);
    this.plan = null;
    return jobs;
  }
}
module.exports = { NativeGuide };
