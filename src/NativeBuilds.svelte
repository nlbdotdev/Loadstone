<script lang="ts">
  import { onMount } from 'svelte';
  import { FolderPlus, Hammer, Square } from '@lucide/svelte';
  import type {
    NativeBuild,
    NativeBuildPlan,
    NativeLibraryState,
  } from './types';
  let {
    live,
    creator = true,
    onresume,
    onadmitted,
  }: {
    live: boolean;
    creator?: boolean;
    onresume?: (id: string) => Promise<void>;
    onadmitted?: () => void;
  } = $props();
  let jobs = $state<NativeBuild[]>([]);
  let plan = $state<NativeBuildPlan | null>(null);
  let busy = $state(false);
  let error = $state('');
  let reviewing = $state<string | null>(null);
  let admitting = $state(false);
  let admissionProgress = $state<NativeLibraryState['progress']>(null);
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
  const phases = {
    recovery: 'Checking retained candidate files',
    downloads: 'Acquiring archive files',
    inputs: 'Checking source files',
    archives: 'Checking archive contents',
    outputs: 'Writing candidate files',
    verification: 'Verifying finished files',
  };
  const fileSize = (bytes: number) =>
    bytes < 1000
      ? `${bytes} B`
      : bytes < 1e6
        ? `${(bytes / 1000).toFixed(1)} KB`
        : `${(bytes / 1e6).toFixed(1)} MB`;
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
        if (admitting) {
          const library = await window.loadstone.nativeLibrary();
          if (!stopped) admissionProgress = library.progress;
        }
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
      <h2>
        {creator ? 'Reconstruct a local candidate' : 'Native installations'}
      </h2>
      <p>
        {creator
          ? 'Creator tools · Experimental'
          : 'Verified files, preserved progress'}
      </p>
    </div>
  </div>
  {#if creator}<p>
      Choose a .loadstone package, its private local-inputs JSON, and a parent
      folder. Loadstone creates a new candidate from owned game files, local
      prerequisites, ZIP, 7z or RAR archives and bundled files. Your input file
      can select local archives or request original-source downloads. For
      downloads or 7z/RAR, you’ll also select your trusted 7-Zip x64 26.04 or
      newer installation.
    </p>
    <p class="note">
      Automatic Nexus downloads require Premium; free accounts can select
      manually downloaded archives. Completed candidates need a separate review
      in My library before launch and shortcut controls become available.
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
  {/if}
  {#if error}<p role="alert" class="error">{error}</p>{/if}
  {#if admitting}
    <p role="status">Checking this setup for My library…</p>
    {#if admissionProgress}
      <p class="note">
        {admissionProgress.completed.toLocaleString()} / {admissionProgress.total.toLocaleString()}
        files checked
      </p>
      <progress
        value={admissionProgress.completed}
        max={Math.max(1, admissionProgress.total)}
        aria-label="Library admission verification"
      ></progress>
    {/if}
    <button
      class="secondary"
      onclick={async () => {
        try {
          await window.loadstone.cancelNativeVerification();
        } catch (e) {
          error =
            e instanceof Error ? e.message : 'Could not cancel verification.';
        }
      }}>Cancel library verification</button
    >
  {/if}
  {#if plan}
    <section class="review" aria-label="Review native build">
      <span class="eyebrow">Ready for input verification</span>
      <h3>{plan.name} <span>v{plan.version}</span></h3>
      <p>
        {plan.outputs.toLocaleString()} output files · {(
          plan.installBytes / 1e9
        ).toFixed(2)} GB · {plan.archiveCount} local archives
      </p>
      {#if plan.downloadCount}
        <p class="note">
          {plan.downloadCount}
          {plan.downloadCount === 1 ? 'archive' : 'archives'} to acquire · up to {(
            plan.downloadBytes / 1e9
          ).toFixed(2)} GB. Verified cached files are reused. Sources: {plan.downloadHosts
            .slice(0, 20)
            .join(' · ')}{plan.downloadHosts.length > 20
            ? ` · ${plan.downloadHosts.length - 20} more`
            : ''}.
        </p>
        <p class="note">Archive cache</p>
        <code>{plan.downloadCache}</code>
      {/if}
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
      <p class="note">
        {plan.resume ? 'Candidate to resume' : 'New candidate folder'}
      </p>
      <code>{plan.destination}</code>
      {#if plan.resume}
        <p class="note">
          {plan.resume.reused.toLocaleString()} matching files can be reused ·
          {plan.resume.missing.toLocaleString()} missing files to build ·
          {plan.resume.conflicts.toLocaleString()} changed or incomplete files to
          preserve before rebuilding. Other files stay in place. Keep MO2 and games
          closed.
        </p>
        <p class="note">Preserved copies will be kept in a new folder under</p>
        <code>{plan.resume.recoveryRoot}</code>
      {/if}
      <p class="note">
        Inputs will be hashed before files are written. A failed or cancelled
        build keeps its partial candidate folder. Resume requires a fresh review
        and reuses matching output files and verified archive downloads.
        Interrupted partial downloads restart from the beginning.
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
            })}
          ><Hammer size={16} />{plan.resume
            ? 'Resume candidate'
            : 'Build candidate'}</button
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
            {(job.status === 'building' || reviewing === job.id) && job.activity
              ? phases[job.activity.phase]
              : labels[job.status]}
          </p>
          <p class="note">
            {job.completed.toLocaleString()} / {job.total.toLocaleString()} files
            reconstructed
          </p>
          {#if (active(job) || reviewing === job.id) && job.activity}
            <p class="note">
              {job.activity.completed.toLocaleString()} / {job.activity.total.toLocaleString()}
              {job.activity.phase === 'archives'
                ? 'archives checked'
                : 'files in this stage'}
            </p>
            <progress
              value={job.activity.completed}
              max={Math.max(1, job.activity.total)}
              aria-label={phases[job.activity.phase]}
            ></progress>
            {#if job.activity.totalBytes > 0 && job.activity.completed < job.activity.total}
              <p class="note">
                Current file: {fileSize(job.activity.bytes)} / {fileSize(
                  job.activity.totalBytes,
                )}
              </p>
              <progress
                value={job.activity.bytes}
                max={job.activity.totalBytes}
                aria-label="Current file bytes"
              ></progress>
            {/if}
          {:else if active(job)}<progress aria-label="Preparing build"
            ></progress>{/if}
          <code>{job.destination}</code>
          {#if job.error}<p class="error">{job.error}</p>{/if}
          {#if reviewing === job.id}
            <button
              class="secondary"
              onclick={async () => {
                try {
                  await window.loadstone.cancelNativeBuild(job.id);
                } catch (e) {
                  error =
                    e instanceof Error ? e.message : 'Could not cancel review.';
                }
              }}><Square size={14} />Cancel recovery review</button
            >
          {:else if ['failed', 'cancelled', 'interrupted'].includes(job.status)}
            <button
              class="secondary"
              disabled={!live || busy || running}
              onclick={() =>
                action(async () => {
                  if (onresume) {
                    await onresume(job.id);
                    return;
                  }
                  plan = null;
                  reviewing = job.id;
                  try {
                    plan = await window.loadstone.resumeNativeBuild(job.id);
                  } finally {
                    reviewing = null;
                  }
                })}>Review resume</button
            >
          {/if}
          {#if !creator && job.status === 'verified'}
            <button
              class="primary"
              disabled={!live || busy || running}
              onclick={() =>
                action(async () => {
                  admitting = true;
                  admissionProgress = null;
                  try {
                    if (await window.loadstone.admitNativeBuild(job.id))
                      onadmitted?.();
                  } finally {
                    admitting = false;
                    admissionProgress = null;
                  }
                })}>Review for My library</button
            >
          {/if}
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
  {#if !creator && !jobs.length}<p>
      Your native installations will appear here after you start a setup in
      Discover.
    </p>{/if}
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
