'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CircleNotch, ArrowsClockwise, Plus, Trash, Receipt } from '@phosphor-icons/react';

interface CostRow {
  id: number;
  category: string;
  label: string;
  monthlyUsd: number;
  notes: string | null;
  updatedAt: string;
  updatedBy: string | null;
}

/**
 * Costs tab — the operator's editable monthly-expense ledger. Feeds
 * the Pulse Revenue section's net-margin math. Inline-edit on any
 * row, Add Row to append, delete per row. `updated_by` lightweight
 * audit stamps which admin wallet last touched a row.
 *
 * Why an editable DB table instead of hardcoded constants: costs
 * change (Vercel tier bumps, new services), and we want changes
 * applied without a deploy. The audit trail also doubles as
 * historical context when costs shift by category over time.
 */
export function CostsTab() {
  const [rows, setRows] = useState<CostRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<number | 'new' | null>(null);

  const fetchRows = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/costs', { cache: 'no-store' });
      if (!res.ok) throw new Error(`Failed to load (${res.status})`);
      const json = await res.json() as { rows: CostRow[] };
      setRows(json.rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void fetchRows(); }, []);

  const total = (rows ?? []).reduce((a, r) => a + r.monthlyUsd, 0);

  const updateRow = async (id: number, patch: Partial<Pick<CostRow, 'category' | 'label' | 'monthlyUsd' | 'notes'>>) => {
    const current = rows?.find((r) => r.id === id);
    if (!current) return;
    setSavingId(id);
    try {
      const res = await fetch(`/api/admin/costs/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          category: patch.category ?? current.category,
          label: patch.label ?? current.label,
          monthlyUsd: patch.monthlyUsd ?? current.monthlyUsd,
          notes: patch.notes !== undefined ? patch.notes : current.notes,
        }),
      });
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
      const json = await res.json() as { row: CostRow };
      setRows((prev) => prev?.map((r) => r.id === id ? json.row : r) ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSavingId(null);
    }
  };

  const deleteRow = async (id: number) => {
    if (!confirm('Delete this cost row?')) return;
    setSavingId(id);
    try {
      const res = await fetch(`/api/admin/costs/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`Delete failed (${res.status})`);
      setRows((prev) => prev?.filter((r) => r.id !== id) ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setSavingId(null);
    }
  };

  const addRow = async () => {
    setSavingId('new');
    try {
      const res = await fetch('/api/admin/costs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ category: 'infra', label: 'New service', monthlyUsd: 0 }),
      });
      if (!res.ok) throw new Error(`Add failed (${res.status})`);
      const json = await res.json() as { row: CostRow };
      setRows((prev) => (prev ? [...prev, json.row] : [json.row]));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Add failed');
    } finally {
      setSavingId(null);
    }
  };

  if (loading && !rows) return <div className="flex justify-center py-12"><CircleNotch className="h-6 w-6 animate-spin text-gray-400" weight="bold" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold tracking-tight text-gray-900">Costs</h2>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={fetchRows} aria-label="Refresh">
            <ArrowsClockwise className="h-4 w-4" weight="bold" />
          </Button>
          <Button variant="outline" size="sm" onClick={addRow} disabled={savingId === 'new'}>
            <Plus className="h-4 w-4 mr-1" weight="bold" />Add row
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2 text-gray-500">
            <Receipt className="h-4 w-4" weight="bold" />
            <span className="text-[10px] font-bold uppercase tracking-wider">Monthly op costs</span>
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          {(rows ?? []).length === 0 ? (
            <p className="text-sm text-gray-500 py-4 text-center">No cost rows yet. Click Add row.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
                <tr>
                  <th className="py-1 pr-2 text-left">Category</th>
                  <th className="py-1 px-2 text-left">Label</th>
                  <th className="py-1 px-2 text-right">Monthly USD</th>
                  <th className="py-1 px-2 text-left">Notes</th>
                  <th className="py-1 px-2 text-right">Updated</th>
                  <th className="py-1 pl-2 text-right"></th>
                </tr>
              </thead>
              <tbody>
                {(rows ?? []).map((r) => (
                  <tr key={r.id} className="border-t border-gray-100">
                    <td className="py-1 pr-2">
                      <InlineInput value={r.category} onSave={(v) => updateRow(r.id, { category: v })} className="font-mono text-[11px]" />
                    </td>
                    <td className="py-1 px-2">
                      <InlineInput value={r.label} onSave={(v) => updateRow(r.id, { label: v })} />
                    </td>
                    <td className="py-1 px-2 text-right">
                      <InlineInput
                        value={String(r.monthlyUsd)}
                        validate={(v) => {
                          const n = Number(v);
                          return Number.isFinite(n) && n >= 0;
                        }}
                        onSave={(v) => updateRow(r.id, { monthlyUsd: Number(v) })}
                        className="text-right tabular-nums"
                      />
                    </td>
                    <td className="py-1 px-2">
                      <InlineInput value={r.notes ?? ''} onSave={(v) => updateRow(r.id, { notes: v || null })} className="text-[12px] text-gray-500" />
                    </td>
                    <td className="py-1 px-2 text-right text-[11px] text-gray-400 tabular-nums">
                      {new Date(r.updatedAt).toLocaleDateString()}
                    </td>
                    <td className="py-1 pl-2 text-right">
                      <button type="button" onClick={() => deleteRow(r.id)} disabled={savingId === r.id} aria-label="Delete row"
                        className="text-gray-400 hover:text-red-600 disabled:opacity-50">
                        <Trash className="w-4 h-4" weight="bold" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-gray-200">
                <tr>
                  <td colSpan={2} className="py-2 text-right font-bold uppercase tracking-wider text-[11px] text-gray-600">Monthly total</td>
                  <td className="py-2 px-2 text-right tabular-nums font-black text-base text-gray-900">${total.toFixed(2)}</td>
                  <td colSpan={3}></td>
                </tr>
              </tfoot>
            </table>
          )}
        </CardContent>
      </Card>
      <p className="text-[11px] text-gray-400">
        Pulse Revenue prorates this total by days-elapsed when computing net MTD.
      </p>
    </div>
  );
}

/**
 * Uncontrolled input that commits on blur or Enter. Avoids round-
 * trips on every keystroke while still feeling instant.
 *
 * Optional `validate` predicate gates the commit: if it returns
 * false, the draft is reverted to the canonical `value` instead of
 * silently calling `onSave` (which the parent might also silently
 * reject, leaving the field stuck on an invalid string with no
 * feedback). Visible-but-bounce behavior is the right default for
 * a numeric column like monthly_usd where the wrong type is
 * obviously wrong.
 */
function InlineInput({
  value, onSave, validate, className,
}: {
  value: string;
  onSave: (v: string) => void;
  validate?: (v: string) => boolean;
  className?: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);
  const commit = () => {
    if (draft === value) return;
    if (validate && !validate(draft)) {
      setDraft(value); // bounce invalid input back to canonical value
      return;
    }
    onSave(draft);
  };
  return (
    <input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') setDraft(value);
      }}
      className={`w-full bg-transparent border border-transparent hover:border-gray-200 focus:border-brand focus:bg-white focus:outline-none rounded px-1.5 py-0.5 text-sm ${className ?? ''}`}
    />
  );
}
