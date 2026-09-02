/**
 * Theme + zoom glue for `docx-preview`'s output.
 *
 * `docx-preview` renders into:
 *   <div ref={containerRef}>                <- our `.heysnap-docx-render-root`
 *     <div class="docx-wrapper heysnap-docx-render">
 *       <section class="docx">…page…</section>
 *       …
 *     </div>
 *   </div>
 *
 * The library injects its own `<style>` blocks for fonts/numbering/etc.,
 * but ships no theming hooks for the gutter color. We layer those on
 * here:
 *   - Gutter color / text color come from CSS custom properties our
 *     wrapper sets (`--hs-doc-bg`, `--hs-doc-text`).
 *   - Margin guides are a dotted outline keyed off `--hs-doc-margin-guide`
 *     — transparent (default) renders no border at all.
 *
 * Zoom is handled separately on the React side via the CSS `zoom`
 * property (set inline on `.heysnap-docx-render-root`) — that scales
 * layout including scroll bounds, which `transform: scale()` doesn't.
 */
const DOCX_THEME_CSS = `
.heysnap-viewer--docx .heysnap-docx-render-root {
  /* The library paints its own background on .docx-wrapper. Match the
     gutter color so the seam between our container and the wrapper is
     invisible until the first page renders. */
  background: var(--hs-doc-bg, #e9eaed);
  color: var(--hs-doc-text, #15171c);
  min-height: 100%;
  /* Anchor the scaled wrapper so its growth via transform doesn't shift
     into negative coordinates on zoom-in. */
  display: flex;
  justify-content: center;
}

.heysnap-viewer--docx .heysnap-docx-render-root .docx-wrapper {
  background: var(--hs-doc-bg, #e9eaed) !important;
}

.heysnap-viewer--docx .heysnap-docx-render-root .docx {
  /* The page surface. Library defaults to white; keep that — only theme
     the gutter and text-on-gutter, never the page itself. */
  color: #202124;
  outline: 1px solid var(--hs-doc-margin-guide, transparent);
  outline-offset: -1px;
}
`;

const STYLE_ID = "heysnap-docx-theme-overrides";

/**
 * Idempotently inject the theme-override stylesheet into `<head>` exactly
 * once per page. Multiple `HeySnapDocxViewer` instances share the same
 * style element — each instance scopes its `--hs-*` custom properties to
 * its own wrapper, so the cascade resolves correctly per-instance.
 */
export function ensureDocxThemeStyles(): void {
  if (typeof document === "undefined") return; // SSR / Node test envs
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = DOCX_THEME_CSS;
  document.head.appendChild(style);
}
