/**
 * Class tools (SE24)
 * MCP tools for reading, creating and writing ABAP classes and their internal includes.
 * 
 * Class internal includes:
 *   - definitions     → local class definitions (CLASS-RELEVANT LOCAL TYPES tab in SE24)
 *   - implementations → local class implementations (LOCAL TYPES tab in SE24)
 *   - macros          → macro definitions
 *   - testclasses     → ABAP Unit test classes
 */

import { z } from "zod";
import { sapClient, SAP_CLIENT, SAP_USER, fetchCsrfToken, fetchEtag, formatError } from "../sap-client.js";

const CLASSES_BASE = "/sap/bc/adt/oo/classes";

/**
 * Registers all class-related tools on the MCP server.
 * @param {McpServer} server
 */
export function registerClassTools(server) {

    // ─── READ CLASS ──────────────────────────────────────────────────────────────
    server.registerTool(
        "leer_clase",
        {
            description: "Reads the full source code of an ABAP class from SE24 (DEFINITION + IMPLEMENTATION)",
            inputSchema: {
                nombre_clase: z.string().describe("Class name, e.g. ZCL_MI_CLASE")
            }
        },
        async ({ nombre_clase }) => {
            try {
                const res = await sapClient.get(
                    `${CLASSES_BASE}/${nombre_clase.toUpperCase()}/source/main`,
                    { headers: { "Accept": "text/plain", "sap-client": SAP_CLIENT } }
                );
                return { content: [{ type: "text", text: res.data }] };
            } catch (err) {
                return { content: [{ type: "text", text: formatError(err) }] };
            }
        }
    );

    // ─── READ CLASS INCLUDE ──────────────────────────────────────────────────────
    server.registerTool(
        "leer_include_clase",
        {
            description: "Reads an internal include of an ABAP class. Use tipo_include: definitions, implementations, macros or testclasses",
            inputSchema: {
                nombre_clase: z.string().describe("Class name, e.g. ZCL_MI_CLASE"),
                tipo_include: z.string().describe("Include type: definitions | implementations | macros | testclasses")
            }
        },
        async ({ nombre_clase, tipo_include }) => {
            try {
                const res = await sapClient.get(
                    `${CLASSES_BASE}/${nombre_clase.toUpperCase()}/includes/${tipo_include.toLowerCase()}`,
                    { headers: { "Accept": "text/plain", "sap-client": SAP_CLIENT } }
                );
                return { content: [{ type: "text", text: res.data }] };
            } catch (err) {
                return { content: [{ type: "text", text: formatError(err) }] };
            }
        }
    );

    // ─── CREATE CLASS ────────────────────────────────────────────────────────────
    server.registerTool(
        "crear_clase",
        {
            description: "Creates a new ABAP class in SE24. Use escribir_clase afterwards to set the source code.",
            inputSchema: {
                nombre_clase: z.string().describe("Class name, e.g. ZCL_MI_CLASE"),
                descripcion: z.string().describe("Short description of the class"),
                paquete: z.string().describe("SAP package, use $TMP for local development"),
                transporte: z.string().optional().describe("Transport request number, e.g. DESK927423. Required when package is not $TMP")
            }
        },
        async ({ nombre_clase, descripcion, paquete }) => {
            try {
                const nombre = nombre_clase.toUpperCase();
                const { csrfToken, cookieHeader } = await fetchCsrfToken();

                const xml = `<?xml version="1.0" encoding="utf-8"?>
<class:abapClass xmlns:class="http://www.sap.com/adt/oo/classes"
  xmlns:adtcore="http://www.sap.com/adt/core"
  xmlns:abapsource="http://www.sap.com/adt/abapsource"
  adtcore:name="${nombre}"
  adtcore:description="${descripcion}"
  adtcore:responsible="${SAP_USER.toUpperCase()}"
  class:final="true"
  class:visibility="public"
  class:category="generalObjectType"
  abapsource:fixPointArithmetic="true">
  <adtcore:packageRef adtcore:name="${paquete.toUpperCase()}"/>
</class:abapClass>`;

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

                await sapClient.post(CLASSES_BASE, xml, { headers });

                return {
                    content: [{
                        type: "text",
                        text: `Class ${nombre} created in package ${paquete.toUpperCase()}. Use escribir_clase to add source code.`
                    }]
                };
            } catch (err) {
                console.error("ERROR crear_clase:", formatError(err));
                return { content: [{ type: "text", text: formatError(err) }] };
            }
        }
    );

    // ─── WRITE CLASS ─────────────────────────────────────────────────────────────
    server.registerTool(
        "escribir_clase",
        {
            description: "Writes or updates the global source code of an ABAP class in SE24 (DEFINITION + IMPLEMENTATION)",
            inputSchema: {
                nombre_clase: z.string().describe("Class name, e.g. ZCL_MI_CLASE"),
                codigo_fuente: z.string().describe("Full ABAP class source code (DEFINITION + IMPLEMENTATION)")
            }
        },
        async ({ nombre_clase, codigo_fuente }) => {
            try {
                const nombre = nombre_clase.toUpperCase();
                const sourcePath = `${CLASSES_BASE}/${nombre}/source/main`;

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
                        text: `Class ${nombre} saved successfully. Remember to activate it in SE24.`
                    }]
                };
            } catch (err) {
                console.error("ERROR escribir_clase:", formatError(err));
                return { content: [{ type: "text", text: formatError(err) }] };
            }
        }
    );

    // ─── WRITE CLASS INCLUDE ─────────────────────────────────────────────────────
    server.registerTool(
        "escribir_include_clase",
        {
            description: "Writes an internal include of an ABAP class. Use tipo_include: definitions, implementations, macros or testclasses",
            inputSchema: {
                nombre_clase: z.string().describe("Class name, e.g. ZCL_MI_CLASE"),
                tipo_include: z.string().describe("Include type: definitions | implementations | macros | testclasses"),
                codigo_fuente: z.string().describe("Source code to write in the include")
            }
        },
        async ({ nombre_clase, tipo_include, codigo_fuente }) => {
            try {
                const nombre = nombre_clase.toUpperCase();
                const tipo = tipo_include.toLowerCase();
                const sourcePath = `${CLASSES_BASE}/${nombre}/includes/${tipo}`;

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
                        text: `Include '${tipo}' of class ${nombre} saved successfully.`
                    }]
                };
            } catch (err) {
                console.error("ERROR escribir_include_clase:", formatError(err));
                return { content: [{ type: "text", text: formatError(err) }] };
            }
        }
    );
}