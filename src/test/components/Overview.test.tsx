/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import Overview from '../../components/Overview';
import {
  averageWeeklySpend,
  monthlyIncomeVsSpending,
  monthlySpendingByCategory,
  topCounterparties,
} from '../../lib/summaries';
import { UNCATEGORIZED } from '../../lib/types';
import type { Transaction } from '../../lib/types';

// Mutable state the Tooltip stub reads, so each test can choose what "hover" looks like.
const tip = vi.hoisted(() => ({
  active: true as boolean,
  payload: [] as unknown[],
  label: '2026-03',
}));

vi.mock('recharts', async () => {
  const { cloneElement } = await import('react');
  return {
    ResponsiveContainer: ({ children }: any) => <div>{children}</div>,
    BarChart: ({ data, children }: any) => (
      <div data-testid="bar-chart" data-rows={JSON.stringify(data)}>{children}</div>
    ),
    Bar: ({ dataKey, fill, stackId }: any) => (
      <div data-testid="bar" data-key={dataKey} data-fill={fill} data-stack={stackId} />
    ),
    CartesianGrid: () => null,
    XAxis: ({ tickFormatter }: any) => (
      <div data-testid="x-ticks">{['2026-03', '2025-12'].map((m) => tickFormatter(m)).join('|')}</div>
    ),
    YAxis: ({ tickFormatter }: any) => (
      <div data-testid="y-ticks">{[999, 1000, 1500, 12345].map((v) => tickFormatter(v)).join('|')}</div>
    ),
    Legend: ({ formatter }: any) => <div data-testid="legend">{formatter('Food')}</div>,
    Tooltip: ({ content }: any) =>
      content ? cloneElement(content, { active: tip.active, payload: tip.payload, label: tip.label }) : null,
  };
});

vi.mock('../../lib/summaries', () => ({
  averageWeeklySpend: vi.fn(),
  monthlyIncomeVsSpending: vi.fn(),
  monthlySpendingByCategory: vi.fn(),
  topCounterparties: vi.fn(),
}));

const mockWeekly = vi.mocked(averageWeeklySpend);
const mockIo = vi.mocked(monthlyIncomeVsSpending);
const mockCat = vi.mocked(monthlySpendingByCategory);
const mockTop = vi.mocked(topCounterparties);

const PALETTE = ['#2dd4bf', '#818cf8', '#f59e0b', '#fb7185', '#38bdf8', '#a3e635', '#c084fc'];
const OTHER_COLOR = '#3f4656';
const UNCAT_COLOR = '#6b7280';
const INCOME_COLOR = '#34d399';
const SPEND_COLOR = '#fb7185';

/** Same formatting the component uses (sv-SE output contains non-breaking spaces / U+2212). */
const f = (n: number) => Math.round(n).toLocaleString('sv-SE');

const tx = {} as Transaction;
const categoryOf = (_t: Transaction) => 'Food';

const charts = () => screen.getAllByTestId('bar-chart');
const rowsOf = (chart: HTMLElement) => JSON.parse(chart.getAttribute('data-rows')!);
const barsOf = (chart: HTMLElement) =>
  within(chart)
    .getAllByTestId('bar')
    .map((b) => ({ key: b.getAttribute('data-key'), fill: b.getAttribute('data-fill') }));
const kpiValue = (label: string) =>
  (screen.getByText(label).closest('.kpi') as HTMLElement).querySelector('.value') as HTMLElement;

function renderOverview(txs: Transaction[] = [tx]) {
  return render(<Overview txs={txs} categoryOf={categoryOf} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  tip.active = true;
  tip.payload = [];
  tip.label = '2026-03';

  mockCat.mockReturnValue({
    '2026-01': { Food: 300, Rent: 1200 },
    '2026-02': { Food: 250, Rent: 1200 },
  } as never);
  // Deliberately unsorted: the component must sort months itself.
  mockIo.mockReturnValue({
    '2026-02': { income: 30000, spending: 1450 },
    '2026-01': { income: 28000, spending: 1500 },
  } as never);
  mockWeekly.mockReturnValue(345.6 as never);
  mockTop.mockReturnValue([['ICA', 1500], ['Landlord', 900], ['SL', 300]] as never);
});

describe('Overview: empty state', () => {
  it('shows the empty message and no dashboard when there are no transactions', () => {
    renderOverview([]);
    expect(screen.getByText('No data yet. Import a CSV to get started.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Overview' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('bar-chart')).not.toBeInTheDocument();
  });
});

describe('Overview: layout', () => {
  it('renders headings and section descriptions', () => {
    renderOverview();
    expect(screen.getByRole('heading', { name: 'Overview' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Spending by category' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Income vs spending' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Top merchants and contacts' })).toBeInTheDocument();
    expect(screen.getByText(/Internal transfers between your accounts are excluded/)).toBeInTheDocument();
  });

  it('renders two charts', () => {
    renderOverview();
    expect(charts()).toHaveLength(2);
  });

  it('passes txs and categoryOf to the summary functions', () => {
    render(<Overview txs={[tx]} categoryOf={categoryOf} />);
    expect(mockCat).toHaveBeenCalledWith([tx], categoryOf);
    expect(mockIo).toHaveBeenCalledWith([tx], categoryOf);
    expect(mockWeekly).toHaveBeenCalledWith([tx], categoryOf);
    expect(mockTop).toHaveBeenCalledWith([tx], 8);
  });

  it('memoizes: only recomputes when txs or categoryOf change', () => {
    const txs = [tx];
    const { rerender } = render(<Overview txs={txs} categoryOf={categoryOf} />);
    expect(mockCat).toHaveBeenCalledTimes(1);

    rerender(<Overview txs={txs} categoryOf={categoryOf} />);
    expect(mockCat).toHaveBeenCalledTimes(1);

    rerender(<Overview txs={[tx]} categoryOf={categoryOf} />);
    expect(mockCat).toHaveBeenCalledTimes(2);
  });
});

describe('Overview: KPIs', () => {
  it('shows average weekly spend, totals and net', () => {
    renderOverview();
    expect(kpiValue('Average weekly spend').textContent).toBe(`${f(345.6)}kr`);
    expect(kpiValue('Total spending').textContent).toBe(`${f(1500 + 1450)}kr`);
    expect(kpiValue('Total income').textContent).toBe(`${f(28000 + 30000)}kr`);
  });

  it('shows a positive net with a plus sign and the pos class', () => {
    renderOverview();
    const net = kpiValue('Net');
    expect(net.textContent).toBe(`+${f(58000 - 2950)}kr`);
    expect(net).toHaveClass('pos');
    expect(net).not.toHaveClass('neg');
  });

  it('shows a negative net without a plus sign and with the neg class', () => {
    mockIo.mockReturnValue({ '2026-01': { income: 1000, spending: 4000 } } as never);
    renderOverview();
    const net = kpiValue('Net');
    expect(net.textContent).toBe(`${f(-3000)}kr`);
    expect(net.textContent).not.toMatch(/^\+/);
    expect(net).toHaveClass('neg');
  });

  it('treats a net of exactly zero as pos, with no plus sign', () => {
    mockIo.mockReturnValue({ '2026-01': { income: 2000, spending: 2000 } } as never);
    renderOverview();
    const net = kpiValue('Net');
    expect(net.textContent).toBe(`${f(0)}kr`);
    expect(net).toHaveClass('pos');
  });
});

describe('Overview: spending by category chart', () => {
  it('builds one row per month, sorted by month', () => {
    mockCat.mockReturnValue({
      '2026-02': { Food: 250, Rent: 1200 },
      '2026-01': { Food: 300, Rent: 1200 },
    } as never);
    renderOverview();
    expect(rowsOf(charts()[0])).toEqual([
      { month: '2026-01', Food: 300, Rent: 1200 },
      { month: '2026-02', Food: 250, Rent: 1200 },
    ]);
  });

  it('orders series by total spend and assigns palette colors in that order', () => {
    renderOverview();
    // Rent (2400 total) outranks Food (550) even though Food comes first in the data.
    expect(barsOf(charts()[0])).toEqual([
      { key: 'Rent', fill: PALETTE[0] },
      { key: 'Food', fill: PALETTE[1] },
    ]);
  });

  it('stacks all category bars together', () => {
    renderOverview();
    const stacks = within(charts()[0]).getAllByTestId('bar').map((b) => b.getAttribute('data-stack'));
    expect(new Set(stacks)).toEqual(new Set(['a']));
  });

  it('keeps the top 7 categories and folds the rest into "Other"', () => {
    // C1..C9 with totals 900..100, inserted in reverse so ordering must come from the totals.
    const month1: Record<string, number> = {};
    for (let i = 9; i >= 1; i--) month1[`C${i}`] = (10 - i) * 100;
    mockCat.mockReturnValue({ '2026-01': month1, '2026-02': { C9: 50, C1: 10 } } as never);
    renderOverview();

    const bars = barsOf(charts()[0]);
    expect(bars.map((b) => b.key)).toEqual(['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'Other']);
    expect(bars.at(-1)).toEqual({ key: 'Other', fill: OTHER_COLOR });

    const rows = rowsOf(charts()[0]);
    expect(rows[0].Other).toBe(200 + 100); // C8 + C9
    expect(rows[0].C8).toBeUndefined();
    expect(rows[0].C9).toBeUndefined();
    expect(rows[1]).toEqual({ month: '2026-02', C1: 10, Other: 50 });
  });

  it('does not add an "Other" series when there are exactly 7 categories', () => {
    const month: Record<string, number> = {};
    for (let i = 1; i <= 7; i++) month[`C${i}`] = i * 100;
    mockCat.mockReturnValue({ '2026-01': month } as never);
    renderOverview();
    expect(barsOf(charts()[0]).map((b) => b.key)).not.toContain('Other');
    expect(barsOf(charts()[0])).toHaveLength(7);
  });

  it('keeps uncategorized separate, last, grey, and out of the top ranking', () => {
    const month: Record<string, number> = { [UNCATEGORIZED]: 99999 };
    for (let i = 1; i <= 8; i++) month[`C${i}`] = (9 - i) * 100;
    mockCat.mockReturnValue({ '2026-01': month } as never);
    renderOverview();

    const bars = barsOf(charts()[0]);
    expect(bars.map((b) => b.key)).toEqual(['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'Other', UNCATEGORIZED]);
    expect(bars.at(-1)).toEqual({ key: UNCATEGORIZED, fill: UNCAT_COLOR });

    const row = rowsOf(charts()[0])[0];
    expect(row[UNCATEGORIZED]).toBe(99999);
    expect(row.Other).toBe(100); // only C8, uncategorized is never folded into Other
  });

  it('has no uncategorized series when there is no uncategorized spending', () => {
    renderOverview();
    expect(barsOf(charts()[0]).map((b) => b.key)).not.toContain(UNCATEGORIZED);
  });
});

describe('Overview: income vs spending chart', () => {
  it('builds rows sorted by month with income and spending', () => {
    renderOverview();
    expect(rowsOf(charts()[1])).toEqual([
      { month: '2026-01', income: 28000, spending: 1500 },
      { month: '2026-02', income: 30000, spending: 1450 },
    ]);
  });

  it('renders an income bar and a spending bar with their colors', () => {
    renderOverview();
    expect(barsOf(charts()[1])).toEqual([
      { key: 'income', fill: INCOME_COLOR },
      { key: 'spending', fill: SPEND_COLOR },
    ]);
  });
});

describe('Overview: axes and legend', () => {
  it('formats month ticks as "Mon yy"', () => {
    renderOverview();
    for (const el of screen.getAllByTestId('x-ticks')) expect(el.textContent).toBe('Mar 26|Dec 25');
  });

  it('compacts large y-axis values to k', () => {
    renderOverview();
    for (const el of screen.getAllByTestId('y-ticks')) expect(el.textContent).toBe('999|1k|1.5k|12.3k');
  });

  it('renders a legend on both charts', () => {
    renderOverview();
    const legends = screen.getAllByTestId('legend');
    expect(legends).toHaveLength(2);
    for (const l of legends) expect(l).toHaveTextContent('Food');
  });
});

describe('Overview: tooltip', () => {
  it('renders nothing when there is no payload', () => {
    tip.payload = [];
    const { container } = renderOverview();
    expect(container.querySelector('.tip')).toBeNull();
  });

  it('renders nothing when inactive', () => {
    tip.active = false;
    tip.payload = [{ name: 'Food', value: 300, color: '#aaaaaa' }];
    const { container } = renderOverview();
    expect(container.querySelector('.tip')).toBeNull();
  });

  it('shows the month title, rows sorted biggest first, and a total on the category chart', () => {
    tip.payload = [
      { name: 'Food', value: 300, color: '#aaaaaa' },
      { name: 'Rent', value: 1200, color: '#bbbbbb' },
    ];
    renderOverview();
    const tipEl = charts()[0].querySelector('.tip') as HTMLElement;

    expect(tipEl.querySelector('.tip-title')).toHaveTextContent('Mar 26');
    const names = [...tipEl.querySelectorAll('.tip-row .tip-name')].map((n) => n.textContent);
    expect(names).toEqual(['Rent', 'Food']);

    const values = [...tipEl.querySelectorAll('.tip-row .tip-val')].map((n) => n.textContent);
    expect(values).toEqual([`${f(1200)} kr`, `${f(300)} kr`]);

    const total = tipEl.querySelector('.tip-total') as HTMLElement;
    expect(total).toHaveTextContent('Total');
    expect(total.querySelector('.tip-val')!.textContent).toBe(`${f(1500)} kr`);
  });

  it('does not show a total on the income vs spending chart', () => {
    tip.payload = [
      { name: 'income', value: 30000, color: '#aaaaaa' },
      { name: 'spending', value: 1450, color: '#bbbbbb' },
    ];
    renderOverview();
    expect(charts()[1].querySelector('.tip')).not.toBeNull();
    expect(charts()[1].querySelector('.tip-total')).toBeNull();
  });

  it('omits zero-valued entries', () => {
    tip.payload = [
      { name: 'Food', value: 300, color: '#aaaaaa' },
      { name: 'Empty', value: 0, color: '#bbbbbb' },
    ];
    renderOverview();
    const names = [...charts()[0].querySelectorAll('.tip-name')].map((n) => n.textContent);
    expect(names).toEqual(['Food']);
  });

  it('hides the total when only one row remains', () => {
    tip.payload = [
      { name: 'Food', value: 300, color: '#aaaaaa' },
      { name: 'Empty', value: 0, color: '#bbbbbb' },
    ];
    renderOverview();
    expect(charts()[0].querySelector('.tip-total')).toBeNull();
  });

  it('colors each dot from the series color, falling back to fill', () => {
    tip.payload = [
      { name: 'Rent', value: 1200, color: '#112233' },
      { name: 'Food', value: 300, fill: '#445566' },
    ];
    renderOverview();
    const dots = charts()[0].querySelectorAll('.dot');
    expect(dots[0].getAttribute('style')).toMatch(/#112233|rgb\(17,\s*34,\s*51\)/i);
    expect(dots[1].getAttribute('style')).toMatch(/#445566|rgb\(68,\s*85,\s*102\)/i);
  });
});

describe('Overview: top merchants and contacts', () => {
  const items = () => [...document.querySelectorAll('.toplist li')] as HTMLElement[];

  it('lists names and formatted amounts in the order given', () => {
    renderOverview();
    expect(items().map((li) => li.querySelector('.name')!.textContent)).toEqual(['ICA', 'Landlord', 'SL']);
    expect(items().map((li) => li.querySelector('.amt')!.textContent)).toEqual([
      `${f(1500)} kr`,
      `${f(900)} kr`,
      `${f(300)} kr`,
    ]);
  });

  it('sets the full name as a title attribute for truncated labels', () => {
    renderOverview();
    expect(items()[0].querySelector('.name')).toHaveAttribute('title', 'ICA');
  });

  it('scales bar widths relative to the biggest entry', () => {
    renderOverview();
    const widths = items().map((li) => parseFloat((li.querySelector('.fill') as HTMLElement).style.width));
    expect(widths[0]).toBeCloseTo(100);
    expect(widths[1]).toBeCloseTo(60);
    expect(widths[2]).toBeCloseTo(20);
  });

  it('renders an empty list without crashing when there are no counterparties', () => {
    mockTop.mockReturnValue([] as never);
    renderOverview();
    expect(items()).toHaveLength(0);
  });
});
