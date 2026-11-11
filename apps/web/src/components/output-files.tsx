'use client';

import { Download, FileSpreadsheet, FolderOutput, RefreshCw } from 'lucide-react';
import type { OutputList } from '@haulbook/shared';
import { downloadUrl } from '@/lib/api';
import { formatBytes, formatDateTime } from '@/lib/format';
import { FolderPathButton } from './folder-path';
import { Alert, Badge, Card, IconTile, cx, iconButtonClass } from './ui';

/** The output folder: the ProMiles files written so far, newest first, each to download. */
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
  return (
    <Card
      title="Output folder"
      subtitle="ProMiles files, ready to import."
      icon={<FolderOutput className="size-4 text-muted-foreground" aria-hidden />}
      action={
        <div className="flex shrink-0 items-center">
          {outputs && <FolderPathButton label="Output folder" path={outputs.outputDir} />}
          <button
            type="button"
            className={iconButtonClass()}
            onClick={onRefresh}
            disabled={loading}
            aria-label="Refresh the list"
            title="Refresh"
          >
            <RefreshCw className={cx('size-4', loading && 'animate-spin')} />
          </button>
        </div>
      }
    >
      {error && <Alert tone="danger">{error}</Alert>}

      {outputs?.files.length === 0 && (
        <p className="py-6 text-center text-sm text-muted-foreground">Nothing converted yet.</p>
      )}

      {outputs && outputs.files.length > 0 && (
        <ul className="-my-3 max-h-[28rem] divide-y divide-border overflow-y-auto">
          {outputs.files.map((file) => {
            const fresh = highlight?.includes(file.name);
            return (
              <li key={file.name} className="flex items-center gap-3 py-3">
                <IconTile tone={fresh ? 'success' : 'primary'}>
                  <FileSpreadsheet className="size-4" aria-hidden />
                </IconTile>
                <div className="min-w-0 flex-1">
                  <p className="break-all text-sm font-medium">{file.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDateTime(file.createdAt)} · {formatBytes(file.size)}
                  </p>
                </div>
                {fresh && <Badge tone="success">New</Badge>}
                <a
                  href={downloadUrl(file.name)}
                  download={file.name}
                  className={iconButtonClass()}
                  aria-label={`Download ${file.name}`}
                  title="Download"
                >
                  <Download className="size-4" />
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
