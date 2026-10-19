import type { Kind, RawTransaction, Transaction } from './types';

// cyrb53: small, fast, good-enough string hash
function hash(str: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

/** Radnummer is deliberately excluded: it changes between exports. */
export function transactionId(t: RawTransaction): string {
  return hash([t.date, t.description, t.amount, t.balance ?? ''].join('|'));
}

const PHONE = /\+?\d[\d\s-]{7,}\d/;

export function detectKind(t: RawTransaction): Kind {
  const d = t.description.toLowerCase();
  if (d.includes('överföring')) return 'transfer';
  if (d.includes('swish')) return t.amount >= 0 ? 'swish_received' : 'swish_sent';
  if (d.startsWith('kortköp') || d.startsWith('k*') || d.includes('kortkop')) return 'card';
  return 'other';
}

export function detectCounterparty(t: RawTransaction, kind: Kind): string {
  if (kind === 'swish_sent' || kind === 'swish_received') {
    const m = t.description.match(PHONE) ?? t.reference.match(PHONE);
    if (m) return m[0].replace(/[\s-]/g, '');
  }
  return t.description
    .replace(/^(kortköp|k\*)\s*/i, '')
    .replace(/\b\d{6}\b/g, '') // purchase date like 240503
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

export function normalize(t: RawTransaction): Transaction {
  const kind = detectKind(t);
  return { ...t, id: transactionId(t), kind, counterparty: detectCounterparty(t, kind) };
}