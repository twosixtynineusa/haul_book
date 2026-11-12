'use client';

import { useState } from 'react';
import { Download, FolderInput, Loader2, Pencil, RefreshCw, RotateCcw, Trash2 } from 'lucide-react';
import type { Company, InboxEntry } from '@haulbook/shared';
import { deleteInbox, downloadUrl, reprocessInbox } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { deleteEntryConfirm, reprocessEntryConfirm } from '@/lib/confirm';
import { STATUS_LABEL, entryOwner } from '@/lib/inbox';
import type { SourceDraft } from '@/lib/sources';
import { useConfirm } from './confirm-dialog';
import { FolderPathButton } from './folder-path';
import { EntryFields, STATUS_TONE, StatusIcon, entryValues, type InboxState } from './inbox-panel';
import { Alert, Badge, Button, Card, IconTile, buttonClass, cx, iconButtonClass } from './ui';

/**
 * One processed input-folder file: what became of it, its ProMiles file to download, and
 * the ways to undo it: correct it and convert again, convert again as is, or delete it
 * (with the ProMiles file and history it produced).
 */
function RecentRow({
  entry,
  companies,
  onDone,
}: {
  entry: InboxEntry;
  companies: Company[];
  onDone: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<SourceDraft>({});
  const [busy, setBusy] = useState<'again' | 'delete' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { complete, choice } = entryValues(entry, draft);
  const confirm = useConfirm();
  // Converting again needs the source it was converted from.
  const canRedo = !!entry.archivedPath;

  const run = async (kind: 'again' | 'delete', action: () => Promise<unknown>) => {
    setBusy(kind);
    setError(null);
    try {
      await action();
      setEditing(false);
      setDraft({});
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  const again = async () => {
    if (await confirm(reprocessEntryConfirm(entry))) {
      void run('again', () => reprocessInbox(entry.id));
    }
  };
  const remove = async () => {
    if (await confirm(deleteEntryConfirm(entry))) void run('delete', () => deleteInbox(entry.id));
  };

  const details = [entryOwner(entry), entry.processedAt && formatDateTime(entry.processedAt)]
    .filter(Boolean)
    .join(' · ');

  return (
    <li className="py-3">
      <div className="flex items-start gap-3">
        <IconTile tone={STATUS_TONE[entry.status]}>
          <StatusIcon status={entry.status} />
        </IconTile>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="min-w-0 flex-1 truncate text-sm font-medium" title={entry.name}>
              {entry.name}
            </p>
            <Badge tone={STATUS_TONE[entry.status]} title={entry.error ?? undefined}>
              {STATUS_LABEL[entry.status]}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={details}>
              {details}
            </p>
            <div className="flex shrink-0 items-center">
              {entry.outputs.map((name) => (
                <a
                  key={name}
                  href={downloadUrl(name)}
                  download={name}
                  className={iconButtonClass()}
                  aria-label={`Download ${name}`}
                  title={`Download ${name}`}
                >
                  <Download className="size-4" />
                </a>
              ))}
              {canRedo && (
                <>
                  <button
                    type="button"
                    className={iconButtonClass(editing ? 'bg-muted text-foreground' : undefined)}
                    disabled={!!busy}
                    onClick={() => setEditing((e) => !e)}
                    aria-label={`Correct ${entry.name} and convert it again`}
                    title="Correct the company, truck # or dates and convert again"
                  >
                    <Pencil className="size-4" />
                  </button>
                  <button
                    type="button"
                    className={iconButtonClass()}
                    disabled={!!busy}
                    onClick={() => void again()}
                    aria-label={`Convert ${entry.name} again`}
                    title="Convert again"
                  >
                    {busy === 'again' ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <RotateCcw className="size-4" />
                    )}
                  </button>
                </>
              )}
              <button
                type="button"
                className={iconButtonClass('hover:text-danger')}
                disabled={!!busy}
                onClick={() => void remove()}
                aria-label={`Delete ${entry.name}`}
                title={
                  entry.status === 'converted'
                    ? 'Delete, with the report and its ProMiles file'
                    : 'Delete, with the report'
                }
              >
                {busy === 'delete' ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Trash2 className="size-4" />
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {error && <p className="mt-2 pl-11 text-xs text-danger">{error}</p>}

      {editing && (
        <form
          className="mt-3 rounded-lg bg-muted/50 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void run('again', () => reprocessInbox(entry.id, choice()));
          }}
        >
          <EntryFields
            entry={entry}
            companies={companies}
            draft={draft}
            narrow
            onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))}
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="submit" disabled={!!busy || !complete} className={buttonClass()}>
              {busy === 'again' && <Loader2 className="size-4 animate-spin" aria-hidden />}
              Save &amp; convert again
            </button>
            <Button variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            {entry.status === 'converted' && (
              <p className="text-xs text-muted-foreground">
                Replaces its ProMiles file and history with the corrected ones.
              </p>
            )}
          </div>
        </form>
      )}
    </li>
  );
}

/**
 * The watched input folder: whether it's being checked, and the latest files that came
 * through it, each with its download and its undo actions. Files still waiting are in
 * InboxPending, above the upload steps.
 */
export function InboxRecent({ state, companies }: { state: InboxState; companies: Company[] }) {
  const { inbox, error, scanning } = state;
  return (
    <Card
      title="Input folder"
      subtitle="Reports dropped in it convert on their own."
      icon={<FolderInput className="size-4 text-muted-foreground" aria-hidden />}
      action={
        <div className="flex shrink-0 items-center">
          {inbox && (
            <span
              className="mr-2 hidden items-center gap-1.5 text-xs text-muted-foreground sm:inline-flex"
              title={`Checked every ${inbox.scanSeconds} seconds`}
            >
              <span className="size-1.5 rounded-full bg-success" aria-hidden />
              Watching
            </span>
          )}
          {inbox && <FolderPathButton label="Input folder" path={inbox.inputDir} />}
          <button
            type="button"
            className={iconButtonClass()}
            onClick={state.scanNow}
            disabled={scanning}
            aria-label="Check the input folder now"
            title="Check the folder now"
          >
            <RefreshCw className={cx('size-4', scanning && 'animate-spin')} />
          </button>
        </div>
      }
    >
      {error && <Alert tone="danger">{error}</Alert>}

      {inbox?.recent.length === 0 && (
        <p className="py-6 text-center text-sm text-muted-foreground">
          Nothing has come through yet.
        </p>
      )}

      {inbox && inbox.recent.length > 0 && (
        <ul className="-my-3 max-h-[28rem] divide-y divide-border overflow-y-auto">
          {inbox.recent.map((entry) => (
            <RecentRow
              key={`${entry.id}:${entry.status}`}
              entry={entry}
              companies={companies}
              onDone={state.changed}
            />
          ))}
        </ul>
      )}
    </Card>
  );
}
