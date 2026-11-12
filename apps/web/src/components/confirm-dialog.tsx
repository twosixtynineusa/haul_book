'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Check, HelpCircle, Minus, Trash2 } from 'lucide-react';
import type { ConfirmOptions } from '@/lib/confirm';
import { Button, IconTile, buttonClass, cx } from './ui';

type Confirm = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<Confirm>(async () => false);

/** `await confirm(options)`: true once the user confirms in the app's own dialog. */
export function useConfirm(): Confirm {
  return useContext(ConfirmContext);
}

/**
 * The app's confirm dialog (instead of the browser's): a modal that spells out what an action
 * deletes or changes, and what stays. Escape, a click outside or Cancel says no.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<{
    options: ConfirmOptions;
    resolve: (ok: boolean) => void;
  } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  const confirm = useCallback<Confirm>(
    (options) => new Promise((resolve) => setRequest({ options, resolve })),
    [],
  );

  useEffect(() => {
    if (request && !dialog.current?.open) dialog.current?.showModal();
  }, [request]);

  const close = (ok: boolean) => {
    request?.resolve(ok);
    setRequest(null);
    dialog.current?.close();
  };

  const options = request?.options;
  const danger = options?.tone === 'danger';

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <dialog
        ref={dialog}
        aria-labelledby="confirm-title"
        onCancel={(e) => {
          e.preventDefault();
          close(false);
        }}
        onClick={(e) => {
          if (e.target === dialog.current) close(false);
        }}
        className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-lg border border-border bg-card p-0 text-card-foreground shadow-xl backdrop:bg-black/50"
      >
        {options && (
          <form
            method="dialog"
            onSubmit={(e) => {
              e.preventDefault();
              close(true);
            }}
          >
            <div className="flex gap-4 p-5">
              <IconTile tone={danger ? 'danger' : 'primary'}>
                {danger ? <Trash2 className="size-4" /> : <HelpCircle className="size-4" />}
              </IconTile>
              <div className="min-w-0 flex-1 space-y-4">
                <h2 id="confirm-title" className="break-words text-base font-semibold">
                  {options.title}
                </h2>
                {!!options.items?.length && (
                  <ItemList
                    label={options.itemsLabel ?? 'This changes'}
                    items={options.items}
                    icon={
                      <Minus className={cx('size-3.5', danger ? 'text-danger' : 'text-primary')} />
                    }
                  />
                )}
                {!!options.kept?.length && (
                  <ItemList
                    label="Stays"
                    items={options.kept}
                    icon={<Check className="size-3.5 text-success" />}
                  />
                )}
                {options.message && (
                  <p className="text-sm text-muted-foreground">{options.message}</p>
                )}
              </div>
            </div>
            <div className="flex flex-wrap justify-end gap-2 rounded-b-lg border-t border-border bg-muted/40 px-5 py-3">
              <Button variant="secondary" onClick={() => close(false)} autoFocus={danger}>
                Cancel
              </Button>
              <button
                type="submit"
                autoFocus={!danger}
                className={buttonClass(danger ? 'danger' : 'primary')}
              >
                {options.confirmLabel}
              </button>
            </div>
          </form>
        )}
      </dialog>
    </ConfirmContext.Provider>
  );
}

function ItemList({ label, items, icon }: { label: string; items: string[]; icon: ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <ul className="mt-1.5 space-y-1">
        {items.map((item) => (
          <li key={item} className="flex gap-2 text-sm">
            <span className="mt-1 shrink-0" aria-hidden>
              {icon}
            </span>
            <span className="min-w-0 break-words">{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
