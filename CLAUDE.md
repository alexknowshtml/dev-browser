# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build and Development Commands

This is a Bun monorepo. Always use Bun instead of Node.js/npm/pnpm.

```bash
# Install dependencies
bun install

# Start the dev-browser server (from dev-browser/ directory)
cd dev-browser && bun run start-server

# Build the dev-browser package
cd packages/dev-browser && bun run build

# Run dev mode with watch
cd packages/dev-browser && bun run dev

# Run tests (uses vitest)
cd packages/dev-browser && bun run test

# Run TypeScript check
cd packages/dev-browser && bun x tsc --noEmit
```

## Important: Before Completing Code Changes

**Always run these checks before considering a task complete:**

1. **TypeScript check**: `bun x tsc --noEmit` - Ensure no type errors
2. **Tests**: `bun run test` - Ensure all tests pass

Common TypeScript issues in this codebase:

- Use `import type { ... }` for type-only imports (required by `verbatimModuleSyntax`)
- Browser globals (`document`, `window`) in `page.evaluate()` callbacks need `declare const document: any;` since DOM lib is not included

## Project Architecture

### Overview

This is a browser automation tool designed for developers and AI agents. It solves the problem of maintaining browser state across multiple script executions - unlike Playwright scripts that start fresh each time, dev-browser keeps pages alive and reusable.

### Package Structure

- **`packages/dev-browser/`** - Core library with server and client
  - `src/index.ts` - Server: launches persistent Chromium context, exposes HTTP API for page management
  - `src/client.ts` - Client: connects to server, retrieves pages by name via CDP
  - `src/types.ts` - Shared TypeScript types for API requests/responses

- **`dev-browser/`** - Claude Code skill that uses the library
  - `scripts/start-server.ts` - Entry point to start the server
  - `tmp/` - Directory for temporary automation scripts

### How It Works

1. **Server** (`serve()` in `packages/dev-browser/src/index.ts`):
   - Launches Chromium with `launchPersistentContext` (preserves cookies, localStorage)
   - Exposes HTTP API on port 9222 for page management
   - Exposes CDP WebSocket endpoint on port 9223
   - Pages are registered by name and persist until explicitly closed

2. **Client** (`connect()` in `packages/dev-browser/src/client.ts`):
   - Connects to server's HTTP API
   - Uses CDP `targetId` to reliably find pages across reconnections
   - Returns standard Playwright `Page` objects for automation

3. **Key API Endpoints**:
   - `GET /` - Returns CDP WebSocket endpoint
   - `GET /pages` - Lists all named pages
   - `POST /pages` - Gets or creates a page by name (body: `{ name: string }`)
   - `DELETE /pages/:name` - Closes a page

### Usage Pattern

```typescript
import { connect } from "dev-browser/client";

const client = await connect("http://localhost:9222");
const page = await client.page("my-page"); // Gets existing or creates new
await page.goto("https://example.com");
// Page persists for future scripts
await client.disconnect(); // Disconnects CDP but page stays alive on server
```

## Bun-Specific Guidelines

- Use `bun x tsx` for running TypeScript files
- Use `bun x tsup` for building
- Bun auto-loads `.env` files (no dotenv needed)
- Prefer `Bun.file` over `node:fs` where possible
