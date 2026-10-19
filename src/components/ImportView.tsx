import { useState } from 'react';
import { decodeCsv, parseSwedbank } from '../lib/parseSwedbank';
import { normalize } from '../lib/normalize';
import { importTransactions } from '../lib/db';

export default function ImportView() {
  const [message, setMessage] = useState('');
  const [dragging, setDragging] = useState(false);

  async function handleFile(file: File) {
    try {
      const text = decodeCsv(await file.arrayBuffer());
      const txs = parseSwedbank(text).map(normalize);
      if (txs.length === 0) {
        setMessage('No transactions found. Is this a Swedbank CSV export?');
        return;
      }
      const { added, duplicates } = await importTransactions(txs);
      setMessage(`${added} new, ${duplicates} duplicates skipped`);
    } catch (e) {
      setMessage(`Import failed: ${(e as Error).message}`);
    }
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
          const f = e.dataTransfer.files[0];
          if (f) handleFile(f);
        }}
      >
        Drop a Swedbank CSV here, or click to choose
        <input
          type="file"
          accept=".csv,text/csv"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
            e.target.value = '';
          }}
        />
      </label>
      {message && <p className="msg">{message}</p>}
      <p className="muted">Everything stays in your browser (IndexedDB). Nothing is uploaded.</p>
    </div>
  );
}
