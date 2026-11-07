export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDistance(value: number, unit: 'M' | 'K'): string {
  return `${value.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${unit === 'M' ? 'mi' : 'km'}`;
}

export function formatDateTime(iso: string, locale?: string): string {
  return new Date(iso).toLocaleString(locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function plural(count: number, word: string, pluralWord = `${word}s`): string {
  return `${count} ${count === 1 ? word : pluralWord}`;
}

/** Joins a host folder and a file name for display, without doubling the separator. */
export function displayPath(folder: string, name: string): string {
  const sep = folder.includes('\\') && !folder.includes('/') ? '\\' : '/';
  return folder.endsWith(sep) ? `${folder}${name}` : `${folder}${sep}${name}`;
}
