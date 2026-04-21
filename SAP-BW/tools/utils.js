/**
 * Utility tools
 * General purpose MCP tools for SAP connectivity checks.
 */

/**
 * Registers utility tools on the MCP server.
 * @param {McpServer} server
 */

import { sapClient, SAP_CLIENT, formatError } from "../sap-client.js";

export function registerUtilTools(server) {

    server.registerTool(
        "ping_sap-bw",
        {
            description: "Verifies connectivity with the SAP BW system",
            inputSchema: {}
        },
        async () => ({
            content: [{ type: "text", text: "SAP MCP server is up and ready to connect to SAP BW." }]
        })
    );

    server.registerTool(
        "listar_transportes",
        {
            description: "Lists all open transport requests for the current user in SAP",
            inputSchema: {}
        },
        async () => {
            try {
                const res = await sapClient.get(
                    `/sap/bc/adt/cts/transportrequests?targets=`,
                    { headers: { "Accept": "application/xml", "sap-client": SAP_CLIENT } }
                );

                const xml = res.data;
                const transportes = [];

                const requestRegex = /tm:request tm:number="([^"]+)"[^>]*tm:owner="([^"]+)"[^>]*tm:desc="([^"]+)"[^>]*tm:status="D"/g;
                let match;
                while ((match = requestRegex.exec(xml)) !== null) {
                    transportes.push(`${match[1]} | Owner: ${match[2]} | ${match[3]}`);
                }

                if (transportes.length === 0) {
                    return { content: [{ type: "text", text: "No open transport requests found." }] };
                }

                return {
                    content: [{ type: "text", text: `Open transport requests:\n\n${transportes.join("\n")}` }]
                };
            } catch (err) {
                return { content: [{ type: "text", text: formatError(err) }] };
            }
        }
    );
}