import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import ImportView from '@/components/ImportView';
import { decodeCsv, parseSwedbank } from '@/lib/parseSwedbank';
import { normalize } from '@/lib/normalize';
import { db, importTransactions } from '@/lib/db';
import type { Account } from '@/lib/types';

vi.mock('@/lib/parseSwedbank', () => ({
  decodeCsv: vi.fn(),
  parseSwedbank: vi.fn(),
}));
vi.mock('@/lib/normalize', () => ({
  normalize: vi.fn((t: unknown) => t),
}));
vi.mock('@/lib/db', () => ({
  db: { delete: vi.fn(), accounts: { put: vi.fn() } },
  importTransactions: vi.fn(),
}));

const mockDecode = vi.mocked(decodeCsv);
const mockParse = vi.mocked(parseSwedbank);
const mockNormalize = vi.mocked(normalize);
const mockImport = vi.mocked(importTransactions);
const mockDbDelete = vi.mocked(db.delete);
const mockPut = vi.mocked(db.accounts.put);

const accounts: Account[] = [
  { id: 'SE1234567890', name: 'Checking' },
  { id: 'SE0987654321', name: 'Savings' },
];

/** jsdom's File doesn't reliably implement arrayBuffer(), so stub it. */
function makeFile(name = 'export.csv') {
  const file = new File(['a;b;c'], name, { type: 'text/csv' });
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new ArrayBuffer(8) });
  return file;
}

function fileInput(container: HTMLElement) {
  return container.querySelector('input[type="file"]') as HTMLInputElement;
}

function uploadFiles(container: HTMLElement, files: File[]) {
  fireEvent.change(fileInput(container), { target: { files } });
}

const fakeTx = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `tx${i}` }) as never);

function renderView(props: Partial<{ accounts: Account[]; transferCount: number }> = {}) {
  return render(<ImportView accounts={props.accounts ?? []} transferCount={props.transferCount ?? 0} />);
}

beforeEach(() => {
  mockDecode.mockReturnValue('csv text');
  mockParse.mockReturnValue(fakeTx(2));
  mockImport.mockResolvedValue({ added: 2, duplicates: 0, accountIds: ['SE1234567890'] } as never);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ImportView: static rendering', () => {
  it('renders the heading, drop zone and privacy note', () => {
    renderView();
    expect(screen.getByRole('heading', { name: 'Import' })).toBeInTheDocument();
    expect(screen.getByText(/Drop one or more Swedbank CSVs here/)).toBeInTheDocument();
    expect(screen.getByText(/Nothing is uploaded/)).toBeInTheDocument();
  });

  it('configures the file input for multiple CSVs', () => {
    const { container } = renderView();
    const input = fileInput(container);
    expect(input).toHaveAttribute('multiple');
    expect(input).toHaveAttribute('accept', '.csv,text/csv');
  });

  it('shows an empty state when there are no accounts', () => {
    renderView({ accounts: [] });
    expect(screen.getByText('No accounts yet.')).toBeInTheDocument();
    expect(screen.queryByText(/internal transfers matched/)).not.toBeInTheDocument();
  });

  it('shows no message box before anything is imported', () => {
    const { container } = renderView();
    expect(container.querySelector('.msg')).toBeNull();
  });
});

describe('ImportView: accounts list', () => {
  it('renders an editable name input and the id for each account', () => {
    renderView({ accounts, transferCount: 3 });
    expect(screen.getByLabelText('Name for account SE1234567890')).toHaveValue('Checking');
    expect(screen.getByLabelText('Name for account SE0987654321')).toHaveValue('Savings');
    expect(screen.getByText('SE1234567890')).toBeInTheDocument();
    expect(screen.getByText('SE0987654321')).toBeInTheDocument();
  });

  it('shows the internal transfer count', () => {
    renderView({ accounts, transferCount: 3 });
    expect(screen.getByText(/3 internal transfers matched/)).toBeInTheDocument();
  });

  it('saves a renamed account (trimmed) on blur', () => {
    renderView({ accounts });
    const input = screen.getByLabelText('Name for account SE1234567890');
    fireEvent.change(input, { target: { value: '  Everyday  ' } });
    fireEvent.blur(input);
    expect(mockPut).toHaveBeenCalledTimes(1);
    expect(mockPut).toHaveBeenCalledWith({ id: 'SE1234567890', name: 'Everyday' });
  });

  it('does not save when the name is unchanged', () => {
    renderView({ accounts });
    fireEvent.blur(screen.getByLabelText('Name for account SE1234567890'));
    expect(mockPut).not.toHaveBeenCalled();
  });

  it('does not save when the name is unchanged apart from whitespace', () => {
    renderView({ accounts });
    const input = screen.getByLabelText('Name for account SE1234567890');
    fireEvent.change(input, { target: { value: ' Checking ' } });
    fireEvent.blur(input);
    expect(mockPut).not.toHaveBeenCalled();
  });

  it('does not save an empty or whitespace-only name', () => {
    renderView({ accounts });
    const input = screen.getByLabelText('Name for account SE1234567890');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.blur(input);
    expect(mockPut).not.toHaveBeenCalled();
  });
});

describe('ImportView: importing via file picker', () => {
  it('imports a file and reports counts with the last 4 digits of the account', async () => {
    mockImport.mockResolvedValue({ added: 5, duplicates: 2, accountIds: ['SE1234567890'] } as never);
    const { container } = renderView();
    uploadFiles(container, [makeFile('checking.csv')]);

    expect(await screen.findByText('checking.csv (account …7890): 5 new, 2 duplicates skipped')).toBeInTheDocument();
  });

  it('runs decode → parse → normalize → import in order', async () => {
    mockDecode.mockReturnValue('decoded');
    mockParse.mockReturnValue(fakeTx(3));
    const { container } = renderView();
    uploadFiles(container, [makeFile()]);

    await waitFor(() => expect(mockImport).toHaveBeenCalled());
    expect(mockDecode).toHaveBeenCalledWith(expect.any(ArrayBuffer));
    expect(mockParse).toHaveBeenCalledWith('decoded');
    expect(mockNormalize).toHaveBeenCalledTimes(3);
    expect(mockImport.mock.calls[0][0]).toHaveLength(3);
  });

  it('reports when no transactions are found and skips the DB import', async () => {
    mockParse.mockReturnValue([]);
    const { container } = renderView();
    uploadFiles(container, [makeFile('empty.csv')]);

    expect(
      await screen.findByText('empty.csv: no transactions found. Is this a Swedbank CSV export?'),
    ).toBeInTheDocument();
    expect(mockImport).not.toHaveBeenCalled();
  });

  it('reports a failure when the parser throws', async () => {
    mockParse.mockImplementation(() => { throw new Error('bad header'); });
    const { container } = renderView();
    uploadFiles(container, [makeFile('broken.csv')]);

    expect(await screen.findByText('broken.csv: import failed (bad header)')).toBeInTheDocument();
    expect(mockImport).not.toHaveBeenCalled();
  });

  it('reports a failure when the DB import rejects', async () => {
    mockImport.mockRejectedValue(new Error('quota exceeded'));
    const { container } = renderView();
    uploadFiles(container, [makeFile('big.csv')]);

    expect(await screen.findByText('big.csv: import failed (quota exceeded)')).toBeInTheDocument();
  });

  it('reports a failure when no account id is returned', async () => {
    mockImport.mockResolvedValue({ added: 0, duplicates: 0, accountIds: [] } as never);
    const { container } = renderView();
    uploadFiles(container, [makeFile('odd.csv')]);

    expect(await screen.findByText(/odd\.csv: import failed/)).toBeInTheDocument();
  });

  it('processes multiple files and keeps going after one fails', async () => {
    mockParse
      .mockReturnValueOnce(fakeTx(1))
      .mockImplementationOnce(() => { throw new Error('nope'); })
      .mockReturnValueOnce(fakeTx(1));
    mockImport
      .mockResolvedValueOnce({ added: 1, duplicates: 0, accountIds: ['AAAA1111'] } as never)
      .mockResolvedValueOnce({ added: 4, duplicates: 1, accountIds: ['BBBB2222'] } as never);

    const { container } = renderView();
    uploadFiles(container, [makeFile('one.csv'), makeFile('two.csv'), makeFile('three.csv')]);

    expect(await screen.findByText('one.csv (account …1111): 1 new, 0 duplicates skipped')).toBeInTheDocument();
    expect(screen.getByText('two.csv: import failed (nope)')).toBeInTheDocument();
    expect(screen.getByText('three.csv (account …2222): 4 new, 1 duplicates skipped')).toBeInTheDocument();
  });

  it('replaces messages from a previous import', async () => {
    const { container } = renderView();
    uploadFiles(container, [makeFile('first.csv')]);
    await screen.findByText(/first\.csv/);

    uploadFiles(container, [makeFile('second.csv')]);
    await screen.findByText(/second\.csv/);
    expect(screen.queryByText(/first\.csv/)).not.toBeInTheDocument();
  });

  it('does nothing when the picker is cancelled (no files)', () => {
    const { container } = renderView();
    uploadFiles(container, []);
    expect(mockDecode).not.toHaveBeenCalled();
    expect(container.querySelector('.msg')).toBeNull();
  });
});

describe('ImportView: drag and drop', () => {
  const dropZone = () => screen.getByText(/Drop one or more Swedbank CSVs here/);

  it('toggles the drag class on dragOver / dragLeave', () => {
    renderView();
    expect(dropZone()).not.toHaveClass('drag');
    fireEvent.dragOver(dropZone());
    expect(dropZone()).toHaveClass('drag');
    fireEvent.dragLeave(dropZone());
    expect(dropZone()).not.toHaveClass('drag');
  });

  it('imports dropped files and clears the drag state', async () => {
    renderView();
    fireEvent.dragOver(dropZone());
    fireEvent.drop(dropZone(), { dataTransfer: { files: [makeFile('dropped.csv')] } });

    expect(await screen.findByText(/dropped\.csv \(account …7890\)/)).toBeInTheDocument();
    expect(dropZone()).not.toHaveClass('drag');
  });

  it('ignores a drop that carries no files', () => {
    renderView();
    fireEvent.drop(dropZone(), { dataTransfer: { files: [] } });
    expect(mockDecode).not.toHaveBeenCalled();
  });

  it('prevents the browser default on dragOver and drop', () => {
    renderView();
    const over = new Event('dragover', { bubbles: true, cancelable: true });
    dropZone().dispatchEvent(over);
    expect(over.defaultPrevented).toBe(true);

    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', { value: { files: [] } });
    dropZone().dispatchEvent(drop);
    expect(drop.defaultPrevented).toBe(true);
  });
});

describe('ImportView: drop database', () => {
  const originalLocation = window.location;
  const reload = vi.fn();

  beforeEach(() => {
    reload.mockClear();
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: { ...originalLocation, reload },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: originalLocation,
    });
  });

  it('deletes the database and reloads the page', async () => {
    mockDbDelete.mockResolvedValue(undefined as never);
    renderView();
    fireEvent.click(screen.getByRole('button', { name: 'Drop database' }));

    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(mockDbDelete).toHaveBeenCalledTimes(1);
  });

  it('shows an error and does not reload when deletion fails', async () => {
    mockDbDelete.mockRejectedValue(new Error('blocked'));
    renderView();
    fireEvent.click(screen.getByRole('button', { name: 'Drop database' }));

    expect(await screen.findByText('Failed to drop database: blocked')).toBeInTheDocument();
    expect(reload).not.toHaveBeenCalled();
  });
});
