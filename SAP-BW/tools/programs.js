/**
 * Program tools (SE38)
 * MCP tools for reading, creating and writing ABAP programs.
 */

import { z } from "zod";
import { sapClient, SAP_CLIENT, SAP_USER, fetchCsrfToken, fetchEtag, formatError } from "../sap-client.js";

const PROGRAMS_BASE = "/sap/bc/adt/programs/programs";
const INCLUDES_BASE = "/sap/bc/adt/programs/includes";

/**
 * Registers all program-related tools on the MCP server.
 * @param {McpServer} server
 */
export function registerProgramTools(server) {

    // ─── READ PROGRAM ───────────────────────────────────────────────────────────
    server.registerTool(
        "leer_programa",
        {
            description: "Reads the source code of an ABAP program from SE38",
            inputSchema: {
                nombre_programa: z.string().describe("Program name, e.g. ZVENTAS")
            }
        },
        async ({ nombre_programa }) => {
            try {
                const res = await sapClient.get(
                    `${PROGRAMS_BASE}/${nombre_programa.toUpperCase()}/source/main`
                );
                return { content: [{ type: "text", text: res.data }] };
            } catch (err) {
                return { content: [{ type: "text", text: formatError(err) }] };
            }
        }
    );

    // ─── READ INCLUDE ────────────────────────────────────────────────────────────
    server.registerTool(
        "leer_include",
        {
            description: "Reads the source code of an ABAP program include",
            inputSchema: {
                nombre_include: z.string().describe("Include name, e.g. ZBDS_WM070_TOP")
            }
        },
        async ({ nombre_include }) => {
            try {
                const res = await sapClient.get(
                    `${INCLUDES_BASE}/${nombre_include.toUpperCase()}/source/main`
                );
                return { content: [{ type: "text", text: res.data }] };
            } catch (err) {
                return { content: [{ type: "text", text: formatError(err) }] };
            }
        }
    );

    // ─── CREATE PROGRAM ──────────────────────────────────────────────────────────
    server.registerTool(
        "crear_programa",
        {
            description: "Creates a new ABAP program in SE38. Use escribir_programa afterwards to set the source code.",
            inputSchema: {
                nombre_programa: z.string().describe("Program name, e.g. ZTEST_MCP"),
                descripcion: z.string().describe("Short description of the program"),
                paquete: z.string().describe("SAP package, use $TMP for local development"),
                transporte: z.string().optional().describe("Transport request number, e.g. DESK927423. Required when package is not $TMP")
            }
        },
        async ({ nombre_programa, descripcion, paquete }) => {
            try {
                const nombre = nombre_programa.toUpperCase();
                const { csrfToken, cookieHeader } = await fetchCsrfToken();

                const xml = `<?xml version="1.0" encoding="utf-8"?>
<program:abapProgram xmlns:program="http://www.sap.com/adt/programs/programs"
  xmlns:adtcore="http://www.sap.com/adt/core"
  adtcore:description="${descripcion}"
  adtcore:name="${nombre}"
  adtcore:responsible="${SAP_USER.toUpperCase()}"
  program:programType="executableProgram">
  <adtcore:packageRef adtcore:name="${paquete.toUpperCase()}"/>
</program:abapProgram>`;

                const headers = {
                    "Content-Type": "application/vnd.sap.adt.programs.programs.v2+xml",
                    "X-CSRF-Token": csrfToken,
                    "Accept": "application/xml",
                    "sap-client": SAP_CLIENT,
                    "Cookie": cookieHeader
                };

                if (transporte) {
                    headers["X-Sap-Adt-Profiling-Transport-Request"] = transporte;
                }
                await sapClient.post(PROGRAMS_BASE, xml, { headers });

                return {
                    content: [{
                        type: "text",
                        text: `Program ${nombre} created in package ${paquete.toUpperCase()}. Use escribir_programa to add source code.`
                    }]
                };
            } catch (err) {
                console.error("ERROR crear_programa:", formatError(err));
                return { content: [{ type: "text", text: formatError(err) }] };
            }
        }
    );

    // ─── WRITE PROGRAM ───────────────────────────────────────────────────────────
    server.registerTool(
        "escribir_programa",
        {
            description: "Writes or updates the source code of an existing ABAP program in SE38",
            inputSchema: {
                nombre_programa: z.string().describe("Program name, e.g. ZTEST_MCP"),
                codigo_fuente: z.string().describe("Full ABAP source code to write")
            }
        },
        async ({ nombre_programa, codigo_fuente }) => {
            try {
                const nombre = nombre_programa.toUpperCase();
                const sourcePath = `${PROGRAMS_BASE}/${nombre}/source/main`;

                const { csrfToken, cookieHeader } = await fetchCsrfToken();
                const etag = await fetchEtag(sourcePath, cookieHeader);

                await sapClient.put(sourcePath, codigo_fuente, {
                    headers: {
                        "Content-Type": "text/plain; charset=utf-8",
                        "X-CSRF-Token": csrfToken,
                        "Accept": "application/xml",
                        "sap-client": SAP_CLIENT,
                        "If-Match": etag || "*",
                        "Cookie": cookieHeader
                    }
                });

                return {
                    content: [{
                        type: "text",
                        text: `Program ${nombre} saved successfully. Remember to activate it in SE38.`
                    }]
                };
            } catch (err) {
                console.error("ERROR escribir_programa:", formatError(err));
                return { content: [{ type: "text", text: formatError(err) }] };
            }
        }
    );
}