/**
 * Transport tools (CTS)
 * MCP tools for managing SAP transport requests.
 */

import { z } from "zod";
import { sapClient, SAP_CLIENT, formatError } from "../sap-client.js";

const CTS_BASE = "/sap/bc/adt/cts/transportrequests";
const ATC_WORKLISTS = "/sap/bc/adt/atc/worklists";


/**
 * Registers transport-related tools on the MCP server.
 * @param {McpServer} server
 */
export function registerTransportTools(server) {

    // ─── LIBERAR ORDEN ───────────────────────────────────────────────────────────
    server.registerTool(
        "liberar_orden",
        {
            description: "Libera una orden de transporte en SAP ECC (equivalente a liberar desde SE09/SE10 o Eclipse ADT). El flujo replica exactamente lo que hace Eclipse ADT: obtiene CSRF token, crea una worklist ATC y luego ejecuta el releasejob.",
            inputSchema: {
                numero_orden: z.string().describe("Número de la orden de transporte a liberar, e.g. DESK936735")
            }
        },
        async ({ numero_orden }) => {
            const orden = numero_orden.toUpperCase().trim();
            try {
                // 1. GET CSRF token
                console.error(`[DEBUG] liberar_orden: obteniendo CSRF token para ${orden}...`);
                const csrfRes = await sapClient.get("/sap/bc/adt/discovery", {
                    headers: {
                        "X-CSRF-Token": "Fetch",
                        "Accept": "application/xml",
                        "sap-client": SAP_CLIENT
                    }
                });
                console.error(`[DEBUG] [1/3] GET /sap/bc/adt/discovery → HTTP ${csrfRes.status}`);
                if (csrfRes.status !== 200) throw new Error(`CSRF fetch falló con HTTP ${csrfRes.status}`);
                const csrfToken = csrfRes.headers["x-csrf-token"];
                const cookies = csrfRes.headers["set-cookie"];
                const cookieHeader = cookies ? cookies.join("; ") : "";

                // 2. POST ATC worklist
                console.error("[DEBUG] liberar_orden: creando worklist ATC...");
                const atcRes = await sapClient.post(ATC_WORKLISTS, "", {
                    params: { checkVariant: "DEFAULT" },
                    headers: {
                        "Accept": "text/plain",
                        "X-CSRF-Token": csrfToken,
                        "sap-client": SAP_CLIENT,
                        "Cookie": cookieHeader
                    }
                });
                console.error(`[DEBUG] [2/3] POST ${ATC_WORKLISTS} → HTTP ${atcRes.status}`);
                if (atcRes.status !== 200) throw new Error(`ATC worklist creation falló con HTTP ${atcRes.status}`);
                const worklistId = atcRes.data?.trim();
                if (!worklistId) throw new Error("No se recibió worklistId del ATC");
                console.error(`[DEBUG] WorklistId: ${worklistId}`);

                // 3. POST releasejob
                console.error(`[DEBUG] liberar_orden: ejecutando releasejob para ${orden}...`);
                const res = await sapClient.post(
                    `${CTS_BASE}/${orden}/releasejobs`,
                    "",
                    {
                        params: { worklistId },
                        headers: {
                            "Accept": "application/vnd.sap.adt.transportorganizer.v1+xml",
                            "X-CSRF-Token": csrfToken,
                            "sap-client": SAP_CLIENT,
                            "Cookie": cookieHeader
                        }
                    }
                );
                console.error(`[DEBUG] [3/3] POST ${CTS_BASE}/${orden}/releasejobs → HTTP ${res.status}`);
                if (res.status !== 200) throw new Error(`Releasejob falló con HTTP ${res.status}`);

                const responseXml = res.data || "";
                console.error(`[DEBUG] Respuesta releasejob: ${responseXml}`);

                return {
                    content: [{
                        type: "text",
                        text: `Orden ${orden} liberada exitosamente.\nWorklistId ATC: ${worklistId}\nRespuesta SAP:\n${responseXml}`
                    }]
                };

            } catch (err) {
                console.error("ERROR liberar_orden:", formatError(err));
                return { content: [{ type: "text", text: formatError(err) }] };
            }
        }
    );
}
