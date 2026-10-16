<script lang="ts">
  import { onMount, tick } from 'svelte';
  import {
    ArrowUpRight,
    ArrowRight,
    ArrowLeft,
    Search,
    Menu,
    X,
    BookOpen,
    FileText,
    GitBranch,
    ChevronRight,
    Command,
    Layers,
    Code2,
  } from '@lucide/svelte';
  import content from '../generated/content.json';
  import Logo from '../../src/Logo.svelte';
  import icon from '../../public/brand/icon.svg';

  let route = 'welcome',
    section = '',
    mobileOpen = false,
    query = '',
    copyStatus = '';
  let windowWidth = 1200;
  let searchDialog: HTMLDialogElement,
    searchInput: HTMLInputElement,
    articleElement: HTMLElement;
  let observer: IntersectionObserver | undefined,
    activeHeading = '';
  $: article = content.pages.find((page) => page.id === route);
  $: index = content.pages.findIndex((page) => page.id === route);
  $: previous = index > 0 ? content.pages[index - 1] : undefined;
  $: next = index >= 0 ? content.pages[index + 1] : undefined;
  $: terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  $: results = terms.length
    ? content.pages
        .map((page) => {
          const title = page.title.toLowerCase(),
            text = page.text.toLowerCase();
          return {
            page,
            score: terms.every((term) => (title + ' ' + text).includes(term))
              ? terms.reduce(
                  (score, term) => score + (title.includes(term) ? 10 : 1),
                  0,
                )
              : 0,
          };
        })
        .filter((v) => v.score)
        .sort((a, b) => b.score - a.score)
        .slice(0, 12)
    : [];

  async function navigate() {
    const hash = location.hash.slice(1) || '/welcome';
    const [path, params] = hash.split('?');
    route = path.replace(/^\//, '');
    section = new URLSearchParams(params).get('section') || '';
    mobileOpen = false;
    searchDialog?.close();
    await tick();
    articleElement?.focus({ preventScroll: true });
    const anchor = section ? document.getElementById(section) : null;
    if (anchor) anchor.scrollIntoView();
    else window.scrollTo({ top: 0 });
    activeHeading = section;
    observer?.disconnect();
    observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.find((entry) => entry.isIntersecting);
        if (visible) activeHeading = visible.target.id;
      },
      { rootMargin: '-90px 0px -65% 0px' },
    );
    articleElement
      ?.querySelectorAll('h2[id],h3[id]')
      .forEach((heading) => observer?.observe(heading));
  }
  onMount(() => {
    navigate();
    window.addEventListener('hashchange', navigate);
    return () => {
      window.removeEventListener('hashchange', navigate);
      observer?.disconnect();
    };
  });
  async function openSearch() {
    searchDialog.showModal();
    await tick();
    searchInput.focus();
  }
  function shortcuts(event: KeyboardEvent) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      openSearch();
    }
    if (event.key === 'Escape') mobileOpen = false;
  }
  async function copyCode(event: MouseEvent) {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
      '[data-copy-code]',
    );
    const code = button?.closest('.code-block')?.querySelector('code');
    if (!button || !code) return;
    try {
      await navigator.clipboard.writeText(code.textContent || '');
      button.textContent = 'Copied';
      copyStatus = 'Code example copied.';
    } catch {
      copyStatus =
        'Clipboard unavailable. Select the code and copy it manually.';
    }
  }
  function snippet(text: string) {
    const compact = text.replace(/\s+/g, ' '),
      position = compact.toLowerCase().indexOf(terms[0] || '');
    const start = Math.max(0, position - 50);
    return (start ? '…' : '') + compact.slice(start, start + 175) + '…';
  }
</script>

<svelte:head>
  <title>{article?.title || 'Page not found'} · Loadstone Handbook</title>
  <link rel="icon" type="image/svg+xml" href={icon} />
</svelte:head>
<svelte:window onkeydown={shortcuts} bind:innerWidth={windowWidth} />

<a
  class="skip-link"
  href="#main"
  onclick={(event) => {
    event.preventDefault();
    articleElement?.focus();
    articleElement?.scrollIntoView();
  }}>Skip to content</a
>
{#if mobileOpen}<button
    class="nav-scrim"
    aria-label="Close navigation"
    onclick={() => (mobileOpen = false)}
  ></button>{/if}
<aside
  id="handbook-sidebar"
  class:open={mobileOpen}
  class="sidebar"
  inert={windowWidth <= 800 && !mobileOpen}
>
  <a class="identity" href="#/welcome" aria-label="Loadstone handbook home"
    ><Logo size={44} /><span
      ><strong>Loadstone</strong><small>THE HANDBOOK</small></span
    ></a
  >
  <button class="sidebar-search" onclick={openSearch}
    ><Search size={16} /><span>Search the handbook</span><kbd>Ctrl K</kbd
    ></button
  >
  <nav aria-label="Handbook navigation">
    {#each content.groups as group}
      {#if group === 'Archive'}
        <details open={article?.group === 'Archive'}>
          <summary>Archive <ChevronRight size={13} /></summary>
          <div class="nav-group">
            {#each content.pages.filter((page) => page.group === group) as page}<a
                class:active={route === page.id}
                onclick={() => (mobileOpen = false)}
                aria-current={route === page.id ? 'page' : undefined}
                href={'#/' + page.id}>{page.title}</a
              >{/each}
          </div>
        </details>
      {:else}
        <section class="nav-group">
          <h2>{group}</h2>
          {#each content.pages.filter((page) => page.group === group) as page}<a
              class:active={route === page.id}
              onclick={() => (mobileOpen = false)}
              aria-current={route === page.id ? 'page' : undefined}
              href={'#/' + page.id}>{page.title}</a
            >{/each}
        </section>
      {/if}
    {/each}
  </nav>
  <div class="sidebar-footer">
    <a href="./agents.md" download="agents.md"
      ><FileText size={16} /><span
        >Agent edition <small>Complete Markdown handbook</small></span
      ><ArrowUpRight size={14} /></a
    >
    <div>
      <span class="status-dot"></span> Local edition
      <span>v{content.version}</span>
    </div>
  </div>
</aside>

<div class="workspace">
  <header class="topbar">
    <button
      class="menu-button"
      onclick={() => (mobileOpen = !mobileOpen)}
      aria-expanded={mobileOpen}
      aria-controls="handbook-sidebar"
      aria-label="Toggle navigation"><Menu size={21} /></button
    >
    <div class="breadcrumb">
      <BookOpen size={15} /><span>Handbook</span><ChevronRight
        size={13}
      /><strong>{article?.group || 'Not found'}</strong>
    </div>
    <a
      class="repository-link"
      href="https://github.com/nlbdotdev/Loadstone"
      target="_blank"
      rel="noopener noreferrer"
      ><GitBranch size={16} /><span>Source</span><ArrowUpRight size={13} /></a
    >
  </header>
  <div class="reading-layout">
    <main id="main" bind:this={articleElement} tabindex="-1">
      {#if article}
        <div class="page-meta">
          <span
            >{route === 'welcome'
              ? 'A FIELD GUIDE TO LOADSTONE'
              : article.group.toUpperCase()}</span
          ><span>{Math.max(1, Math.ceil(article.words / 220))} min read</span>
        </div>
        {#if route === 'welcome'}
          <div class="hero">
            <h1>Your next playthrough,<br /><em>well documented.</em></h1>
            <p>
              Understand your setup. Build with confidence.<br />A guide for
              players, creators and contributors.
            </p>
            <div class="edition-note">
              <span class="status-dot"></span> Developer preview <span>·</span>
              Version {content.version}
            </div>
          </div>
          <div class="path-cards">
            <a href="#/quick-start"
              ><div><Layers size={22} /><span>01 / PLAYERS</span></div>
              <h2>Find your starting point.</h2>
              <p>
                Install a setup, understand its sources and keep your
                playthrough safe.
              </p>
              <span class="card-link"
                >Your first setup <ArrowRight size={17} /></span
              ></a
            >
            <a href="#/creator-workflow"
              ><div><Code2 size={22} /><span>02 / CREATORS</span></div>
              <h2>Make it reproducible.</h2>
              <p>
                Turn an installed profile into a reviewed, verifiable recipe.
              </p>
              <span class="card-link"
                >The creator workflow <ArrowRight size={17} /></span
              ></a
            >
          </div>
          <div class="contributor-link">
            <span>Working on Loadstone itself?</span><a href="#/development"
              >Open the development guide <ArrowUpRight size={14} /></a
            >
          </div>
        {:else}<h1>{article.title}</h1>
          <p class="page-summary">{article.summary}</p>{/if}
        {#if article.group === 'Archive'}<div class="archive-note">
            Historical record. These observations apply to the versions
            identified on this page.
          </div>{/if}
        <!-- HTML is compiled from an explicit repository allowlist with raw HTML disabled and checked URLs. -->
        <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
        <div class="prose" onclick={copyCode}>{@html article.html}</div>
        <div class="page-source">
          <a href={article.sourceUrl} target="_blank" rel="noopener noreferrer"
            >View canonical source <ArrowUpRight size={14} /></a
          ><span>GPL-3.0-or-later · documentation</span>
        </div>
        <div class="page-turns">
          {#if previous}<a href={'#/' + previous.id}
              ><ArrowLeft size={17} /><span
                ><small>PREVIOUS</small>{previous.title}</span
              ></a
            >{:else}<span></span>{/if}
          {#if next}<a href={'#/' + next.id}
              ><span><small>NEXT</small>{next.title}</span><ArrowRight
                size={17}
              /></a
            >{/if}
        </div>
      {:else}
        <div class="not-found">
          <span class="eyebrow">OFF THE MAP</span>
          <h1>That page isn't here.</h1>
          <p>
            The link may be outdated. Search the handbook or return to the
            starting point.
          </p>
          <a class="primary-link" href="#/welcome"
            >Back to the handbook <ArrowRight size={17} /></a
          >
        </div>
      {/if}
    </main>
    {#if article}<aside class="contents" aria-label="On this page">
        <h2>ON THIS PAGE</h2>
        {#each article.headings.filter((heading) => heading.level === 2) as heading}<a
            class:current={activeHeading === heading.id}
            href={'#/' + route + '?section=' + encodeURIComponent(heading.id)}
            >{heading.text}</a
          >{/each}
        <div class="contents-note">
          <span class="status-dot"></span>
          <p>Source-backed guidance.<br />Updated with the code.</p>
        </div>
      </aside>{/if}
  </div>
  <footer class="site-footer">
    <span
      >Loadstone <span class="footer-dot">/</span> Greater worlds start with a solid
      foundation.</span
    ><a href="./frontend-notices.json" target="_blank" rel="noopener noreferrer"
      >Third-party notices</a
    >
  </footer>
</div>
<span class="sr-only" role="status">{copyStatus}</span>

<dialog
  bind:this={searchDialog}
  class="search-dialog"
  aria-label="Search the handbook"
  onclick={(event) => {
    if (event.target === searchDialog) searchDialog.close();
  }}
  onkeydown={(event) => {
    if (event.key === 'Escape') searchDialog.close();
  }}
>
  <div class="search-field">
    <Search size={22} /><input
      bind:this={searchInput}
      bind:value={query}
      aria-label="Search documentation"
      placeholder="What would you like to know?"
    /><button aria-label="Close search" onclick={() => searchDialog.close()}
      ><X size={20} /></button
    >
  </div>
  <div class="search-results">
    {#if !terms.length}<div class="search-empty">
        <Command size={24} />
        <h2>A shortcut to the answer.</h2>
        <p>Search workflows, format fields, recovery steps and more.</p>
        <div>
          {#each ['repair', 'Nexus', 'BSA'] as suggestion}<button
              onclick={() => (query = suggestion)}>{suggestion}</button
            >{/each}
        </div>
      </div>
    {:else if !results.length}<div class="search-empty">
        <h2>No matching pages.</h2>
        <p>Try a shorter phrase or a related term.</p>
        <button onclick={() => (query = '')}>Clear search</button>
      </div>
    {:else}<p class="results-label">
        {results.length} matching {results.length === 1
          ? 'page'
          : 'pages'}{results.length === 12 ? ' · top results' : ''}
      </p>
      {#each results as { page }}<a
          href={'#/' + page.id}
          onclick={() => searchDialog.close()}
          ><small>{page.group}</small><strong
            >{page.title}<ArrowUpRight size={16} /></strong
          >
          <p>{snippet(page.text)}</p></a
        >{/each}{/if}
  </div>
  <div class="search-footer">
    <span>Search runs entirely on this device.</span><span
      ><kbd>Esc</kbd> to close</span
    >
  </div>
</dialog>
