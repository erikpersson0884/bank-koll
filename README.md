# Bank overview (MVP)

## Setup
```
npm create vite@latest bank-overview -- --template react-ts
cd bank-overview
npm i papaparse dexie recharts
npm i -D vitest @types/papaparse
```
Copy `src/lib/*` and `.gitignore` from this folder into the project, add `"test": "vitest"` to package.json scripts, then `npm test`.