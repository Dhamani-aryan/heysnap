const routeFromPathname = (pathname) => {
  const normalized = pathname
    .replace(/\/index\.html$/u, "")
    .replace(/\/+$/u, "");

  return normalized.length === 0 ? "/" : normalized;
};

const resolveRootPath = () => {
  const script = document.currentScript;
  const configured = script?.dataset.rootPath;

  if (configured !== undefined && configured.length > 0) {
    return configured.replace(/\/+$/u, "");
  }

  return ".";
};

const createHeader = () => {
  const rootPath = resolveRootPath();
  const currentPath = document.body.dataset.docsPath ?? routeFromPathname(window.location.pathname);
  const logoPath = `${rootPath}/heysnap-light-logo.png`;

  const header = document.createElement("header");
  header.className = "docs-header";
  header.innerHTML = `
    <div class="docs-header-inner">
      <a class="docs-brand" href="${rootPath}/index.html" aria-label="HeySnap docs home">
        <img class="docs-logo" src="${logoPath}" alt="" />
        <span class="docs-title">HeySnap</span>
      </a>
      <div class="docs-route" aria-label="Current docs path">
        <span class="docs-route-text">${escapeHtml(currentPath)}</span>
      </div>
    </div>
  `;

  return header;
};

const escapeHtml = (value) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");

const mountShell = () => {
  const shell = document.querySelector("[data-docs-shell]");

  if (shell === null) {
    return;
  }

  shell.prepend(createHeader());
};

mountShell();
