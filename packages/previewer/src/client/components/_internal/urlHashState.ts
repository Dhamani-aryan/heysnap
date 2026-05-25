export const readHashParam = (name: string): string | null => {
  if (typeof window === "undefined") {
    return null;
  }

  return parseHashParams(window.location.hash).get(name);
};

export const writeHashParam = (name: string, value: string | null): void => {
  if (typeof window === "undefined") {
    return;
  }

  const params = parseHashParams(window.location.hash);

  if (value === null || value.length === 0) {
    params.delete(name);
  } else {
    params.set(name, value);
  }

  const query = params.toString();
  const nextUrl = `${window.location.pathname}${window.location.search}${query.length === 0 ? "" : `#${query}`}`;

  window.history.replaceState(window.history.state, "", nextUrl);
};

const parseHashParams = (hash: string): URLSearchParams => {
  const value = hash.startsWith("#") ? hash.slice(1) : hash;

  return new URLSearchParams(value);
};
