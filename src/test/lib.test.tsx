import { describe, expect, it } from 'vitest';
import { parseAmount, parseSwedbank } from './parseSwedbank';
import { normalize } from './normalize';
import { categorize, DEFAULT_RULES } from './categorize';
import { matchTransfers } from './transfers';
import { monthlyIncomeVsSpending } from '@/lib/sum';

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

describe('parseAmount', () => {
  it('handles dot and comma decimals', () => {
    expect(parseAmount('-12.50')).toBe(-12.5);
    expect(parseAmount('-12,50')).toBe(-12.5);
    expect(parseAmount('1 234,50')).toBe(1234.5);
    expect(parseAmount('1,234.50')).toBe(1234.5);
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

describe('multi-account transfers', () => {
  const all = [...parseSwedbank(CSV_A), ...parseSwedbank(CSV_B)].map(normalize);
  const transferIds = matchTransfers(all);
  const ctx = { overrides: {}, labels: [], rules: DEFAULT_RULES, transferIds };

  it('matches the out/in pair across accounts', () => {
    expect(transferIds.size).toBe(2);
    const matched = all.filter((t) => transferIds.has(t.id));
    expect(matched.map((t) => t.amount).sort((a, b) => a - b)).toEqual([-1000, 1000]);
  });
  it('does not match within the same account', () => {
    const sameAccount = parseSwedbank(CSV_A).map(normalize);
    expect(matchTransfers(sameAccount).size).toBe(0);
  });
  it('does not match outside the date window', () => {
    const late = [...parseSwedbank(CSV_A), ...parseSwedbank(CSV_B.replace('2024-05-03,2024-05-03,2024-05-03', '2024-05-20,2024-05-20,2024-05-20'))].map(normalize);
    expect(matchTransfers(late).size).toBe(0);
  });
  it('unmatched transfers are not assumed internal', () => {
    const only = parseSwedbank(CSV_A).map(normalize);
    const c = { ...ctx, transferIds: matchTransfers(only) };
    expect(categorize(only[1], c)).toBe('Uncategorized');
  });
  it('categorizes and nets out matched transfers from totals', () => {
    const card = all.find((t) => t.kind === 'card')!;
    expect(categorize(card, ctx)).toBe('Food');
    const totals = monthlyIncomeVsSpending(all, (t) => categorize(t, ctx));
    expect(totals['2024-05']).toEqual({ income: 250, spending: 129 });
  });
});
