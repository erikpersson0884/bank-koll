import { useMemo, useState } from 'react';
import { db } from '../lib/db';
import { UNCATEGORIZED } from '../lib/types';
import type { Transaction } from '../lib/types';

const LIMIT = 500;
const collator = new Intl.Collator('sv', { sensitivity: 'base' });

type SortKey = 'date' | 'account' | 'description' | 'amount' | 'category';
type Row = { t: Transaction; cat: string };

export default function TransactionTable({
  txs, categoryOf, categories, accountName,
}: { txs: Transaction[]; categoryOf: (t: Transaction) => string; categories: string[]; accountName: (id: string) => string }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'date', dir: 'desc' });

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const sign = sort.dir === 'asc' ? 1 : -1;
    const compare = (a: Row, b: Row): number => {
      switch (sort.key) {
        case 'date': return a.t.date.localeCompare(b.t.date);
        case 'amount': return a.t.amount - b.t.amount;
        case 'account': return collator.compare(accountName(a.t.accountId), accountName(b.t.accountId));
        case 'description': return collator.compare(a.t.description, b.t.description);
        case 'category': return collator.compare(a.cat, b.cat);
      }
    };
    return txs
      .map((t) => ({ t, cat: categoryOf(t) }))
      .filter(({ t, cat }) =>
        (!category || cat === category) &&
        (!q || `${t.description} ${t.counterparty}`.toLowerCase().includes(q)))
      .sort((a, b) => sign * compare(a, b)); // stable: ties keep their newest-first order
  }, [txs, categoryOf, accountName, query, category, sort]);

  const uncategorized = useMemo(() => txs.filter((t) => categoryOf(t) === UNCATEGORIZED).length, [txs, categoryOf]);
  const categorized = useMemo(() => txs.filter((t) => categoryOf(t) !== UNCATEGORIZED).length, [txs, categoryOf]);

  // First click sorts a column in its natural direction, second click reverses it.
  function toggleSort(key: SortKey) {
    setSort((s) => s.key === key
      ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: key === 'date' || key === 'amount' ? 'desc' : 'asc' });
  }

  const header = (key: SortKey, label: string, className?: string) => (
    <th className={className} aria-sort={sort.key === key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button className="sort" onClick={() => toggleSort(key)}>
        {label}<span className="arrow">{sort.key === key ? (sort.dir === 'asc' ? '↑' : '↓') : ''}</span>
      </button>
    </th>
  );

  async function setOverride(id: string, value: string) {
    const v = value.trim();
    if (v) await db.overrides.put({ id, category: v });
    else await db.overrides.delete(id);
  }

  return (
    <div>
      <h2>Transactions</h2>
      {uncategorized > 0 && (
        <p className="msg">
          {uncategorized} / {categorized} are uncategorized.{' '}
          <button onClick={() => setCategory(UNCATEGORIZED)}>Show queue</button>
        </p>
      )}
      <div className="filters">
        <input placeholder="Search…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option>
          {categories.map((c) => <option key={c}>{c}</option>)}
        </select>
      </div>
      <datalist id="cats">{categories.map((c) => <option key={c} value={c} />)}</datalist>
      <table>
        <thead>
          <tr>
            {header('date', 'Date')}
            {header('account', 'Account')}
            {header('description', 'Description')}
            {header('amount', 'Amount', 'r')}
            {header('category', 'Category')}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, LIMIT).map(({ t, cat }) => (
            <tr key={t.id}>
              <td>{t.date}</td>
              <td>{accountName(t.accountId)}</td>
              <td>{t.description}</td>
              <td className={`r ${t.amount < 0 ? 'neg' : 'pos'}`}>{t.amount.toFixed(2)}</td>
              <td>
                <input
                  list="cats"
                  defaultValue={cat}
                  key={`${t.id}-${cat}`}
                  onBlur={(e) => { if (e.target.value !== cat) setOverride(t.id, e.target.value); }}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > LIMIT && <p className="muted">Showing first {LIMIT} of {rows.length}. Use the filters.</p>}
    </div>
  );
}