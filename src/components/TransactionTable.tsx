import { useMemo, useState } from 'react';
import { db } from '../lib/db';
import { UNCATEGORIZED } from '../lib/types';
import type { Transaction } from '../lib/types';

const LIMIT = 500;

export default function TransactionTable({
  txs, categoryOf, categories, accountName,
}: { txs: Transaction[]; categoryOf: (t: Transaction) => string; categories: string[]; accountName: (id: string) => string }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return txs
      .map((t) => ({ t, cat: categoryOf(t) }))
      .filter(({ t, cat }) =>
        (!category || cat === category) &&
        (!q || `${t.description} ${t.counterparty}`.toLowerCase().includes(q)));
  }, [txs, categoryOf, query, category]);

  const uncategorized = useMemo(() => txs.filter((t) => categoryOf(t) === UNCATEGORIZED).length, [txs, categoryOf]);
  const categorized = useMemo(() => txs.filter((t) => categoryOf(t) !== UNCATEGORIZED).length, [txs, categoryOf]);

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
        <thead><tr><th>Date</th><th>Account</th><th>Description</th><th className="r">Amount</th><th>Category</th></tr></thead>
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