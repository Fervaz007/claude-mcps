/**
 * SAP MCP Server — Entry Point
 * 
 * Connects Claude Code to SAP ECC via the ADT REST API.
 * Tools are organized by domain and registered from separate modules.
 * 
 * Modules:
 *   - tools/utils.js    → ping_sap
 *   - tools/programs.js → leer_programa, leer_include, crear_programa, escribir_programa
 *   - tools/classes.js  → leer_clase, leer_include_clase, crear_clase, escribir_clase, escribir_include_clase
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { registerUtilTools }   from "./tools/utils.js";
import { registerProgramTools } from "./tools/programs.js";
import { registerClassTools }   from "./tools/classes.js";

const server = new McpServer({
    name: "sap-bw-mcp",
    version: "1.0.0"
});

// Register tools by domain
registerUtilTools(server);
registerProgramTools(server);
registerClassTools(server);

// Start MCP server using stdio transport (required for Claude Code)
const transport = new StdioServerTransport();
await server.connect(transport);