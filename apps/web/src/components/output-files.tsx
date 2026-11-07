'use client';

import { useState } from 'react';
import { Check, Copy, Download, FolderOpen, RefreshCw } from 'lucide-react';
import type { OutputList } from '@haulbook/shared';
import { downloadUrl } from '@/lib/api';
import { formatBytes, formatDateTime } from '@/lib/format';
import { Alert, Button, Card, cx } from './ui';

export function OutputFiles({
  outputs,
  error,
  loading,
  highlight,
  onRefresh,
}: {
  outputs: OutputList | null;
  error: string | null;
  loading: boolean;
  /** Names to mark as just saved. */
  highlight?: string[];
  onRefresh: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const copyFolder = async () => {
    if (!outputs) return;
    try {
      await navigator.clipboard.writeText(outputs.outputDir);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard needs a secure context (localhost is fine); ignore elsewhere.
    }
  };

  return (
    <Card
      title="Output folder"
      action={
        <Button variant="ghost" onClick={onRefresh} disabled={loading} aria-label="Refresh list">
          <RefreshCw className={cx('size-4', loading && 'animate-spin')} />
        </Button>
      }
    >
      {outputs && (
        <div className="mb-4 flex items-center gap-2 rounded-md bg-muted px-3 py-2">
          <FolderOpen className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <code className="min-w-0 flex-1 truncate text-xs" title={outputs.outputDir}>
            {outputs.outputDir}
          </code>
          <button
            type="button"
            onClick={copyFolder}
            className="rounded p-1 text-muted-foreground hover:bg-card hover:text-foreground"
            aria-label="Copy folder path"
          >
            {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
          </button>
        </div>
      )}

      {error && <Alert tone="danger">{error}</Alert>}

      {outputs && outputs.files.length === 0 && (
        <p className="py-6 text-center text-sm text-muted-foreground">
          No converted files yet. They will appear here and in the folder above.
        </p>
      )}

      {outputs && outputs.files.length > 0 && (
        <ul className="-mx-2 max-h-[28rem] divide-y divide-border overflow-y-auto">
          {outputs.files.map((file) => (
            <li
              key={file.name}
              className={cx(
                'flex items-center gap-3 rounded-md px-2 py-2.5',
                highlight?.includes(file.name) && 'bg-success-bg',
              )}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-xs font-medium" title={file.name}>
                  {file.name}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatBytes(file.size)} · {formatDateTime(file.createdAt)}
                </p>
              </div>
              <a
                href={downloadUrl(file.name)}
                download={file.name}
                className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label={`Download ${file.name}`}
              >
                <Download className="size-4" />
              </a>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
