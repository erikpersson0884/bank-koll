import type { Transaction } from './types';

const DAY = 86_400_000;

/**
 * Finds internal transfers between your own accounts: an outgoing and an incoming
 * transaction with the same amount, in different accounts, booked within `windowDays`.
 * Each transaction is used at most once; the closest dates are paired first.
 * Swish and card rows are never candidates (too many false positives).
 * Returns the ids of all transactions that are part of a pair.
 */
export function matchTransfers(txs: Transaction[], windowDays = 3): Set<string> {
  const candidates = txs.filter((t) => t.kind === 'transfer' || t.kind === 'other');
  const incomingByCents = new Map<number, Transaction[]>();
  for (const t of candidates) {
    if (t.amount <= 0) continue;
    const key = Math.round(t.amount * 100);
    const list = incomingByCents.get(key);
    if (list) list.push(t);
    else incomingByCents.set(key, [t]);
  }

  const pairs: { out: Transaction; inc: Transaction; diff: number }[] = [];
  for (const out of candidates) {
    if (out.amount >= 0) continue;
    for (const inc of incomingByCents.get(Math.round(-out.amount * 100)) ?? []) {
      if (inc.accountId === out.accountId) continue;
      const diff = Math.abs(Date.parse(inc.date) - Date.parse(out.date)) / DAY;
      if (diff <= windowDays) pairs.push({ out, inc, diff });
    }
  }
  pairs.sort((a, b) => a.diff - b.diff || a.out.date.localeCompare(b.out.date));

  const used = new Set<string>();
  for (const { out, inc } of pairs) {
    if (used.has(out.id) || used.has(inc.id)) continue;
    used.add(out.id);
    used.add(inc.id);
  }
  return used;
}