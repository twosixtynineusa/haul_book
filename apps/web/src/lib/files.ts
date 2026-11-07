import { ACCEPTED_EXTENSIONS, MAX_UPLOAD_BYTES, MAX_UPLOAD_FILES } from '@haulbook/shared';

/** The bits of a browser `File` the dropzone logic needs (keeps it testable in node). */
export interface FileLike {
  name: string;
  size: number;
}

export interface MergeResult<T extends FileLike> {
  files: T[];
  rejected: string[];
}

/**
 * Adds dropped/browsed files to the current selection: CSV or Excel, within the
 * upload size/count limits, and no duplicates (same name + size).
 */
export function mergeFiles<T extends FileLike>(current: T[], incoming: T[]): MergeResult<T> {
  const files = [...current];
  const rejected: string[] = [];
  for (const file of incoming) {
    const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
    if (!(ACCEPTED_EXTENSIONS as readonly string[]).includes(ext)) {
      rejected.push(`${file.name}: only ${ACCEPTED_EXTENSIONS.join(', ')} files are accepted`);
    } else if (file.size > MAX_UPLOAD_BYTES) {
      rejected.push(`${file.name}: larger than ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB`);
    } else if (files.some((f) => f.name === file.name && f.size === file.size)) {
      continue;
    } else if (files.length >= MAX_UPLOAD_FILES) {
      rejected.push(`${file.name}: at most ${MAX_UPLOAD_FILES} files per conversion`);
    } else {
      files.push(file);
    }
  }
  return { files, rejected };
}
