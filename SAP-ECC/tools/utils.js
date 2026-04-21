/**
 * Utility tools
 * General purpose MCP tools for SAP connectivity checks.
 */

/**
 * Registers utility tools on the MCP server.
 * @param {McpServer} server
 */
export function registerUtilTools(server) {

    server.registerTool(
        "ping_sap",
        {
            description: "Verifies connectivity with the SAP ECC system",
            inputSchema: {}
        },
        async () => ({
            content: [{ type: "text", text: "SAP MCP server is up and ready to connect to SAP ECC." }]
        })
    );
}