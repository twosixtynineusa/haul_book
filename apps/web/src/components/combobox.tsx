'use client';

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import type { PickOption } from '@/lib/sources';
import { cx } from './ui';

/**
 * A text field with a drop-down list: pick a saved value, or type a new one. The arrow
 * (or ↓) opens the whole list; typing narrows it. Enter picks the highlighted entry,
 * Escape closes the list. Whatever is typed is kept as is when nothing is picked.
 */
export function Combobox({
  value,
  options,
  onChange,
  placeholder,
  invalid,
  readOnly,
  className,
  label,
  title,
  emptyText = 'Nothing saved yet: type it in.',
}: {
  value: string;
  options: PickOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  invalid?: boolean;
  readOnly?: boolean;
  className?: string;
  /** Accessible name, when the field isn't inside a <label>. */
  label?: string;
  title?: string;
  emptyText?: string;
}) {
  const [open, setOpen] = useState(false);
  /** True once the user typed since opening: the list narrows to what matches. */
  const [filtering, setFiltering] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();

  const shown = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!filtering || !q) return options;
    return options.filter(
      (o) => o.value.toLowerCase().includes(q) || o.hint?.toLowerCase().includes(q),
    );
  }, [options, value, filtering]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const show = (narrow: boolean) => {
    if (readOnly) return;
    setFiltering(narrow);
    setOpen(true);
    const at = options.findIndex((o) => o.value === value);
    setActive(narrow ? 0 : Math.max(at, 0));
  };

  const pick = (option: PickOption) => {
    onChange(option.value);
    setOpen(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (readOnly) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) return show(false);
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((a) => (shown.length ? (a + step + shown.length) % shown.length : 0));
    } else if (e.key === 'Enter' && open && shown[active]) {
      e.preventDefault();
      pick(shown[active]);
    } else if (e.key === 'Escape' && open) {
      e.preventDefault();
      setOpen(false);
    }
  };

  return (
    <div ref={root} className={cx('relative', className)}>
      <input
        ref={input}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-invalid={invalid}
        aria-label={label}
        aria-activedescendant={open && shown[active] ? `${listId}-${active}` : undefined}
        autoComplete="off"
        value={value}
        readOnly={readOnly}
        title={title}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value);
          show(true);
        }}
        onKeyDown={onKeyDown}
        className={cx(
          'w-full rounded-md border bg-background py-1.5 pl-2.5 pr-8 text-sm',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          invalid ? 'border-danger' : 'border-input',
          readOnly && 'bg-muted text-muted-foreground',
        )}
      />
      {!readOnly && (
        <button
          type="button"
          tabIndex={-1}
          aria-label={open ? 'Close the list' : 'Show the list'}
          onClick={() => {
            input.current?.focus();
            if (open) setOpen(false);
            else show(false);
          }}
          className="absolute inset-y-0 right-0 grid w-8 place-items-center text-muted-foreground hover:text-foreground"
        >
          <ChevronDown className={cx('size-4 transition-transform', open && 'rotate-180')} />
        </button>
      )}
      {open && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-64 w-full min-w-[12rem] overflow-y-auto rounded-md border border-border bg-card py-1 text-sm shadow-lg"
        >
          {shown.length === 0 && (
            <li className="px-3 py-2 text-xs text-muted-foreground">
              {options.length === 0 ? emptyText : `No match: “${value.trim()}” is used as typed.`}
            </li>
          )}
          {shown.map((o, i) => (
            <li
              key={o.value}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={o.value === value}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(o)}
              className={cx(
                'flex cursor-pointer items-center gap-2 px-3 py-1.5',
                i === active && 'bg-muted',
              )}
            >
              <Check
                className={cx(
                  'size-3.5 shrink-0',
                  o.value === value ? 'text-primary' : 'invisible',
                )}
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate font-medium text-foreground">{o.value}</span>
              {o.hint && (
                <span className="max-w-[55%] truncate text-xs text-muted-foreground">{o.hint}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
