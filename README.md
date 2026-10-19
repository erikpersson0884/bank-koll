# Bank-koll

[![Last Commit][last-commit-shield]][last-commit-url]
[![Build Status][build-shield]][build-url]
[![Test Coverage][coverage-shield]][coverage-url]
[![Repo Size][repo-size-shield]][repo-size-url]
[![Author][author-shield]][author-url]

A local-only web app that turns Swedbank CSV exports into a readable overview of where your money goes. Import one or more account exports, let the app categorize the transactions, and look at monthly spending, income vs. spending, and your biggest merchants and contacts.

**Privacy:** everything runs in your browser. Transactions, rules and settings are stored in IndexedDB on your own machine. Nothing is uploaded anywhere.

**Stack:** Vite, React 19, TypeScript, Dexie (IndexedDB), PapaParse (CSV), Recharts (charts), Vitest (tests).

---

## Quick start

```bash
npm install
npm run dev
```

The dev server runs on http://localhost:3000. On a fresh clone, first create `src/rules.json` containing `[]` (see [Personal rules](#personal-rules-srcrulesjson)).

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the dev server (port 3000) |
| `npm run build` | Type-check (`tsc -b`) and build to `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run lint` | Run ESLint |

> There is currently no `test` script. See [Testing](#testing).

---

## Using the app

### 1. Export from Swedbank

Export your transactions as CSV from Swedbank's internet bank. One file per account. The app expects the standard "Transaktioner" export:

- Line 1 is a metadata line starting with `*` (for example `* Transaktioner Period ... Skapad ...`). It is skipped automatically.
- Line 2 is the header: `Radnummer, Clearingnummer, Kontonummer, Produkt, Valuta, Bokföringsdag, Transaktionsdag, Valutadag, Referens, Beskrivning, Belopp, Bokfört saldo`.
- Both UTF-8 and Windows-1252 (Latin-1) encodings work, so "Överföring" and "Västtrafik" come through intact.
- Amounts may use a decimal point or comma, and may contain thousands separators.

### 2. Import

Open the **Import** tab and drop one or more CSV files onto the drop area (or click it to choose files). For each file you get a message like:

```
export.csv (account …5839): 142 new, 38 duplicates skipped
```

Re-importing overlapping periods is safe: transactions that are already stored are skipped.

**Accounts.** Each distinct `Clearingnummer-Kontonummer` becomes an account. New accounts get a default name like `Account …5839`. Rename them in the Accounts list on the Import tab; the name is saved when the field loses focus.

**Drop database** deletes the entire local database: transactions, accounts, rules, labels and manual categories. There is no confirmation and no undo.

### 3. Overview

The **Overview** tab shows, for all imported data:

- Average weekly spend
- Spending by category, stacked per month
- Income vs. spending per month
- Top 8 merchants and contacts by total spend

Internal transfers between your own accounts are excluded from every figure (see [Transfer detection](#transfer-detection)).

### 4. Transactions

The **Transactions** tab lists transactions (newest first, capped at 500 rows) with a text search and a category filter. If anything is uncategorized, a banner shows the count and a **Show queue** button that filters to those rows.

To change a transaction's category, type in the category box on its row (it autocompletes from existing categories) and click away. This stores a manual override for that one transaction. Clearing the box removes the override.

---

## How categorization works

Every transaction gets exactly one category, computed on the fly from the stored data. Because it is never saved on the transaction itself, changing a rule or label immediately re-categorizes all past transactions.

Priority, first match wins:

1. **Manual override** for that transaction (set in the Transactions tab)
2. **Matched internal transfer** → `Transfer`
3. **Label** whose `counterparty` equals the transaction's counterparty (case-insensitive)
4. **Rules**: each rule's `pattern` is a regular expression, tested case-insensitively against `counterparty + " " + description`
5. Otherwise `Uncategorized`

### Rules

A rule looks like this:

```json
{ "id": "phone", "pattern": "telia", "category": "Phone" }
```

- `id` must be unique. It is the database key.
- `pattern` is a JavaScript regex source. It matches anywhere in the text, with no word boundaries, so short patterns such as `ica` or `wh` also match inside longer words. Invalid regexes are silently skipped.
- Built-in starter rules live in `src/lib/categorize.ts` (`DEFAULT_RULES`).

### Personal rules (`src/rules.json`)

`src/rules.json` holds your own rules. It is listed in `.gitignore` so personal names and patterns stay out of version control, but it **is imported at build time**, so the file must exist. On a fresh clone, create it containing `[]`.

On first run, `DEFAULT_RULES` plus `rules.json` are written to IndexedDB. **This seeding only happens when the rules table is empty.** Editing `rules.json` later has no effect on an existing database. To apply changes without losing your transactions, open DevTools → Application → IndexedDB → `bank-overview` → `rules`, clear the table, and reload. "Drop database" also works but removes everything.

---

## Transfer detection

Moving money between your own accounts would otherwise show up as spending in one and income in another. `src/lib/transfers.ts` pairs these up:

- Candidates are transactions of kind `transfer` or `other`. Swish and card rows are never candidates.
- A pair is one outgoing and one incoming transaction with the **same amount** (to the öre) in **different accounts**, dated **within 3 days** of each other.
- Each transaction is used at most once, and the closest dates are paired first.

Matched pairs are categorized `Transfer` and excluded from income and spending. An "Överföring" that has no partner is **not** assumed to be internal (it could be money from a parent, for example). It falls through to the rules and then `Uncategorized` so you can review it.

Transfer matching only works when you have imported both sides, so import all relevant accounts.

---

## Project structure

```
src/
  main.tsx                 App entry point
  App.tsx                  Tab navigation (Import / Overview / Transactions)
  index.css                Global styles
  rules.json               Your personal categorization rules (gitignored)
  components/
    ImportView.tsx         File drop, import messages, account names, drop database
    Overview.tsx           Charts and summary figures
    TransactionTable.tsx   Search, filter, manual category editing
  lib/
    types.ts               Shared types and the TRANSFER / UNCATEGORIZED constants
    parseSwedbank.ts       CSV text → RawTransaction[]
    normalize.ts           RawTransaction → Transaction (id, kind, counterparty)
    transfers.ts           Matching of transfers between own accounts
    categorize.ts          DEFAULT_RULES and the categorize() function
    summaries.ts           Aggregations used by the Overview
    db.ts                  Dexie database, schema and importTransactions()
    useData.ts             React hook that wires the database to the UI
  test/
    lib.test.tsx           Vitest tests for the lib modules
```

The logic in `lib/` is plain functions with no React dependency. The components only display data and write overrides and account names.

---

## Data model

### Types (`lib/types.ts`)

| Type | Fields |
| --- | --- |
| `RawTransaction` | `accountId`, `date` (Transaktionsdag, `YYYY-MM-DD`), `description`, `reference`, `amount`, `balance` (nullable) |
| `Transaction` | everything in `RawTransaction` plus `id`, `kind`, `counterparty` |
| `Kind` | `card`, `swish_sent`, `swish_received`, `transfer`, `other` |
| `Account` | `id`, `name` |
| `Rule` | `id`, `pattern`, `category` |
| `Label` | `counterparty`, `name`, `category` |
| `CategoryContext` | `overrides` (tx id → category), `labels`, `rules`, `transferIds` |

Negative amounts are spending, positive amounts are income.

### IndexedDB (`lib/db.ts`)

Database name: `bank-overview`.

| Table | Primary key | Extra indexes | Contents |
| --- | --- | --- | --- |
| `transactions` | `id` | `date`, `kind`, `counterparty`, `accountId` | Imported transactions |
| `accounts` | `id` | | Account names |
| `rules` | `id` | | Categorization rules |
| `labels` | `counterparty` | | Contact/merchant labels with a category |
| `overrides` | `id` (transaction id) | | Manual per-transaction categories |

**Schema history.** Version 2 added multiple accounts. Because transaction ids now include the account, the upgrade clears the `transactions` table. If you ever see an empty overview after upgrading, re-import your CSVs. Rules, labels and overrides are preserved by the migration (note that overrides are keyed by the old ids, so they no longer match).

### Transaction ids and de-duplication

`transactionId()` hashes `accountId | date | description | amount | balance` (cyrb53). The CSV row number (`Radnummer`) is deliberately left out because it changes between exports, which would break de-duplication of overlapping periods. Including the account keeps identical rows in different accounts distinct.

---

## Module reference

**`parseSwedbank.ts`**
- `decodeCsv(buffer)`: decodes as UTF-8, falls back to Windows-1252.
- `parseAmount(string)`: handles `-12.50`, `-12,50`, `1 234,50`, `1,234.50`. Returns `NaN` for empty input.
- `parseSwedbank(text)`: skips leading `*` lines, parses with PapaParse, drops rows without a date or a valid amount, and returns rows sorted oldest first. The account id is `Clearingnummer-Kontonummer`.

**`normalize.ts`**
- `detectKind(raw)`: `transfer` if the description contains "överföring", `swish_sent`/`swish_received` if it contains "swish" (by amount sign), `card` if it starts with "kortköp" or "k*", otherwise `other`.
- `detectCounterparty(raw, kind)`: for Swish, the phone number found in the description or reference; otherwise the description uppercased, with a leading "Kortköp"/"K*" prefix and 6-digit purchase dates removed.
- `normalize(raw)`: adds `id`, `kind` and `counterparty`.

**`categorize.ts`**
- `categorize(tx, ctx)`: returns the category using the priority order above.

**`transfers.ts`**
- `matchTransfers(txs, windowDays = 3)`: returns the set of transaction ids that belong to a matched transfer pair.

**`summaries.ts`** (all exclude `Transfer`)
- `monthlySpendingByCategory(txs, categoryOf)`: `{ 'YYYY-MM': { category: amount } }`, spending only, as positive numbers.
- `monthlyIncomeVsSpending(txs, categoryOf)`: `{ 'YYYY-MM': { income, spending } }`.
- `averageWeeklySpend(txs, categoryOf)`: total spending divided by the number of weeks in the data's date range (minimum one week).
- `topCounterparties(txs, n)`: top `n` counterparties by spend.

**`db.ts`**
- `importTransactions(txs)`: inserts only unseen ids, creates any new accounts, and returns `{ added, duplicates, accountIds }`.
- `defaultAccountName(id)`: `Account …<last 4 characters>`.

**`useData.ts`**
- `useData()`: live-queries all tables, seeds the starter rules on first run, computes transfer matches, and returns `txs`, `loading`, `ctx`, `categoryOf`, `categories`, `accounts`, `accountName` and `transferCount`.

---

## Testing

Tests are written with Vitest in `src/test/lib.test.tsx` and use small anonymized CSV fixtures. They cover amount parsing, CSV parsing, normalization, id stability, and multi-account transfer matching.

**The tests do not run as-is.** Two fixes are needed:

1. The imports at the top of the file point to the wrong place. `./parseSwedbank`, `./normalize`, `./categorize` and `./transfers` should be `../lib/...`, and `@/lib/sum` should be `../lib/summaries` (and the function is `monthlyIncomeVsSpending`).
2. Add a script to `package.json`: `"test": "vitest run"`.

Keep real data out of fixtures. `.csv` files should never be committed, and fixtures should use made-up numbers and names.

---

## Known limitations

- **Card purchases may not be recognized as `card`.** `detectKind` looks for a "Kortköp" or "K*" prefix. In the exports seen so far, card purchases appear as just the merchant name (for example `MaxBurgers`), so they get kind `other`. Two consequences: they are still categorized by rules as normal, but they also count as candidates in transfer matching, so a card purchase could in theory be paired with an equal incoming amount in another account within 3 days.
- **Rule priority is alphabetical by `id`, not file order.** Dexie returns table rows in primary-key order, so when several rules match, the one whose `id` sorts first wins. For example, a "Swish Västtrafik To Go" payment matches both `swish` and `transport`, and `swish` wins because "s" sorts before "t".
- **No UI for labels or rules.** Only per-transaction overrides can be edited in the app. Rules come from `DEFAULT_RULES` and `rules.json`; the `labels` table is supported by the categorizer but nothing writes to it yet.
- **Overview has no date or account filter.** It always covers everything imported.
- **Top merchants uses the raw counterparty**, so phone numbers are shown as numbers even if you later add labels.
- **Duplicate ids in a single file.** `importTransactions` checks against stored data, not within the incoming batch, so two rows that hash identically in one file (same account, date, description, amount and balance) would make the insert fail.
- **Short rule patterns over-match** (see the note under Rules).
- `vitest` is listed under `dependencies`; it belongs in `devDependencies`.

## Ideas for next steps

- A rules and contacts screen (with a rule order or priority field)
- Month and account filters on the Overview
- Recognize `Swish <merchant>` payments (for example Västtrafik, Telia) separately from person-to-person Swish
- Recurring-purchase detection and a "money out right after money in" view





# Authors
- <a href="https://erikpersson0884.github.io/portfolio">Erik Persson</a> 🐦






<!-- Repo info Shields -->
[last-commit-shield]: https://img.shields.io/github/last-commit/erikpersson0884/bank-koll/main?style=for-the-badge&cacheSeconds=30
[last-commit-url]: https://github.com/erikpersson0884/bank-koll/commits/main

[repo-size-shield]: https://img.shields.io/github/repo-size/erikpersson0884/bank-koll?style=for-the-badge&cacheSeconds=60
[repo-size-url]: https://github.com/erikpersson0884/bank-koll

[author-shield]: https://img.shields.io/badge/Author-Erik%20Persson-blue?style=for-the-badge
[author-url]: https://github.com/erikpersson0884

[build-shield]: https://img.shields.io/github/actions/workflow/status/erikpersson0884/bank-koll/frontend-tests.yml?branch=main&style=for-the-badge
[build-url]: https://github.com/erikpersson0884/bank-koll/actions


<!-- Frameworks & Languages Shields -->
[vite-shield]: https://img.shields.io/badge/Vite-646CFF?logo=Vite&logoColor=white&style=for-the-badge
[react-shield]: https://img.shields.io/badge/React-61DAFB?logo=react&logoColor=white&style=for-the-badge
[vitest-shield]: https://img.shields.io/badge/Vitest-3E7CFF?logo=vitest&logoColor=white&style=for-the-badge
[docker-shield]: https://img.shields.io/badge/Docker-2496ED?logo=docker&logoColor=white&style=for-the-badge
[typescript-shield]: https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white&style=for-the-badge


<!-- Test Coverage Shields -->
[coverage-shield]: https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/erikpersson0884/bank-koll/coverage/.github/coverage.json&style=for-the-badge&v=2
[coverage-url]: https://github.com/erikpersson0884/bank-koll/actions