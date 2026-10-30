"use strict";

const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const { createClient } = require("@supabase/supabase-js");

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const BUDGET_FILE = path.join(DATA_DIR, "ngan-sach.txt.txt");
const EXPENSE_FILE_NAME = "chi-tieu.txt.txt";
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_BUCKET = "expense-data";
const SUPABASE_LEGACY_FILE = "expense-store.txt";
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || (process.env.PORT ? "0.0.0.0" : "127.0.0.1");
const MAX_BODY_BYTES = 1024 * 1024;
const MIME_TYPES = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
};

if (Boolean(SUPABASE_URL) !== Boolean(SUPABASE_SERVICE_ROLE_KEY)) {
    throw new Error("Cần cấu hình cả SUPABASE_URL và SUPABASE_SERVICE_ROLE_KEY");
}

const supabase = SUPABASE_URL
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    : null;

function isValidDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return false;
    }
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year &&
        date.getUTCMonth() === month - 1 &&
        date.getUTCDate() === day;
}

function folderNameFromIso(isoDate) {
    const [year, month, day] = isoDate.split("-");
    return `${day}-${month}-${year}`;
}

function isoFromFolderName(folderName) {
    const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(folderName);
    if (!match) {
        return null;
    }
    const isoDate = `${match[3]}-${match[2]}-${match[1]}`;
    return isValidDate(isoDate) ? isoDate : null;
}

function amountToCents(raw) {
    const text = String(raw).trim();
    const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text);
    if (!match) {
        return null;
    }
    const cents = Number(match[1]) * 100 + Number(`${match[2] || ""}00`.slice(0, 2));
    return Number.isSafeInteger(cents) ? cents : null;
}

function formatAmount(cents) {
    const whole = Math.trunc(cents / 100);
    const fraction = cents % 100;
    return fraction ? `${whole}.${String(fraction).padStart(2, "0")}` : String(whole);
}

async function readTextOrEmpty(filePath) {
    try {
        return await fs.readFile(filePath, "utf8");
    } catch (error) {
        if (error.code === "ENOENT") {
            return "";
        }
        throw error;
    }
}

async function readLocalStore() {
    const periodsByDate = new Map();
    const entries = {};
    const budgetText = await readTextOrEmpty(BUDGET_FILE);

    for (const line of budgetText.split(/\r?\n/)) {
        const match = /^(\d{4}-\d{2}-\d{2})\s+(.+)$/.exec(line.trim());
        if (!match || !isValidDate(match[1])) {
            continue;
        }
        const budgetCents = amountToCents(match[2]);
        if (budgetCents > 0) {
            periodsByDate.set(match[1], { start: match[1], budgetCents });
        }
    }

    let children = [];
    try {
        children = await fs.readdir(DATA_DIR, { withFileTypes: true });
    } catch (error) {
        if (error.code !== "ENOENT") {
            throw error;
        }
    }

    for (const child of children) {
        if (!child.isDirectory()) {
            continue;
        }
        const isoDate = isoFromFolderName(child.name);
        if (!isoDate) {
            continue;
        }
        const expenseText = await readTextOrEmpty(
            path.join(DATA_DIR, child.name, EXPENSE_FILE_NAME)
        );
        const items = [];
        for (const line of expenseText.split(/\r?\n/)) {
            const separator = line.lastIndexOf(" - ");
            if (separator <= 0) {
                continue;
            }
            const content = line.slice(0, separator).trim();
            const cents = amountToCents(line.slice(separator + 3));
            if (content && content.length <= 200 && cents > 0 && !/[\r\n]/.test(content)) {
                items.push({ content, cents });
            }
        }
        if (items.length) {
            entries[isoDate] = items;
        }
    }

    return {
        periods: [...periodsByDate.values()].sort((left, right) => left.start.localeCompare(right.start)),
        entries,
    };
}

function normalizeStore(value) {
    if (!value || typeof value !== "object" || !Array.isArray(value.periods) ||
        !value.entries || typeof value.entries !== "object" || Array.isArray(value.entries)) {
        throw new Error("Cấu trúc dữ liệu không hợp lệ");
    }

    const periods = value.periods.flatMap((period) => {
        if (!period || !isValidDate(period.start) || !Number.isSafeInteger(period.budgetCents) || period.budgetCents <= 0) {
            return [];
        }
        return [{ start: period.start, budgetCents: period.budgetCents }];
    });
    const entries = {};

    for (const [isoDate, items] of Object.entries(value.entries)) {
        if (!isValidDate(isoDate) || !Array.isArray(items)) {
            continue;
        }
        entries[isoDate] = items.flatMap((item) => {
            if (!item || typeof item.content !== "string" || !item.content.trim() ||
                item.content.length > 200 || /[\r\n]/.test(item.content) ||
                !Number.isSafeInteger(item.cents) || item.cents <= 0) {
                return [];
            }
            return [{ content: item.content.trim(), cents: item.cents }];
        });
    }

    return { periods, entries };
}

async function writeLocalStore(store) {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const periods = [...store.periods].sort((left, right) => left.start.localeCompare(right.start));
    const budgetLines = periods.map((period) => `${period.start} ${formatAmount(period.budgetCents)}`);
    await fs.writeFile(BUDGET_FILE, budgetLines.length ? `${budgetLines.join("\r\n")}\r\n` : "", "utf8");

    for (const [isoDate, items] of Object.entries(store.entries)) {
        if (!isValidDate(isoDate)) {
            continue;
        }
        const dayDirectory = path.join(DATA_DIR, folderNameFromIso(isoDate));
        await fs.mkdir(dayDirectory, { recursive: true });
        const lines = items.map((item) => `${item.content} - ${formatAmount(item.cents)}`);
        await fs.writeFile(
            path.join(dayDirectory, EXPENSE_FILE_NAME),
            lines.length ? `${lines.join("\r\n")}\r\n` : "",
            "utf8"
        );
    }
}

async function writeSupabaseStore(store) {
    const budgetLines = [...store.periods]
        .sort((left, right) => left.start.localeCompare(right.start))
        .map((period) => `${period.start} ${formatAmount(period.budgetCents)}`);
    await uploadSupabaseText(
        "ngan-sach.txt.txt",
        budgetLines.length ? `${budgetLines.join("\r\n")}\r\n` : ""
    );

    for (const [isoDate, items] of Object.entries(store.entries)) {
        if (!isValidDate(isoDate)) {
            continue;
        }
        const lines = items.map((item) => `${item.content} - ${formatAmount(item.cents)}`);
        await uploadSupabaseText(
            `${folderNameFromIso(isoDate)}/${EXPENSE_FILE_NAME}`,
            lines.length ? `${lines.join("\r\n")}\r\n` : ""
        );
    }
}

function isMissingSupabaseObject(error) {
    const message = String(error.message || "").toLowerCase();
    return String(error.statusCode) === "404" &&
        message.includes("object not found") &&
        !message.includes("bucket");
}

async function downloadSupabaseText(objectPath) {
    const { data, error } = await supabase.storage
        .from(SUPABASE_BUCKET)
        .download(objectPath);
    if (error) {
        if (isMissingSupabaseObject(error)) {
            return null;
        }
        throw error;
    }
    return data.text();
}

async function uploadSupabaseText(objectPath, text) {
    const { error } = await supabase.storage
        .from(SUPABASE_BUCKET)
        .upload(objectPath, Buffer.from(text, "utf8"), {
            contentType: "text/plain; charset=utf-8",
            upsert: true,
        });
    if (error) {
        throw error;
    }
}

function parseBudgetText(text) {
    const periodsByDate = new Map();
    for (const line of text.split(/\r?\n/)) {
        const match = /^(\d{4}-\d{2}-\d{2})\s+(.+)$/.exec(line.trim());
        if (!match || !isValidDate(match[1])) {
            continue;
        }
        const budgetCents = amountToCents(match[2]);
        if (budgetCents > 0) {
            periodsByDate.set(match[1], { start: match[1], budgetCents });
        }
    }
    return [...periodsByDate.values()].sort((left, right) => left.start.localeCompare(right.start));
}

function parseExpenseText(text) {
    return text.split(/\r?\n/).flatMap((line) => {
        const separator = line.lastIndexOf(" - ");
        if (separator <= 0) {
            return [];
        }
        const content = line.slice(0, separator).trim();
        const cents = amountToCents(line.slice(separator + 3));
        if (!content || content.length > 200 || /[\r\n]/.test(content) || cents <= 0) {
            return [];
        }
        return [{ content, cents }];
    });
}

async function readSupabaseStore() {
    const budgetText = await downloadSupabaseText("ngan-sach.txt.txt");
    const { data: rootItems, error: listError } = await supabase.storage
        .from(SUPABASE_BUCKET)
        .list("", { limit: 1000 });
    if (listError) {
        throw listError;
    }

    const dateFolders = rootItems
        .map((item) => item.name)
        .filter((name) => isoFromFolderName(name));
    const entries = {};
    for (const folderName of dateFolders) {
        const isoDate = isoFromFolderName(folderName);
        const expenseText = await downloadSupabaseText(`${folderName}/${EXPENSE_FILE_NAME}`);
        if (expenseText !== null) {
            const items = parseExpenseText(expenseText);
            if (items.length) {
                entries[isoDate] = items;
            }
        }
    }

    const hasSplitData = budgetText !== null || dateFolders.length > 0;
    if (hasSplitData) {
        return {
            periods: budgetText === null ? [] : parseBudgetText(budgetText),
            entries,
        };
    }

    const legacyText = await downloadSupabaseText(SUPABASE_LEGACY_FILE);
    if (legacyText !== null) {
        let legacyStore;
        try {
            legacyStore = normalizeStore(JSON.parse(legacyText));
        } catch (error) {
            throw new Error("File expense-store.txt cũ trên Supabase không hợp lệ");
        }
        await writeSupabaseStore(legacyStore);
        return legacyStore;
    }

    const localStore = await readLocalStore();
    await writeSupabaseStore(localStore);
    return localStore;
}

async function readStore() {
    if (!supabase) {
        return readLocalStore();
    }
    return readSupabaseStore();
}

async function writeStore(store) {
    if (!supabase) {
        return writeLocalStore(store);
    }
    await writeSupabaseStore(store);
}

function sendJson(response, statusCode, value) {
    response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify(value));
}

function setCorsHeaders(response) {
    response.setHeader("Access-Control-Allow-Origin", process.env.FRONTEND_ORIGIN || "*");
    response.setHeader("Access-Control-Allow-Methods", "GET, PUT, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

async function readRequestBody(request) {
    const chunks = [];
    let byteCount = 0;
    for await (const chunk of request) {
        byteCount += chunk.length;
        if (byteCount > MAX_BODY_BYTES) {
            throw new Error("Dữ liệu gửi lên quá lớn");
        }
        chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString("utf8");
}

async function handleApi(request, response) {
    if (request.method === "GET" && request.url === "/api/store") {
        sendJson(response, 200, await readStore());
        return;
    }
    if (request.method === "PUT" && request.url === "/api/store") {
        let parsed;
        try {
            parsed = JSON.parse(await readRequestBody(request));
        } catch (error) {
            sendJson(response, 400, { error: error.message || "JSON không hợp lệ" });
            return;
        }
        let store;
        try {
            store = normalizeStore(parsed);
            await writeStore(store);
        } catch (error) {
            sendJson(response, 400, { error: error.message || "Không lưu được dữ liệu" });
            return;
        }
        sendJson(response, 200, { ok: true });
        return;
    }
    sendJson(response, 404, { error: "API không tồn tại" });
}

async function serveStatic(request, response) {
    if (request.method !== "GET" && request.method !== "HEAD") {
        response.writeHead(405, { Allow: "GET, HEAD" });
        response.end();
        return;
    }

    let pathname;
    try {
        pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    } catch (error) {
        response.writeHead(400);
        response.end("Bad request");
        return;
    }
    const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const filePath = path.resolve(ROOT, relativePath);
    if (!filePath.startsWith(`${ROOT}${path.sep}`) || filePath.startsWith(`${DATA_DIR}${path.sep}`)) {
        response.writeHead(404);
        response.end("Not found");
        return;
    }

    try {
        const content = await fs.readFile(filePath);
        response.writeHead(200, {
            "Content-Type": MIME_TYPES[path.extname(filePath)] || "application/octet-stream",
            "X-Content-Type-Options": "nosniff",
        });
        response.end(request.method === "HEAD" ? undefined : content);
    } catch (error) {
        response.writeHead(error.code === "ENOENT" ? 404 : 500);
        response.end(error.code === "ENOENT" ? "Not found" : "Server error");
    }
}

const server = http.createServer(async (request, response) => {
    try {
        if (request.url === "/api/store") {
            setCorsHeaders(response);
            if (request.method === "OPTIONS") {
                response.writeHead(204);
                response.end();
                return;
            }
            await handleApi(request, response);
            return;
        }
        await serveStatic(request, response);
    } catch (error) {
        sendJson(response, 500, { error: "Lỗi máy chủ" });
        console.error(error);
    }
});

server.listen(PORT, HOST, () => {
    const storage = supabase ? `Supabase Storage (${SUPABASE_BUCKET}/)` : DATA_DIR;
    console.log(`Expense app listening at http://${HOST}:${PORT}; storage: ${storage}`);
});
