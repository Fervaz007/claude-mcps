/**
 * Program tools (SE38)
 * MCP tools for reading, creating and writing ABAP programs.
 */

import { z } from "zod";
import { sapClient, SAP_CLIENT, SAP_USER, fetchCsrfToken, fetchEtag, formatError } from "../sap-client.js";

const PROGRAMS_BASE = "/sap/bc/adt/programs/programs";
const INCLUDES_BASE = "/sap/bc/adt/programs/includes";
const CTS_BASE = "/sap/bc/adt/cts/transportrequests";

/**
 * Obtiene un lock sobre el programa para poder modificarlo
 */
async function lockProgram(programName, csrfToken, cookieHeader) {
    const res = await sapClient.post(
        `${PROGRAMS_BASE}/${programName}`,
        "",
        {
            params: {
                _action: "LOCK",
                accessMode: "MODIFY"
            },
            headers: {
                "X-CSRF-Token": csrfToken,
                "X-sap-adt-sessiontype": "stateful",
                "Accept": "application/vnd.sap.adt.lock.result.v1+xml",
                "sap-client": SAP_CLIENT,
                "Cookie": cookieHeader
            }
        }
    );
    
    // El lock handle viene en el header de respuesta
    const lockHandle = res.headers["x-sap-adt-lockhandle"];
    if (!lockHandle) {
        throw new Error("No se pudo obtener el lock del programa");
    }
    return lockHandle;
}

/**
 * Libera el lock del programa
 */
async function unlockProgram(programName, lockHandle, csrfToken, cookieHeader) {
    await sapClient.post(
        `${PROGRAMS_BASE}/${programName}`,
        "",
        {
            params: { _action: "UNLOCK" },
            headers: {
                "X-CSRF-Token": csrfToken,
                "X-sap-adt-lockhandle": lockHandle,
                "sap-client": SAP_CLIENT,
                "Cookie": cookieHeader
            }
        }
    );
}

/**
 * Crea una nueva orden de transporte y devuelve el número
 */
async function createTransport(description, csrfToken, cookieHeader) {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<tm:request xmlns:tm="http://www.sap.com/cts/adt/tm"
    tm:desc="${description}"
    tm:type="K"
    tm:target=""
    tm:cts_project="">
</tm:request>`;

    const res = await sapClient.post(CTS_BASE, xml, {
        headers: {
            "Content-Type": "application/vnd.sap.adt.transportrequests.v1+xml",
            "X-CSRF-Token": csrfToken,
            "Accept": "application/vnd.sap.adt.transportrequests.v1+xml",
            "sap-client": SAP_CLIENT,
            "Cookie": cookieHeader
        }
    });

    // El número de transporte viene en el header Location o en el body
    const location = res.headers["location"];
    if (location) {
        // Location: /sap/bc/adt/cts/transportrequests/DESK900123
        const match = location.match(/\/([^\/]+)$/);
        if (match) return match[1];
    }
    
    // Alternativa: buscar en el body XML
    const bodyMatch = res.data?.match(/tm:number="([^"]+)"/);
    if (bodyMatch) return bodyMatch[1];
    
    throw new Error("No se pudo obtener el número de transporte creado");
}

// ─── HELPERS INTERNOS ───────────────────────────────────────────────────────

function mergeCookies(currentCookies, response) {
    const setCookies = response.headers["set-cookie"];
    if (!setCookies) return currentCookies;
    const cookieMap = {};
    for (const c of currentCookies.split("; ").filter(Boolean)) {
        const name = c.split("=")[0];
        cookieMap[name] = c;
    }
    for (const raw of setCookies) {
        const c = raw.split(";")[0];
        const name = c.split("=")[0];
        cookieMap[name] = c;
    }
    return Object.values(cookieMap).join("; ");
}

async function adtLock(objectPath, csrfToken, cookies) {
    const res = await sapClient.post(objectPath, "", {
        params: { _action: "LOCK", accessMode: "MODIFY" },
        headers: {
            "X-CSRF-Token": csrfToken,
            "X-sap-adt-sessiontype": "stateful",
            "Accept": "application/vnd.sap.as+xml;charset=UTF-8;dataname=com.sap.adt.lock.result;q=0.8, application/vnd.sap.as+xml;charset=UTF-8;dataname=com.sap.adt.lock.result2;q=0.9",
            "sap-client": SAP_CLIENT,
            "Cookie": cookies
        }
    });
    const match = res.data.match(/<LOCK_HANDLE>([^<]+)<\/LOCK_HANDLE>/);
    if (!match) throw new Error("No se pudo obtener el LOCK_HANDLE del body XML");
    return { lockHandle: match[1], cookies: mergeCookies(cookies, res) };
}

async function adtUnlock(objectPath, lockHandle, csrfToken, cookies) {
    await sapClient.post(objectPath, "", {
        params: { _action: "UNLOCK", lockHandle },
        headers: {
            "X-CSRF-Token": csrfToken,
            "X-sap-adt-sessiontype": "stateful",
            "sap-client": SAP_CLIENT,
            "Cookie": cookies
        }
    });
}

async function adtCreateTransport(textoOrden, refPath, csrfToken, cookies) {
    const xml = `<?xml version="1.0" encoding="UTF-8" ?><asx:abap version="1.0" xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><OPERATION></OPERATION><DEVCLASS>ZBDS1</DEVCLASS><REQUEST_TEXT>${textoOrden}</REQUEST_TEXT><REF>${refPath}</REF></DATA></asx:values></asx:abap>`;
    const res = await sapClient.post("/sap/bc/adt/cts/transports", xml, {
        headers: {
            "Content-Type": "application/vnd.sap.as+xml; charset=UTF-8; dataname=com.sap.adt.CreateCorrectionRequest",
            "Accept": "application/vnd.sap.as+xml;charset=UTF-8;dataname=com.sap.adt.CorrectionRequestResult, text/plain",
            "X-CSRF-Token": csrfToken,
            "X-sap-adt-sessiontype": "stateful",
            "sap-client": SAP_CLIENT,
            "Cookie": cookies
        }
    });
    const match = res.data.match(/\/([^\/]+)$/);
    if (!match) throw new Error(`No se pudo extraer número de transporte de: ${res.data}`);
    return { transportNumber: match[1], cookies: mergeCookies(cookies, res) };
}

function applyEdiciones(source, ediciones) {
    let result = source;
    for (const { old_string, new_string } of ediciones) {
        const count = (result.split(old_string).length - 1);
        if (count === 0) throw new Error(`old_string no encontrado en el fuente:\n---\n${old_string}\n---`);
        if (count > 1) throw new Error(`old_string ambiguo (aparece ${count} veces), añade más contexto:\n---\n${old_string}\n---`);
        result = result.replace(old_string, new_string);
    }
    return result;
}

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
                descripcion:     z.string().describe("Short description of the program"),
                paquete:         z.string().describe("SAP package, use $TMP for local development")
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

                await sapClient.post(PROGRAMS_BASE, xml, {
                    headers: {
                        "Content-Type": "application/vnd.sap.adt.programs.programs.v2+xml",
                        "X-CSRF-Token": csrfToken,
                        "Accept":       "application/xml",
                        "sap-client":   SAP_CLIENT,
                        "Cookie":       cookieHeader
                    }
                });

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

    // ─── WRITE PROGRAM (ACTUALIZADO CON SOPORTE DE TRANSPORTE) ───────────────────
    server.registerTool(
        "escribir_programa",
        {
            description: "Writes or updates the source code of an existing ABAP program. For non-local packages, provide transporte_descripcion to create a new transport request.",
            inputSchema: {
                nombre_programa:        z.string().describe("Program name, e.g. ZTEST_MCP"),
                codigo_fuente:          z.string().describe("Full ABAP source code to write"),
                transporte_descripcion: z.string().optional().describe("Description for new transport request. Required for non-$TMP packages. Example: 'Fix bug in sales report'")
            }
        },
        async ({ nombre_programa, codigo_fuente, transporte_descripcion }) => {
            const nombre = nombre_programa.toUpperCase();
            const sourcePath = `${PROGRAMS_BASE}/${nombre}/source/main`;
            
            let lockHandle = null;
            let transportNumber = null;
            
            try {
                const { csrfToken, cookieHeader } = await fetchCsrfToken();
                
                // 1. Obtener lock del programa
                lockHandle = await lockProgram(nombre, csrfToken, cookieHeader);
                
                // 2. Crear transporte si se proporcionó descripción
                if (transporte_descripcion) {
                    transportNumber = await createTransport(transporte_descripcion, csrfToken, cookieHeader);
                }
                
                // 3. Obtener ETag para el PUT
                const etag = await fetchEtag(sourcePath, cookieHeader);
                
                // 4. Preparar headers para el PUT
                const putHeaders = {
                    "Content-Type": "text/plain; charset=utf-8",
                    "X-CSRF-Token": csrfToken,
                    "Accept": "application/xml",
                    "sap-client": SAP_CLIENT,
                    "If-Match": etag || "*",
                    "Cookie": cookieHeader,
                    "X-sap-adt-lockhandle": lockHandle
                };
                
                // Agregar transporte si existe
                if (transportNumber) {
                    putHeaders["X-sap-cts-request"] = transportNumber;
                }
                
                // 5. Hacer el PUT del código fuente
                await sapClient.put(sourcePath, codigo_fuente, { headers: putHeaders });
                
                // 6. Liberar el lock
                await unlockProgram(nombre, lockHandle, csrfToken, cookieHeader);
                lockHandle = null; // Marcar como liberado
                
                // 7. Respuesta exitosa
                let message = `Program ${nombre} saved successfully.`;
                if (transportNumber) {
                    message += ` Transport request: ${transportNumber}`;
                }
                message += " Remember to activate it in SE38.";
                
                return { content: [{ type: "text", text: message }] };
                
            } catch (err) {
                // Intentar liberar el lock si algo falló
                if (lockHandle) {
                    try {
                        const { csrfToken, cookieHeader } = await fetchCsrfToken();
                        await unlockProgram(nombre, lockHandle, csrfToken, cookieHeader);
                    } catch (unlockErr) {
                        console.error("Error liberando lock:", unlockErr.message);
                    }
                }
                
                console.error("ERROR escribir_programa:", formatError(err));
                return { content: [{ type: "text", text: formatError(err) }] };
            }
        }
    );

    // ─── WRITE PROGRAM WITH TRANSPORT (ECLIPSE ADT FLOW) ───────────────────────
    server.registerTool(
        "modificar_programa_transporte",
        {
            description: "Modifies an existing ABAP program and saves the change in a new transport request (package ZBDS1). Use this for programs that are NOT in $TMP.",
            inputSchema: {
                nombre_programa:        z.string().describe("Program name, e.g. ZBDS_WM085"),
                codigo_fuente:          z.string().describe("Full ABAP source code to write"),
                texto_orden:            z.string().describe("Description for the transport request, e.g. 'Fix sales report logic'")
            }
        },
        async ({ nombre_programa, codigo_fuente, texto_orden }) => {
            const nombre = nombre_programa.toUpperCase();
            const lockPath   = `${PROGRAMS_BASE}/${nombre}`;
            const sourcePath = `${lockPath}/source/main`;
            let lockHandle = null;
            let cookies = "";

            try {
                const { csrfToken, cookieHeader: initialCookies } = await fetchCsrfToken();
                cookies = initialCookies;

                console.error("[DEBUG] Paso 1: Obteniendo lock...");
                ({ lockHandle, cookies } = await adtLock(lockPath, csrfToken, cookies));
                console.error("[DEBUG] Lock obtenido:", lockHandle);

                console.error("[DEBUG] Paso 2: Creando orden de transporte...");
                let transportNumber;
                ({ transportNumber, cookies } = await adtCreateTransport(texto_orden, sourcePath, csrfToken, cookies));
                console.error("[DEBUG] Transporte creado:", transportNumber);

                console.error("[DEBUG] Paso 3: PUT del código fuente...");
                const putRes = await sapClient.put(sourcePath, codigo_fuente, {
                    params: { lockHandle, corrNr: transportNumber },
                    headers: {
                        "Content-Type": "text/plain; charset=utf-8",
                        "X-CSRF-Token": csrfToken,
                        "X-sap-adt-sessiontype": "stateful",
                        "sap-client": SAP_CLIENT,
                        "Cookie": cookies
                    }
                });
                cookies = mergeCookies(cookies, putRes);

                console.error("[DEBUG] Paso 4: Unlock...");
                await adtUnlock(lockPath, lockHandle, csrfToken, cookies);
                lockHandle = null;

                return {
                    content: [{
                        type: "text",
                        text: `Programa ${nombre} modificado exitosamente. Orden de transporte: ${transportNumber}. Recuerda activarlo en SE38.`
                    }]
                };

            } catch (err) {
                if (lockHandle) {
                    try {
                        const { csrfToken: csrf2, cookieHeader: cookie2 } = await fetchCsrfToken();
                        await adtUnlock(`${PROGRAMS_BASE}/${nombre}`, lockHandle, csrf2, cookie2);
                    } catch (unlockErr) {
                        console.error("Error liberando lock:", unlockErr.message);
                    }
                }
                console.error("ERROR modificar_programa_transporte:", formatError(err));
                return { content: [{ type: "text", text: `Lock obtenido: ${lockHandle ? 'SI' : 'NO'}\n${formatError(err)}` }] };
            }
        }
    );

    // ─── PATCH PROGRAM ──────────────────────────────────────────────────────────
    server.registerTool(
        "parchar_programa",
        {
            description: "Applies targeted edits to an ABAP program using old_string/new_string pairs. Much faster than modificar_programa_transporte for large programs because only the changed fragments need to be sent. The server reads the full source from SAP, applies all edits in memory, then PUTs the result.",
            inputSchema: {
                nombre_programa: z.string().describe("Program name, e.g. ZBDS_WM041"),
                ediciones: z.array(z.object({
                    old_string: z.string().describe("Exact text to replace — must appear exactly once in the source"),
                    new_string: z.string().describe("Replacement text")
                })).min(1).describe("List of edits to apply in order"),
                texto_orden: z.string().describe("Description for the new transport request")
            }
        },
        async ({ nombre_programa, ediciones, texto_orden }) => {
            const nombre = nombre_programa.toUpperCase();
            const lockPath   = `${PROGRAMS_BASE}/${nombre}`;
            const sourcePath = `${lockPath}/source/main`;
            let lockHandle = null;
            let cookies = "";

            try {
                const { csrfToken, cookieHeader: initialCookies } = await fetchCsrfToken();
                cookies = initialCookies;

                // 1. Leer fuente actual
                console.error("[DEBUG] parchar_programa: leyendo fuente...");
                const getRes = await sapClient.get(sourcePath, {
                    headers: { "Accept": "text/plain", "sap-client": SAP_CLIENT, "Cookie": cookies }
                });
                const fuenteOriginal = getRes.data;

                // 2. Aplicar ediciones en memoria
                const fuenteModificado = applyEdiciones(fuenteOriginal, ediciones);

                // 3. Lock
                console.error("[DEBUG] parchar_programa: lock...");
                ({ lockHandle, cookies } = await adtLock(lockPath, csrfToken, cookies));

                // 4. Transporte
                let transportNumber;
                ({ transportNumber, cookies } = await adtCreateTransport(texto_orden, sourcePath, csrfToken, cookies));
                console.error("[DEBUG] Transporte:", transportNumber);

                // 5. PUT
                const putRes = await sapClient.put(sourcePath, fuenteModificado, {
                    params: { lockHandle, corrNr: transportNumber },
                    headers: {
                        "Content-Type": "text/plain; charset=utf-8",
                        "X-CSRF-Token": csrfToken,
                        "X-sap-adt-sessiontype": "stateful",
                        "sap-client": SAP_CLIENT,
                        "Cookie": cookies
                    }
                });
                cookies = mergeCookies(cookies, putRes);

                // 6. Unlock
                await adtUnlock(lockPath, lockHandle, csrfToken, cookies);
                lockHandle = null;

                return {
                    content: [{
                        type: "text",
                        text: `Programa ${nombre} parcheado exitosamente (${ediciones.length} edición(es)). Orden de transporte: ${transportNumber}. Recuerda activarlo en SE38.`
                    }]
                };

            } catch (err) {
                if (lockHandle) {
                    try {
                        const { csrfToken: csrf2, cookieHeader: cookie2 } = await fetchCsrfToken();
                        await adtUnlock(lockPath, lockHandle, csrf2, cookie2);
                    } catch (e) { console.error("Error liberando lock:", e.message); }
                }
                console.error("ERROR parchar_programa:", formatError(err));
                return { content: [{ type: "text", text: formatError(err) }] };
            }
        }
    );

    // ─── PATCH INCLUDE ───────────────────────────────────────────────────────────
    server.registerTool(
        "parchar_include",
        {
            description: "Applies targeted edits to an ABAP include (e.g. ZBDS_WM041_GEN) using old_string/new_string pairs. The lock is acquired on the parent program. Much faster than sending the full source for large includes.",
            inputSchema: {
                nombre_include:  z.string().describe("Include name, e.g. ZBDS_WM041_GEN"),
                nombre_programa: z.string().describe("Parent program name used to acquire the lock, e.g. ZBDS_WM041"),
                ediciones: z.array(z.object({
                    old_string: z.string().describe("Exact text to replace — must appear exactly once in the source"),
                    new_string: z.string().describe("Replacement text")
                })).min(1).describe("List of edits to apply in order"),
                texto_orden: z.string().describe("Description for the new transport request")
            }
        },
        async ({ nombre_include, nombre_programa, ediciones, texto_orden }) => {
            const include    = nombre_include.toUpperCase();
            const programa   = nombre_programa.toUpperCase();
            const lockPath   = `${PROGRAMS_BASE}/${programa}`;
            const sourcePath = `${INCLUDES_BASE}/${include}/source/main`;
            let lockHandle = null;
            let cookies = "";

            try {
                const { csrfToken, cookieHeader: initialCookies } = await fetchCsrfToken();
                cookies = initialCookies;

                // 1. Leer fuente actual del include
                console.error("[DEBUG] parchar_include: leyendo fuente...");
                const getRes = await sapClient.get(sourcePath, {
                    headers: { "Accept": "text/plain", "sap-client": SAP_CLIENT, "Cookie": cookies }
                });
                const fuenteOriginal = getRes.data;

                // 2. Aplicar ediciones en memoria
                const fuenteModificado = applyEdiciones(fuenteOriginal, ediciones);

                // 3. Lock sobre el programa padre
                console.error("[DEBUG] parchar_include: lock...");
                ({ lockHandle, cookies } = await adtLock(lockPath, csrfToken, cookies));

                // 4. Transporte
                let transportNumber;
                ({ transportNumber, cookies } = await adtCreateTransport(texto_orden, sourcePath, csrfToken, cookies));
                console.error("[DEBUG] Transporte:", transportNumber);

                // 5. PUT del include
                const putRes = await sapClient.put(sourcePath, fuenteModificado, {
                    params: { lockHandle, corrNr: transportNumber },
                    headers: {
                        "Content-Type": "text/plain; charset=utf-8",
                        "X-CSRF-Token": csrfToken,
                        "X-sap-adt-sessiontype": "stateful",
                        "sap-client": SAP_CLIENT,
                        "Cookie": cookies
                    }
                });
                cookies = mergeCookies(cookies, putRes);

                // 6. Unlock
                await adtUnlock(lockPath, lockHandle, csrfToken, cookies);
                lockHandle = null;

                return {
                    content: [{
                        type: "text",
                        text: `Include ${include} parcheado exitosamente (${ediciones.length} edición(es)). Orden de transporte: ${transportNumber}. Recuerda activarlo en SE38.`
                    }]
                };

            } catch (err) {
                if (lockHandle) {
                    try {
                        const { csrfToken: csrf2, cookieHeader: cookie2 } = await fetchCsrfToken();
                        await adtUnlock(lockPath, lockHandle, csrf2, cookie2);
                    } catch (e) { console.error("Error liberando lock:", e.message); }
                }
                console.error("ERROR parchar_include:", formatError(err));
                return { content: [{ type: "text", text: formatError(err) }] };
            }
        }
    );

    // ─── LIST TRANSPORTS (OPCIONAL - ÚTIL PARA DEBUG) ────────────────────────────
    server.registerTool(
        "listar_transportes",
        {
            description: "Lists open transport requests for the current user",
            inputSchema: {}
        },
        async () => {
            try {
                const res = await sapClient.get(CTS_BASE, {
                    params: {
                        user: SAP_USER.toUpperCase(),
                        targets: "true",
                        type: "K"
                    },
                    headers: {
                        "Accept": "application/xml",
                        "sap-client": SAP_CLIENT
                    }
                });
                return { content: [{ type: "text", text: res.data }] };
            } catch (err) {
                return { content: [{ type: "text", text: formatError(err) }] };
            }
        }
    );
}