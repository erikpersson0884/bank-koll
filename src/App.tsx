import { useState } from 'react';
import ImportView from './components/ImportView';
import Overview from './components/Overview';
import TransactionTable from './components/TransactionTable';
import { useData } from './lib/useData';
import './index.css';

type Tab = 'import' | 'overview' | 'transactions';

export default function App() {
  const [tab, setTab] = useState<Tab>('import');
  const { txs, loading, categoryOf, categories } = useData();

  return (
    <div className="app">
      <nav>
        {(['import', 'overview', 'transactions'] as Tab[]).map((t) => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </nav>
      {loading ? <p>Loading…</p> : (
        <>
          {tab === 'import' && <ImportView />}
          {tab === 'overview' && <Overview txs={txs} categoryOf={categoryOf} />}
          {tab === 'transactions' && <TransactionTable txs={txs} categoryOf={categoryOf} categories={categories} />}
        </>
      )}
    </div>
  );
}