import { TRANSFER, UNCATEGORIZED } from './types';
import type { CategoryContext, Transaction } from './types';

export const DEFAULT_RULES = [
  { id: 'food', pattern: 'maxburgers|mcdgb', category: 'Food' },
  { id: 'transport', pattern: 'västtrafik|ryde', category: 'Transport' },
  { id: 'phone', pattern: 'telia', category: 'Phone' },
];

/**
 * Order: manual override -> matched internal transfer -> counterparty label -> keyword rules -> Uncategorized.
 * An "Överföring" that is NOT matched to one of your accounts is not assumed to be internal:
 * it falls through and lands in Uncategorized so you can review it.
 */
export function categorize(tx: Transaction, ctx: CategoryContext): string {
  const override = ctx.overrides[tx.id];
  if (override) return override;

  if (ctx.transferIds.has(tx.id)) return TRANSFER;

  const label = ctx.labels.find((l) => l.counterparty === tx.counterparty);
  if (label) return label.category;

  const haystack = `${tx.counterparty} ${tx.description}`;
  for (const rule of ctx.rules) {
    try {
      if (new RegExp(rule.pattern, 'i').test(haystack)) return rule.category;
    } catch {
      // invalid regex in a user rule: skip it
    }
  }
  return UNCATEGORIZED;
}