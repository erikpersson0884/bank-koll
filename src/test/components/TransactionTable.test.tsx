import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import TransactionTable from '@/components/TransactionTable';
import { db } from '@/lib/db';
import { UNCATEGORIZED } from '@/lib/types';
import type { Transaction } from '@/lib/types';

vi.mock('@/lib/db', () => ({
  db: { overrides: { put: vi.fn(), delete: vi.fn() } },
}));

const mockPut = vi.mocked(db.overrides.put);
const mockDelete = vi.mocked(db.overrides.delete);

const makeTx = (
  id: string, date: string, accountId: string, description: string, counterparty: string, amount: number,
) => ({ id, date, accountId, description, counterparty, amount }) as Transaction;

// Input order matters: tx2 and tx4 share a date, and ties keep input order.
const txs: Transaction[] = [
  makeTx('1', '2026-03-01', 'acc1', 'ICA Maxi', 'ICA', -250.5),
  makeTx('2', '2026-03-05', 'acc2', 'Salary', 'Employer AB', 30000),
  makeTx('3', '2026-02-10', 'acc1', 'SL travel card', 'SL', -970),
  makeTx('4', '2026-03-05', 'acc1', 'Spotify', 'Spotify AB', -119),
];

const catById: Record<string, string> = { '1': 'Food', '2': 'Income', '3': 'Transport', '4': 'Entertainment' };
const categoryOf = (t: Transaction) => catById[t.id] ?? UNCATEGORIZED;
const categories = ['Food', 'Income', 'Transport', 'Entertainment'];
const accountName = (id: string) => ({ acc1: 'Checking', acc2: 'Savings' })[id] ?? id;

type Props = Partial<React.ComponentProps<typeof TransactionTable>>;

function renderTable(props: Props = {}) {
  return render(
    <TransactionTable
      txs={props.txs ?? txs}
      categoryOf={props.categoryOf ?? categoryOf}
      categories={props.categories ?? categories}
      accountName={props.accountName ?? accountName}
    />,
  );
}

const bodyRows = () => [...document.querySelectorAll<HTMLTableRowElement>('tbody tr')];
const col = (i: number) => bodyRows().map((tr) => tr.cells[i].textContent);
const descriptions = () => col(2);
const sortBy = (label: RegExp) => fireEvent.click(screen.getByRole('button', { name: label }));
const searchBox = () => screen.getByPlaceholderText(/Search/);
const categorySelect = () => document.querySelector('select') as HTMLSelectElement;
const categoryInput = (row: number) => bodyRows()[row].querySelector('input') as HTMLInputElement;

beforeEach(() => {
  mockPut.mockResolvedValue(undefined as never);
  mockDelete.mockResolvedValue(undefined as never);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('TransactionTable: rendering', () => {
  it('renders the heading and all column headers', () => {
    renderTable();
    expect(screen.getByRole('heading', { name: 'Transactions' })).toBeInTheDocument();
    for (const name of [/^Date/, /^Account/, /^Description/, /^Amount/, /^Category/]) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });

  it('renders a row per transaction with resolved account names', () => {
    renderTable();
    expect(bodyRows()).toHaveLength(4);
    expect(col(1)).toEqual(['Savings', 'Checking', 'Checking', 'Checking']);
  });

  it('formats amounts with two decimals and a neg/pos class', () => {
    renderTable();
    // default order: Salary, Spotify, ICA Maxi, SL travel card
    expect(col(3)).toEqual(['30000.00', '-119.00', '-250.50', '-970.00']);
    const cells = bodyRows().map((tr) => tr.cells[3]);
    expect(cells[0]).toHaveClass('pos');
    expect(cells[1]).toHaveClass('neg');
    expect(cells[0]).toHaveClass('r');
  });

  it('shows each transaction\'s category in an editable input', () => {
    renderTable();
    expect(categoryInput(0)).toHaveValue('Income');
    expect(categoryInput(2)).toHaveValue('Food');
  });

  it('renders an empty table body for no transactions', () => {
    renderTable({ txs: [] });
    expect(bodyRows()).toHaveLength(0);
    expect(document.querySelector('.msg')).toBeNull();
  });

  it('offers the categories in the datalist and the filter select', () => {
    renderTable();
    const listed = [...document.querySelectorAll('datalist#cats option')].map((o) => o.getAttribute('value'));
    expect(listed).toEqual(categories);
    const selectOptions = [...categorySelect().options].map((o) => o.text);
    expect(selectOptions).toEqual(['All categories', ...categories]);
  });
});

describe('TransactionTable: sorting', () => {
  it('defaults to date descending, keeping input order for ties', () => {
    renderTable();
    expect(descriptions()).toEqual(['Salary', 'Spotify', 'ICA Maxi', 'SL travel card']);
    expect(screen.getByRole('columnheader', { name: /Date/ })).toHaveAttribute('aria-sort', 'descending');
    expect(screen.getByRole('columnheader', { name: /Account/ })).toHaveAttribute('aria-sort', 'none');
  });

  it('shows an arrow only on the active column', () => {
    renderTable();
    expect(screen.getByRole('button', { name: /^Date/ })).toHaveTextContent('↓');
    expect(screen.getByRole('button', { name: /^Amount/ })).not.toHaveTextContent(/[↑↓]/);
  });

  it('reverses date order on the second click', () => {
    renderTable();
    sortBy(/^Date/);
    expect(descriptions()).toEqual(['SL travel card', 'ICA Maxi', 'Salary', 'Spotify']);
    expect(screen.getByRole('columnheader', { name: /Date/ })).toHaveAttribute('aria-sort', 'ascending');
    expect(screen.getByRole('button', { name: /^Date/ })).toHaveTextContent('↑');
  });

  it('sorts amount descending first, then ascending', () => {
    renderTable();
    sortBy(/^Amount/);
    expect(descriptions()).toEqual(['Salary', 'Spotify', 'ICA Maxi', 'SL travel card']);
    expect(screen.getByRole('columnheader', { name: /Amount/ })).toHaveAttribute('aria-sort', 'descending');

    sortBy(/^Amount/);
    expect(descriptions()).toEqual(['SL travel card', 'ICA Maxi', 'Spotify', 'Salary']);
  });

  it('sorts description ascending first, then descending', () => {
    renderTable();
    sortBy(/^Description/);
    expect(descriptions()).toEqual(['ICA Maxi', 'Salary', 'SL travel card', 'Spotify']);
    sortBy(/^Description/);
    expect(descriptions()).toEqual(['Spotify', 'SL travel card', 'Salary', 'ICA Maxi']);
  });

  it('sorts description case-insensitively using Swedish collation (å after z)', () => {
    const list = [
      makeTx('a', '2026-01-01', 'acc1', 'Åsa', 'x', -1),
      makeTx('b', '2026-01-02', 'acc1', 'zebra', 'x', -1),
      makeTx('c', '2026-01-03', 'acc1', 'Apple', 'x', -1),
    ];
    renderTable({ txs: list, categoryOf: () => 'Food' });
    sortBy(/^Description/);
    expect(descriptions()).toEqual(['Apple', 'zebra', 'Åsa']);
  });

  it('sorts by account name (not account id), ties in input order', () => {
    renderTable();
    sortBy(/^Account/);
    expect(col(1)).toEqual(['Checking', 'Checking', 'Checking', 'Savings']);
    expect(descriptions()).toEqual(['ICA Maxi', 'SL travel card', 'Spotify', 'Salary']);
  });

  it('sorts by category name', () => {
    renderTable();
    sortBy(/^Category/);
    // Entertainment, Food, Income, Transport
    expect(descriptions()).toEqual(['Spotify', 'ICA Maxi', 'Salary', 'SL travel card']);
    sortBy(/^Category/);
    expect(descriptions()).toEqual(['SL travel card', 'Salary', 'ICA Maxi', 'Spotify']);
  });

  it('resets to the natural direction when switching columns', () => {
    renderTable();
    sortBy(/^Date/); // date now ascending
    sortBy(/^Amount/); // amount starts descending
    expect(screen.getByRole('columnheader', { name: /Amount/ })).toHaveAttribute('aria-sort', 'descending');
    expect(screen.getByRole('columnheader', { name: /Date/ })).toHaveAttribute('aria-sort', 'none');
  });
});

describe('TransactionTable: search and category filter', () => {
  it('filters by description, case-insensitively', () => {
    renderTable();
    fireEvent.change(searchBox(), { target: { value: 'ICA' } });
    expect(descriptions()).toEqual(['ICA Maxi']);
    fireEvent.change(searchBox(), { target: { value: 'spotify' } });
    expect(descriptions()).toEqual(['Spotify']);
  });

  it('also matches the counterparty', () => {
    renderTable();
    fireEvent.change(searchBox(), { target: { value: 'employer' } });
    expect(descriptions()).toEqual(['Salary']);
  });

  it('ignores surrounding whitespace in the query', () => {
    renderTable();
    fireEvent.change(searchBox(), { target: { value: '   sl   ' } });
    expect(descriptions()).toContain('SL travel card');
  });

  it('shows nothing when nothing matches', () => {
    renderTable();
    fireEvent.change(searchBox(), { target: { value: 'zzz-no-match' } });
    expect(bodyRows()).toHaveLength(0);
  });

  it('filters by category and restores all rows on "All categories"', () => {
    renderTable();
    fireEvent.change(categorySelect(), { target: { value: 'Food' } });
    expect(descriptions()).toEqual(['ICA Maxi']);
    fireEvent.change(categorySelect(), { target: { value: '' } });
    expect(bodyRows()).toHaveLength(4);
  });

  it('combines search and category filters', () => {
    renderTable();
    fireEvent.change(categorySelect(), { target: { value: 'Transport' } });
    fireEvent.change(searchBox(), { target: { value: 'ICA' } });
    expect(bodyRows()).toHaveLength(0);
    fireEvent.change(searchBox(), { target: { value: 'travel' } });
    expect(descriptions()).toEqual(['SL travel card']);
  });

  it('keeps the current sort while filtering', () => {
    renderTable();
    sortBy(/^Amount/); // descending
    fireEvent.change(searchBox(), { target: { value: 'S' } });
    // Salary, Spotify, SL travel card (ICA Maxi also contains no "s"... "Maxi" no; "ICA Maxi" excluded)
    expect(descriptions()).toEqual(['Salary', 'Spotify', 'SL travel card']);
  });
});

describe('TransactionTable: uncategorized queue', () => {
  const withUncategorized = (t: Transaction) => (t.id === '3' || t.id === '4' ? UNCATEGORIZED : catById[t.id]);

  it('shows no banner when everything is categorized', () => {
    renderTable();
    expect(document.querySelector('.msg')).toBeNull();
  });

  it('shows uncategorized / categorized counts', () => {
    renderTable({ categoryOf: withUncategorized });
    expect(document.querySelector('.msg')).toHaveTextContent(/2 \/ 2 are uncategorized\./);
  });

  it('"Show queue" filters the table to uncategorized transactions', () => {
    renderTable({ categoryOf: withUncategorized });
    fireEvent.click(screen.getByRole('button', { name: 'Show queue' }));
    expect(descriptions().sort()).toEqual(['SL travel card', 'Spotify']);
  });

  it('selects the uncategorized option when the categories list includes it', () => {
    renderTable({ categoryOf: withUncategorized, categories: [...categories, UNCATEGORIZED] });
    fireEvent.click(screen.getByRole('button', { name: 'Show queue' }));
    expect(categorySelect().value).toBe(UNCATEGORIZED);
  });
});

describe('TransactionTable: row limit', () => {
  const many = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      makeTx(`t${i}`, `2026-01-${String((i % 28) + 1).padStart(2, '0')}`, 'acc1', `Tx ${i}`, 'x', -i));

  it('renders at most 500 rows and says how many exist', () => {
    renderTable({ txs: many(600), categoryOf: () => 'Food' });
    expect(bodyRows()).toHaveLength(500);
    expect(screen.getByText('Showing first 500 of 600. Use the filters.')).toBeInTheDocument();
  });

  it('shows no limit message at exactly 500 rows', () => {
    renderTable({ txs: many(500), categoryOf: () => 'Food' });
    expect(bodyRows()).toHaveLength(500);
    expect(screen.queryByText(/Showing first/)).not.toBeInTheDocument();
  });

  it('counts filtered rows, not total rows, in the limit message', () => {
    renderTable({ txs: many(600), categoryOf: () => 'Food' });
    fireEvent.change(searchBox(), { target: { value: 'Tx 1' } }); // Tx 1, Tx 10-19, Tx 100-199 = 111
    expect(bodyRows()).toHaveLength(111);
    expect(screen.queryByText(/Showing first/)).not.toBeInTheDocument();
  });
});

describe('TransactionTable: category overrides', () => {
  const edit = (row: number, value: string) => {
    const input = categoryInput(row);
    fireEvent.change(input, { target: { value } });
    fireEvent.blur(input);
  };

  it('saves a changed category as an override', () => {
    renderTable();
    edit(2, 'Groceries'); // row 2 = ICA Maxi (id 1)
    expect(mockPut).toHaveBeenCalledWith({ id: '1', category: 'Groceries' });
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('trims the category before saving', () => {
    renderTable();
    edit(2, '  Groceries  ');
    expect(mockPut).toHaveBeenCalledWith({ id: '1', category: 'Groceries' });
  });

  it('removes the override when the category is cleared', () => {
    renderTable();
    edit(2, '');
    expect(mockDelete).toHaveBeenCalledWith('1');
    expect(mockPut).not.toHaveBeenCalled();
  });

  it('removes the override when the category is only whitespace', () => {
    renderTable();
    edit(2, '   ');
    expect(mockDelete).toHaveBeenCalledWith('1');
    expect(mockPut).not.toHaveBeenCalled();
  });

  it('does nothing when the value is unchanged', () => {
    renderTable();
    fireEvent.blur(categoryInput(2));
    expect(mockPut).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('uses the right transaction id after re-sorting', () => {
    renderTable();
    sortBy(/^Amount/); // first row is now Salary (id 2)
    edit(0, 'Wages');
    expect(mockPut).toHaveBeenCalledWith({ id: '2', category: 'Wages' });
  });

  it('refreshes the input when the computed category changes', () => {
    const { rerender } = renderTable();
    expect(categoryInput(2)).toHaveValue('Food');

    rerender(
      <TransactionTable
        txs={txs}
        categoryOf={(t) => (t.id === '1' ? 'Groceries' : catById[t.id])}
        categories={categories}
        accountName={accountName}
      />,
    );
    expect(categoryInput(2)).toHaveValue('Groceries');
  });
});
