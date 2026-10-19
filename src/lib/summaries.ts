import { TRANSFER } from './types';
import type { Transaction } from './types';

type CategoryOf = (t: Transaction) => string;

const month = (d: string) => d.slice(0, 7);

/** { '2024-05': { Food: 812.5, Transport: 300 } } — spending only, positive numbers, transfers excluded */
export function monthlySpendingByCategory(txs: Transaction[], categoryOf: CategoryOf) {
  const out: Record<string, Record<string, number>> = {};
  for (const t of txs) {
    const cat = categoryOf(t);
    if (cat === TRANSFER || t.amount >= 0) continue;
    const m = (out[month(t.date)] ??= {});
    m[cat] = (m[cat] ?? 0) + -t.amount;
  }
  return out;
}

export function monthlyIncomeVsSpending(txs: Transaction[], categoryOf: CategoryOf) {
  const out: Record<string, { income: number; spending: number }> = {};
  for (const t of txs) {
    if (categoryOf(t) === TRANSFER) continue;
    const m = (out[month(t.date)] ??= { income: 0, spending: 0 });
    if (t.amount >= 0) m.income += t.amount;
    else m.spending += -t.amount;
  }
  return out;
}

export function averageWeeklySpend(txs: Transaction[], categoryOf: CategoryOf): number {
  const spend = txs.filter((t) => t.amount < 0 && categoryOf(t) !== TRANSFER);
  if (spend.length === 0) return 0;
  const dates = txs.map((t) => Date.parse(t.date));
  const days = (Math.max(...dates) - Math.min(...dates)) / 86_400_000 + 1;
  const total = spend.reduce((s, t) => s - t.amount, 0);
  return total / Math.max(days / 7, 1);
}

export function topCounterparties(txs: Transaction[], n = 10) {
  const sums = new Map<string, number>();
  for (const t of txs) {
    if (t.amount >= 0 || t.kind === 'transfer') continue;
    sums.set(t.counterparty, (sums.get(t.counterparty) ?? 0) - t.amount);
  }
  return [...sums.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}