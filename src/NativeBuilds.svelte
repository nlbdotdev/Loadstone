<script lang="ts">
  import { onMount } from 'svelte';
  import { FolderPlus, Hammer, Square } from '@lucide/svelte';
  import type { NativeBuild, NativeBuildPlan } from './types';
  let { live }: { live: boolean } = $props();
  let jobs = $state<NativeBuild[]>([]);
  let plan = $state<NativeBuildPlan | null>(null);
  let busy = $state(false);
  let error = $state('');
  const active = (job: NativeBuild) =>
    ['queued', 'building', 'stopping'].includes(job.status);
  const running = $derived(jobs.some(active));
  const labels: Record<NativeBuild['status'], string> = {
    queued: 'Waiting to begin',
    building: 'Checking inputs and reconstructing',
    stopping: 'Stopping…',
    verified: 'Files verified · Launch untested',
    failed: 'Build failed',
    cancelled: 'Build cancelled',
    interrupted: 'Build interrupted',
  };
  async function action(operation: () => Promise<void>) {
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
          : 'The build action could not complete.';
    } finally {
      busy = false;
    }
  }
  onMount(() => {
    let stopped = false,
      reading = false;
    const refresh = async () => {
      if (reading) return;
      reading = true;
      try {
        const result = await window.loadstone.nativeBuilds();
        if (!stopped) jobs = result;
      } catch {
        if (!stopped) error = 'Could not read native build history.';
      } finally {
        reading = false;
      }
    };
    void refresh();
    const interval = setInterval(() => void refresh(), 1000);
    return () => {
      stopped = true;
      clearInterval(interval);
    };
  });
</script>

<section class="native-builds" aria-label="Native candidate builds">
  <div class="heading">
    <Hammer size={22} />
    <div>
      <h2>Reconstruct a local candidate</h2>
      <p>Creator tools · Experimental</p>
    </div>
  </div>
  <p>
    Choose a .loadstone package, its private local-inputs JSON, and a parent
    folder. Loadstone creates a new candidate from owned game files, local
    prerequisites, downloaded ZIP, 7z or RAR archives and bundled files. For
    7z/RAR, you’ll also select your trusted 7-Zip x64 26.04 or newer
    installation.
  </p>
  <p class="note">
    Downloads, configuration rebasing and launch checks are still in
    development. These builds stay separate from your playable library.
  </p>
  {#if !live}<p class="note">
      Switch to the live workspace to build real files.
    </p>{/if}
  <button
    class="secondary"
    disabled={!live || busy || running}
    onclick={() =>
      action(async () => {
        plan = null;
        plan = await window.loadstone.prepareNativeBuild();
      })}
    ><FolderPlus size={16} />{busy
      ? 'Preparing…'
      : 'Choose local build inputs'}</button
  >
  {#if error}<p role="alert" class="error">{error}</p>{/if}
  {#if plan}
    <section class="review" aria-label="Review native build">
      <span class="eyebrow">Ready for input verification</span>
      <h3>{plan.name} <span>v{plan.version}</span></h3>
      <p>
        {plan.outputs.toLocaleString()} output files · {(
          plan.installBytes / 1e9
        ).toFixed(2)} GB · {plan.archiveCount} local archives
      </p>
      <p class="note">New candidate folder</p>
      {#if plan.generatedConfigurations}<p class="note">
          MO2 configuration will be generated for this folder. The size includes
          a 1 MB configuration allowance. Account and personal interface
          settings are not imported; launch and profile save settings still need
          verification.
        </p>{/if}
      {#if plan.archiveTool}<p class="note">
          Archive tool: {plan.archiveTool}
        </p>{/if}
      {#if plan.prerequisites.length}<p class="note">
          Required local material: {plan.prerequisites
            .map((v) => `${v.name} ${v.version}`)
            .join(' · ')}. These files must already be prepared locally.
        </p>{/if}
      <code>{plan.destination}</code>
      <p class="note">
        Inputs will be hashed before files are written. A failed or cancelled
        build keeps its partial folder. Retrying creates a new folder.
      </p>
      <div class="buttons">
        <button
          class="primary"
          disabled={!live || busy || running}
          onclick={() =>
            action(async () => {
              if (plan) {
                jobs = await window.loadstone.startNativeBuild(plan.id);
                plan = null;
              }
            })}><Hammer size={16} />Build candidate</button
        ><button class="secondary" disabled={busy} onclick={() => (plan = null)}
          >Dismiss</button
        >
      </div>
    </section>
  {/if}
  {#if jobs.length}<div class="history" aria-label="Native build history">
      {#each [...jobs].reverse() as job (job.id)}
        <article>
          <h3>{job.name} <span>v{job.version}</span></h3>
          <p class:verified={job.status === 'verified'} role="status">
            {labels[job.status]}
          </p>
          <p class="note">
            {job.completed.toLocaleString()} / {job.total.toLocaleString()} files
            reconstructed
          </p>
          {#if active(job)}<progress
              value={job.completed}
              max={job.total}
              aria-label="Reconstructed files"
            ></progress>{/if}
          <code>{job.destination}</code>
          {#if job.error}<p class="error">{job.error}</p>{/if}
          {#if active(job)}<button
              class="secondary"
              disabled={busy || job.status === 'stopping'}
              onclick={() =>
                action(async () => {
                  jobs = await window.loadstone.cancelNativeBuild(job.id);
                })}><Square size={14} />Cancel build</button
            >{/if}
        </article>
      {/each}
    </div>{/if}
</section>

<style>
  .native-builds {
    margin: 24px 0;
    padding: 28px;
    background: #1c2122;
    border: 1px solid #35403e;
    border-radius: 12px;
  }
  .heading {
    display: flex;
    align-items: center;
    gap: 14px;
    color: #c79d77;
  }
  h2 {
    margin: 0 0 6px;
    font-size: 22px;
    color: #f0eee9;
  }
  h3 {
    margin: 12px 0 0;
    font-size: 19px;
    overflow-wrap: anywhere;
  }
  h3 span {
    color: #b1b8b2;
    font-size: 14px;
  }
  p {
    color: #a2aaa6;
    line-height: 1.6;
    overflow-wrap: anywhere;
  }
  .heading p {
    margin: 0;
    font-size: 13px;
  }
  .note {
    font-size: 13px;
  }
  .review,
  article {
    margin-top: 24px;
    padding-top: 24px;
    border-top: 1px solid #35403e;
  }
  .error {
    color: #edaa95;
  }
  .verified {
    color: #a6c9b5;
  }
  code {
    display: block;
    font-size: 12px;
    overflow-wrap: anywhere;
    line-height: 1.6;
    color: #c4ccc6;
  }
  .buttons {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
  }
  progress {
    width: 100%;
    height: 8px;
    accent-color: #c79d77;
    margin-bottom: 16px;
  }
  article button {
    margin-top: 16px;
  }
</style>
