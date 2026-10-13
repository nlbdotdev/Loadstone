<script lang="ts">
  import { onMount } from 'svelte';
  import SteamShortcut from './SteamShortcut.svelte';
  import type { NativeLibraryState, NativeLibraryPlan } from './types';
  let { onrepair }: { onrepair?: () => void } = $props();
  let libraryState = $state<NativeLibraryState>({
    entries: [],
    busy: false,
    progress: null,
    error: null,
  });
  let plan = $state<NativeLibraryPlan | null>(null);
  let busy = $state(false),
    error = $state(''),
    message = $state('');
  const locked = $derived(busy || libraryState.busy || !!libraryState.error);
  onMount(() => {
    let mounted = true;
    const refresh = async () => {
      try {
        const next = await window.loadstone.nativeLibrary();
        if (mounted) libraryState = next;
      } catch {
        if (mounted) error = 'Could not read the native library.';
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 500);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  });
  async function action(fn: () => Promise<unknown>) {
    if (busy) return;
    busy = true;
    error = '';
    message = '';
    try {
      await fn();
      libraryState = await window.loadstone.nativeLibrary();
    } catch (e) {
      error =
        e instanceof Error
          ? e.message.replace(
              /^Error invoking remote method '[^']+': Error: /,
              '',
            )
          : 'Could not update the native library.';
    } finally {
      busy = false;
    }
  }
</script>

<section aria-label="Native setups">
  <div class="page-heading">
    <div>
      <p class="eyebrow">YOUR LIVE WORKSPACE</p>
      <h1>Your native setups.</h1>
      <p>
        Add a completed .loadstone candidate after checking its recipe files and
        isolated profile.
      </p>
      <p>Keep MO2 and the game closed while verifying files.</p>
    </div>
    <button
      class="primary"
      disabled={locked}
      onclick={() =>
        action(async () => {
          plan = null;
          plan = await window.loadstone.prepareNativeLibrary();
        })}>Add native candidate</button
    >
  </div>
  {#if libraryState.error || error}<p class="error" role="alert">
      {libraryState.error || error}
    </p>{/if}
  {#if message}<p role="status">{message}</p>{/if}
  {#if libraryState.progress}
    <div class="card" role="status">
      <p>
        {{
          verification: 'Checking recipe files',
          inventory: 'Scanning candidate entries',
          'removal-review': 'Reviewing removal',
          removal: 'Processing reviewed files',
          'repair-review': 'Reviewing repair files',
          'repair-downloads': 'Acquiring repair archives',
          repair: 'Repairing and verifying files',
        }[libraryState.progress.phase || 'verification']}:
        {libraryState.progress.completed.toLocaleString()}
        {#if libraryState.progress.total}
          / {libraryState.progress.total.toLocaleString()}{/if}
      </p>
      {#if libraryState.progress.total}
        <progress
          max={Math.max(1, libraryState.progress.total)}
          value={libraryState.progress.completed}
        ></progress>
      {:else}<progress aria-label="Scanning candidate entries"></progress>{/if}
      <button
        class="secondary"
        onclick={() => window.loadstone.cancelNativeVerification()}
        >{libraryState.progress.phase?.startsWith('repair')
          ? 'Stop repair'
          : libraryState.progress.phase === 'removal'
            ? 'Stop removal'
            : 'Cancel verification'}</button
      >
    </div>
  {/if}
  {#if plan}
    <div class="card review">
      <p class="eyebrow">REVIEW CANDIDATE</p>
      <h2>{plan.name} · {plan.version}</h2>
      <p class="path">{plan.root}</p>
      <p>
        {plan.fileCount.toLocaleString()} recipe outputs checked. Profile: {plan.profile}.
      </p>
      <p>
        Save guidance: {plan.saveCompatibility.status}. {plan.saveCompatibility
          .notes}
      </p>
      <p>
        Local saves and settings are enabled. Existing saves are not imported.
        Only add candidates from creators you trust: they contain executable
        code. File verification does not certify gameplay.
      </p>
      <div class="actions">
        <button
          class="primary"
          disabled={locked}
          onclick={() =>
            action(async () => {
              if (plan) await window.loadstone.registerNativeLibrary(plan.id);
              plan = null;
              message =
                'Native candidate added. Launch and shortcut controls are available below.';
            })}>Add to library</button
        >
        <button
          class="secondary"
          disabled={locked}
          onclick={() => {
            plan = null;
          }}>Dismiss</button
        >
      </div>
    </div>
  {/if}
  {#if !libraryState.entries.length && !plan}<p class="empty">
      No native setups registered. Start a .loadstone setup in Discover, then
      review it for My library from Downloads. You can also add an existing
      completed candidate here.
    </p>{/if}
  {#each libraryState.entries as entry (entry.id)}
    <article class="card">
      <p class="eyebrow">
        {entry.status === 'removed'
          ? 'REMOVED NATIVE SETUP'
          : 'NATIVE CANDIDATE'}
      </p>
      <h2>{entry.name} <span>{entry.version}</span></h2>
      <p class="path">{entry.root}</p>
      {#if entry.maintenanceError}<p class="error">
          {entry.maintenanceError}
        </p>{/if}
      {#if entry.repair}
        <p role="status">
          {entry.repair.completedAt
            ? 'Repair completed. Recipe replacements and retained personal files were verified.'
            : entry.status === 'repairing'
              ? 'Repair in progress. Launch is disabled.'
              : 'Repair is incomplete. Review again to continue.'}
        </p>
        <p class="path">Repair copies: {entry.root}/{entry.repair.directory}</p>
        {#if entry.repair.completedAt}<p>
            {entry.repair.preserved.toLocaleString()} changed personal files preserved.
            A strict recipe comparison may still report these differences.
          </p>{/if}
      {/if}
      {#if ['installed', 'repair-failed'].includes(entry.status)}
        <button
          class="secondary"
          disabled={locked}
          onclick={() =>
            action(async () => {
              if (await window.loadstone.repairNativeSetup(entry.id))
                onrepair?.();
            })}
          >{entry.status === 'repair-failed'
            ? 'Review repair again'
            : 'Repair native setup'}</button
        >
      {/if}
      {#if entry.status === 'installed'}
        <button
          class="secondary"
          disabled={locked}
          onclick={() =>
            action(async () => {
              if (await window.loadstone.updateNativeSetup(entry.id))
                onrepair?.();
            })}>Install another version</button
        >
        <p>
          Profile {entry.profile} · {entry.fileCount.toLocaleString()} recipe outputs
          checked on {new Date(entry.verifiedAt).toLocaleString()}.
        </p>
        <p>Save guidance: {entry.saveStatus}. {entry.saveNotes}</p>
        <p>
          Launch checks the manager, game executable and local profile paths.
          Gameplay acceptance is still required.
        </p>
        <div class="actions">
          <button
            class="primary"
            disabled={locked ||
              entry.launch?.phase === 'open' ||
              entry.launch?.phase === 'starting'}
            onclick={() =>
              action(() => window.loadstone.launchNative(entry.id))}
            >Launch native setup</button
          >
          <button
            class="secondary"
            disabled={locked}
            onclick={() =>
              action(async () => {
                await window.loadstone.verifyNativeLibrary(entry.id);
                message =
                  'Recipe files and profile isolation verified. No files were changed.';
              })}>Verify recipe files</button
          >
          <button
            class="secondary"
            disabled={locked}
            onclick={() =>
              action(async () => {
                message = await window.loadstone.nativeDesktopShortcut(
                  entry.id,
                );
              })}>Add or repair desktop shortcut</button
          >
        </div>
        <SteamShortcut jobId={entry.id} native />
        {#if entry.launch}<p role="status">{entry.launch.message}</p>{/if}
      {:else if entry.recoveryRoot}
        <p role="status">
          {entry.status === 'removed'
            ? 'Native setup removed. Retained data is available in the recovery folder.'
            : 'Native removal is incomplete. Remaining files are retained for recovery.'}
        </p>
        <p class="path">Recovery folder: {entry.recoveryRoot}</p>
        {#if entry.status === 'removed'}
          {#if entry.shortcutsCleaned}<p>Owned shortcuts cleaned up.</p>
          {:else}
            {#if entry.shortcutError}<p class="error">
                {entry.shortcutError}
              </p>{/if}
            <button
              class="secondary"
              disabled={locked}
              onclick={() =>
                action(() => window.loadstone.cleanupNativeShortcuts(entry.id))}
              >Clean up native shortcuts</button
            >
          {/if}
        {/if}
      {/if}
      {#if !['removed', 'repairing'].includes(entry.status)}
        <button
          class="secondary"
          disabled={locked}
          onclick={() => action(() => window.loadstone.removeNative(entry.id))}
        >
          {['installed', 'repair-failed'].includes(entry.status)
            ? 'Remove native setup'
            : 'Resume native removal'}
        </button>
      {/if}
    </article>
  {/each}
</section>

<style>
  section {
    margin-bottom: 48px;
  }
  .page-heading,
  .actions {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }
  .page-heading {
    justify-content: space-between;
  }
  .page-heading > div {
    max-width: 660px;
  }
  .card {
    background: #151b1b;
    border: 1px solid #34413b;
    border-radius: 12px;
    padding: 24px;
    margin: 20px 0;
  }
  .review {
    border-color: #b99d62;
  }
  h2 {
    margin: 8px 0 16px;
  }
  h2 span {
    font-size: 15px;
    color: #a4aaa6;
    font-weight: 400;
  }
  p {
    color: #adb5af;
    line-height: 1.6;
  }
  .path {
    overflow-wrap: anywhere;
  }
  .error {
    color: #e0a882;
  }
  .empty {
    padding: 20px 0;
  }
  progress {
    display: block;
    width: 100%;
    accent-color: #b99d62;
    margin: 12px 0;
  }
</style>
