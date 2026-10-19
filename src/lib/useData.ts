import { useCallback, useEffect, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db';
import { categorize, DEFAULT_RULES } from './categorize';
import { TRANSFER, UNCATEGORIZED } from './types';
import type { Transaction } from './types';

export function useData() {
  const txs = useLiveQuery(() => db.transactions.orderBy('date').reverse().toArray(), []);
  const rules = useLiveQuery(() => db.rules.toArray(), []);
  const labels = useLiveQuery(() => db.labels.toArray(), []);
  const overrides = useLiveQuery(() => db.overrides.toArray(), []);

  // seed starter rules on first run (put, not add, so StrictMode's double effect is harmless)
  useEffect(() => {
    db.rules.count().then((c) => {
      if (c === 0) db.rules.bulkPut(DEFAULT_RULES);
    });
  }, []);

  const ctx = useMemo(
    () => ({
      overrides: Object.fromEntries((overrides ?? []).map((o) => [o.id, o.category])),
      labels: labels ?? [],
      rules: rules ?? [],
    }),
    [overrides, labels, rules],
  );

  const categoryOf = useCallback((t: Transaction) => categorize(t, ctx), [ctx]);

  const categories = useMemo(() => {
    const set = new Set<string>([UNCATEGORIZED, TRANSFER]);
    ctx.rules.forEach((r) => set.add(r.category));
    ctx.labels.forEach((l) => set.add(l.category));
    Object.values(ctx.overrides).forEach((c) => set.add(c));
    return [...set].sort();
  }, [ctx]);

  return { txs: txs ?? [], loading: txs === undefined, ctx, categoryOf, categories };
}
