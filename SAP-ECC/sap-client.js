/**
 * SAP HTTP Client
 * Configures axios instance with SAP ECC credentials and provides
 * helper functions for CSRF token fetching and cookie management.
 */

import axios from "axios";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, ".env") });

export const SAP_URL      = process.env.SAP_URL;
export const SAP_CLIENT   = process.env.SAP_CLIENT;
export const SAP_USER     = process.env.SAP_USER;
export const SAP_PASSWORD = process.env.SAP_PASSWORD;

/** Axios instance pre-configured with SAP credentials */
export const sapClient = axios.create({
    baseURL: SAP_URL,
    auth: { username: SAP_USER, password: SAP_PASSWORD },
    headers: {
        "sap-client": SAP_CLIENT,
        "Accept": "text/plain"
    }
});

/**
 * Fetches a CSRF token and session cookies from SAP ADT discovery endpoint.
 * SAP requires this handshake before any write operation (POST/PUT).
 * @returns {{ csrfToken: string, cookieHeader: string }}
 */
export async function fetchCsrfToken() {
    const response = await sapClient.get("/sap/bc/adt/discovery", {
        headers: {
            "X-CSRF-Token": "Fetch",
            "Accept": "application/xml",
            "sap-client": SAP_CLIENT
        }
    });

    const csrfToken   = response.headers["x-csrf-token"];
    const cookies     = response.headers["set-cookie"];
    const cookieHeader = cookies ? cookies.join("; ") : "";

    return { csrfToken, cookieHeader };
}

/**
 * Fetches the ETag of a given SAP ADT resource.
 * ETag is required in the If-Match header for PUT operations.
 * @param {string} resourcePath - ADT resource path, e.g. /sap/bc/adt/programs/programs/ZTEST/source/main
 * @param {string} cookieHeader - Session cookies from fetchCsrfToken
 * @returns {string} ETag value
 */
export async function fetchEtag(resourcePath, cookieHeader = "") {
    const response = await sapClient.get(resourcePath, {
        headers: {
            "Accept": "text/plain",
            "sap-client": SAP_CLIENT,
            "Cookie": cookieHeader
        }
    });
    return response.headers["etag"];
}

/**
 * Formats an axios error into a readable string for MCP tool responses.
 * @param {Error} error
 * @returns {string}
 */
export function formatError(error) {
    if (error.response) {
        return [
            `Status: ${error.response.status}`,
            `StatusText: ${error.response.statusText}`,
            `Body: ${JSON.stringify(error.response.data)}`
        ].join("\n");
    }
    return `Connection error: ${error.message}`;
}