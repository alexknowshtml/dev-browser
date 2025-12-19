#!/bin/bash
cd "$(dirname "$0")"
exec bun run scripts/start-server.ts
