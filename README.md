# nyaagrab

NyaaGrab is a desktop-first Nyaa episode range searcher built as a TypeScript monorepo with React, Vite, and Tauri 2.

It is meant for the simple but annoying use case of catching up on long-running anime without searching Nyaa episode by episode by hand.

## What it does

- Search Nyaa RSS by anime title and episode range
- Parse release titles into episode / group / resolution / codec metadata
- Rank releases and pick one best result per episode
- Prefer smaller files when requested
- Separate found episodes, missing episodes, and request/search failures
- Show alternate releases under each main pick
- Export magnets, copy magnets, or open individual magnets from the desktop app

## Current stack

- `apps/desktop`: React + Vite + Tauri desktop app
- `packages/contracts`: shared `zod` schemas and TS contracts
- `packages/core`: pure search / parsing / ranking / orchestration logic
- `packages/test-fixtures`: reusable fixture generators for tests

## Requirements

- Node.js 20+
- `pnpm` 10+
- Rust toolchain via `rustup`
- Windows desktop builds: Visual Studio Build Tools 2022 with MSVC
- Windows desktop runtime: WebView2

## Install

```bash
pnpm install
```

## Run

Frontend only:

```bash
pnpm dev
```

Actual desktop app:

```bash
pnpm desktop:dev
```

## Build

Desktop build:

```bash
pnpm desktop:build
```

Workspace build:

```bash
pnpm build
```

## Check and test

```bash
pnpm check
pnpm test
```

## Notes

- The desktop app uses Tauri, so on Windows the UI is rendered through WebView2.
- The Windows bundle is configured to bootstrap WebView2 instead of assuming it is already present.
- NyaaGrab is local-first. There is no hosted backend.
