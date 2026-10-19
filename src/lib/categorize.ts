import { TRANSFER, UNCATEGORIZED } from './types';
import type { CategoryContext, Transaction } from './types';

export const DEFAULT_RULES = [
  { id: 'fast_food', pattern: 'maxburgers|mcdgb|sannegården|baguetten|tunnbrodsgub|pizza|pizzeria|pizz|kiku', category: 'Fast food' },
  { id: 'groceries', pattern: 'ica|coop|willys|hemköp|hemkop|lidl|wh', category: 'Groceries' },
  { id: 'transport', pattern: 'västtrafik|skånetrafik|ryde|lime|voi', category: 'Transport' },
  { id: 'parking', pattern: 'parkering|aimo park', category: 'Parking' },
  { id: 'phone', pattern: 'telia', category: 'Phone' },
  { id: 'streaming', pattern: 'netflix|spotify|disney|youtube', category: 'Streaming' },
  { id: 'swish', pattern: 'swish', category: 'Swish' },
  { id: 'clothes', pattern: 'h&m|hm|lindex|kappahl|cubus|gina tricot|dressman', category: 'Clothes' },
  { id: 'alcohol', pattern: 'systembolaget', category: 'Alcohol' },
  { id: 'tickets', pattern: 'ticketmaster|tickster', category: 'Tickets' },
  { id: 'games', pattern: 'steam|epic games|gog', category: 'Games' },
  { id: 'study_grant', pattern: 'Csn', category: 'Study grant' },
  { id: 'chalmers', pattern: 'chalmers|Kåravgift', category: 'Chalmers' },
  { id: 'salary', pattern: 'lön|salary|payroll|lönespecifikation', category: 'Salary' },
  { id: 'gasquen', pattern: 'gasque|gasquen', category: 'Gasquen' },
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

  const label = ctx.labels.find(
    (l) => l.counterparty.toLowerCase() === tx.counterparty.toLowerCase()
  );
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