'use client';

import { useRef, useState, type DragEvent } from 'react';
import { UploadCloud } from 'lucide-react';
import { ACCEPTED_EXTENSIONS, MAX_UPLOAD_FILES, SOURCE_FORMATS } from '@haulbook/shared';
import { cx } from './ui';

export function Dropzone({
  onAdd,
  disabled,
}: {
  onAdd: (files: File[]) => void;
  disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (!disabled) onAdd(Array.from(e.dataTransfer.files));
  };

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      aria-label="Drop mileage reports here, or press Enter to browse"
      onClick={() => !disabled && input.current?.click()}
      onKeyDown={(e) => {
        if (!disabled && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          input.current?.click();
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={cx(
        'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        dragging ? 'border-primary bg-primary-soft' : 'border-input hover:border-primary/60',
        disabled && 'pointer-events-none opacity-50',
      )}
    >
      <UploadCloud
        className={cx('size-9', dragging ? 'text-primary' : 'text-muted-foreground')}
        aria-hidden
      />
      <p className="text-sm font-medium">
        Drop mileage reports here, or <span className="text-primary underline">browse</span>
      </p>
      <p className="text-xs text-muted-foreground">
        {SOURCE_FORMATS.map((f) => f.label.split(' — ')[0]).join(' · ')} — the format is detected
        automatically
      </p>
      <p className="text-xs text-muted-foreground">
        {ACCEPTED_EXTENSIONS.join(' ')} · up to {MAX_UPLOAD_FILES} files · 2 MB each · keep
        Wialon&apos;s file name (<code className="break-all">22_IFTA_…csv</code>) so the truck # is
        read from it
      </p>
      <input
        ref={input}
        type="file"
        accept={[...ACCEPTED_EXTENSIONS, 'text/csv'].join(',')}
        multiple
        hidden
        onChange={(e) => {
          onAdd(Array.from(e.target.files ?? []));
          e.target.value = '';
        }}
      />
    </div>
  );
}
