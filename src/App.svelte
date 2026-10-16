<script lang="ts">
  import { onMount } from 'svelte';
  import { version as appVersion } from '../package.json';
  import LicenseNotice from './LicenseNotice.svelte';
  import {
    Compass,
    Library,
    Download,
    Settings as SettingsIcon,
    Search,
    Minus,
    Square,
    X,
    ArrowRight,
    ArrowUpRight,
    ChevronRight,
    Check,
    CheckCircle2,
    ShieldCheck,
    Leaf,
    Gamepad2,
    Folder,
    Play,
    Pause,
    RotateCcw,
    Trash2,
    Clock3,
    HardDrive,
    Layers,
    SlidersHorizontal,
    Info,
    FlaskConical,
    LoaderCircle,
    AlertCircle,
    FileText,
    Monitor,
    CircleHelp,
  } from '@lucide/svelte';
  import Logo from './Logo.svelte';
  import Welcome from './Welcome.svelte';
  import LiveCatalog from './LiveCatalog.svelte';
  import EngineSettings from './EngineSettings.svelte';
  import NexusSettings from './NexusSettings.svelte';
  import NativePackagePreview from './NativePackagePreview.svelte';
  import NativeBuilds from './NativeBuilds.svelte';
  import NativeInstall from './NativeInstall.svelte';
  import LiveJobs from './LiveJobs.svelte';
  import NativeLibrary from './NativeLibrary.svelte';
  import { catalog } from './data';
  import type { AppState, Page, Setup, Job } from './types';

  let appState = $state<AppState | null>(null);
  let page = $state<Page>('discover');
  let selectedId = $state('mojave');
  let search = $state('');
  let filter = $state('All games');
  let modal = $state<
    'install' | 'details' | 'uninstall' | 'reset' | 'session' | 'about' | null
  >(null);
  let destination = $state('');
  let desktopShortcut = $state(true);
  let steamShortcut = $state(true);
  let toast = $state<{ text: string; error: boolean } | null>(null);
  let toastTimer: ReturnType<typeof setTimeout>;
  let busy = $state(false);
  let loaded = $state(false);
  let startupError = $state('');
  let lastCompleted = new Set<string>();
  const selected = $derived(
    catalog.find((x) => x.id === selectedId) || catalog[0],
  );
  const visibleCatalog = $derived(
    appState?.settings.dummyData
      ? catalog.filter(
          (x) =>
            (filter === 'All games' || x.shortGame === filter) &&
            `${x.name} ${x.game} ${x.tags.join(' ')}`
              .toLowerCase()
              .includes(search.toLowerCase()),
        )
      : [],
  );
  const activeJobs = $derived(
    appState?.settings.dummyData
      ? appState.jobs.filter(
          (x) => !['complete', 'cancelled'].includes(x.status),
        )
      : [],
  );
  const visibleJobs = $derived(
    appState?.settings.dummyData ? appState.jobs : [],
  );
  const visibleInstalled = $derived(
    appState?.settings.dummyData
      ? appState.installed.filter((x) => {
          const setup = catalog.find((s) => s.id === x.setupId);
          return (
            setup &&
            `${setup.name} ${setup.game}`
              .toLowerCase()
              .includes(search.toLowerCase())
          );
        })
      : [],
  );
  const feature = $derived(
    visibleCatalog.find((x) => x.id === selectedId) || visibleCatalog[0],
  );
  const installedSelected = $derived(
    appState?.settings.dummyData &&
      appState.installed.some((x) => x.setupId === selected.id),
  );
  const selectedJob = $derived(
    activeJobs.find((x) => x.setupId === selected.id),
  );
  const stages = [
    'Download archives',
    'Prepare your profile',
    'Configure & finish',
  ];
  const nav = [
    { id: 'discover' as Page, label: 'Discover', icon: Compass },
    { id: 'library' as Page, label: 'My library', icon: Library },
    { id: 'downloads' as Page, label: 'Downloads', icon: Download },
    { id: 'settings' as Page, label: 'Settings', icon: SettingsIcon },
  ];
  function message(text: string, error = false) {
    clearTimeout(toastTimer);
    toast = { text, error };
    toastTimer = setTimeout(() => (toast = null), error ? 8000 : 4500);
  }
  function accept(next: AppState) {
    for (const job of next.jobs)
      if (job.status === 'complete' && !lastCompleted.has(job.id) && loaded)
        message(
          `${catalog.find((x) => x.id === job.setupId)?.name} is ready in your demo library.`,
        );
    lastCompleted = new Set(
      next.jobs.filter((x) => x.status === 'complete').map((x) => x.id),
    );
    appState = next;
  }
  async function action(fn: () => Promise<AppState>, success?: string) {
    if (busy) return false;
    busy = true;
    try {
      accept(await fn());
      if (success) message(success);
      return true;
    } catch (error) {
      message(
        error instanceof Error
          ? error.message.replace(
              /^Error invoking remote method '[^']+': Error: /,
              '',
            )
          : 'Something went wrong.',
        true,
      );
      return false;
    } finally {
      busy = false;
    }
  }
  function navigate(next: Page) {
    page = next;
    search = '';
  }
  $effect(() => {
    page;
    document.querySelector('main')?.scrollTo({ top: 0 });
  });
  function openInstall(setup: Setup) {
    selectedId = setup.id;
    destination = `${appState?.settings.installRoot}\\${setup.name.replaceAll(' ', '-')}`;
    desktopShortcut = appState?.settings.desktopShortcut ?? true;
    steamShortcut = appState?.settings.steamShortcut ?? true;
    modal = 'install';
  }
  async function install() {
    const ok = await action(
      () =>
        window.loadstone.install({
          setupId: selected.id,
          destination,
          desktopShortcut,
          steamShortcut,
        }),
      'Demo installation queued. Follow its progress in Downloads.',
    );
    if (ok) {
      modal = null;
      page = 'downloads';
    }
  }
  async function play(setup: Setup) {
    selectedId = setup.id;
    if (await action(() => window.loadstone.library('play', setup.id)))
      modal = 'session';
  }
  function modalFocus(node: HTMLElement) {
    const previous = document.activeElement as HTMLElement | null;
    node.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const controls = [
        ...node.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), summary, [tabindex="0"]',
        ),
      ];
      if (!controls.length) {
        event.preventDefault();
        return;
      }
      const first = controls[0],
        last = controls[controls.length - 1];
      if (
        event.shiftKey &&
        (document.activeElement === first || document.activeElement === node)
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || document.activeElement === node)
      ) {
        event.preventDefault();
        first.focus();
      }
    };
    node.addEventListener('keydown', trap);
    return {
      destroy() {
        node.removeEventListener('keydown', trap);
        if (previous?.isConnected) previous.focus();
      },
    };
  }
  async function pickFolder(forInstall = false) {
    try {
      const folder = await window.loadstone.pickDirectory();
      if (folder) {
        if (forInstall) destination = folder;
        else
          await action(
            () => window.loadstone.settings({ installRoot: folder }),
            'Installation folder saved.',
          );
      }
    } catch {
      message('Could not open the folder picker.', true);
    }
  }
  function setupFor(job: Job) {
    return catalog.find((x) => x.id === job.setupId)!;
  }
  function dateLabel(value?: string) {
    return value
      ? new Date(value).toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
        })
      : 'Not played yet';
  }
  function statusLabel(job: Job) {
    return {
      queued: 'Waiting in queue',
      downloading: 'Downloading archives',
      extracting: 'Preparing your profile',
      configuring: 'Configuring your setup',
      paused: 'Installation paused',
      complete: 'Ready to play',
      cancelled: 'Installation cancelled',
    }[job.status];
  }
  function isInstalled(id: string) {
    return appState?.installed.some((x) => x.setupId === id) ?? false;
  }
  function isInstalling(id: string) {
    return activeJobs.some((x) => x.setupId === id);
  }
  onMount(() => {
    const stop = window.loadstone.onState(accept);
    window.loadstone
      .getState()
      .then((next) => {
        accept(next);
        loaded = true;
      })
      .catch((error) => (startupError = String(error)));
    return () => {
      stop();
      clearTimeout(toastTimer);
    };
  });
</script>

<svelte:window
  onkeydown={(event) => {
    if (event.key === 'Escape' && !busy) modal = null;
  }}
/>

<div class:reduced-motion={appState?.settings.reducedMotion} class="app-shell">
  <header class="titlebar">
    <button
      class="brand"
      onclick={() => navigate('discover')}
      aria-label="Loadstone home"
      ><Logo /><span
        ><strong>Loadstone</strong><small>Your next playthrough, ready.</small></span
      ></button
    >
    <div class="titlebar-search">
      <Search size={17} /><input
        aria-label="Search setups"
        placeholder="Search setups, games, or themes…"
        bind:value={search}
        oninput={() => {
          if (page === 'settings' || page === 'downloads') page = 'discover';
        }}
      />{#if search}<button
          class="icon-button"
          aria-label="Clear search"
          onclick={() => (search = '')}><X size={14} /></button
        >{/if}<kbd>⌕</kbd>
    </div>
    <button class="build-badge" onclick={() => (modal = 'about')}
      >PREVIEW <span>{appVersion}</span></button
    >
    <div class="window-controls">
      <button
        aria-label="Minimize window"
        onclick={() => window.loadstone.window('minimize')}
        ><Minus size={16} /></button
      ><button
        aria-label="Maximize window"
        onclick={() => window.loadstone.window('maximize')}
        ><Square size={13} /></button
      ><button
        class="close-window"
        aria-label="Close window"
        onclick={() => window.loadstone.window('close')}><X size={17} /></button
      >
    </div>
  </header>
  <aside class="sidebar">
    <div class="nav-section-label">YOUR NEXT ADVENTURE</div>
    <nav aria-label="Main navigation">
      {#each nav as item}<button
          class:active={page === item.id}
          onclick={() => navigate(item.id)}
          aria-current={page === item.id ? 'page' : undefined}
          ><item.icon size={21} /><span>{item.label}</span
          >{#if item.id === 'downloads' && activeJobs.length}<span
              class="nav-count">{activeJobs.length}</span
            >{/if}{#if item.id === 'library' && appState?.settings.dummyData && appState.installed.length}<span
              class="library-count">{appState.installed.length}</span
            >{/if}</button
        >{/each}
    </nav>
    <div class="sidebar-bottom">
      <div class="compass-decoration"><Logo size={102} /></div>
      <p>SAME GAMES.<br />FARTHER PLACES.</p>
      <span class="copper-line"></span><button
        class="mode-indicator"
        onclick={() => navigate('settings')}
        ><span class:live={!appState?.settings.dummyData} class="status-dot"
        ></span>{!appState?.settings.onboardingComplete
          ? 'Choose workspace'
          : appState.settings.dummyData
            ? 'Demo mode'
            : 'Live mode'}<ChevronRight size={14} /></button
      ><button class="help-link" onclick={() => (modal = 'about')}
        ><CircleHelp size={15} /> About Loadstone</button
      >
    </div>
  </aside>
  <main>
    {#if startupError}<div class="empty-state">
        <AlertCircle size={36} />
        <h1>Couldn’t load your workspace</h1>
        <p>{startupError}</p>
        <p>
          Restart Loadstone to try again. Your saved data has been preserved.
        </p>
      </div>
    {:else if !appState}<div class="empty-state">
        <LoaderCircle class="spin" size={32} />
        <h1>Finding your next adventure…</h1>
      </div>
    {:else if !appState.settings.onboardingComplete}
      <Welcome
        {busy}
        onchoose={async (demo) => {
          if (
            await action(() =>
              window.loadstone.settings({
                dummyData: demo,
                onboardingComplete: true,
              }),
            )
          )
            navigate('discover');
        }}
      />
    {:else}
      <div class="demo-strip" class:production={!appState.settings.dummyData}>
        <FlaskConical size={14} /><span
          >{appState.settings.dummyData
            ? 'Demo workspace'
            : 'Live workspace'}</span
        >
        <p>
          {appState.settings.dummyData
            ? 'Explore the full experience. Installs, games, and shortcuts are simulated.'
            : 'Installations use your local game and original mod sources.'}
        </p>
        <button onclick={() => navigate('settings')}
          >{appState.settings.dummyData ? 'Manage' : 'Enable demo'}<ArrowUpRight
            size={13}
          /></button
        >
      </div>
      <div class="page-content">
        {#if page === 'discover'}
          <div class="page-heading">
            <div>
              <p class="eyebrow">CURATED WORLDS. CONSIDERED CHOICES.</p>
              <h1>Your next playthrough, ready.</h1>
              <p class="page-subtitle">
                Familiar worlds, thoughtfully reimagined.
              </p>
            </div>
            <div class="heading-mark">
              <Compass size={19} /><span>EXPLORE<br />SOMETHING MORE</span>
            </div>
          </div>
          {#if !appState.settings.dummyData}
            <NativeInstall
              onstarted={(repair) => navigate(repair ? 'library' : 'downloads')}
            />
            <LiveCatalog onstarted={() => navigate('downloads')} />
          {:else}
            <div class="filter-row">
              <div class="filter-tabs" aria-label="Filter by game">
                {#each ['All games', 'New Vegas', 'Skyrim SE', 'Fallout 4'] as game}<button
                    class:selected={filter === game}
                    onclick={() => (filter = game)}>{game}</button
                  >{/each}
              </div>
              <span class="result-count"
                >{visibleCatalog.length}
                {visibleCatalog.length === 1
                  ? 'setup'
                  : 'setups'}<SlidersHorizontal size={15} /></span
              >
            </div>
            {#if feature}
              <div class="discover-grid">
                <div class="showcase">
                  <section
                    class="hero art {feature.art}"
                    aria-label={feature.name}
                  >
                    <div class="hero-shade"></div>
                    <div class="hero-content">
                      <p class="hero-kicker">
                        <span></span>THE FEATURED JOURNEY
                      </p>
                      <h2>{feature.name}</h2>
                      <p>{feature.description}</p>
                      <div class="tag-row">
                        {#each feature.tags as tag, i}<span class="tag"
                            >{#if i === 0}<Leaf size={13} />{:else}<ShieldCheck
                                size={13}
                              />{/if}{tag}</span
                          >{/each}
                      </div>
                      <div class="hero-bottom">
                        <button
                          class="primary"
                          onclick={() => {
                            selectedId = feature.id;
                            if (isInstalled(feature.id)) play(feature);
                            else if (isInstalling(feature.id))
                              page = 'downloads';
                            else openInstall(feature);
                          }}
                          >{isInstalled(feature.id)
                            ? 'Play demo'
                            : isInstalling(feature.id)
                              ? 'View installation'
                              : 'Install setup'}<ArrowRight size={18} /></button
                        ><button
                          class="hero-details"
                          onclick={() => {
                            selectedId = feature.id;
                            modal = 'details';
                          }}>Explore setup<ArrowUpRight size={15} /></button
                        >
                      </div>
                    </div>
                    <span class="hero-caption"
                      >A BETTER WAY<br />BACK INTO THE WORLD.</span
                    >
                  </section>
                  <div class="setup-grid">
                    {#each visibleCatalog.filter((x) => x.id !== feature.id) as setup}<button
                        class="setup-card art {setup.art}"
                        onclick={() => (selectedId = setup.id)}
                        ><div class="card-shade"></div>
                        <span class="card-game">{setup.shortGame}</span>
                        <div class="card-bottom">
                          <div>
                            <h3>{setup.name}</h3>
                            <p>{setup.description}</p>
                          </div>
                          <span class="round-arrow"
                            ><ChevronRight size={20} /></span
                          >
                        </div></button
                      >{/each}
                  </div>
                  <div class="trust-row">
                    <span><ShieldCheck size={17} /> Curated with care</span
                    ><span><Layers size={17} /> Separate profiles</span><span
                      ><RotateCcw size={17} /> Made to be maintained</span
                    >
                  </div>
                </div>
                <aside class="details-panel">
                  <div class="detail-cover art {feature.art}"></div>
                  <div class="detail-body">
                    <p class="eyebrow">YOUR SELECTED SETUP</p>
                    <h3>{feature.name}</h3>
                    <p class="detail-game">{feature.game}</p>
                    <div class="detail-meta">
                      <span>v{feature.version}</span><span
                        >{feature.mods} mods</span
                      ><span>Windows</span>
                    </div>
                    <div class="divider"></div>
                    <h4>Before you install</h4>
                    <ul class="requirements">
                      <li>
                        <Gamepad2 size={17} /><span
                          >{feature.shortGame} + required DLC</span
                        >
                      </li>
                      <li>
                        <ShieldCheck size={17} /><span
                          >Nexus account required</span
                        >
                      </li>
                      <li>
                        <Download size={17} /><span
                          >Automatic downloads with Premium</span
                        >
                      </li>
                      <li>
                        <Monitor size={17} /><span
                          >Optional desktop & Steam shortcuts</span
                        >
                      </li>
                    </ul>
                    <div class="divider"></div>
                    <h4>Room for adventure</h4>
                    <div class="size-row">
                      <span><Download size={16} /> Download</span><strong
                        >{feature.downloadGB} GB</strong
                      >
                    </div>
                    <div class="size-row">
                      <span><HardDrive size={16} /> Installed</span><strong
                        >{feature.installGB} GB</strong
                      >
                    </div>
                    <div class="divider"></div>
                    <div class="ready-status">
                      <CheckCircle2 size={19} />{isInstalled(feature.id)
                        ? 'Installed in demo library'
                        : isInstalling(feature.id)
                          ? 'Installation in progress'
                          : 'Ready for a demo install'}
                    </div>
                    <button
                      class="primary full"
                      onclick={() => {
                        selectedId = feature.id;
                        if (isInstalled(feature.id)) play(feature);
                        else if (isInstalling(feature.id)) page = 'downloads';
                        else openInstall(feature);
                      }}
                      >{isInstalled(feature.id)
                        ? 'Play demo'
                        : isInstalling(feature.id)
                          ? 'View installation'
                          : 'Install setup'}<ArrowRight size={17} /></button
                    ><button
                      class="text-button full"
                      onclick={() => {
                        selectedId = feature.id;
                        modal = 'details';
                      }}>View setup details<ArrowUpRight size={13} /></button
                    >
                  </div>
                </aside>
              </div>
            {:else}<div class="empty-state">
                <Compass size={40} />
                <h2>
                  {appState.settings.dummyData
                    ? 'No journeys found'
                    : 'Your next chapter starts here'}
                </h2>
                <p>
                  {appState.settings.dummyData
                    ? 'Try a different search or game filter.'
                    : 'The live catalog isn’t connected yet. Enable dummy data to explore three curated setups and the complete demo workflow.'}
                </p>
                <button
                  class="secondary"
                  onclick={() => {
                    if (appState?.settings.dummyData) {
                      search = '';
                      filter = 'All games';
                    } else page = 'settings';
                  }}
                  >{appState.settings.dummyData
                    ? 'Clear filters'
                    : 'Open settings'}<ArrowRight size={16} /></button
                >
              </div>{/if}
          {/if}
        {:else if page === 'library' && !appState.settings.dummyData}
          <NativeLibrary onrepair={() => navigate('discover')} />
          <LiveJobs library />
        {:else if page === 'downloads' && !appState.settings.dummyData}
          <NativeBuilds
            live
            creator={false}
            onresume={async (id) => {
              if (await window.loadstone.importNativeSetup(id))
                navigate('discover');
            }}
            onadmitted={() => navigate('library')}
          />
          <LiveJobs />
        {:else if page === 'library'}
          <div class="page-heading">
            <div>
              <p class="eyebrow">A PLACE TO RETURN TO</p>
              <h1>Your adventures.</h1>
              <p class="page-subtitle">
                Everything you’ve installed, ready when you are.
              </p>
            </div>
            <span class="count-pill">{visibleInstalled.length} installed</span>
          </div>
          {#if visibleInstalled.length}<div class="library-grid">
              {#each visibleInstalled as item}{@const setup = catalog.find(
                  (x) => x.id === item.setupId,
                )!}
                <article class="library-card">
                  <div class="library-cover art {setup.art}">
                    <span class="installed-badge"
                      ><CheckCircle2 size={14} /> Ready to play</span
                    >
                  </div>
                  <div class="library-body">
                    <p class="eyebrow">{setup.shortGame}</p>
                    <h2>{setup.name}</h2>
                    <p class="library-description">{setup.description}</p>
                    <div class="detail-meta">
                      <span>v{setup.version}</span><span>{setup.mods} mods</span
                      ><span>{item.sessions} demo sessions</span>
                    </div>
                    <div class="library-stats">
                      <span
                        ><Clock3 size={14} />{item.lastPlayed
                          ? `Last played ${dateLabel(item.lastPlayed)}`
                          : 'Your first journey awaits'}</span
                      ><span><HardDrive size={14} />{setup.installGB} GB</span>
                    </div>
                    <div class="library-actions">
                      <button
                        class="primary"
                        disabled={busy}
                        onclick={() => play(setup)}
                        ><Play size={16} /> Play demo</button
                      ><button
                        class="icon-button outlined"
                        aria-label={`Verify ${setup.name}`}
                        title="Verify demo setup"
                        disabled={busy}
                        onclick={() =>
                          action(
                            () => window.loadstone.library('verify', setup.id),
                            'Demo verification passed. Your profile is ready.',
                          )}><ShieldCheck size={18} /></button
                      ><button
                        class="icon-button outlined"
                        aria-label={`Details for ${setup.name}`}
                        title="Setup details"
                        onclick={() => {
                          selectedId = setup.id;
                          modal = 'details';
                        }}><Info size={18} /></button
                      ><button
                        class="icon-button outlined danger"
                        aria-label={`Uninstall ${setup.name}`}
                        title="Remove demo setup"
                        onclick={() => {
                          selectedId = setup.id;
                          modal = 'uninstall';
                        }}><Trash2 size={17} /></button
                      >
                    </div>
                  </div>
                </article>{/each}
            </div>
          {:else}<div class="empty-state">
              <Library size={42} />
              <h2>
                {search
                  ? 'No matching setups'
                  : 'Make room for your next story.'}
              </h2>
              <p>
                {search
                  ? 'Try searching for another setup or game.'
                  : 'Install a curated setup and it will appear here. Your original games stay right where they are.'}
              </p>
              <button class="primary" onclick={() => navigate('discover')}
                >Discover setups<ArrowRight size={17} /></button
              >
            </div>{/if}
        {:else if page === 'downloads'}
          <div class="page-heading">
            <div>
              <p class="eyebrow">THE ROAD TO READY</p>
              <h1>A little preparation.<br />A whole new adventure.</h1>
              <p class="page-subtitle">
                Follow your installs from the first archive to the final detail.
              </p>
            </div>
            <span class="count-pill">{activeJobs.length} active</span>
          </div>
          {#if visibleJobs.length}<div class="download-list">
              {#each [...visibleJobs].reverse() as job}{@const setup =
                  setupFor(job)}
                <article class="download-card">
                  <div class="download-art art {setup.art}"></div>
                  <div class="download-body">
                    <div class="download-heading">
                      <div>
                        <p class="eyebrow">
                          {setup.shortGame} · DEMO INSTALLATION
                        </p>
                        <h2>{setup.name}</h2>
                      </div>
                      <span
                        class="job-status"
                        class:complete={job.status === 'complete'}
                        >{#if job.status === 'complete'}<CheckCircle2
                            size={16}
                          />{:else if job.status === 'paused'}<Pause
                            size={15}
                          />{:else if job.status === 'cancelled'}<X
                            size={16}
                          />{:else}<LoaderCircle
                            size={16}
                            class="spin"
                          />{/if}{statusLabel(job)}</span
                      >
                    </div>
                    <div class="progress-meta">
                      <span
                        >{job.status === 'complete'
                          ? 'All steps complete'
                          : `${((setup.downloadGB * job.progress) / 100).toFixed(1)} of ${setup.downloadGB} GB · simulated`}</span
                      ><strong>{job.progress}%</strong>
                    </div>
                    <div
                      class="progress-track"
                      role="progressbar"
                      aria-label={`${setup.name} installation progress`}
                      aria-valuenow={job.progress}
                      aria-valuemin="0"
                      aria-valuemax="100"
                    >
                      <div
                        style:width={`${job.progress}%`}
                        class:paused={job.status === 'paused'}
                      ></div>
                    </div>
                    <div class="stage-row">
                      {#each stages as stage, i}<span
                          class:done={job.progress >= [65, 85, 100][i]}
                          >{#if job.progress >= [65, 85, 100][i]}<Check
                              size={13}
                            />{:else}<span class="stage-number">{i + 1}</span
                            >{/if}{stage}</span
                        >{/each}
                    </div>
                    <div class="download-bottom">
                      <span class="destination"
                        ><Folder size={14} />{job.destination}</span
                      >
                      <div class="job-actions">
                        {#if job.status === 'paused'}<button
                            class="secondary small"
                            disabled={busy}
                            onclick={() =>
                              action(() =>
                                window.loadstone.job('resume', job.id),
                              )}><Play size={14} />Resume</button
                          >{:else if !['complete', 'cancelled'].includes(job.status)}<button
                            class="secondary small"
                            disabled={busy}
                            onclick={() =>
                              action(() =>
                                window.loadstone.job('pause', job.id),
                              )}><Pause size={14} />Pause</button
                          >{/if}{#if !['complete', 'cancelled'].includes(job.status)}<button
                            class="text-button danger"
                            disabled={busy}
                            onclick={() =>
                              action(
                                () => window.loadstone.job('cancel', job.id),
                                'Demo installation cancelled.',
                              )}><X size={14} />Cancel</button
                          >{:else if job.status === 'cancelled'}<button
                            class="secondary small"
                            disabled={busy ||
                              isInstalled(setup.id) ||
                              isInstalling(setup.id)}
                            onclick={() =>
                              action(() =>
                                window.loadstone.job('retry', job.id),
                              )}><RotateCcw size={14} />Retry</button
                          >{:else}<button
                            class="secondary small"
                            onclick={() =>
                              navigate(
                                isInstalled(setup.id) ? 'library' : 'discover',
                              )}
                            >{isInstalled(setup.id)
                              ? 'Open library'
                              : 'Discover setups'}<ArrowRight
                              size={14}
                            /></button
                          >{/if}{#if ['complete', 'cancelled'].includes(job.status)}<button
                            class="icon-button"
                            aria-label={`Clear ${setup.name} download`}
                            onclick={() =>
                              action(() =>
                                window.loadstone.job('clear', job.id),
                              )}><Trash2 size={15} /></button
                          >{/if}
                      </div>
                    </div>
                  </div>
                </article>{/each}
            </div>
            <p class="quiet-note">
              <Info size={15} />Demo installs run one at a time. Closing the app
              pauses unfinished work; resume it here when you return.
            </p>
          {:else}<div class="empty-state">
              <Download size={42} />
              <h2>Nothing on the road just yet.</h2>
              <p>
                When you install a setup, you can follow its progress, pause it,
                or pick up where you left off here.
              </p>
              <button class="primary" onclick={() => navigate('discover')}
                >Find your next setup<ArrowRight size={17} /></button
              >
            </div>{/if}
        {:else if page === 'settings'}
          <div class="page-heading">
            <div>
              <p class="eyebrow">MAKE YOURSELF AT HOME</p>
              <h1>A few things, your way.</h1>
              <p class="page-subtitle">
                Your workspace, preferences, and preview tools.
              </p>
            </div>
            <SettingsIcon size={28} class="muted" />
          </div>
          <div class="settings-layout">
            <div class="settings-main">
              <EngineSettings />
              <NexusSettings />
              <NativePackagePreview />
              <NativeBuilds live={!appState.settings.dummyData} />
              <section class="settings-section">
                <div class="section-heading">
                  <FlaskConical size={20} />
                  <div>
                    <h2>Developer & demo mode</h2>
                    <p>A safe place to explore the complete experience.</p>
                  </div>
                </div>
                <div class="setting-row">
                  <div>
                    <label for="dummy-data">Use dummy data</label>
                    <p>
                      Show sample setups and simulate installs, launches, and
                      shortcuts.<br />Turning this off hides demo data and
                      pauses demo installations.
                    </p>
                  </div>
                  <button
                    id="dummy-data"
                    aria-label="Use dummy data"
                    class="toggle"
                    class:on={appState.settings.dummyData}
                    role="switch"
                    aria-checked={appState.settings.dummyData}
                    disabled={busy}
                    onclick={() =>
                      action(
                        () =>
                          window.loadstone.settings({
                            dummyData: !appState!.settings.dummyData,
                          }),
                        appState!.settings.dummyData
                          ? 'Live mode enabled. Demo data is hidden and preserved.'
                          : 'Demo workspace restored.',
                      )}><span></span></button
                  >
                </div>
                <div class="notice">
                  <Info size={17} />
                  <p>
                    This MVP has no live installer or Nexus connection. Demo
                    mode never downloads mods, launches games, or changes your
                    Steam library.
                  </p>
                </div>
                <button
                  class="secondary small"
                  disabled={!appState.settings.dummyData}
                  onclick={() => (modal = 'reset')}
                  ><RotateCcw size={15} /> Reset demo workspace</button
                >
              </section>
              <section class="settings-section">
                <div class="section-heading">
                  <Folder size={20} />
                  <div>
                    <h2>Installation preferences</h2>
                    <p>A home for your curated setups.</p>
                  </div>
                </div>
                <label class="field-label" for="root-path"
                  >Default installation folder</label
                >
                <div class="folder-input">
                  <input
                    id="root-path"
                    value={appState.settings.installRoot}
                    readonly
                  /><button class="secondary small" onclick={() => pickFolder()}
                    ><Folder size={15} />Browse</button
                  >
                </div>
                <p class="field-help">
                  Saved for future installs. Existing setups keep their current
                  location.
                </p>
                <div class="setting-row">
                  <div>
                    <label for="desktop-shortcut"
                      >Create desktop shortcuts</label
                    >
                    <p>Include a shortcut in each setup’s installation plan.</p>
                  </div>
                  <button
                    id="desktop-shortcut"
                    aria-label="Create desktop shortcuts"
                    class="toggle"
                    class:on={appState.settings.desktopShortcut}
                    role="switch"
                    aria-checked={appState.settings.desktopShortcut}
                    disabled={busy}
                    onclick={() =>
                      action(() =>
                        window.loadstone.settings({
                          desktopShortcut: !appState!.settings.desktopShortcut,
                        }),
                      )}><span></span></button
                  >
                </div>
                <div class="setting-row">
                  <div>
                    <label for="steam-shortcut">Add setups to Steam</label>
                    <p>
                      Plan a local Steam library shortcut. Simulated in this
                      preview.
                    </p>
                  </div>
                  <button
                    id="steam-shortcut"
                    aria-label="Add setups to Steam"
                    class="toggle"
                    class:on={appState.settings.steamShortcut}
                    role="switch"
                    aria-checked={appState.settings.steamShortcut}
                    disabled={busy}
                    onclick={() =>
                      action(() =>
                        window.loadstone.settings({
                          steamShortcut: !appState!.settings.steamShortcut,
                        }),
                      )}><span></span></button
                  >
                </div>
              </section>
              <section class="settings-section">
                <div class="section-heading">
                  <Monitor size={20} />
                  <div>
                    <h2>Comfort & accessibility</h2>
                    <p>Keep the experience comfortable.</p>
                  </div>
                </div>
                <div class="setting-row">
                  <div>
                    <label for="reduced-motion">Reduce motion</label>
                    <p>Turn off animations and progress transitions.</p>
                  </div>
                  <button
                    id="reduced-motion"
                    aria-label="Reduce motion"
                    class="toggle"
                    class:on={appState.settings.reducedMotion}
                    role="switch"
                    aria-checked={appState.settings.reducedMotion}
                    disabled={busy}
                    onclick={() =>
                      action(() =>
                        window.loadstone.settings({
                          reducedMotion: !appState!.settings.reducedMotion,
                        }),
                      )}><span></span></button
                  >
                </div>
              </section>
            </div>
            <aside class="settings-aside">
              <Logo size={60} />
              <h2>Loadstone</h2>
              <p>Your next playthrough, ready.</p>
              <div class="detail-meta">
                <span>Version {appVersion}</span><span>Developer preview</span>
              </div>
              <div class="divider"></div>
              <h4>Built for a better journey</h4>
              <p class="aside-copy">
                Svelte & Electron on Windows. A considered starting point for
                curated Bethesda playthroughs.
              </p>
              <button class="secondary full" onclick={() => (modal = 'about')}
                ><Info size={16} />About this preview</button
              >
              <div class="divider"></div>
              <h4>Diagnostics</h4>
              <p class="aside-copy">
                Export app, engine and installation status. Credentials, account
                names, paths and raw logs are excluded. Nothing is uploaded.
              </p>
              <button
                class="secondary full"
                onclick={async () => {
                  try {
                    const file = await window.loadstone.exportLogs();
                    if (file) message(`Diagnostics exported to ${file}`);
                  } catch {
                    message('Could not export diagnostics.', true);
                  }
                }}><FileText size={16} />Export diagnostics</button
              >
              <details class="activity-log">
                <summary>Recent activity</summary>{#each appState.logs
                  .slice(-8)
                  .reverse() as log}<p>{log}</p>{/each}
              </details>
            </aside>
          </div>
        {/if}
        <footer>
          <span>Built for your next adventure.<i></i></span><span
            >EXPLORE <b>/</b> INSTALL <b>/</b> PLAY <b>/</b> REPEAT</span
          >
        </footer>
      </div>
    {/if}
  </main>
  {#if toast}<div
      class="toast"
      class:error={toast.error}
      role={toast.error ? 'alert' : 'status'}
    >
      {#if toast.error}<AlertCircle size={20} />{:else}<CheckCircle2
          size={20}
        />{/if}<span>{toast.text}</span><button
        class="icon-button"
        aria-label="Dismiss notification"
        onclick={() => (toast = null)}><X size={16} /></button
      >
    </div>{/if}
  {#if modal && appState}
    <div
      class="modal-backdrop"
      role="presentation"
      onclick={(event) => {
        if (event.target === event.currentTarget && !busy) modal = null;
      }}
    >
      <div
        use:modalFocus
        class="modal"
        class:wide={modal === 'details'}
        role="dialog"
        aria-modal="true"
        aria-label={modal === 'install'
          ? 'Prepare installation'
          : modal === 'details'
            ? 'Setup details'
            : modal === 'uninstall'
              ? 'Remove setup'
              : modal === 'reset'
                ? 'Reset demo workspace'
                : modal === 'session'
                  ? 'Demo session'
                  : 'About Loadstone'}
        tabindex="-1"
      >
        <button
          class="modal-close icon-button"
          aria-label="Close dialog"
          disabled={busy}
          onclick={() => (modal = null)}><X size={20} /></button
        >
        {#if modal === 'install'}<div class="modal-art art {selected.art}">
            <div class="modal-art-shade"></div>
            <p class="eyebrow">YOUR NEXT JOURNEY</p>
            <h2>{selected.name}</h2>
          </div>
          <div class="modal-body">
            <h3>Let’s get everything ready.</h3>
            <p class="modal-intro">
              Choose a home for your setup. We’ll take care of the details.
            </p>
            <div class="notice">
              <FlaskConical size={18} />
              <p>
                <strong>Demo installation</strong><br />Requirements are
                simulated. No mods, game files, or shortcuts will be created.
              </p>
            </div>
            <div class="preflight-grid">
              <span
                ><CheckCircle2 size={16} />Game & DLC detected
                <small>DEMO</small></span
              ><span
                ><CheckCircle2 size={16} />Enough disk space
                <small>DEMO</small></span
              >
            </div>
            <label class="field-label" for="install-destination"
              >Installation folder</label
            >
            <div class="folder-input">
              <input id="install-destination" bind:value={destination} /><button
                class="secondary small"
                onclick={() => pickFolder(true)}
                aria-label="Browse installation folder"
                ><Folder size={16} /></button
              >
            </div>
            <div class="install-options">
              <label
                ><input type="checkbox" bind:checked={desktopShortcut} />Desktop
                shortcut <span>Simulated</span></label
              ><label
                ><input type="checkbox" bind:checked={steamShortcut} />Steam
                library entry <span>Simulated</span></label
              >
            </div>
            <div class="install-summary">
              <span>{selected.mods} mods</span><span
                >{selected.downloadGB} GB download</span
              ><span>{selected.installGB} GB installed</span>
            </div>
            <button
              class="primary full"
              disabled={busy || !destination.trim()}
              onclick={install}
              >{#if busy}<LoaderCircle class="spin" size={17} />{/if}Begin demo
              installation<ArrowRight size={17} /></button
            >
            <p class="modal-footnote">
              About 20 seconds. You can pause or cancel at any time.
            </p>
          </div>
        {:else if modal === 'details'}<div
            class="modal-art large art {selected.art}"
          >
            <div class="modal-art-shade"></div>
            <p class="eyebrow">{selected.game}</p>
            <h2>{selected.name}</h2>
          </div>
          <div class="modal-body">
            <div class="detail-meta">
              <span>v{selected.version}</span><span>{selected.mods} mods</span
              ><span>By {selected.author}</span>
            </div>
            <p class="long-description">{selected.longDescription}</p>
            <div class="modal-columns">
              <div>
                <h4>A considered collection</h4>
                <ul class="detail-list">
                  {#each selected.highlights as highlight}<li>
                      <Check size={16} />{highlight}
                    </li>{/each}
                </ul>
              </div>
              <div>
                <h4>What you’ll need</h4>
                <ul class="detail-list">
                  {#each selected.requirements as requirement}<li>
                      <ChevronRight size={15} />{requirement}
                    </li>{/each}
                </ul>
              </div>
            </div>
            <div class="notice">
              <Info size={17} />
              <p>
                This is an illustrative catalog entry. Names, versions,
                requirements, and mod counts are dummy data.
              </p>
            </div>
            <div class="modal-actions">
              <span class="muted">Updated {selected.updated}</span><button
                class="primary"
                onclick={() => {
                  if (installedSelected) play(selected);
                  else if (selectedJob) {
                    modal = null;
                    page = 'downloads';
                  } else openInstall(selected);
                }}
                >{installedSelected
                  ? 'Play demo'
                  : selectedJob
                    ? 'View installation'
                    : 'Install setup'}<ArrowRight size={16} /></button
              >
            </div>
          </div>
        {:else if modal === 'session'}<div class="modal-body centered">
            <div class="session-icon"><Play size={32} /></div>
            <p class="eyebrow">YOUR JOURNEY IS READY</p>
            <h2>{selected.name}</h2>
            <p class="modal-intro">This is where your adventure would begin.</p>
            <div class="notice">
              <FlaskConical size={18} />
              <p>
                Demo launch successful. In the connected app, this action will
                start the game through its configured MO2 profile. No game was
                launched.
              </p>
            </div>
            <div class="session-details">
              <span><CheckCircle2 size={16} />Profile selected</span><span
                ><CheckCircle2 size={16} />Launch plan validated</span
              >
            </div>
            <button class="primary full" onclick={() => (modal = null)}
              >Back to my library<ArrowRight size={16} /></button
            >
          </div>
        {:else if modal === 'uninstall'}<div class="modal-body">
            <Trash2 size={32} class="copper" />
            <h2>Remove {selected.name}?</h2>
            <p class="modal-intro">
              This removes the setup from your demo library. Your actual games,
              saves, and files won’t be touched.
            </p>
            <div class="modal-actions">
              <button class="secondary" onclick={() => (modal = null)}
                >Keep setup</button
              ><button
                class="danger-button"
                disabled={busy}
                onclick={async () => {
                  await action(
                    () => window.loadstone.library('uninstall', selected.id),
                    'Demo setup removed.',
                  );
                  modal = null;
                }}>Remove demo setup</button
              >
            </div>
          </div>
        {:else if modal === 'reset'}<div class="modal-body">
            <RotateCcw size={32} class="copper" />
            <h2>A fresh start?</h2>
            <p class="modal-intro">
              Clear demo installations, library entries, and activity logs. Your
              preferences and actual game files stay untouched.
            </p>
            <div class="modal-actions">
              <button class="secondary" onclick={() => (modal = null)}
                >Keep workspace</button
              ><button
                class="danger-button"
                disabled={busy}
                onclick={async () => {
                  await action(
                    () => window.loadstone.resetDemo(),
                    'Demo workspace reset. Ready for a fresh journey.',
                  );
                  modal = null;
                }}>Reset demo data</button
              >
            </div>
          </div>
        {:else}<div class="modal-body centered">
            <Logo size={72} />
            <h2>Loadstone</h2>
            <p class="modal-intro">Your next playthrough, ready.</p>
            <div class="detail-meta centered-meta">
              <span>{appVersion}</span><span>Windows developer preview</span>
            </div>
            <p class="long-description">
              Explore the fictional demo catalog or import a creator’s setup
              manifest in the live workspace. Keep installation progress and
              installed profiles together in your library.
            </p>
            <div class="notice">
              <Info size={18} />
              <p>
                The demo is simulated. Live installation features are in private
                testing and require your game, a compatible list and source
                access. Full install-to-play and Steam acceptance remain open.
              </p>
            </div>
            <LicenseNotice />
            <button class="primary full" onclick={() => (modal = null)}
              >Let’s explore<Compass size={17} /></button
            >
          </div>{/if}
      </div>
    </div>
  {/if}
</div>
