import { useMemo } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, Tooltip, XAxis, YAxis } from 'recharts';
import { ResponsiveContainer } from 'recharts';
import { averageWeeklySpend, monthlyIncomeVsSpending, monthlySpendingByCategory, topCounterparties } from '../lib/summaries';
import type { Transaction } from '../lib/types';

const COLORS = ['#4f46e5', '#059669', '#d97706', '#dc2626', '#0891b2', '#7c3aed', '#db2777', '#65a30d', '#64748b'];
const fmt = (n: number) => Math.round(n).toLocaleString('sv-SE');

export default function Overview({ txs, categoryOf }: { txs: Transaction[]; categoryOf: (t: Transaction) => string }) {
  const data = useMemo(() => {
    const byCat = monthlySpendingByCategory(txs, categoryOf);
    const cats = [...new Set(Object.values(byCat).flatMap((m) => Object.keys(m)))].sort();
    const catRows = Object.keys(byCat).sort().map((month) => ({ month, ...byCat[month] }));
    const io = monthlyIncomeVsSpending(txs, categoryOf);
    const ioRows = Object.keys(io).sort().map((month) => ({ month, ...io[month] }));
    return { cats, catRows, ioRows, weekly: averageWeeklySpend(txs, categoryOf), top: topCounterparties(txs, 8) };
  }, [txs, categoryOf]);

  if (txs.length === 0) return <p>No data yet. Import a CSV first.</p>;

  return (
    <div>
      <h2>Overview</h2>
      <p className="stat">Average weekly spend: <strong>{fmt(data.weekly)} kr</strong></p>

      <h3>Spending by category</h3>
      <div className="chart">
        <ResponsiveContainer>
          <BarChart data={data.catRows}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="month" />
            <YAxis />
            <Tooltip formatter={(v: number) => `${fmt(v)} kr`} />
            <Legend />
            {data.cats.map((c, i) => (
              <Bar key={c} dataKey={c} stackId="a" fill={COLORS[i % COLORS.length]} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      <h3>Income vs spending</h3>
      <div className="chart">
        <ResponsiveContainer>
          <BarChart data={data.ioRows}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="month" />
            <YAxis />
            <Tooltip formatter={(v: number) => `${fmt(v)} kr`} />
            <Legend />
            <Bar dataKey="income" fill="#059669" />
            <Bar dataKey="spending" fill="#dc2626" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <h3>Top merchants and contacts (by spend)</h3>
      <ol>
        {data.top.map(([name, sum]) => (
          <li key={name}>{name}: {fmt(sum)} kr</li>
        ))}
      </ol>
    </div>
  );
}
