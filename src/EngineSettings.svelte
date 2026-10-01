<script lang="ts">
  import { onMount } from 'svelte';
  import { Download, ShieldCheck, X } from '@lucide/svelte';
  import type { RuntimeStatus } from './types';
  let engine = $state<RuntimeStatus | null>(null);
  let error = $state('');
  let busy = $state(false);
  async function refresh() {
    engine = await window.loadstone.runtime();
  }
  onMount(() => {
    let mounted = true;
    const update = () =>
      window.loadstone
        .runtime()
        .then((status) => {
          if (mounted) engine = status;
        })
        .catch(() => {
          if (mounted) error = 'Could not read engine status.';
        });
    void update();
    const timer = setInterval(() => {
      void update();
    }, 500);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  });
  async function run(fn: () => Promise<RuntimeStatus>) {
    busy = true;
    error = '';
    try {
      engine = await fn();
    } catch (e) {
      error =
        e instanceof Error
          ? e.message.replace(
              /^Error invoking remote method '[^']+': Error: /,
              '',
            )
          : 'Could not prepare the engine.';
    } finally {
      busy = false;
      await refresh();
    }
  }
</script>

<section class="engine-settings" aria-label="Installation engine">
  <div>
    <h2>Installation engine</h2>
    <p>
      Loadstone uses Wabbajack to reproduce curated setups from their original
      sources.
    </p>
  </div>
  {#if engine}
    <div class="engine-summary">
      <strong>Wabbajack {engine.version}</strong><span
        class:ready={engine.status === 'ready'}>{engine.phase}</span
      >
    </div>
    {#if engine.status === 'installing'}
      <progress
        max={engine.totalBytes}
        value={engine.downloadedBytes}
        aria-label="Runtime download"
      ></progress>
      <p>
        {(engine.downloadedBytes / 1e6).toFixed(1)} / {(
          engine.totalBytes / 1e6
        ).toFixed(1)} MB downloaded
      </p>
      <button
        class="secondary"
        onclick={() => run(() => window.loadstone.cancelRuntime())}
        ><X size={16} />Cancel engine download</button
      >
    {:else}
      <div class="engine-actions">
        <button
          class="secondary"
          disabled={busy || engine.status === 'checking'}
          onclick={() => run(() => window.loadstone.installRuntime())}
          ><Download size={16} />{engine.status === 'ready' ||
          engine.status === 'error'
            ? 'Repair engine'
            : 'Install engine'}</button
        >
        {#if engine.status === 'ready'}<button
            class="secondary"
            disabled={busy}
            onclick={() => run(() => window.loadstone.verifyRuntime())}
            ><ShieldCheck size={16} />Verify engine</button
          >{/if}
      </div>
    {/if}
    {#if error || engine.error}<p class="engine-error" role="alert">
        {error || engine.error}
      </p>{/if}
  {/if}
  <p class="engine-note">
    Downloads the pinned official Windows release (146 MB), checks its SHA-256
    hash, and verifies the installer interface. No game files are changed.
    Account connection and setup installation are still in development.
  </p>
</section>

<style>
  .engine-settings {
    margin: 24px 0;
    background: #1c2122;
    border: 1px solid #35403e;
    border-radius: 12px;
    padding: 28px;
  }
  h2 {
    font-size: 22px;
    margin: 0 0 10px;
  }
  p {
    color: #a2aaa6;
    line-height: 1.6;
  }
  .engine-summary {
    display: flex;
    align-items: center;
    gap: 24px;
    margin: 24px 0;
  }
  .engine-summary span {
    color: #bba388;
  }
  .engine-summary .ready {
    color: #8bb8a4;
  }
  .engine-actions {
    display: flex;
    gap: 12px;
  }
  .engine-error {
    color: #dca37e;
  }
  progress {
    width: 100%;
    accent-color: #bb8c61;
  }
  .engine-note {
    font-size: 13px;
    margin: 20px 0 0;
  }
</style>
