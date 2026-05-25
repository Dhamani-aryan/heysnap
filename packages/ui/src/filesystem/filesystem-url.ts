const VOLATILE_FILESYSTEM_URL_PARAMS = new Set(["accessToken", "token", "path", "showHidden", "v"]);

export const normalizeFilesystemConnectionIdentity = (rawUrl: string, baseUrl = getDefaultBaseUrl()): string => {
  const url = new URL(rawUrl, baseUrl);

  for (const param of VOLATILE_FILESYSTEM_URL_PARAMS) {
    url.searchParams.delete(param);
  }

  sortSearchParams(url);
  url.hash = "";

  return url.toString();
};

const sortSearchParams = (url: URL): void => {
  const entries = Array.from(url.searchParams.entries())
    .sort(([leftName, leftValue], [rightName, rightValue]) =>
      leftName === rightName ? leftValue.localeCompare(rightValue) : leftName.localeCompare(rightName)
    );

  url.search = "";

  for (const [name, value] of entries) {
    url.searchParams.append(name, value);
  }
};

const getDefaultBaseUrl = (): string =>
  typeof window !== "undefined" && typeof window.location?.href === "string"
    ? window.location.href
    : "http://localhost";
