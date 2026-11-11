'use client';

import { useState } from 'react';
import { Check, Folder } from 'lucide-react';
import { iconButtonClass } from './ui';

/**
 * Where a folder is on this computer, kept out of the way: hovering the button shows the
 * path, clicking copies it.
 */
export function FolderPathButton({ label, path }: { label: string; path: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(path);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard needs a secure context (localhost is fine); ignore elsewhere.
    }
  };

  return (
    <button
      type="button"
      onClick={() => void copy()}
      className={iconButtonClass()}
      title={copied ? 'Copied' : `${label}: ${path} (click to copy)`}
      aria-label={`Copy the ${label.toLowerCase()} path`}
    >
      {copied ? <Check className="size-4 text-success" /> : <Folder className="size-4" />}
    </button>
  );
}
