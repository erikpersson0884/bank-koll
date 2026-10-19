import { describe, expect, it } from 'vitest';
import { decodeCsv, parseAmount, parseSwedbank } from '../lib/parseSwedbank';
import { normalize } from '../lib/normalize';
import { categorize } from '../lib/categorize';
import { matchTransfers } from '../lib/transfers';
import { averageWeeklySpend, monthlyIncomeVsSpending, monthlySpendingByCategory, topCounterparties } from '../lib/summaries';
import { TRANSFER, UNCATEGORIZED } from '../lib/types';
import type { CategoryContext, Rule, Transaction } from '../lib/types';

// ANONYMIZED fixtures: replace with a few rows from your real exports (change numbers/names first!)
const HEADER = `* Transaktioner Period 2024-05-01 - 2024-05-31 Skapad 2024-06-01
Radnummer,Clearingnummer,Kontonummer,Produkt,Valuta,Bokföringsdag,Transaktionsdag,Valutadag,Referens,Beskrivning,Belopp,Bokfört saldo
`;
const CSV_A = HEADER + `3,1234,000000000,Privatkonto,SEK,2024-05-04,2024-05-03,2024-05-04,MAXBURGERS,Kortköp 240503 MAXBURGERS,-129.00,4871.00
2,1234,000000000,Privatkonto,SEK,2024-05-02,2024-05-02,2024-05-02,Överföring,Överföring via internet,-1000.00,5000.00
1,1234,000000000,Privatkonto,SEK,2024-05-01,2024-05-01,2024-05-01,Swish,Swish inbetalning +46701234567,250.00,6000.00
`;
const CSV_B = HEADER + `1,5678,111111111,Sparkonto,SEK,2024-05-03,2024-05-03,2024-05-03,Överföring,Överföring via internet,1000.00,11000.00
`;

// Tests use their own small rule list, so renaming categories in DEFAULT_RULES can't break them.
const RULES: Rule[] = [
  { id: 'food', pattern: 'maxburgers', category: 'Food' },
  { id: 'phone', pattern: 'telia', category: 'Phone' },
];
const ctxOf = (over: Partial<CategoryContext> = {}): CategoryContext => ({
  overrides: {},
  labels: [],
  rules: RULES,
  transferIds: new Set<string>(),
  ...over,
});

/** Build a normalized transaction without going through CSV. */
const tx = (description: string, amount: number, date = '2024-05-10', accountId = '1234-000000000'): Transaction =>
  normalize({ accountId, date, description, reference: '', amount, balance: null });

describe('parseAmount', () => {
  it('handles dot and comma decimals', () => {
    expect(parseAmount('-12.50')).toBe(-12.5);
    expect(parseAmount('-12,50')).toBe(-12.5);
    expect(parseAmount('1 234,50')).toBe(1234.5);
    expect(parseAmount('1,234.50')).toBe(1234.5);
  });
  it('returns NaN for empty input', () => {
    expect(parseAmount('')).toBeNaN();
  });
});

describe('decodeCsv', () => {
  it('decodes UTF-8', () => {
    expect(decodeCsv(new TextEncoder().encode('Överföring').buffer as ArrayBuffer)).toBe('Överföring');
  });
  it('falls back to Windows-1252 when the bytes are not valid UTF-8', () => {
    const latin1 = new Uint8Array([0xd6, 0x76, 0x65, 0x72]); // "Över"
    expect(decodeCsv(latin1.buffer as ArrayBuffer)).toBe('Över');
  });
});

describe('parseSwedbank', () => {
  const rows = parseSwedbank(CSV_A);
  it('skips the * line and sorts oldest first', () => {
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.date)).toEqual(['2024-05-01', '2024-05-02', '2024-05-03']);
  });
  it('keeps Swedish characters and reads the account', () => {
    expect(rows[1].description).toContain('Överföring');
    expect(rows[0].accountId).toBe('1234-000000000');
  });
  it('ignores a byte order mark', () => {
    expect(parseSwedbank('\uFEFF' + CSV_A)).toHaveLength(3);
  });
  it('returns nothing for empty input', () => {
    expect(parseSwedbank('')).toEqual([]);
  });
  it('skips rows without a valid date or amount', () => {
    const csv = 'Transaktionsdag,Beskrivning,Belopp,Bokfört saldo\n2024-05-01,Ok,"-5,00","10,00"\n,No date,-1,1\n2024-05-02,No amount,,1\n';
    const parsed = parseSwedbank(csv);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ description: 'Ok', amount: -5, accountId: 'unknown' });
  });
});

describe('normalize', () => {
  const txs = parseSwedbank(CSV_A).map(normalize);
  it('detects kinds and counterparties', () => {
    expect(txs.map((t) => t.kind)).toEqual(['swish_received', 'transfer', 'card']);
    expect(txs[0].counterparty).toBe('+46701234567');
    expect(txs[2].counterparty).toBe('MAXBURGERS');
  });
  it('id ignores Radnummer', () => {
    const again = parseSwedbank(CSV_A.replace(/\n3,/, '\n99,')).map(normalize);
    expect(again.map((t) => t.id)).toEqual(txs.map((t) => t.id));
  });
  it('id differs per account for otherwise identical rows', () => {
    const b = parseSwedbank(CSV_A.replace(/1234,000000000/g, '5678,111111111')).map(normalize);
    expect(b[0].id).not.toBe(txs[0].id);
  });
});

describe('categorize', () => {
  const burger = tx('Kortköp MAXBURGERS', -50);

  it('matches rules against the description, case-insensitively', () => {
    expect(categorize(burger, ctxOf())).toBe('Food');
    expect(categorize(tx('Telia 59741225', -549), ctxOf())).toBe('Phone');
  });
  it('falls back to Uncategorized', () => {
    expect(categorize(tx('Something else', -10), ctxOf())).toBe(UNCATEGORIZED);
  });
  it('a label beats a rule, and matches the counterparty case-insensitively', () => {
    const labels = [{ counterparty: 'maxburgers', name: 'Max', category: 'Treats' }];
    expect(categorize(burger, ctxOf({ labels }))).toBe('Treats');
  });
  it('a matched transfer beats labels and rules', () => {
    const labels = [{ counterparty: 'MAXBURGERS', name: 'Max', category: 'Treats' }];
    expect(categorize(burger, ctxOf({ labels, transferIds: new Set([burger.id]) }))).toBe(TRANSFER);
  });
  it('a manual override beats everything', () => {
    const ctx = ctxOf({ overrides: { [burger.id]: 'Gift' }, transferIds: new Set([burger.id]) });
    expect(categorize(burger, ctx)).toBe('Gift');
  });
  it('skips invalid regexes instead of crashing', () => {
    const rules: Rule[] = [{ id: 'bad', pattern: '(', category: 'Bad' }, ...RULES];
    expect(categorize(burger, ctxOf({ rules }))).toBe('Food');
  });
});

describe('matchTransfers', () => {
  const all = [...parseSwedbank(CSV_A), ...parseSwedbank(CSV_B)].map(normalize);
  const transferIds = matchTransfers(all);

  it('matches the out/in pair across accounts', () => {
    expect(transferIds.size).toBe(2);
    const matched = all.filter((t) => transferIds.has(t.id));
    expect(matched.map((t) => t.amount).sort((a, b) => a - b)).toEqual([-1000, 1000]);
  });
  it('does not match within the same account', () => {
    expect(matchTransfers(parseSwedbank(CSV_A).map(normalize)).size).toBe(0);
  });
  it('does not match outside the date window', () => {
    const late = [...parseSwedbank(CSV_A), ...parseSwedbank(CSV_B.replace('2024-05-03,2024-05-03,2024-05-03', '2024-05-20,2024-05-20,2024-05-20'))].map(normalize);
    expect(matchTransfers(late).size).toBe(0);
  });
  it('never treats Swish or card rows as transfers', () => {
    const out = tx('Swish betalning +46701234567', -300, '2024-05-02', 'A');
    const inc = tx('Swish inbetalning +46709999999', 300, '2024-05-02', 'B');
    expect(matchTransfers([out, inc]).size).toBe(0);
  });
  it('uses each transaction at most once, pairing the closest dates first', () => {
    const outNear = tx('Överföring via internet', -500, '2024-05-02', 'A');
    const outFar = tx('Överföring via internet', -500, '2024-05-04', 'A');
    const inc = tx('Överföring via internet', 500, '2024-05-02', 'B');
    const ids = matchTransfers([outNear, outFar, inc]);
    expect(ids.size).toBe(2);
    expect(ids.has(outNear.id)).toBe(true);
    expect(ids.has(outFar.id)).toBe(false);
  });
});

describe('summaries', () => {
  const transfer = tx('Överföring via internet', -999, '2024-06-05');
  const sample = [
    tx('Kortköp MAXBURGERS', -100, '2024-05-01'),
    tx('Kortköp MAXBURGERS', -50, '2024-06-02'),
    tx('Telia 59741225', -200, '2024-06-03'),
    tx('Swish inbetalning +46701234567', 300, '2024-06-04'),
    transfer,
  ];
  const categoryOf = (t: Transaction) => categorize(t, ctxOf({ transferIds: new Set([transfer.id]) }));

  it('groups spending by month and category, leaving out income and transfers', () => {
    expect(monthlySpendingByCategory(sample, categoryOf)).toEqual({
      '2024-05': { Food: 100 },
      '2024-06': { Food: 50, Phone: 200 },
    });
  });
  it('totals income and spending per month, leaving out transfers', () => {
    expect(monthlyIncomeVsSpending(sample, categoryOf)).toEqual({
      '2024-05': { income: 0, spending: 100 },
      '2024-06': { income: 300, spending: 250 },
    });
  });
  it('ranks counterparties by spend, leaving out income and transfers', () => {
    expect(topCounterparties(sample, 5)).toEqual([['TELIA 59741225', 200], ['MAXBURGERS', 150]]);
  });
  it('averages spend per week over the date range', () => {
    const two = [tx('Kortköp MAXBURGERS', -100, '2024-05-01'), tx('Kortköp MAXBURGERS', -100, '2024-05-14')];
    expect(averageWeeklySpend(two, categoryOf)).toBe(100); // 14 days = 2 weeks, 200 kr
  });
  it('counts a short range as one full week and handles no spending', () => {
    expect(averageWeeklySpend([tx('Kortköp MAXBURGERS', -70)], categoryOf)).toBe(70);
    expect(averageWeeklySpend([], categoryOf)).toBe(0);
  });
});

describe('multi-account totals', () => {
  it('nets out matched transfers from income and spending', () => {
    const all = [...parseSwedbank(CSV_A), ...parseSwedbank(CSV_B)].map(normalize);
    const ctx = ctxOf({ transferIds: matchTransfers(all) });
    const card = all.find((t) => t.kind === 'card')!;
    expect(categorize(card, ctx)).toBe('Food');
    const totals = monthlyIncomeVsSpending(all, (t) => categorize(t, ctx));
    expect(totals['2024-05']).toEqual({ income: 250, spending: 129 });
  });
  it('does not assume an unmatched Överföring is internal', () => {
    const only = parseSwedbank(CSV_A).map(normalize);
    const ctx = ctxOf({ transferIds: matchTransfers(only) });
    expect(categorize(only[1], ctx)).toBe(UNCATEGORIZED);
  });
});
