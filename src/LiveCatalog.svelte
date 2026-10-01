<script lang="ts">
  import { onMount } from 'svelte';
  import {
    FileText,
    Folder,
    ShieldCheck,
    AlertCircle,
    CheckCircle2,
  } from '@lucide/svelte';
  import type { Manifest, DiscoveredGame, Preflight } from './types';
  let { onstarted }: { onstarted: () => void } = $props();
  let installRoot = $state('');
  let lists = $state<Manifest[]>([]);
  let games = $state<DiscoveredGame[]>([]);
  let warnings = $state<string[]>([]);
  let selected = $state<Manifest | null>(null);
  let gameFolder = $state('');
  let destination = $state('');
  let result = $state<Preflight | null>(null);
  let busy = $state(false);
  let error = $state('');
  const names = {
    fnv: 'Fallout: New Vegas',
    skyrimse: 'Skyrim Special Edition',
    fallout4: 'Fallout 4',
  };
  async function run(fn: () => Promise<void>) {
    if (busy) return;
    busy = true;
    error = '';
    try {
      await fn();
    } catch (e) {
      error =
        e instanceof Error
          ? e.message.replace(
              /^Error invoking remote method '[^']+': Error: /,
              '',
            )
          : 'Could not complete this operation.';
    } finally {
      busy = false;
    }
  }
  async function refresh() {
    const found = await window.loadstone.discoverGames();
    games = found.games;
    warnings = found.warnings;
  }
  function select(list: Manifest) {
    selected = list;
    result = null;
    gameFolder = games.find((g) => g.id === list.game.id)?.folder || '';
    destination = `${installRoot}\\${list.id}-${list.version.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 40)}`;
  }
  onMount(() => {
    void run(async () => {
      lists = await window.loadstone.liveCatalog();
      installRoot = await window.loadstone.liveInstallRoot();
      await refresh();
    });
  });
</script>

<section class="live-catalog" aria-label="Live setups">
  <div class="live-toolbar">
    <div>
      <h2>Your setup manifests</h2>
      <p>
        Import a creator’s manifest and its original Wabbajack archive to check
        compatibility.
      </p>
    </div>
    <button
      class="secondary"
      disabled={busy}
      onclick={() =>
        run(async () => {
          const imported = await window.loadstone.importManifest();
          if (imported) {
            lists = imported;
            select(imported.at(-1)!);
          }
        })}><FileText size={16} />Import setup</button
    >
  </div>
  {#if error}<p class="live-error" role="alert">{error}</p>{/if}
  {#if !lists.length}<div class="empty-state">
      <FileText size={32} />
      <h2>No live setups imported</h2>
      <p>
        Live installations need a versioned manifest with game hashes, storage
        requirements, launch settings, and author credits. Prepare the engine
        and connect your Nexus account in Settings before installing.
      </p>
    </div>{/if}
  <div class="live-list-grid">
    {#each lists as list}<button
        class="live-list"
        class:selected={selected?.id === list.id}
        onclick={() => select(list)}
        ><span class="eyebrow">{names[list.game.id]} · {list.version}</span>
        <h3>{list.name}</h3>
        <p>{list.description}</p>
        <span>By {list.author}</span></button
      >{/each}
  </div>
  {#if selected}
    <section class="live-preflight" aria-label="Setup compatibility">
      <h2>{selected.name}</h2>
      <p>
        Supported game versions: {selected.game.versions.join(', ')}. Requires {(
          (selected.storage.downloadBytes + selected.storage.installBytes) /
          1e9
        ).toFixed(1)} GB including downloads.
      </p>
      {#if selected.update}<div class="live-checks">
          <strong>Fresh installation of version {selected.version}</strong>
          <p>
            Updates from: {selected.update.fromVersions.join(', ')}.
            Creator-declared save compatibility: {selected.update
              .saveCompatibility}.
          </p>
          <p>{selected.update.notes}</p>
          <p>
            Choose a separate empty folder. Your previous installation remains
            available for rollback. Saves and custom changes are not copied
            automatically; follow the creator’s guidance before transferring
            anything.
          </p>
        </div>{/if}
      <label for="live-game">Game installation</label>
      <div class="live-folder">
        <input
          id="live-game"
          value={gameFolder}
          oninput={(e) => {
            gameFolder = e.currentTarget.value;
            result = null;
          }}
          placeholder="Choose your installed game folder"
        /><button
          class="secondary"
          disabled={busy}
          aria-label="Choose game folder"
          onclick={() =>
            run(async () => {
              const folder = await window.loadstone.pickDirectory();
              if (folder) {
                gameFolder = folder;
                result = null;
              }
            })}><Folder size={16} /></button
        >
      </div>
      {#each games.filter((g) => g.id === selected?.game.id) as game}<button
          class="text-button"
          onclick={() => {
            gameFolder = game.folder;
            result = null;
          }}>Use Steam installation: {game.folder}</button
        >{/each}
      <label for="live-destination">Setup installation</label>
      <div class="live-folder">
        <input
          id="live-destination"
          value={destination}
          oninput={(e) => {
            destination = e.currentTarget.value;
            result = null;
          }}
        /><button
          class="secondary"
          disabled={busy}
          aria-label="Choose live setup folder"
          onclick={() =>
            run(async () => {
              const folder = await window.loadstone.pickDirectory();
              if (folder) {
                destination = folder;
                result = null;
              }
            })}><Folder size={16} /></button
        >
      </div>
      <button
        class="primary"
        disabled={busy || !gameFolder || !destination}
        onclick={() =>
          run(async () => {
            result = await window.loadstone.preflight({
              id: selected!.id,
              gameFolder,
              destination,
            });
          })}
        ><ShieldCheck size={16} />{busy
          ? 'Checking…'
          : 'Check compatibility'}</button
      >
      {#if result}<div class="live-checks" aria-live="polite">
          {#each result.checks as check}<div
              class="live-check"
              class:failed={check.status === 'fail'}
            >
              {#if check.status === 'pass'}<CheckCircle2
                  size={18}
                />{:else}<AlertCircle size={18} />{/if}
              <div>
                <strong>{check.name}</strong>
                <p>{check.detail}</p>
              </div>
            </div>{/each}
        </div>{/if}
      {#if result?.ready}<button
          class="primary"
          disabled={busy}
          onclick={() =>
            run(async () => {
              await window.loadstone.installLive({
                id: selected!.id,
                gameFolder,
                destination,
              });
              onstarted();
            })}>Install this setup</button
        >{/if}
      <details>
        <summary>Credits and distribution information</summary
        >{#each selected.credits as credit}<p>
            <strong>{credit.name}</strong> by {credit.author}<br
            />{credit.license}<br /><span class="live-source"
              >{credit.source}</span
            >
          </p>{/each}
      </details>
    </section>
  {/if}
  {#if warnings.length}<details>
      <summary>Game discovery notices</summary>{#each warnings as warning}<p>
          {warning}
        </p>{/each}
    </details>{/if}
</section>

<style>
  .live-catalog {
    margin-top: 24px;
  }
  .live-toolbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 24px;
  }
  h2 {
    font-size: 22px;
    margin: 0 0 10px;
  }
  h3 {
    font-size: 20px;
    margin: 12px 0;
  }
  p {
    color: var(--muted, #a2aaa6);
    line-height: 1.6;
  }
  .live-list-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 16px;
    margin: 24px 0;
  }
  .live-list {
    display: block;
    text-align: left;
    padding: 24px;
    background: #1c2122;
    border: 1px solid #35403e;
    border-radius: 12px;
    color: #e9e5db;
  }
  .live-list.selected {
    border-color: #bb8c61;
  }
  .live-list span {
    color: #b6bcb7;
  }
  .live-preflight {
    background: #1c2122;
    padding: 28px;
    border: 1px solid #35403e;
    border-radius: 12px;
  }
  label {
    display: block;
    margin: 22px 0 8px;
    font-weight: 600;
  }
  .live-folder {
    display: flex;
    gap: 10px;
    margin-bottom: 12px;
  }
  input {
    flex: 1;
    min-width: 0;
    color: #e9e5db;
    background: #151819;
    border: 1px solid #35403e;
    padding: 12px;
    border-radius: 6px;
  }
  .live-checks {
    margin: 24px 0;
  }
  .live-check {
    display: flex;
    gap: 12px;
    margin: 16px 0;
    color: #8bb8a4;
  }
  .live-check.failed,
  .live-error {
    color: #dca37e;
  }
  .live-check p {
    margin: 5px 0;
  }
  details {
    margin-top: 24px;
  }
  summary {
    cursor: pointer;
  }
  .live-source {
    overflow-wrap: anywhere;
  }
</style>
