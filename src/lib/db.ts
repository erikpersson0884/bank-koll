import Dexie, { type Table } from 'dexie';
import type { Account, Label, Rule, Transaction } from './types';

class BankDB extends Dexie {
  transactions!: Table<Transaction, string>;
  rules!: Table<Rule, string>;
  labels!: Table<Label, string>;
  overrides!: Table<{ id: string; category: string }, string>;
  accounts!: Table<Account, string>;

  constructor() {
    super('bank-overview');
    this.version(1).stores({
      transactions: 'id, date, kind, counterparty',
      rules: 'id',
      labels: 'counterparty',
      overrides: 'id',
    });
    // v2: multiple accounts. Transaction ids now include the account, so old rows are cleared
    // (re-import your CSVs once). Rules, labels and overrides are kept.
    this.version(2)
      .stores({
        transactions: 'id, date, kind, counterparty, accountId',
        accounts: 'id',
      })
      .upgrade((tx) => tx.table('transactions').clear());
  }
}

export const db = new BankDB();

export const defaultAccountName = (id: string) => `Account …${id.slice(-4)}`;

/** Insert only unseen ids. Returns counts for the "142 new, 38 duplicates skipped" message. */
export async function importTransactions(txs: Transaction[]) {
  const found = await db.transactions.bulkGet(txs.map((t) => t.id));
  const existing = new Set(found.filter(Boolean).map((t) => t!.id));
  const fresh = txs.filter((t) => !existing.has(t.id));
  await db.transactions.bulkAdd(fresh);

  const accountIds = [...new Set(txs.map((t) => t.accountId))];
  const known = new Set((await db.accounts.bulkGet(accountIds)).filter(Boolean).map((a) => a!.id));
  const newAccounts = accountIds.filter((id) => !known.has(id)).map((id) => ({ id, name: defaultAccountName(id) }));
  if (newAccounts.length) await db.accounts.bulkAdd(newAccounts);

  return { added: fresh.length, duplicates: txs.length - fresh.length, accountIds };
}