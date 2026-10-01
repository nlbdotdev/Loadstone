<script lang="ts">
  import { onMount } from 'svelte';
  import type { NexusStatus } from './types';
  let account = $state<NexusStatus | null>(null);
  let key = $state(''),
    error = $state(''),
    busy = $state(false);
  async function run(fn: () => Promise<NexusStatus>) {
    if (busy) return;
    busy = true;
    error = '';
    try {
      account = await fn();
    } catch (e) {
      error =
        e instanceof Error
          ? e.message.replace(
              /^Error invoking remote method '[^']+': Error: /,
              '',
            )
          : 'Could not connect to Nexus.';
    } finally {
      key = '';
      busy = false;
    }
  }
  onMount(() => {
    void run(() => window.loadstone.nexus());
  });
</script>

<section class="nexus-settings" aria-label="Nexus Mods account">
  <h2>Nexus Mods account</h2>
  <p>
    Connect a personal API key for this private testing build. Public access
    will use a registered Loadstone connection.
  </p>
  {#if account?.connected}
    <div class="account">
      <strong>{account.name}</strong><span
        >{account.premium ? 'Premium' : 'Free membership'}</span
      >
    </div>
    <p>
      Last verified {new Date(account.verifiedAt!).toLocaleString()}. {account.premium
        ? 'Your account supports automated Nexus downloads.'
        : 'Free accounts require manual Nexus downloads; automatic downloading is unavailable.'}
    </p>
    <div class="actions">
      <button
        class="secondary"
        disabled={busy}
        onclick={() => run(() => window.loadstone.verifyNexus())}
        >Check account</button
      ><button
        class="secondary"
        disabled={busy}
        onclick={() => run(() => window.loadstone.disconnectNexus())}
        >Disconnect Nexus</button
      >
    </div>
  {:else if account?.available}
    <label for="nexus-key">Personal API key</label>
    <input
      id="nexus-key"
      type="password"
      autocomplete="off"
      spellcheck={false}
      bind:value={key}
      disabled={busy}
      placeholder="Paste your Nexus API key"
    />
    <button
      class="secondary"
      disabled={busy || !key.trim()}
      onclick={() => {
        const submitted = key;
        key = '';
        void run(() => window.loadstone.connectNexus(submitted));
      }}>{busy ? 'Checking account…' : 'Connect Nexus'}</button
    >
  {/if}
  {#if error || account?.error}<p role="alert" class="error">
      {error || account?.error}
    </p>{/if}
  {#if account?.error}<button
      class="secondary"
      disabled={busy}
      onclick={() => run(() => window.loadstone.disconnectNexus())}
      >Clear saved connection</button
    >{/if}
  <p class="note">
    The key is protected with Windows credential encryption and stays on this
    device. Disconnecting removes Loadstone’s saved key. The Wabbajack account
    connection is still being integrated.
  </p>
</section>

<style>
  .nexus-settings {
    margin: 24px 0;
    padding: 28px;
    background: #1c2122;
    border: 1px solid #35403e;
    border-radius: 12px;
  }
  h2 {
    font-size: 22px;
    margin: 0 0 10px;
  }
  p {
    color: #a2aaa6;
    line-height: 1.6;
  }
  label {
    display: block;
    margin: 20px 0 8px;
  }
  input {
    display: block;
    width: 100%;
    box-sizing: border-box;
    color: #e9e5db;
    background: #151819;
    border: 1px solid #35403e;
    padding: 12px;
    border-radius: 6px;
    margin-bottom: 16px;
  }
  .account,
  .actions {
    display: flex;
    gap: 20px;
    align-items: center;
    margin: 20px 0;
  }
  .account span {
    color: #8bb8a4;
  }
  .note {
    font-size: 13px;
  }
  .error {
    color: #dca37e;
  }
</style>
