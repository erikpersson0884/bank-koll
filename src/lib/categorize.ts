const TRANSFER = 'Transfer';
const UNCATEGORIZED = 'Uncategorized';

type Transaction = {
  id: string;
  kind: string;
  counterparty: string;
  description: string;
};

type CategoryContext = {
  overrides: Record<string, string | undefined>;
  labels: Array<{ counterparty: string; category: string }>;
  rules: Array<{ pattern: string; category: string }>;
};

export const DEFAULT_RULES = [
  { id: 'food', pattern: 'maxburgers|mcdgb', category: 'Food' },
  { id: 'transport', pattern: 'västtrafik|ryde', category: 'Transport' },
  { id: 'phone', pattern: 'telia', category: 'Phone' },
];

/** Order: manual override -> transfer -> counterparty label -> keyword rules -> Uncategorized */
export function categorize(tx: Transaction, ctx: CategoryContext): string {
  const override = ctx.overrides[tx.id];
  if (override) return override;

  if (tx.kind === 'transfer') return TRANSFER;

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