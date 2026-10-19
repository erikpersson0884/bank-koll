import Papa from 'papaparse';
import type { RawTransaction } from './types';

/** Try UTF-8 first, fall back to Latin-1/Windows-1252 (Swedbank sometimes exports that). */
export function decodeCsv(buf: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('windows-1252').decode(buf);
  }
}

/** Handles "-12.50", "-12,50", "1 234,50", "1,234.50". */
export function parseAmount(input: string): number {
  let s = input.replace(/[\s\u00a0]/g, '');
  if (s === '') return NaN;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma !== -1 && lastDot !== -1) {
    // the later separator is the decimal one
    s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lastComma !== -1) {
    s = s.replace(',', '.');
  }
  return Number(s);
}

/** CSV text -> RawTransaction[], newest-first input is sorted oldest-first. */
export function parseSwedbank(text: string): RawTransaction[] {
  const clean = text.replace(/^\uFEFF/, '');
  const lines = clean.split(/\r?\n/);
  // Swedbank puts a "* Transaktioner ..." line before the header
  const start = lines.findIndex((l) => l.trim() !== '' && !l.trim().startsWith('*'));
  if (start === -1) return [];
  const body = lines.slice(start).join('\n');

  const result = Papa.parse<Record<string, string>>(body, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });

  const rows: RawTransaction[] = [];
  for (const r of result.data) {
    const amount = parseAmount(r['Belopp'] ?? '');
    const date = (r['Transaktionsdag'] ?? '').trim();
    if (!date || Number.isNaN(amount)) continue;
    const bal = parseAmount(r['Bokfört saldo'] ?? '');
    rows.push({
      date,
      description: (r['Beskrivning'] ?? '').trim(),
      reference: (r['Referens'] ?? '').trim(),
      amount,
      balance: Number.isNaN(bal) ? null : bal,
    });
  }
  // explicit sort; stable, so same-day order from the file is preserved
  return rows.sort((a, b) => a.date.localeCompare(b.date));
}