import { useState } from 'react';
import { decodeCsv, parseSwedbank } from '../lib/parseSwedbank';
import { normalize } from '../lib/normalize';
import { db, importTransactions } from '../lib/db';
import type { Account } from '../lib/types';

export default function ImportView({ accounts, transferCount }: { accounts: Account[]; transferCount: number }) {
  const [messages, setMessages] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);

  async function handleFiles(files: FileList | File[]) {
    const out: string[] = [];
    for (const file of Array.from(files)) {
      try {
        const text = decodeCsv(await file.arrayBuffer());
        const txs = parseSwedbank(text).map(normalize);
        if (txs.length === 0) {
          out.push(`${file.name}: no transactions found. Is this a Swedbank CSV export?`);
          continue;
        }
        const { added, duplicates, accountIds } = await importTransactions(txs);
        out.push(`${file.name} (account …${accountIds[0].slice(-4)}): ${added} new, ${duplicates} duplicates skipped`);
      } catch (e) {
        out.push(`${file.name}: import failed (${(e as Error).message})`);
      }
    }
    setMessages(out);
  }

  return (
    <div>
      <h2>Import</h2>
      <label
        className={`drop ${dragging ? 'drag' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
        }}
      >
        Drop one or more Swedbank CSVs here (one per account), or click to choose
        <input
          type="file"
          accept=".csv,text/csv"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files?.length) handleFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </label>
      {messages.length > 0 && (
        <div className="msg">{messages.map((m) => <div key={m}>{m}</div>)}</div>
      )}

      <h3>Accounts</h3>
      {accounts.length === 0 ? (
        <p className="muted">No accounts yet.</p>
      ) : (
        <>
          {accounts.map((a) => (
            <div key={a.id} className="filters">
              <input
                defaultValue={a.name}
                aria-label={`Name for account ${a.id}`}
                onBlur={(e) => { const n = e.target.value.trim(); if (n && n !== a.name) db.accounts.put({ id: a.id, name: n }); }}
              />
              <span className="muted">{a.id}</span>
            </div>
          ))}
          <p className="muted">{transferCount} internal transfers matched between accounts and excluded from spending/income.</p>
        </>
      )}
      <p className="muted">Everything stays in your browser (IndexedDB). Nothing is uploaded.</p>
    </div>
  );
}