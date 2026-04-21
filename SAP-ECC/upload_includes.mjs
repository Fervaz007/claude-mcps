/**
 * Direct SAP ADT API script to upload modified ZBDS_WM041 includes.
 */

import axios from "axios";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { readFileSync } from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

dotenv.config({ path: join(__dirname, ".env") });

const SAP_URL      = process.env.SAP_URL;
const SAP_CLIENT   = process.env.SAP_CLIENT;
const SAP_USER     = process.env.SAP_USER;
const SAP_PASSWORD = process.env.SAP_PASSWORD;

const INCLUDES_BASE = "/sap/bc/adt/programs/includes";

const sapClient = axios.create({
    baseURL: SAP_URL,
    auth: { username: SAP_USER, password: SAP_PASSWORD },
    headers: { "sap-client": SAP_CLIENT, "Accept": "text/plain" }
});

async function fetchCsrfToken() {
    const res = await sapClient.get("/sap/bc/adt/discovery", {
        headers: { "X-CSRF-Token": "Fetch", "Accept": "application/xml", "sap-client": SAP_CLIENT }
    });
    const csrfToken    = res.headers["x-csrf-token"];
    const cookies      = res.headers["set-cookie"];
    const cookieHeader = cookies ? cookies.join("; ") : "";
    return { csrfToken, cookieHeader };
}

async function fetchEtag(resourcePath, cookieHeader) {
    const res = await sapClient.get(resourcePath, {
        headers: { "sap-client": SAP_CLIENT, "Cookie": cookieHeader }
    });
    return res.headers["etag"] || "*";
}

async function writeInclude(includeName, sourceCode, csrfToken, cookieHeader) {
    const sourcePath = `${INCLUDES_BASE}/${includeName.toUpperCase()}/source/main`;
    let etag = "*";
    try {
        etag = await fetchEtag(sourcePath, cookieHeader);
    } catch (e) {
        console.log(`  Could not fetch ETag for ${includeName}, using "*"`);
    }

    await sapClient.put(sourcePath, sourceCode, {
        headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "X-CSRF-Token": csrfToken,
            "Accept":       "application/xml",
            "sap-client":   SAP_CLIENT,
            "If-Match":     etag,
            "Cookie":       cookieHeader
        }
    });
    console.log(`  OK: ${includeName} saved successfully.`);
}

async function main() {
    const BASE = "C:/Users/briand.vazquez/Documents/sap-agents-abap";

    const topSource = readFileSync(`${BASE}/ZBDS_WM041_TOP_modified.abap`, "utf-8");
    const genSource = readFileSync(`${BASE}/ZBDS_WM041_GEN_modified.txt`, "utf-8");

    console.log(`TOP: ${topSource.length} chars`);
    console.log(`GEN: ${genSource.length} chars`);

    // --- Write TOP ---
    console.log("\nFetching CSRF token (1/2)...");
    const { csrfToken: csrf1, cookieHeader: cookie1 } = await fetchCsrfToken();
    console.log("Writing ZBDS_WM041_TOP...");
    await writeInclude("ZBDS_WM041_TOP", topSource, csrf1, cookie1);

    // --- Write GEN ---
    console.log("\nFetching CSRF token (2/2)...");
    const { csrfToken: csrf2, cookieHeader: cookie2 } = await fetchCsrfToken();
    console.log("Writing ZBDS_WM041_GEN...");
    await writeInclude("ZBDS_WM041_GEN", genSource, csrf2, cookie2);

    console.log("\nDone. Activate both includes in SE38.");
}

main().catch(err => {
    console.error("ERROR:", err.response?.data || err.message);
    process.exit(1);
});
