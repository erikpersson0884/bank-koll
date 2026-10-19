import { useCallback, useEffect, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, defaultAccountName } from './db';
import { categorize, DEFAULT_RULES } from './categorize';
import { matchTransfers } from './transfers';
import { TRANSFER, UNCATEGORIZED } from './types';
import type { Rule, Transaction } from './types';

// src/rules.json holds personal rules and is gitignored, so it may not exist
// (fresh clone, Docker or CI build). A glob import yields {} when the file is missing.
const personalModules = import.meta.glob<Rule[]>('@/rules.json', { eager: true, import: 'default' });
const customRules: Rule[] = Object.values(personalModules).flat();

export function useData() {
  const txs = useLiveQuery(() => db.transactions.orderBy('date').reverse().toArray(), []);
  const rules = useLiveQuery(() => db.rules.toArray(), []);
  const labels = useLiveQuery(() => db.labels.toArray(), []);
  const overrides = useLiveQuery(() => db.overrides.toArray(), []);
  const accounts = useLiveQuery(() => db.accounts.toArray(), []);

  // seed starter rules on first run (put, not add, so StrictMode's double effect is harmless)
  useEffect(() => {
    const allRules: Rule[] = [...DEFAULT_RULES, ...customRules];
    db.rules.count().then((c) => {
      if (c === 0) db.rules.bulkPut(allRules);
    });
  }, []);

  const transactions = useMemo(() => txs ?? [], [txs]);
  const transferIds = useMemo(() => matchTransfers(transactions), [transactions]);

  const ctx = useMemo(
    () => ({
      overrides: Object.fromEntries((overrides ?? []).map((o) => [o.id, o.category])),
      labels: labels ?? [],
      rules: rules ?? [],
      transferIds,
    }),
    [overrides, labels, rules, transferIds],
  );

  const categoryOf = useCallback((t: Transaction) => categorize(t, ctx), [ctx]);

  const accountName = useCallback(
    (id: string) => (accounts ?? []).find((a) => a.id === id)?.name ?? defaultAccountName(id),
    [accounts],
  );

  const categories = useMemo(() => {
    const set = new Set<string>([UNCATEGORIZED, TRANSFER]);
    ctx.rules.forEach((r) => set.add(r.category));
    ctx.labels.forEach((l) => set.add(l.category));
    Object.values(ctx.overrides).forEach((c) => set.add(c));
    return [...set].sort();
  }, [ctx]);

  return {
    txs: transactions,
    loading: txs === undefined,
    ctx,
    categoryOf,
    categories,
    accounts: accounts ?? [],
    accountName,
    transferCount: transferIds.size / 2,
  };
}
