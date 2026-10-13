<script lang="ts">
  let { jobId, native = false }: { jobId: string; native?: boolean } = $props();
  let expanded = $state(false),
    busy = $state(false),
    error = $state(''),
    message = $state('');
  let accounts = $state<{ id: string; label: string }[]>([]),
    selected = $state('');
  async function run(save = false) {
    busy = true;
    error = '';
    message = '';
    try {
      if (save)
        message = (
          await (native
            ? window.loadstone.nativeSteamShortcut(jobId, selected)
            : window.loadstone.steamShortcut(jobId, selected))
        ).message;
      else {
        accounts = await window.loadstone.steamAccounts();
        selected = accounts.length === 1 ? accounts[0].id : '';
        expanded = true;
      }
    } catch (e) {
      error =
        e instanceof Error
          ? e.message.replace(
              /^Error invoking remote method '[^']+': Error: /,
              '',
            )
          : 'Could not update Steam.';
    } finally {
      busy = false;
    }
  }
</script>

<div class="steam-shortcut">
  <button class="secondary" disabled={busy} onclick={() => run()}
    >Add or repair Steam entry</button
  >
  {#if expanded}
    <p>
      Exit Steam completely before saving. Existing entries are backed up and
      preserved.
    </p>
    {#if accounts.length}
      <label for={'steam-account-' + jobId}>Local Steam library</label>
      <select
        id={'steam-account-' + jobId}
        bind:value={selected}
        disabled={busy}
      >
        <option value="" disabled>Choose an account</option>
        {#each accounts as account}<option value={account.id}
            >{account.label}</option
          >{/each}
      </select>
      <button
        class="secondary"
        disabled={busy || !selected}
        onclick={() => run(true)}>Save Steam entry</button
      >
    {:else}<p>
        No local Steam accounts found. Sign in to Steam once, then exit it and
        try again.
      </p>{/if}
  {/if}
  {#if error}<p role="alert" class="error">{error}</p>{/if}
  {#if message}<p role="status">{message}</p>{/if}
</div>

<style>
  .steam-shortcut {
    margin: 18px 0;
  }
  p {
    color: #a2aaa6;
    line-height: 1.6;
  }
  label {
    display: block;
    margin: 12px 0 8px;
  }
  select {
    background: #151819;
    color: #e9e5db;
    border: 1px solid #35403e;
    border-radius: 6px;
    padding: 12px;
    margin-right: 12px;
    max-width: 100%;
  }
  .error {
    color: #dca37e;
  }
</style>
