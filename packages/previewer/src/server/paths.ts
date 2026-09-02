import { isAbsolute, resolve, sep } from "node:path";

export class PreviewPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PreviewPathError";
  }
}

export interface ResolvePreviewPathInput {
  readonly path: string;
  readonly root?: string;
}

export interface ResolvedPreviewPath {
  readonly filePath: string;
  readonly publicPath: string;
  readonly htmlRootPath: string | null;
}

export interface PreviewPathResolverOptions {
  readonly rootPath?: string;
  readonly allowAbsolutePaths?: boolean;
}

export type PreviewPathResolver = (input: ResolvePreviewPathInput) => Promise<ResolvedPreviewPath> | ResolvedPreviewPath;

export const createDefaultPreviewPathResolver = (
  options: PreviewPathResolverOptions = {},
): PreviewPathResolver => {
  const rootPath = options.rootPath === undefined ? undefined : resolve(options.rootPath);
  const allowAbsolutePaths = options.allowAbsolutePaths ?? false;

  return (input) => {
    if (input.path.trim().length === 0 || input.path.includes("\0")) {
      throw new PreviewPathError("Preview path is required.");
    }

    const filePath = resolveRequestedPath(input.path, {
      rootPath,
      allowAbsolutePaths,
      kind: "path",
    });
    const htmlRootPath = input.root === undefined || input.root.trim().length === 0
      ? null
      : resolveRequestedPath(input.root, {
          rootPath,
          allowAbsolutePaths,
          kind: "root",
        });

    if (htmlRootPath !== null) {
      ensurePathInside(htmlRootPath, filePath, "Preview path must be inside the HTML root.");
    }

    return {
      filePath,
      publicPath: input.path,
      htmlRootPath,
    };
  };
};

const resolveRequestedPath = (
  rawPath: string,
  options: {
    readonly rootPath: string | undefined;
    readonly allowAbsolutePaths: boolean;
    readonly kind: "path" | "root";
  },
): string => {
  const trimmedPath = rawPath.trim();

  if (trimmedPath.length === 0 || trimmedPath.includes("\0")) {
    throw new PreviewPathError(`Preview ${options.kind} is invalid.`);
  }

  if (isAbsolute(trimmedPath)) {
    const absolutePath = resolve(trimmedPath);

    if (options.rootPath !== undefined && !options.allowAbsolutePaths) {
      ensurePathInside(options.rootPath, absolutePath, `Preview ${options.kind} is outside the configured root.`);
    }

    return absolutePath;
  }

  if (options.rootPath === undefined) {
    throw new PreviewPathError(`Preview ${options.kind} must be absolute.`);
  }

  const absolutePath = resolve(options.rootPath, trimmedPath);
  ensurePathInside(options.rootPath, absolutePath, `Preview ${options.kind} is outside the configured root.`);
  return absolutePath;
};

export const ensurePathInside = (rootPath: string, targetPath: string, message: string): void => {
  const root = resolve(rootPath);
  const target = resolve(targetPath);

  if (target !== root && !target.startsWith(root + sep)) {
    throw new PreviewPathError(message);
  }
};

export const normalizeBasePath = (basePath: string | undefined): string => {
  const rawBasePath = basePath?.trim() || "/preview";
  const withLeadingSlash = rawBasePath.startsWith("/") ? rawBasePath : `/${rawBasePath}`;
  const normalized = withLeadingSlash.replace(/\/+$/u, "");

  return normalized.length === 0 ? "/" : normalized;
};

export const stripBasePath = (pathname: string, basePath: string): string | null => {
  if (basePath === "/") {
    return pathname;
  }

  if (pathname === basePath) {
    return "/";
  }

  if (!pathname.startsWith(`${basePath}/`)) {
    return null;
  }

  return pathname.slice(basePath.length);
};
