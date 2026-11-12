'use client';

import { useState } from 'react';
import { ArrowRightLeft, Loader2 } from 'lucide-react';
import type { Company, Truck, TruckMoved } from '@haulbook/shared';
import { moveTruck } from '@/lib/api';
import { moveTruckConfirm } from '@/lib/confirm';
import { useConfirm } from './confirm-dialog';
import { fieldClass } from './sources-panel';
import { Button, cx } from './ui';

/**
 * "Move to company…" for one truck (Companies tab rows, the truck page): pick another saved
 * company, confirm, and the truck moves there with its odometer, details and history. A
 * company that already has that truck # is marked, and the two become one truck.
 */
export function MoveTruck({
  companyId,
  truck,
  others,
  onMoved,
  onCancel,
}: {
  companyId: string;
  truck: Truck;
  /** The companies it can move to (not its own). */
  others: Company[];
  onMoved: (moved: TruckMoved) => void;
  onCancel: () => void;
}) {
  const [into, setInto] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const target = others.find((o) => o.id === into);
  const confirm = useConfirm();

  const move = async () => {
    if (!target || !(await confirm(moveTruckConfirm(truck, target)))) return;
    setBusy(true);
    setError(null);
    try {
      onMoved(await moveTruck(companyId, truck.id, target.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {others.length === 0 ? (
        <p className="text-sm text-muted-foreground">There is no other company to move it to.</p>
      ) : (
        <>
          <select
            value={into}
            onChange={(e) => setInto(e.target.value)}
            className={cx(fieldClass(false), 'w-auto min-w-[16rem]')}
            aria-label={`Company to move truck ${truck.unit} to`}
          >
            <option value="">Move truck {truck.unit} to…</option>
            {others.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
                {o.trucks.some((t) => t.unit === truck.unit) ? ` (has truck ${truck.unit})` : ''}
              </option>
            ))}
          </select>
          <Button variant="secondary" disabled={!target || busy} onClick={() => void move()}>
            {busy ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <ArrowRightLeft className="size-4" aria-hidden />
            )}
            Move
          </Button>
        </>
      )}
      <Button variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
      {error && <p className="w-full text-xs text-danger">{error}</p>}
    </div>
  );
}
