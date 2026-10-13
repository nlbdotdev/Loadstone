<script lang="ts">
  import { PackageCheck, FileSearch } from '@lucide/svelte';
  import type { NativePackageSummary } from './types';
  let result = $state<NativePackageSummary | null>(null);
  let busy = $state(false);
  let error = $state('');
  const names: Record<string, string> = {
    fnv: 'Fallout: New Vegas',
    fallout3: 'Fallout 3',
    skyrimse: 'Skyrim Special Edition',
    fallout4: 'Fallout 4',
  };
  const compatibility = {
    unknown: 'Not yet established',
    'new-save-required': 'Start a new game',
    compatible: 'Creator declares compatible saves',
  };
  async function inspect() {
    if (busy) return;
    busy = true;
    error = '';
    result = null;
    try {
      result = await window.loadstone.inspectNativePackage();
    } catch (e) {
      error =
        e instanceof Error
          ? e.message.replace(
              /^Error invoking remote method '[^']+': Error: /,
              '',
            )
          : 'Could not inspect this package.';
    } finally {
      busy = false;
    }
  }
</script>

<section class="native-preview" aria-label="Native package creator tools">
  <div class="section-heading">
    <PackageCheck size={22} />
    <div>
      <h2>Native package preview</h2>
      <p>Creator tools · Experimental</p>
    </div>
  </div>
  <p>
    Open a .loadstone package to review its game requirements and check its
    bundled files. Native installation is still in development.
  </p>
  <button class="secondary" disabled={busy} onclick={inspect}
    ><FileSearch size={16} />{busy
      ? 'Checking package…'
      : 'Inspect .loadstone package'}</button
  >
  {#if busy}<p role="status">
      Reading the recipe and checking bundled file hashes…
    </p>{/if}
  {#if error}<p class="native-error" role="alert">{error}</p>{/if}
  {#if result}
    <section class="native-result" aria-label="Native package inspection">
      <span class="eyebrow">Package integrity checked</span>
      <h3>{result.name} <span>v{result.version}</span></h3>
      <p>
        By {result.author} · {names[result.game.id]}{result.game.variant ===
        'ttw'
          ? ' · Tale of Two Wastelands'
          : ''}
      </p>
      <dl>
        <div>
          <dt>Owned games required</dt>
          <dd>{result.requiredGames.map((id) => names[id]).join(' + ')}</dd>
        </div>
        <div>
          <dt>Expected installation</dt>
          <dd>
            {result.outputs.toLocaleString()} files · {(
              result.installBytes / 1e9
            ).toFixed(2)} GB
          </dd>
        </div>
        <div>
          <dt>Sources</dt>
          <dd>
            {result.downloadSources} downloads · {result.gameSources} local game inputs
            · {result.payloadSources} bundled files
          </dd>
        </div>
        <div>
          <dt>MO2 profile</dt>
          <dd>{result.profile}</dd>
        </div>
        <div>
          <dt>Save guidance</dt>
          <dd>{compatibility[result.saveCompatibility.status]}</dd>
        </div>
      </dl>
      <p>{result.saveCompatibility.notes}</p>
      <p class="native-note">
        This checks the package structure and bundled bytes. Downloaded mods,
        owned game files, permissions and gameplay still need verification
        before release.
      </p>
      <details>
        <summary>Recipe fingerprint</summary><code>{result.recipeSha256}</code>
      </details>
    </section>
  {/if}
</section>

<style>
  .native-preview {
    margin: 24px 0;
    padding: 28px;
    background: #1c2122;
    border: 1px solid #35403e;
    border-radius: 12px;
  }
  .section-heading {
    display: flex;
    align-items: center;
    gap: 14px;
    color: #c79d77;
  }
  h2 {
    font-size: 22px;
    color: #f0eee9;
    margin: 0 0 6px;
  }
  h3 {
    font-size: 22px;
    margin: 12px 0 0;
    overflow-wrap: anywhere;
  }
  h3 span {
    color: #b1b8b2;
    font-size: 15px;
  }
  p {
    color: #a2aaa6;
    line-height: 1.6;
    overflow-wrap: anywhere;
  }
  .section-heading p {
    margin: 0;
    font-size: 13px;
  }
  .native-result {
    margin-top: 24px;
    padding-top: 24px;
    border-top: 1px solid #35403e;
  }
  dl {
    display: grid;
    gap: 16px;
    margin: 22px 0;
  }
  dl div {
    display: grid;
    grid-template-columns: minmax(130px, 1fr) 2fr;
    gap: 18px;
  }
  dt {
    color: #a2aaa6;
    font-size: 13px;
  }
  dd {
    margin: 0;
    font-size: 14px;
    overflow-wrap: anywhere;
  }
  .native-error {
    color: #edaa95;
  }
  .native-note {
    font-size: 13px;
  }
  summary {
    cursor: pointer;
    color: #c79d77;
    font-size: 13px;
  }
  code {
    display: block;
    margin-top: 12px;
    overflow-wrap: anywhere;
    font-size: 12px;
  }
</style>
