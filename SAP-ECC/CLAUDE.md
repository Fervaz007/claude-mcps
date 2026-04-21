# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

An MCP (Model Context Protocol) server that connects Claude Code to SAP ECC via the SAP ADT REST API. It exposes tools for reading, creating, and writing ABAP programs (SE38) and classes (SE24) directly from Claude Code using stdio transport.

## Running the Server

```bash
node index.js
```

The server is configured as an MCP stdio server — it's meant to be launched by Claude Code, not run standalone in a browser. No build step required.

## Environment

Requires a `.env` file with: `SAP_URL`, `SAP_CLIENT`, `SAP_USER`, `SAP_PASSWORD`. This is an ES modules project (`"type": "module"` in package.json).

## Architecture

- **`index.js`** — Entry point. Creates the `McpServer`, registers tool modules, starts stdio transport.
- **`sap-client.js`** — Shared axios instance with SAP credentials, plus helpers: `fetchCsrfToken()` (required before any write), `fetchEtag()` (required for PUT operations), `formatError()`.
- **`tools/`** — Each file exports a `register*Tools(server)` function:
  - `utils.js` — `ping_sap`
  - `programs.js` — `leer_programa`, `leer_include`, `crear_programa`, `escribir_programa`, `listar_transportes`. Includes lock/unlock and transport request creation for write operations.
  - `classes.js` — `leer_clase`, `leer_include_clase`, `crear_clase`, `escribir_clase`, `escribir_include_clase`. Class writes use ETag-based concurrency but don't implement lock/unlock (unlike programs).

## SAP ADT Write Flow

Write operations follow this pattern (see `programs.js` for the full version):
1. `fetchCsrfToken()` — GET `/sap/bc/adt/discovery` with `X-CSRF-Token: Fetch`
2. Lock the object (`_action=LOCK`) — returns a lock handle
3. Optionally create a transport request (for non-`$TMP` packages)
4. `fetchEtag()` on the source path
5. PUT with CSRF token, ETag, lock handle, and optionally `X-sap-cts-request` header
6. Unlock the object (`_action=UNLOCK`)

Class writes (`classes.js`) currently skip steps 2, 3, and 6 — they only use CSRF + ETag.

## Tool Naming Convention

Tool names and parameters use Spanish: `leer` (read), `escribir` (write), `crear` (create), `nombre_programa`, `codigo_fuente`, `paquete`, `transporte_descripcion`, etc.

## Standalone Script

`upload_includes.mjs` is a one-off script (not part of the MCP server) for bulk-uploading modified includes to SAP. It duplicates the SAP client setup rather than importing from `sap-client.js`.
