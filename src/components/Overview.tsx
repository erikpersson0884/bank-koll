import { useMemo } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { averageWeeklySpend, monthlyIncomeVsSpending, monthlySpendingByCategory, topCounterparties } from '../lib/summaries';
import { UNCATEGORIZED } from '../lib/types';
import type { Transaction } from '../lib/types';

const PALETTE = ['#2dd4bf', '#818cf8', '#f59e0b', '#fb7185', '#38bdf8', '#a3e635', '#c084fc'];
const MAX_CATEGORIES = PALETTE.length;
const OTHER = 'Other';
const OTHER_COLOR = '#3f4656';
const UNCAT_COLOR = '#6b7280';
const INCOME_COLOR = '#34d399';
const SPEND_COLOR = '#fb7185';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const fmt = (n: number) => Math.round(n).toLocaleString('sv-SE');
const compact = (n: number) => (Math.abs(n) >= 1000 ? `${Math.round(n / 100) / 10}k` : String(n));
const monthLabel = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;

interface TipItem { name?: string | number; value?: unknown; color?: string; fill?: string }

/** Hover popup: a dot in the series color before each name, biggest first. */
function ChartTooltip({ active, payload, label, showTotal }: { active?: boolean; payload?: readonly TipItem[]; label?: unknown; showTotal?: boolean }) {
  if (!active || !payload?.length) return null;
  const rows = payload
    .map((p) => ({ name: String(p.name ?? ''), value: Number(p.value ?? 0), color: p.color ?? p.fill ?? 'var(--muted)' }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value);
  const total = rows.reduce((s, r) => s + r.value, 0);
  return (
    <div className="tip">
      <div className="tip-title">{monthLabel(String(label))}</div>
      {rows.map((r) => (
        <div className="tip-row" key={r.name}>
          <span className="dot" style={{ background: r.color }} />
          <span className="tip-name">{r.name}</span>
          <span className="tip-val">{fmt(r.value)} kr</span>
        </div>
      ))}
      {showTotal && rows.length > 1 && (
        <div className="tip-total"><span>Total</span><span className="tip-val">{fmt(total)} kr</span></div>
      )}
    </div>
  );
}

const cursor = { fill: 'var(--hover)' };

const legend = (
  <Legend
    iconType="circle"
    iconSize={8}
    wrapperStyle={{ paddingTop: 12 }}
    formatter={(v) => <span style={{ color: 'var(--muted)', fontSize: 13 }}>{String(v)}</span>}
  />
);

export default function Overview({ txs, categoryOf }: { txs: Transaction[]; categoryOf: (t: Transaction) => string }) {
  const data = useMemo(() => {
    const byCat = monthlySpendingByCategory(txs, categoryOf);
    const months = Object.keys(byCat).sort();

    // Rank categories by total spend; keep the biggest few, fold the rest into "Other".
    const totalByCat = new Map<string, number>();
    for (const m of months) for (const [c, v] of Object.entries(byCat[m])) totalByCat.set(c, (totalByCat.get(c) ?? 0) + v);
    const named = [...totalByCat.entries()].filter(([c]) => c !== UNCATEGORIZED).sort((a, b) => b[1] - a[1]).map(([c]) => c);
    const top = named.slice(0, MAX_CATEGORIES);
    const topSet = new Set(top);

    const catRows = months.map((month) => {
      const acc: Record<string, number> = {};
      for (const [c, v] of Object.entries(byCat[month])) {
        const key = c === UNCATEGORIZED || topSet.has(c) ? c : OTHER;
        acc[key] = (acc[key] ?? 0) + v;
      }
      return { month, ...acc };
    });
    const series = [
      ...top.map((key, i) => ({ key, color: PALETTE[i] })),
      ...(named.length > MAX_CATEGORIES ? [{ key: OTHER, color: OTHER_COLOR }] : []),
      ...(totalByCat.has(UNCATEGORIZED) ? [{ key: UNCATEGORIZED, color: UNCAT_COLOR }] : []),
    ];

    const io = monthlyIncomeVsSpending(txs, categoryOf);
    const ioRows = Object.keys(io).sort().map((month) => ({ month, ...io[month] }));
    const income = ioRows.reduce((s, r) => s + r.income, 0);
    const spending = ioRows.reduce((s, r) => s + r.spending, 0);

    return { series, catRows, ioRows, income, spending, weekly: averageWeeklySpend(txs, categoryOf), top: topCounterparties(txs, 8) };
  }, [txs, categoryOf]);

  if (txs.length === 0) return <div className="card empty">No data yet. Import a CSV to get started.</div>;

  const net = data.income - data.spending;
  const maxTop = data.top[0]?.[1] ?? 1;
  const axis = { tickLine: false, axisLine: false } as const;

  return (
    <div>
      <h2>Overview</h2>

      <div className="kpis">
        <div className="card kpi"><div className="label">Average weekly spend</div><div className="value">{fmt(data.weekly)}<small>kr</small></div></div>
        <div className="card kpi"><div className="label">Total spending</div><div className="value">{fmt(data.spending)}<small>kr</small></div></div>
        <div className="card kpi"><div className="label">Total income</div><div className="value">{fmt(data.income)}<small>kr</small></div></div>
        <div className="card kpi"><div className="label">Net</div><div className={`value ${net < 0 ? 'neg' : 'pos'}`}>{net > 0 ? '+' : ''}{fmt(net)}<small>kr</small></div></div>
      </div>

      <div className="stack">
        <section className="card">
          <h3>Spending by category</h3>
          <p className="muted">Biggest categories per month. Smaller ones are grouped as “Other”.</p>
          <div className="chart">
            <ResponsiveContainer>
              <BarChart data={data.catRows} barCategoryGap="22%">
                <CartesianGrid vertical={false} />
                <XAxis dataKey="month" tickFormatter={monthLabel} {...axis} />
                <YAxis tickFormatter={compact} width={44} {...axis} />
                <Tooltip content={<ChartTooltip showTotal />} cursor={cursor} />
                {legend}
                {data.series.map((s) => <Bar key={s.key} dataKey={s.key} stackId="a" fill={s.color} />)}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="card">
          <h3>Income vs spending</h3>
          <p className="muted">Internal transfers between your accounts are excluded.</p>
          <div className="chart">
            <ResponsiveContainer>
              <BarChart data={data.ioRows} barCategoryGap="22%" barGap={4}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="month" tickFormatter={monthLabel} {...axis} />
                <YAxis tickFormatter={compact} width={44} {...axis} />
                <Tooltip content={<ChartTooltip />} cursor={cursor} />
                {legend}
                <Bar dataKey="income" fill={INCOME_COLOR} radius={[4, 4, 0, 0]} />
                <Bar dataKey="spending" fill={SPEND_COLOR} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="card">
          <h3>Top merchants and contacts</h3>
          <p className="muted">By total spend.</p>
          <ol className="toplist">
            {data.top.map(([name, sum]) => (
              <li key={name}>
                <span className="name" title={name}>{name}</span>
                <span className="amt">{fmt(sum)} kr</span>
                <span className="track"><span className="fill" style={{ width: `${(sum / maxTop) * 100}%`, display: 'block' }} /></span>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}