<script lang="ts">
  import {
    Compass,
    ArrowRight,
    FlaskConical,
    Gamepad2,
    Download,
    Folder,
  } from '@lucide/svelte';
  let {
    busy,
    onchoose,
  }: { busy: boolean; onchoose: (demo: boolean) => Promise<void> } = $props();
</script>

<section class="welcome" aria-label="Welcome to Loadstone">
  <p class="eyebrow">YOUR NEXT PLAYTHROUGH STARTS HERE</p>
  <Compass size={42} strokeWidth={1.3} />
  <h1>Make room for another adventure.</h1>
  <p class="intro">
    Bring your game. Choose a creator’s setup. Let Loadstone help you prepare
    your next playthrough.
  </p>
  <div class="choices">
    <article>
      <span class="eyebrow">REAL INSTALLATIONS</span>
      <h2>Set up your workspace</h2>
      <p>
        This preview installs creator-provided setups. No playable modlists are
        bundled yet.
      </p>
      <ul>
        <li>
          <Gamepad2 size={20} /><span
            >Your installed game, with the version and DLC required by the
            setup. Tale of Two Wastelands requires both New Vegas and Fallout 3.</span
          >
        </li>
        <li>
          <Folder size={20} /><span
            >A trusted creator’s .loadstone package and a separate folder with
            enough free space. The installation guide asks for its required
            games, original archives and prepared files.</span
          >
        </li>
        <li>
          <Download size={20} /><span
            >For Nexus sources, select your manually downloaded originals or
            connect a Premium account in Settings for automatic downloads.
            Local-only packages need no Nexus connection.</span
          >
        </li>
      </ul>
      <button class="primary" disabled={busy} onclick={() => onchoose(false)}
        >Set up real installations <ArrowRight size={18} /></button
      >
      <p class="note">
        Next: open your .loadstone package in Discover. Wabbajack setups use the
        separate manifest import and optional engine in Settings. Nothing
        downloads until you request it.
      </p>
    </article>
    <article class="demo-choice">
      <FlaskConical size={27} />
      <h2>Take a look around</h2>
      <p>
        Try the interface with fictional setups. Downloads, compatibility
        checks, launches and shortcuts are simulated.
      </p>
      <p>
        The demo does not install mods or change your games or Steam library.
      </p>
      <button class="secondary" disabled={busy} onclick={() => onchoose(true)}
        >Explore the demo</button
      >
      <p class="note">You can switch workspaces later in Settings.</p>
    </article>
  </div>
  <p class="preview-note">
    Developer preview · Full real-list install-to-play testing is still in
    progress. Keep trusted backups of your saves.
  </p>
</section>

<style>
  .welcome {
    max-width: 1120px;
    margin: 0 auto;
    padding: 48px 36px;
    color: #d9ddd8;
  }
  .welcome > :global(svg) {
    color: #c89d77;
    margin: 18px 0;
  }
  h1 {
    font-size: clamp(30px, 3vw, 44px);
    line-height: 1.2;
    margin: 0 0 16px;
  }
  h2 {
    font-size: 24px;
    margin: 15px 0;
  }
  p {
    color: #a9b1ac;
    line-height: 1.65;
  }
  .intro {
    max-width: 650px;
    font-size: 17px;
    margin-bottom: 30px;
  }
  .choices {
    display: grid;
    grid-template-columns: 1.6fr 1fr;
    gap: 22px;
  }
  article {
    border: 1px solid #655541;
    background: #1c2222;
    border-radius: 14px;
    padding: 28px;
  }
  .demo-choice {
    border-color: #35403e;
    background: #191f20;
  }
  .demo-choice > :global(svg) {
    color: #8fa69c;
  }
  ul {
    list-style: none;
    margin: 25px 0;
    padding: 0;
  }
  li {
    display: flex;
    gap: 14px;
    align-items: start;
    margin: 20px 0;
    line-height: 1.5;
    color: #c0c8c1;
  }
  li :global(svg) {
    flex-shrink: 0;
    color: #c89d77;
    margin-top: 3px;
  }
  button {
    margin-top: 12px;
  }
  .note,
  .preview-note {
    font-size: 12px;
  }
  .preview-note {
    margin-top: 24px;
  }
  @media (max-width: 1000px) {
    .choices {
      grid-template-columns: 1fr;
    }
    .welcome {
      padding: 28px;
    }
  }
</style>
