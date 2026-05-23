/**
 * Stylesheet for the preview body. Scoped to `.heysnap-md-preview` so it
 * can't leak into the rest of the page. All color rules derive from
 * `currentColor` + `color-mix(...)` so the same sheet works on both light
 * and dark hosts — whatever foreground the consumer set on the viewer (or
 * inherits from the document) drives every accent here.
 *
 * Injection: {@link ensureMarkdownPreviewStyles} appends a single `<style>`
 * to `document.head` the first time a `HeySnapMarkdownViewer` mounts in
 * preview mode, then no-ops on every subsequent mount. We don't import a
 * `.css` file because that would force consumers to wire CSS through their
 * bundler — keeping the styles inline keeps the markdown subpath import
 * "drop in and it works" with zero CSS plumbing on the consumer side.
 */

const STYLE_ID = "heysnap-markdown-preview-styles";

const CSS = `
.heysnap-md-preview {
  color: inherit;
  word-wrap: break-word;
}

.heysnap-md-preview > :first-child { margin-top: 0; }
.heysnap-md-preview > :last-child { margin-bottom: 0; }

/* Headings — small step ladder, semibold, subtle bottom rule on h1/h2 so a
   long document feels sectioned without resorting to extra dividers. */
.heysnap-md-preview h1,
.heysnap-md-preview h2,
.heysnap-md-preview h3,
.heysnap-md-preview h4,
.heysnap-md-preview h5,
.heysnap-md-preview h6 {
  margin: 1.6em 0 0.6em;
  font-weight: 600;
  line-height: 1.25;
  letter-spacing: -0.012em;
}
.heysnap-md-preview h1 {
  font-size: 1.875em;
  padding-bottom: 0.3em;
  border-bottom: 1px solid color-mix(in srgb, currentColor 14%, transparent);
}
.heysnap-md-preview h2 {
  font-size: 1.5em;
  padding-bottom: 0.25em;
  border-bottom: 1px solid color-mix(in srgb, currentColor 12%, transparent);
}
.heysnap-md-preview h3 { font-size: 1.25em; }
.heysnap-md-preview h4 { font-size: 1.05em; }
.heysnap-md-preview h5 { font-size: 1em; }
.heysnap-md-preview h6 {
  font-size: 0.92em;
  color: color-mix(in srgb, currentColor 70%, transparent);
}

.heysnap-md-preview p { margin: 0.75em 0; }

/* Lists — generous left padding so the marker has room to breathe, and a
   shared selector for nested lists kills the double margin that nested
   ULs would otherwise pick up. */
.heysnap-md-preview ul,
.heysnap-md-preview ol {
  margin: 0.75em 0;
  padding-left: 1.6em;
}
.heysnap-md-preview ul ul,
.heysnap-md-preview ul ol,
.heysnap-md-preview ol ul,
.heysnap-md-preview ol ol { margin: 0.25em 0; }
.heysnap-md-preview li { margin: 0.25em 0; }
.heysnap-md-preview li > p { margin: 0.25em 0; }

/* GFM task list checkboxes — drop the default bullet so the checkbox
   stands alone in the line, and align it with the first line of text. */
.heysnap-md-preview li.task-list-item { list-style: none; margin-left: -1.4em; }
.heysnap-md-preview li.task-list-item input[type="checkbox"] {
  margin-right: 0.4em;
  vertical-align: middle;
}

.heysnap-md-preview a {
  color: color-mix(in srgb, currentColor 60%, #3b82f6);
  text-decoration: underline;
  text-underline-offset: 2px;
  text-decoration-thickness: 1px;
}
.heysnap-md-preview a:hover { text-decoration-thickness: 2px; }

.heysnap-md-preview blockquote {
  margin: 1em 0;
  padding: 0.25em 1em;
  color: color-mix(in srgb, currentColor 72%, transparent);
  border-left: 3px solid color-mix(in srgb, currentColor 20%, transparent);
  background: color-mix(in srgb, currentColor 4%, transparent);
  border-radius: 0 4px 4px 0;
}
.heysnap-md-preview blockquote > :first-child { margin-top: 0; }
.heysnap-md-preview blockquote > :last-child { margin-bottom: 0; }

.heysnap-md-preview hr {
  height: 1px;
  border: 0;
  background: color-mix(in srgb, currentColor 14%, transparent);
  margin: 1.6em 0;
}

.heysnap-md-preview img {
  max-width: 100%;
  height: auto;
  border-radius: 6px;
  margin: 0.5em 0;
  /* Subtle ring so transparent images don't disappear into the surface
     in either light or dark mode. */
  box-shadow: 0 0 0 1px color-mix(in srgb, currentColor 8%, transparent);
}

/* Inline code — pill background tinted off the surface so it reads as a
   token rather than a frame. */
.heysnap-md-preview code {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
  font-size: 0.88em;
  padding: 0.15em 0.4em;
  border-radius: 4px;
  background: color-mix(in srgb, currentColor 9%, transparent);
}

/* Fenced code block — full panel with a hairline border. We deliberately
   don't ship syntax highlighting at this layer; consumers wanting colored
   tokens can wrap their own code renderer via the components prop. */
.heysnap-md-preview pre {
  margin: 1em 0;
  padding: 12px 14px;
  border-radius: 6px;
  background: color-mix(in srgb, currentColor 6%, transparent);
  border: 1px solid color-mix(in srgb, currentColor 10%, transparent);
  overflow-x: auto;
  font-size: 13px;
  line-height: 1.55;
}
.heysnap-md-preview pre code {
  background: transparent;
  padding: 0;
  border-radius: 0;
  font-size: inherit;
}

/* GFM tables — borders all the way around, header gets a subtle tint to
   anchor the eye on long datasets. Wide tables are wrapped in a div with
   overflow-x: auto so they scroll horizontally instead of breaking the
   page layout. */
.heysnap-md-preview .heysnap-md-table-wrap {
  overflow-x: auto;
  margin: 1em 0;
}
.heysnap-md-preview table {
  border-collapse: collapse;
  width: 100%;
  font-size: 0.95em;
}
.heysnap-md-preview th,
.heysnap-md-preview td {
  padding: 6px 12px;
  border: 1px solid color-mix(in srgb, currentColor 16%, transparent);
  text-align: left;
  vertical-align: top;
}
.heysnap-md-preview th {
  background: color-mix(in srgb, currentColor 6%, transparent);
  font-weight: 600;
}
.heysnap-md-preview tbody tr:nth-child(even) td {
  background: color-mix(in srgb, currentColor 3%, transparent);
}

/* Keyboard shortcut tag — rarely-emitted but worth styling when GFM
   passes it through. */
.heysnap-md-preview kbd {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  font-size: 0.85em;
  padding: 0.1em 0.45em;
  border-radius: 4px;
  border: 1px solid color-mix(in srgb, currentColor 22%, transparent);
  background: color-mix(in srgb, currentColor 6%, transparent);
  box-shadow: inset 0 -1px 0 color-mix(in srgb, currentColor 18%, transparent);
}

/* Strikethrough lives in remark-gfm output as plain <del>; style it
   explicitly so consumers that strip the default UA color get consistent
   visuals. */
.heysnap-md-preview del {
  color: color-mix(in srgb, currentColor 60%, transparent);
  text-decoration: line-through;
  text-decoration-thickness: 1px;
}
`;

/**
 * Inject the preview stylesheet into `document.head`. Idempotent — the
 * `STYLE_ID` guard means a second call (from another viewer instance) is
 * a cheap DOM lookup with no side effects. Safe to call during render via
 * a `useEffect`; do not call from SSR because we touch `document`.
 */
export function ensureMarkdownPreviewStyles(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = CSS;
  // Prepend so consumer styles loaded after us win the cascade — they'll
  // already be higher specificity in most cases, but ordering keeps the
  // override story predictable.
  document.head.insertBefore(el, document.head.firstChild);
}

/** Class applied to the wrapper that scopes the stylesheet. */
export const MARKDOWN_PREVIEW_CLASS = "heysnap-md-preview";
