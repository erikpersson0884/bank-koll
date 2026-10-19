export interface RawTransaction {
  accountId: string; // "<Clearingnummer>-<Kontonummer>" from the CSV
  date: string; // Transaktionsdag, YYYY-MM-DD
  description: string;
  reference: string;
  amount: number;
  balance: number | null;
}

export type Kind = 'card' | 'swish_sent' | 'swish_received' | 'transfer' | 'other';

export interface Transaction extends RawTransaction {
  id: string;
  kind: Kind;
  counterparty: string;
}

export interface Account {
  id: string;
  name: string;
}

export interface Rule {
  id: string;
  pattern: string; // regex source, matched case-insensitively against counterparty + description
  category: string;
}

export interface Label {
  counterparty: string; // phone number or normalized merchant
  name: string;
  category: string;
}

export interface CategoryContext {
  overrides: Record<string, string>; // transaction id -> category
  labels: Label[];
  rules: Rule[];
  transferIds: Set<string>; // transactions matched as internal transfers between accounts
}

export const TRANSFER = 'Transfer';
export const UNCATEGORIZED = 'Uncategorized';
