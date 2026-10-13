# Wash+ Washer Queue Prototype

Wash+ is a mobile-first laundry queue prototype for university housing. It simulates washer and dryer reservations, claim windows, linked wash-and-dry loads, reminders, removal grace periods, and fairness rules.

The app runs entirely in the browser. It does not require a backend, database, API keys, or environment variables. User accounts, payments, machine events, notifications, and AI reminders are simulated for demonstration purposes.

## Requirements

- Node.js 20 or newer
- npm (included with Node.js)
- A modern web browser

This is a Node.js project, so its dependency requirements are declared in `package.json` and locked to reproducible versions in `package-lock.json`. A Python `requirements.txt` file is not needed.

## Install and run locally

Clone the repository and enter its directory:

```bash
git clone https://github.com/Lexi-cod/washer-queue-prototype.git
cd washer-queue-prototype
```

Install the exact dependency versions from the lockfile:

```bash
npm ci
```

Start the development server:

```bash
npm run dev
```

Open the local URL printed by Vite, usually `http://localhost:5173`.

## Create and preview a production build

```bash
npm run build
npm run preview
```

The optimized production files are written to `dist/`. Open the preview URL printed by Vite to verify the build.

## Use the prototype

1. Select a resident from the switcher on the Home screen.
2. Choose Wash Only, Dry Only, or Wash + Dry.
3. Join an available machine queue.
4. When the resident reaches the front, claim the machine and enter their PIN.
5. Use the Demo screen to advance timers or load preset scenarios.
6. Use Reset App in Settings to clear the saved demo state.

Demo residents:

| Resident | Unit | PIN |
| --- | ---: | ---: |
| Maya Chen | 08 | 2468 |
| Jordan Lee | 14 | 1357 |
| Alex Rivera | 21 | 4826 |
| Priya Shah | 05 | 9071 |

Presentation Demo Mode is enabled by default. It uses shortened claim windows, machine cycles, reminders, and removal-grace timers so the complete workflow can be demonstrated quickly.

## Data and integrations

The current prototype stores its state in the browser under the `wash-plus-state-v1` local-storage key. Clearing browser storage or selecting Reset App removes that state. No information is sent to an external service.

## Main project files

- `src/App.tsx` - React interface and browser persistence
- `src/engine.ts` - queue and machine-state rules
- `src/styles.css` - responsive mobile-first styling
- `package.json` - commands and dependency requirements
- `package-lock.json` - exact dependency versions

## Available commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the local development server |
| `npm run build` | Type-check and create a production build |
| `npm run preview` | Preview the production build locally |
