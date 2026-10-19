/* eslint-disable @typescript-eslint/no-explicit-any */
import 'fake-indexeddb/auto'; // must come before anything that loads Dexie
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, defaultAccountName, importTransactions } from '../lib/db';
import type { Transaction } from '../lib/types';

const ACC_A = 'SE1111111111';
const ACC_B = 'SE2222222222';

const makeTx = (id: string, accountId = ACC_A, over: Record<string, unknown> = {}) =>
  ({
    id,
    accountId,
    date: '2026-01-01',
    description: `Tx ${id}`,
    counterparty: 'ICA',
    amount: -100,
    kind: 'card',
    ...over,
  }) as unknown as Transaction;

beforeEach(async () => {
  await Promise.all([
    db.transactions.clear(),
    db.accounts.clear(),
    db.rules.clear(),
    db.labels.clear(),
    db.overrides.clear(),
  ]);
});

afterAll(() => {
  db.close();
});

describe('defaultAccountName', () => {
  it('uses the last four characters of the account id', () => {
    expect(defaultAccountName('SE1234567890')).toBe('Account …7890');
  });

  it('uses the whole id when it is shorter than four characters', () => {
    expect(defaultAccountName('42')).toBe('Account …42');
  });
});

describe('schema', () => {
  it('uses the expected database name and version', () => {
    expect(db.name).toBe('bank-overview');
    expect(db.verno).toBe(2);
  });

  it('declares all five tables', () => {
    expect(db.tables.map((t) => t.name).sort()).toEqual(
      ['accounts', 'labels', 'overrides', 'rules', 'transactions'],
    );
  });

  it('uses the expected primary keys', () => {
    expect(db.transactions.schema.primKey.name).toBe('id');
    expect(db.rules.schema.primKey.name).toBe('id');
    expect(db.labels.schema.primKey.name).toBe('counterparty');
    expect(db.overrides.schema.primKey.name).toBe('id');
    expect(db.accounts.schema.primKey.name).toBe('id');
  });

  it('indexes transactions by date, kind, counterparty and accountId', () => {
    expect(db.transactions.schema.indexes.map((i) => i.name).sort()).toEqual(
      ['accountId', 'counterparty', 'date', 'kind'],
    );
  });

  it('supports querying transactions through those indexes', async () => {
    await db.transactions.bulkAdd([
      makeTx('1', ACC_A, { date: '2026-01-01', counterparty: 'ICA', kind: 'card' }),
      makeTx('2', ACC_B, { date: '2026-02-01', counterparty: 'SL', kind: 'transfer' }),
    ]);
    expect(await db.transactions.where('accountId').equals(ACC_B).count()).toBe(1);
    expect(await db.transactions.where('counterparty').equals('ICA').count()).toBe(1);
    expect(await db.transactions.where('kind').equals('transfer').count()).toBe(1);
    expect(await db.transactions.where('date').above('2026-01-15').count()).toBe(1);
  });
});

describe('importTransactions', () => {
  it('adds new transactions and reports counts and account ids', async () => {
    const result = await importTransactions([makeTx('1'), makeTx('2'), makeTx('3')]);

    expect(result).toEqual({ added: 3, duplicates: 0, accountIds: [ACC_A] });
    expect(await db.transactions.count()).toBe(3);
  });

  it('stores the transactions unchanged', async () => {
    const tx = makeTx('1', ACC_A, { amount: -42.5, description: 'Coffee' });
    await importTransactions([tx]);
    expect(await db.transactions.get('1')).toEqual(tx);
  });

  it('skips transactions that already exist and counts them as duplicates', async () => {
    await importTransactions([makeTx('1'), makeTx('2')]);
    const result = await importTransactions([makeTx('2'), makeTx('3'), makeTx('4')]);

    expect(result.added).toBe(2);
    expect(result.duplicates).toBe(1);
    expect(await db.transactions.count()).toBe(4);
  });

  it('does not overwrite an existing transaction with the same id', async () => {
    await importTransactions([makeTx('1', ACC_A, { description: 'Original' })]);
    await importTransactions([makeTx('1', ACC_A, { description: 'Changed' })]);

    expect((await db.transactions.get('1'))!.description).toBe('Original');
  });

  it('is idempotent: importing the same file twice adds nothing the second time', async () => {
    const batch = [makeTx('1'), makeTx('2'), makeTx('3')];
    await importTransactions(batch);
    const second = await importTransactions(batch);

    expect(second).toEqual({ added: 0, duplicates: 3, accountIds: [ACC_A] });
    expect(await db.transactions.count()).toBe(3);
  });

  it('keeps added + duplicates equal to the batch size', async () => {
    await importTransactions([makeTx('1'), makeTx('2')]);
    const batch = [makeTx('1'), makeTx('2'), makeTx('3'), makeTx('4'), makeTx('5')];
    const { added, duplicates } = await importTransactions(batch);
    expect(added + duplicates).toBe(batch.length);
  });

  it('handles an empty batch without writing anything', async () => {
    const result = await importTransactions([]);

    expect(result).toEqual({ added: 0, duplicates: 0, accountIds: [] });
    expect(await db.transactions.count()).toBe(0);
    expect(await db.accounts.count()).toBe(0);
  });

  it('rejects when the same id appears twice in one batch, and creates no account', async () => {
    await expect(importTransactions([makeTx('1'), makeTx('1')])).rejects.toThrow();
    expect(await db.accounts.count()).toBe(0);
  });
});

describe('importTransactions: accounts', () => {
  it('creates an account with a default name for a new account id', async () => {
    await importTransactions([makeTx('1', ACC_A)]);

    expect(await db.accounts.toArray()).toEqual([{ id: ACC_A, name: defaultAccountName(ACC_A) }]);
  });

  it('creates one account per distinct account id, even with many transactions', async () => {
    await importTransactions([makeTx('1', ACC_A), makeTx('2', ACC_A), makeTx('3', ACC_B)]);

    expect(await db.accounts.count()).toBe(2);
    expect((await db.accounts.get(ACC_B))!.name).toBe(defaultAccountName(ACC_B));
  });

  it('returns unique account ids in first-seen order', async () => {
    const { accountIds } = await importTransactions([
      makeTx('1', ACC_B),
      makeTx('2', ACC_A),
      makeTx('3', ACC_B),
    ]);
    expect(accountIds).toEqual([ACC_B, ACC_A]);
  });

  it('does not overwrite a renamed account on later imports', async () => {
    await importTransactions([makeTx('1', ACC_A)]);
    await db.accounts.put({ id: ACC_A, name: 'Everyday spending' });

    await importTransactions([makeTx('2', ACC_A)]);

    expect((await db.accounts.get(ACC_A))!.name).toBe('Everyday spending');
    expect(await db.accounts.count()).toBe(1);
  });

  it('only creates the missing accounts when some are already known', async () => {
    await db.accounts.put({ id: ACC_A, name: 'Checking' });

    await importTransactions([makeTx('1', ACC_A), makeTx('2', ACC_B)]);

    expect((await db.accounts.get(ACC_A))!.name).toBe('Checking');
    expect((await db.accounts.get(ACC_B))!.name).toBe(defaultAccountName(ACC_B));
  });

  it('still creates the account when every transaction was a duplicate', async () => {
    await db.transactions.add(makeTx('1', ACC_A)); // e.g. account row was lost after the v2 upgrade

    const result = await importTransactions([makeTx('1', ACC_A)]);

    expect(result.added).toBe(0);
    expect(await db.accounts.get(ACC_A)).toBeDefined();
  });
});

describe('v1 → v2 upgrade', () => {
  it('clears transactions but keeps rules, labels and overrides, and adds accounts', async () => {
    // Start from nothing, then build a genuine v1 database under the same name.
    await db.delete();

    const { default: Dexie } = await import('dexie');
    const legacy = new Dexie('bank-overview');
    legacy.version(1).stores({
      transactions: 'id, date, kind, counterparty',
      rules: 'id',
      labels: 'counterparty',
      overrides: 'id',
    });
    await legacy.table('transactions').bulkAdd([
      { id: 'old1', date: '2025-12-01', kind: 'card', counterparty: 'ICA' },
      { id: 'old2', date: '2025-12-02', kind: 'card', counterparty: 'SL' },
    ]);
    await legacy.table('rules').add({ id: 'r1', pattern: 'ICA', category: 'Food' });
    await legacy.table('labels').add({ counterparty: 'ICA', label: 'Groceries' });
    await legacy.table('overrides').add({ id: 'old1', category: 'Food' });
    legacy.close();

    // A fresh copy of the real module opens the v1 database and runs the upgrade.
    vi.resetModules();
    const fresh = await import('../lib/db');
    await fresh.db.open();

    expect(fresh.db.verno).toBe(2);
    expect(await fresh.db.transactions.count()).toBe(0);
    expect(await fresh.db.rules.count()).toBe(1);
    expect(await fresh.db.labels.count()).toBe(1);
    expect(await fresh.db.overrides.count()).toBe(1);
    expect(await fresh.db.accounts.count()).toBe(0);

    // The upgraded database is usable with the new accountId index.
    await fresh.importTransactions([makeTx('n1', ACC_A)]);
    expect(await fresh.db.transactions.where('accountId').equals(ACC_A).count()).toBe(1);

    fresh.db.close();
  });
});
