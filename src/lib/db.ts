import Dexie, { type Table } from 'dexie';
import type { Label, Rule, Transaction } from './types';

class BankDB extends Dexie {
  transactions!: Table<Transaction, string>;
  rules!: Table<Rule, string>;
  labels!: Table<Label, string>;
  overrides!: Table<{ id: string; category: string }, string>;

  constructor() {
    super('bank-overview');
    this.version(1).stores({
      transactions: 'id, date, kind, counterparty',
      rules: 'id',
      labels: 'counterparty',
      overrides: 'id',
    });
  }
}

export const db = new BankDB();

/** Insert only unseen ids. Returns counts for the "142 new, 38 duplicates skipped" message. */
export async function importTransactions(txs: Transaction[]) {
  const existing = new Set(await db.transactions.bulkGet(txs.map((t) => t.id)).then((r) => r.filter(Boolean).map((t) => t!.id)));
  const fresh = txs.filter((t) => !existing.has(t.id));
  await db.transactions.bulkAdd(fresh);
  return { added: fresh.length, duplicates: txs.length - fresh.length };
}