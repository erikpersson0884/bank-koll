import 'fake-indexeddb/auto'; // must come before anything that loads Dexie
import { StrictMode, createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { useData } from '../lib/useData';
import { db, defaultAccountName } from '../lib/db';
import { categorize } from '../lib/categorize';
import { matchTransfers } from '../lib/transfers';
import { TRANSFER, UNCATEGORIZED } from '../lib/types';
import type { Transaction } from '../lib/types';

vi.mock('../lib/categorize', () => ({
  categorize: vi.fn(),
  DEFAULT_RULES: [
    { id: 'default-1', category: 'Food' },
    { id: 'default-2', category: 'Transport' },
  ],
}));
vi.mock('../lib/transfers', () => ({
  matchTransfers: vi.fn(),
}));

const mockCategorize = vi.mocked(categorize);
const mockMatch = vi.mocked(matchTransfers);

const makeTx = (id: string, date: string, accountId = 'acc1') =>
  ({ id, date, accountId, description: `Tx ${id}`, counterparty: 'ICA', amount: -100, kind: 'card' }) as unknown as Transaction;

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

beforeEach(async () => {
  mockCategorize.mockReturnValue('Food' as never);
  mockMatch.mockReturnValue(new Set<string>() as never);
  await Promise.all([
    db.transactions.clear(),
    db.accounts.clear(),
    db.rules.clear(),
    db.labels.clear(),
    db.overrides.clear(),
  ]);
});

afterEach(async () => {
  cleanup();
  vi.clearAllMocks();
  // The seeding effect resolves asynchronously; let it settle so it can't leak into the next test.
  await tick();
});

/** Put a rule in first so the first-run seeding doesn't kick in. */
const preventSeeding = () => db.rules.put({ id: 'existing', category: 'Existing' } as never);

const waitForSeed = (result: { current: ReturnType<typeof useData> }) =>
  waitFor(() => expect(result.current.ctx.rules.length).toBeGreaterThanOrEqual(2));

describe('useData: loading and transactions', () => {
  it('starts in the loading state with no transactions', () => {
    const { result } = renderHook(() => useData());
    expect(result.current.loading).toBe(true);
    expect(result.current.txs).toEqual([]);
  });

  it('finishes loading with an empty database', async () => {
    const { result } = renderHook(() => useData());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.txs).toEqual([]);
    expect(result.current.accounts).toEqual([]);
  });

  it('returns transactions sorted by date, newest first', async () => {
    await db.transactions.bulkAdd([
      makeTx('a', '2026-01-10'),
      makeTx('b', '2026-03-05'),
      makeTx('c', '2026-02-01'),
    ]);
    const { result } = renderHook(() => useData());
    await waitFor(() => expect(result.current.txs).toHaveLength(3));
    expect(result.current.txs.map((t) => t.id)).toEqual(['b', 'c', 'a']);
    expect(result.current.loading).toBe(false);
  });

  it('updates live when a transaction is added', async () => {
    const { result } = renderHook(() => useData());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await db.transactions.add(makeTx('new', '2026-04-01'));
    });
    await waitFor(() => expect(result.current.txs.map((t) => t.id)).toEqual(['new']));
  });
});

describe('useData: seeding starter rules', () => {
  it('seeds the default rules on first run', async () => {
    const { result } = renderHook(() => useData());
    await waitForSeed(result);
    const ids = (await db.rules.toArray()).map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining(['default-1', 'default-2']));
  });

  it('does not seed when rules already exist', async () => {
    await preventSeeding();
    const spy = vi.spyOn(db.rules, 'count');

    renderHook(() => useData());
    await waitFor(() => expect(spy).toHaveBeenCalled());
    await spy.mock.results[0].value;
    await tick();

    expect(await db.rules.count()).toBe(1);
    expect((await db.rules.toArray())[0].id).toBe('existing');
    spy.mockRestore();
  });

  it('is harmless under StrictMode (effect runs twice)', async () => {
    // Baseline: how many rules a normal first run seeds (defaults + any personal rules.json).
    const normal = renderHook(() => useData());
    await waitForSeed(normal.result);
    await tick();
    const baseline = await db.rules.count();
    normal.unmount();
    await db.rules.clear();

    const wrapper = ({ children }: { children: ReactNode }) => createElement(StrictMode, null, children);
    const { result } = renderHook(() => useData(), { wrapper });
    await waitForSeed(result);
    await tick();
    expect(await db.rules.count()).toBe(baseline);
  });
});

describe('useData: context', () => {
  it('exposes overrides as an id → category map', async () => {
    await preventSeeding();
    await db.overrides.bulkPut([
      { id: 't1', category: 'Gifts' },
      { id: 't2', category: 'Travel' },
    ]);
    const { result } = renderHook(() => useData());
    await waitFor(() => expect(Object.keys(result.current.ctx.overrides)).toHaveLength(2));
    expect(result.current.ctx.overrides).toEqual({ t1: 'Gifts', t2: 'Travel' });
  });

  it('exposes labels and rules from the database', async () => {
    await preventSeeding();
    await db.labels.put({ counterparty: 'SL', category: 'Transport' } as never);
    const { result } = renderHook(() => useData());
    await waitFor(() => expect(result.current.ctx.labels).toHaveLength(1));
    expect(result.current.ctx.labels[0]).toMatchObject({ counterparty: 'SL', category: 'Transport' });
    expect(result.current.ctx.rules.map((r) => r.id)).toEqual(['existing']);
  });

  it('defaults overrides, labels and rules to empty before data arrives', () => {
    const { result } = renderHook(() => useData());
    expect(result.current.ctx.overrides).toEqual({});
    expect(result.current.ctx.labels).toEqual([]);
    expect(result.current.ctx.rules).toEqual([]);
  });

  it('includes the matched transfer ids', async () => {
    mockMatch.mockReturnValue(new Set(['1', '2']) as never);
    const { result } = renderHook(() => useData());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.ctx.transferIds).toEqual(new Set(['1', '2']));
  });
});

describe('useData: transfers', () => {
  it('passes the loaded transactions to matchTransfers', async () => {
    await db.transactions.bulkAdd([makeTx('a', '2026-01-01'), makeTx('b', '2026-01-02')]);
    const { result } = renderHook(() => useData());
    await waitFor(() => expect(result.current.txs).toHaveLength(2));

    const lastCall = mockMatch.mock.calls.at(-1)![0] as Transaction[];
    expect(lastCall.map((t) => t.id)).toEqual(['b', 'a']);
  });

  it('reports transferCount as half the number of matched ids (each transfer has two sides)', async () => {
    mockMatch.mockReturnValue(new Set(['1', '2', '3', '4']) as never);
    const { result } = renderHook(() => useData());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.transferCount).toBe(2);
  });

  it('reports zero transfers when none match', async () => {
    const { result } = renderHook(() => useData());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.transferCount).toBe(0);
  });

  it('does not recompute matches on rerender when the data is unchanged', async () => {
    const { result, rerender } = renderHook(() => useData());
    await waitForSeed(result);
    const calls = mockMatch.mock.calls.length;

    rerender();
    expect(mockMatch.mock.calls.length).toBe(calls);
  });
});

describe('useData: categoryOf', () => {
  it('delegates to categorize with the transaction and the current context', async () => {
    mockCategorize.mockReturnValue('Groceries' as never);
    const { result } = renderHook(() => useData());
    await waitForSeed(result);

    const tx = makeTx('x', '2026-01-01');
    expect(result.current.categoryOf(tx)).toBe('Groceries');
    expect(mockCategorize).toHaveBeenLastCalledWith(tx, result.current.ctx);
  });

  it('is referentially stable while the context is unchanged', async () => {
    const { result, rerender } = renderHook(() => useData());
    await waitForSeed(result);
    const first = result.current.categoryOf;

    rerender();
    expect(result.current.categoryOf).toBe(first);
  });

  it('changes identity when an override is added', async () => {
    const { result } = renderHook(() => useData());
    await waitForSeed(result);
    const before = result.current.categoryOf;

    await act(async () => {
      await db.overrides.put({ id: 't1', category: 'Gifts' });
    });
    await waitFor(() => expect(result.current.categoryOf).not.toBe(before));
    expect(result.current.ctx.overrides).toEqual({ t1: 'Gifts' });
  });
});

describe('useData: categories', () => {
  it('always includes the uncategorized and transfer categories', async () => {
    await preventSeeding();
    const { result } = renderHook(() => useData());
    await waitFor(() => expect(result.current.ctx.rules).toHaveLength(1));
    expect(result.current.categories).toContain(UNCATEGORIZED);
    expect(result.current.categories).toContain(TRANSFER);
  });

  it('merges rule, label and override categories, deduplicated and sorted', async () => {
    await db.rules.bulkPut([
      { id: 'r1', category: 'Food' },
      { id: 'r2', category: 'Food' },
    ] as never);
    await db.labels.put({ counterparty: 'SL', category: 'Transport' } as never);
    await db.overrides.put({ id: 'x', category: 'Gifts' });

    const { result } = renderHook(() => useData());
    const expected = [...new Set([UNCATEGORIZED, TRANSFER, 'Food', 'Transport', 'Gifts'])].sort();
    await waitFor(() => expect(result.current.categories).toEqual(expected));
  });

  it('picks up a new override category live', async () => {
    await preventSeeding();
    const { result } = renderHook(() => useData());
    await waitFor(() => expect(result.current.ctx.rules).toHaveLength(1));

    await act(async () => {
      await db.overrides.put({ id: 'x', category: 'Hobbies' });
    });
    await waitFor(() => expect(result.current.categories).toContain('Hobbies'));
  });
});

describe('useData: accounts', () => {
  it('returns the stored accounts', async () => {
    await db.accounts.bulkPut([
      { id: 'acc1', name: 'Checking' },
      { id: 'acc2', name: 'Savings' },
    ]);
    const { result } = renderHook(() => useData());
    await waitFor(() => expect(result.current.accounts).toHaveLength(2));
  });

  it('resolves an account id to its stored name', async () => {
    await db.accounts.put({ id: 'acc1', name: 'Checking' });
    const { result } = renderHook(() => useData());
    await waitFor(() => expect(result.current.accountName('acc1')).toBe('Checking'));
  });

  it('falls back to the default name for unknown accounts', async () => {
    const { result } = renderHook(() => useData());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.accountName('SE1234567890')).toBe(defaultAccountName('SE1234567890'));
  });

  it('reflects a rename live', async () => {
    await db.accounts.put({ id: 'acc1', name: 'Checking' });
    const { result } = renderHook(() => useData());
    await waitFor(() => expect(result.current.accountName('acc1')).toBe('Checking'));

    await act(async () => {
      await db.accounts.put({ id: 'acc1', name: 'Everyday' });
    });
    await waitFor(() => expect(result.current.accountName('acc1')).toBe('Everyday'));
  });
});
