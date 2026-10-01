<script lang="ts">
  import { onMount } from 'svelte';
  import type { LiveJob } from './types';
  let { library = false }: { library?: boolean } = $props();
  let jobs = $state<LiveJob[]>([]),
    verified = $state<Record<string, string>>({}),
    error = $state(''),
    busy = $state(false);
  const shown = $derived(
    library ? jobs.filter((job) => job.status === 'installed') : jobs,
  );
  onMount(() => {
    let mounted = true;
    const refresh = async () => {
      try {
        const next = await window.loadstone.liveJobs();
        if (mounted) jobs = next;
      } catch {
        if (mounted) error = 'Could not read live installation history.';
      }
    };
    void refresh();
    const timer = setInterval(() => {
      void refresh();
    }, 1000);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  });
  async function action(fn: () => Promise<LiveJob[]>) {
    if (busy) return;
    busy = true;
    error = '';
    try {
      jobs = await fn();
    } catch (e) {
      error =
        e instanceof Error
          ? e.message.replace(
              /^Error invoking remote method '[^']+': Error: /,
              '',
            )
          : 'Could not update this installation.';
    } finally {
      busy = false;
    }
  }
</script>

<section
  aria-label={library ? 'Installed live setups' : 'Live installation jobs'}
>
  <div class="page-heading">
    <div>
      <p class="eyebrow">YOUR LIVE WORKSPACE</p>
      <h1>{library ? 'Installed setups.' : 'Your installations.'}</h1>
      <p>Real installation activity and saved recovery state.</p>
    </div>
  </div>
  {#if error}<p role="alert" class="error">{error}</p>{/if}
  {#if !shown.length}<div class="empty-state">
      <h2>
        {library
          ? 'No live setups installed yet'
          : 'No live installations started'}
      </h2>
      <p>
        Import a setup in Discover and check its compatibility to get started.
      </p>
    </div>{/if}
  {#each shown as job}<article class="live-job">
      <div class="job-heading">
        <h2>{job.name}</h2>
        <span>{job.status}</span>
      </div>
      <p>{job.destination}</p>
      {#if job.error}<p class="error">{job.error}</p>{/if}
      {#if ['preparing', 'installing', 'verifying'].includes(job.status)}<p>
          Wabbajack is working. Progress below comes from the installer.
        </p>
        <button
          class="secondary"
          disabled={busy}
          onclick={() => action(() => window.loadstone.cancelLive(job.id))}
          >Stop installation</button
        >{/if}
      {#if ['failed', 'cancelled', 'interrupted'].includes(job.status)}<button
          class="secondary"
          disabled={busy}
          onclick={() => action(() => window.loadstone.retryLive(job.id))}
          >Retry installation</button
        >{/if}
      {#if job.status === 'installed'}
        <div class="launch-actions">
          <button
            class="primary"
            disabled={busy ||
              job.launch?.phase === 'open' ||
              job.launch?.phase === 'starting'}
            onclick={() => action(() => window.loadstone.launchLive(job.id))}
            >Launch setup</button
          >
          <button
            class="secondary"
            disabled={busy}
            onclick={() =>
              action(async () => {
                verified[job.id] = '';
                verified[job.id] = await window.loadstone.verifyLiveProfile(
                  job.id,
                );
                return window.loadstone.liveJobs();
              })}>Check profile</button
          >
        </div>
        {#if job.launch}<p
            role="status"
            class:error={job.launch.phase === 'error'}
          >
            {job.launch.message}
          </p>{/if}
        {#if verified[job.id]}<p role="status">{verified[job.id]}</p>{/if}
      {/if}
      {#if job.logs.length}<details>
          <summary>Installer output</summary>
          <pre>{job.logs.join('\n')}</pre>
        </details>{/if}
    </article>{/each}
</section>

<style>
  .launch-actions {
    display: flex;
    gap: 12px;
    margin: 20px 0;
  }
  .live-job {
    padding: 24px;
    margin: 20px 0;
    background: #1c2122;
    border: 1px solid #35403e;
    border-radius: 12px;
  }
  .job-heading {
    display: flex;
    justify-content: space-between;
    gap: 20px;
    align-items: center;
  }
  h2 {
    font-size: 22px;
  }
  p {
    color: #a2aaa6;
    line-height: 1.6;
    overflow-wrap: anywhere;
  }
  .job-heading span {
    text-transform: capitalize;
    color: #c8a57e;
  }
  .error {
    color: #dca37e;
  }
  details {
    margin-top: 20px;
  }
  summary {
    cursor: pointer;
  }
  pre {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    max-height: 300px;
    overflow: auto;
    color: #b6bcb7;
    font-size: 12px;
    line-height: 1.6;
  }
</style>
