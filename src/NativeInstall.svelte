<script lang="ts">
  import { onMount } from 'svelte';
  import {
    PackageOpen,
    Folder,
    ArrowRight,
    Download,
    CheckCircle2,
  } from '@lucide/svelte';
  import type {
    NativeGuideState,
    NativeBuild,
    NativeLibraryState,
    Bridge,
  } from './types';
  let { onstarted }: { onstarted: (repair: boolean) => void } = $props();
  let setup = $state<NativeGuideState | null>(null);
  let recoveryActivity = $state<NativeBuild['activity']>(undefined);
  let repairProgress = $state<NativeLibraryState['progress']>(null);
  let busy = $state(false),
    error = $state(''),
    query = $state(''),
    page = $state(0);
  const names: Record<string, string> = {
    fnv: 'Fallout: New Vegas',
    fallout3: 'Fallout 3',
    skyrimse: 'Skyrim Special Edition',
    fallout4: 'Fallout 4',
  };
  const saves = {
    compatible: 'Creator declares compatible saves',
    unknown: 'Save compatibility is not established',
    'new-save-required': 'Start a new game',
  };
  const archives = $derived(
    (setup?.archives || []).filter((v) =>
      v.id.toLowerCase().includes(query.toLowerCase()),
    ),
  );
  const visible = $derived(archives.slice(page * 20, (page + 1) * 20));
  async function run(operation: () => Promise<void>) {
    if (busy) return;
    busy = true;
    error = '';
    try {
      await operation();
    } catch (e) {
      error =
        e instanceof Error
          ? e.message.replace(
              /^Error invoking remote method '[^']+': Error: /,
              '',
            )
          : 'Could not prepare this native installation.';
    } finally {
      busy = false;
    }
  }
  function select(
    kind: Parameters<Bridge['selectNativeInput']>[1],
    key?: string,
    token?: string,
  ) {
    return run(async () => {
      if (setup)
        setup = await window.loadstone.selectNativeInput(
          setup.id,
          kind,
          key,
          token,
        );
    });
  }
  onMount(() => {
    let stopped = false,
      reading = false;
    void run(async () => {
      setup = await window.loadstone.nativeGuide();
    });
    const timer = setInterval(async () => {
      if (!busy || (!setup?.resumeId && !setup?.repair)) {
        recoveryActivity = undefined;
        repairProgress = null;
        return;
      }
      if (reading) return;
      reading = true;
      try {
        if (setup.repair) {
          const state = await window.loadstone.nativeLibrary();
          if (!stopped) repairProgress = state.progress;
          return;
        }
        const jobs = await window.loadstone.nativeBuilds();
        if (!stopped)
          recoveryActivity = jobs.find(
            (v) => v.id === setup?.resumeId,
          )?.activity;
      } catch {
        /* The current operation reports its own failure. */
      } finally {
        reading = false;
      }
    }, 500);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  });
</script>

<section class="native-install" aria-label="Install a native setup">
  <div class="toolbar">
    <div>
      <p class="eyebrow">YOUR NEXT JOURNEY</p>
      <h2>
        {setup?.repair
          ? 'Repair your installed setup.'
          : setup?.update
            ? 'Try another version. Keep your playthrough.'
            : 'Bring your .loadstone setup.'}
      </h2>
      <p>
        Select your games and sources. Loadstone handles reconstruction and
        verification.
      </p>
    </div>
    <button
      class="primary"
      disabled={busy}
      onclick={() =>
        run(async () => {
          const imported = await window.loadstone.importNativeSetup();
          if (imported) {
            setup = imported;
            query = '';
            page = 0;
          } else setup = await window.loadstone.nativeGuide();
        })}><PackageOpen size={18} />Open .loadstone</button
    >
  </div>
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  {#if busy}<p role="status">Preparing your selection…</p>{/if}
  {#if busy && setup?.repair}
    {#if repairProgress}<p role="status">
        Checking repair files: {repairProgress.completed.toLocaleString()} / {repairProgress.total.toLocaleString()}
      </p>{/if}
    <button
      class="secondary"
      onclick={() => window.loadstone.cancelNativeVerification()}
      >Cancel repair review</button
    >
  {/if}
  {#if busy && setup?.resumeId}
    {#if recoveryActivity}<p role="status">
        Checking retained files: {recoveryActivity.completed.toLocaleString()} / {recoveryActivity.total.toLocaleString()}
      </p>
      <progress
        value={recoveryActivity.completed}
        max={Math.max(1, recoveryActivity.total)}
        aria-label="Retained file verification"
      ></progress>{/if}
    <button
      class="secondary"
      onclick={async () => {
        try {
          if (setup?.resumeId)
            await window.loadstone.cancelNativeBuild(setup.resumeId);
        } catch (e) {
          error =
            e instanceof Error
              ? e.message
              : 'Could not cancel recovery review.';
        }
      }}>Cancel recovery review</button
    >
  {/if}
  {#if setup}
    <div class="setup-heading">
      <span class="eyebrow"
        >{names[setup.game.id]}{setup.game.variant === 'ttw'
          ? ' · Tale of Two Wastelands'
          : ''}</span
      >
      <h3>{setup.name} <span>v{setup.version}</span></h3>
      <p>{setup.description}</p>
      <p>
        By {setup.author} · {setup.outputs.toLocaleString()} files · up to {(
          setup.installBytes / 1e9
        ).toFixed(2)} GB installed
      </p>
    </div>
    <div class="save-note">
      <strong>{saves[setup.saveCompatibility.status]}</strong>
      <p>{setup.saveCompatibility.notes}</p>
      <p>
        Existing saves are not imported automatically. This preview still
        requires gameplay acceptance.
      </p>
    </div>
    {#if setup.update}
      <div class="save-note">
        <strong
          >{setup.update.version} → {setup.version}: a separate installation</strong
        >
        <p>
          Your current setup, personal settings, saves and shortcuts stay
          available here:
        </p>
        <code>{setup.update.root}</code>
        <p>
          The selected version uses its own profile and recipe settings.
          Personal mods, settings and saves are not copied. Review the creator’s
          save guidance above before considering a manual transfer; “compatible”
          is the creator’s claim.
        </p>
        <p>
          After verification, add the new folder as a separate library entry.
          You can continue using the original version and remove either setup
          separately.
        </p>
      </div>
    {/if}
    {#if setup.repair}
      <div class="save-note">
        <strong>Repair the registered version in its existing folder</strong>
        <p>
          Missing files are rebuilt. Changed game/mod files are retained before
          replacement. Saves and untracked files stay in place. Existing
          profiles and configuration are kept by default.
        </p>
        <label
          ><input
            type="checkbox"
            disabled={busy}
            checked={setup.repair.restoreConfiguration}
            onchange={(event) =>
              select(
                'configuration',
                event.currentTarget.checked ? 'restore' : 'preserve',
              )}
          />Restore changed profiles and configuration to this recipe too</label
        >
        {#if setup.repair.restoreConfiguration}<p>
            This restores recipe settings and mod order. Previous versions are
            retained in the repair recovery folder; saves are never restored or
            imported.
          </p>{/if}
      </div>
    {/if}
    <h4>1. Your owned games</h4>
    {#each setup.games as game}
      <div class="input-row">
        <div>
          <strong>{names[game.id]} · {game.store.toUpperCase()}</strong><code
            >{game.folder || 'Choose the version required by this setup'}</code
          >
        </div>
        <button
          class="secondary"
          disabled={busy}
          onclick={() => select('game', game.id)}
          ><Folder size={16} />Choose {names[game.id]}</button
        >
      </div>
      {#each game.detected as found}<button
          class="text-button"
          disabled={busy}
          onclick={() => select('game', game.id, found.token)}
          >Use detected installation: {found.folder}</button
        >{/each}
    {/each}
    <p class="note">
      Detected folders are suggestions. Required file versions are checked
      before installation writes. Fallout 3 for TTW and GOG installations can be
      selected manually.
    </p>
    {#if setup.prerequisites.length}
      <h4>2. Prepared prerequisites</h4>
      {#each setup.prerequisites as item}
        <div class="input-row">
          <div>
            <strong>{item.name} {item.version}</strong>
            <p class="note">
              {item.files.toLocaleString()} required files · {item.instructions}
            </p>
            <code>{item.folder || 'Select the locally prepared files'}</code>
          </div>
          <button
            class="secondary"
            disabled={busy}
            onclick={() => select('prerequisite', item.id)}
            ><Folder size={16} />Choose {item.name}</button
          >
        </div>
      {/each}
      <p class="note">
        Prepare these with the creator’s instructions first. Loadstone checks
        their bytes and does not run a converter.
      </p>
    {/if}
    {#if setup.archives.length}
      <h4>Original archives</h4>
      <p>
        {setup.archives.filter((v) => v.file === null).length.toLocaleString()} downloads
        selected · {setup.archives
          .filter((v) => v.file !== null)
          .length.toLocaleString()} local archives
      </p>
      <p class="note">
        Automatic Nexus downloads require a connected Premium account in
        Settings. Free accounts can select manually downloaded original
        archives. Existing verified cache files are reused.
      </p>
      <label
        >Find an archive<input
          type="search"
          bind:value={query}
          oninput={() => (page = 0)}
          placeholder="Search by source name"
        /></label
      >
      {#each visible as archive}
        <div class="archive">
          <strong>{archive.id}</strong>
          <p class="note">
            {archive.credit} · {(archive.bytes / 1e6).toFixed(1)} MB
          </p>
          <code>{archive.source}</code>
          <p class="note">
            {archive.file
              ? 'Local archive selected'
              : 'Download from original source'}
          </p>
          {#if archive.file}<code>{archive.file}</code>{/if}
          <div class="actions">
            <button
              class="secondary"
              disabled={busy}
              onclick={() => select('archive', archive.id)}
              ><Folder size={15} />Choose archive</button
            >
            {#if archive.file}<button
                class="secondary"
                disabled={busy}
                onclick={() => select('download', archive.id)}
                ><Download size={15} />Use original download</button
              >{/if}
          </div>
        </div>
      {/each}
      {#if archives.length > 20}<div class="actions">
          <button class="secondary" disabled={page === 0} onclick={() => page--}
            >Previous sources</button
          ><span>{page + 1} / {Math.ceil(archives.length / 20)}</span><button
            class="secondary"
            disabled={(page + 1) * 20 >= archives.length}
            onclick={() => page++}>Next sources</button
          >
        </div>{/if}
    {/if}
    <h4>Installation location</h4>
    <div class="input-row">
      <div>
        <code
          >{setup.repair?.destination ||
            setup.parent ||
            'Choose a folder for this installation'}</code
        >
        <p class="note">
          {setup.repair
            ? 'Repair keeps this registered installation folder.'
            : setup.resumeId
              ? 'Resume keeps the original installation folder.'
              : 'A separate folder is created here. Existing game installations stay intact.'}
        </p>
      </div>
      {#if !setup.resumeId && !setup.repair}<button
          class="secondary"
          disabled={busy}
          onclick={() => select('parent')}
          ><Folder size={16} />Choose installation location</button
        >{/if}
    </div>
    <button
      class="primary"
      disabled={busy || !setup.ready}
      onclick={() =>
        run(async () => {
          if (setup) setup = await window.loadstone.reviewNativeSetup(setup.id);
        })}
      ><CheckCircle2 size={17} />{setup.repair
        ? 'Review repair'
        : 'Review installation'}</button
    >
    {#if setup.plan}{@const plan = setup.plan}
      <section class="confirmation" aria-label="Review native installation">
        <span class="eyebrow">READY FOR SOURCE VERIFICATION</span>
        <h3>
          {plan.repair
            ? 'Repair this setup'
            : setup.update
              ? 'Install a separate version'
              : plan.resume
                ? 'Resume this setup'
                : 'Install this setup'}
        </h3>
        <code>{plan.destination}</code>
        {#if setup.update}<p>
            Keep {setup.update.name}
            {setup.update.version} in its current folder. Install {setup.version}
            here with fresh settings and no imported saves. Existing shortcuts continue
            to open the original version.
          </p>{/if}
        <p>
          {plan.outputs.toLocaleString()} output files · {(
            plan.installBytes / 1e9
          ).toFixed(2)} GB · {plan.downloadCount} archives to acquire
        </p>
        {#if plan.downloadCount}<p class="note">
            Up to {(plan.downloadBytes / 1e9).toFixed(2)} GB of original downloads.
            Sources: {plan.downloadHosts.slice(0, 20).join(' · ')}. Cache: {plan.downloadCache}
          </p>{/if}
        {#if plan.archiveTool}<p class="note">
            Archive reader: {plan.archiveTool}
          </p>{/if}
        {#if plan.repair}
          <p>
            {plan.repair.reused.toLocaleString()} matching files · {plan.repair.missing.toLocaleString()}
            missing files · {plan.repair.conflicts.toLocaleString()} changed files
            to retain and replace · {plan.repair.preserved.toLocaleString()} changed
            personal files to keep.
          </p>
          {#if plan.repair.preservedPaths.length}<p class="note">
              Kept changes (up to 20): {plan.repair.preservedPaths.join(' · ')}
            </p>{/if}
          <code>{plan.repair.recoveryRoot}</code>
          <p class="note">
            Stop repair from My library. An interrupted repair requires a fresh
            review and keeps launch disabled until the files and isolated
            profile pass. Existing direct shortcuts do not run Loadstone’s
            checks; keep MO2 and games closed.
          </p>
        {/if}
        {#if plan.resume}<p>
            {plan.resume.reused.toLocaleString()} matching files to reuse · {plan.resume.missing.toLocaleString()}
            missing files · {plan.resume.conflicts.toLocaleString()} changed files
            to retain before rebuilding.
          </p>
          <code>{plan.resume.recoveryRoot}</code>{/if}
        {#if !plan.repair}<p class="note">
            Inputs and final files must pass their checks. Keep games and MO2
            closed. You can cancel in Downloads and review a resume later.
            Completion offers library review and optional shortcuts; it starts
            no game and imports no saves.
          </p>{/if}
        <button
          class="primary"
          disabled={busy}
          onclick={() =>
            run(async () => {
              if (setup) {
                await window.loadstone.installNativeSetup(setup.id, plan.id);
                onstarted(Boolean(setup.repair));
              }
            })}
          >{plan.repair
            ? 'Repair installed setup'
            : setup.update
              ? 'Install separate version'
              : plan.resume
                ? 'Resume installation'
                : 'Install native setup'}<ArrowRight size={17} /></button
        >
      </section>
    {/if}
  {/if}
</section>

<style>
  .native-install {
    margin: 24px 0 40px;
    padding: 28px;
    background: #1c2122;
    border: 1px solid #35403e;
    border-radius: 12px;
    color: #f0eee9;
  }
  .toolbar,
  .input-row,
  .actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 18px;
    flex-wrap: wrap;
  }
  .toolbar > div,
  .input-row > div {
    flex: 1;
    min-width: 240px;
  }
  h2 {
    font-size: 26px;
    margin: 8px 0;
  }
  h3 {
    font-size: 23px;
    margin: 12px 0;
  }
  h3 span {
    color: #aab4ae;
    font-size: 15px;
  }
  h4 {
    font-size: 17px;
    margin: 26px 0 12px;
  }
  p {
    line-height: 1.6;
    color: #b4bdb7;
    overflow-wrap: anywhere;
  }
  .note {
    font-size: 13px;
  }
  code {
    display: block;
    font-size: 12px;
    line-height: 1.7;
    overflow-wrap: anywhere;
    color: #c9d1ca;
  }
  .setup-heading,
  .confirmation {
    border-top: 1px solid #35403e;
    padding-top: 22px;
    margin-top: 26px;
  }
  .input-row {
    padding: 14px 0;
    border-bottom: 1px solid #303a37;
  }
  .save-note {
    padding: 16px 20px;
    background: #282924;
    border-left: 3px solid #c79d77;
    border-radius: 4px;
  }
  .save-note p {
    margin: 6px 0;
  }
  .archive {
    padding: 16px 0;
    border-bottom: 1px solid #35403e;
  }
  .actions {
    justify-content: flex-start;
    margin-top: 12px;
  }
  label {
    display: block;
    font-size: 13px;
    color: #b4bdb7;
  }
  input {
    display: block;
    width: 100%;
    box-sizing: border-box;
    margin-top: 7px;
    padding: 11px;
    border: 1px solid #35403e;
    border-radius: 6px;
    color: #f0eee9;
    background: #151819;
  }
  input[type='checkbox'] {
    display: inline;
    width: auto;
    margin-right: 8px;
  }
  .error {
    color: #edaa95;
  }
  strong,
  button {
    overflow-wrap: anywhere;
  }
  .text-button {
    text-align: left;
    word-break: break-word;
  }
</style>
