<script lang="ts">
  import { license } from '../package.json';
  import terms from '../LICENSE?raw';
  import notice from '../COPYRIGHT?raw';
</script>

<section class="license-notice" aria-label="Loadstone license">
  <p>Copyright © 2026 Nathan Bennett and contributors</p>
  <p>
    Free software under {license}. You may redistribute and modify the covered
    source under these terms. Provided without warranty.
  </p>
  <details>
    <summary>Read license and scope</summary>
    <textarea readonly aria-label="License text" value={notice + '\n\n' + terms}
    ></textarea>
  </details>
</section>

<style>
  .license-notice {
    margin: 20px 0;
    text-align: left;
    color: #bbc1ba;
    font-size: 13px;
    line-height: 1.6;
  }
  p {
    margin: 8px 0;
  }
  summary {
    cursor: pointer;
    color: #dfb78e;
  }
  textarea {
    width: 100%;
    height: 240px;
    box-sizing: border-box;
    resize: vertical;
    color: inherit;
    background: #151b1e;
    overflow: auto;
    padding: 14px;
    border: 1px solid #45504a;
    border-radius: 8px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font: inherit;
  }
</style>
