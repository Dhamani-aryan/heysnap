export const formatBytes = (bytes: number): string => {
  if (bytes < 1024) {
    return `${String(bytes)} B`;
  }

  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unitIndex]}`;
};

export const formatTimestamp = (timestamp: string): string => {
  const date = new Date(timestamp);

  return Number.isNaN(date.getTime()) ? timestamp : date.toLocaleString();
};

export const validateFilesystemName = (name: string): string | null => {
  if (name.length === 0) {
    return 'Enter a name.';
  }

  if (name === '.' || name === '..') {
    return 'Use a different name.';
  }

  if (name.includes('/') || name.includes('\\') || name.includes('\0')) {
    return 'Names cannot contain slashes.';
  }

  return null;
};
