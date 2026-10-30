(function () {
    "use strict";

    const STORAGE_KEY = "expense-management-v1";
    const API_BASE_URL = "https://expense-manager-service-8cm3.onrender.com";
    const PERIOD_DAY_COUNT = 7;
    const MAX_CONTENT_LENGTH = 200;
    const CENTS_FACTOR = 100;

    /** Dữ liệu cũ từ thư mục data/ — chỉ nạp lần đầu khi localStorage trống. */
    const LEGACY_SEED = {
        periods: [{ start: "2026-10-25", budgetCents: 95000000 }],
        entries: {
            "2026-10-25": [
                { content: "Ăn tối", cents: 10900000 },
                { content: "Nước", cents: 2000000 },
                { content: "Ga", cents: 1000000 },
                { content: "Rau", cents: 500000 },
            ],
            "2026-10-26": [
                { content: "Cá", cents: 5000000 },
                { content: "thịt", cents: 1500000 },
                { content: "ăn sáng", cents: 1000000 },
                { content: "Xăng xe", cents: 7000000 },
                { content: "chợ", cents: 2200000 },
            ],
            "2026-10-27": [
                { content: "ăn sáng", cents: 1500000 },
                { content: "chợ", cents: 1500000 },
                { content: "dừa", cents: 2500000 },
            ],
            "2026-10-28": [
                { content: "ăn sáng", cents: 2000000 },
                { content: "cafe", cents: 1500000 },
                { content: "ăn tối", cents: 5200000 },
            ],
            "2026-10-29": [
                { content: "ăn sáng", cents: 1500000 },
                { content: "rau", cents: 500000 },
            ],
        },
    };

    const entryForm = document.querySelector("#entry-form");
    const serverStatus = document.querySelector("#server-status");
    const entryDate = document.querySelector("#entry-date");
    const budgetAmount = document.querySelector("#budget-amount");
    const budgetLocked = document.querySelector("#budget-locked");
    const entryContent = document.querySelector("#entry-content");
    const entryAmount = document.querySelector("#entry-amount");
    const saveButton = document.querySelector("#save-button");
    const filterDate = document.querySelector("#filter-date");
    const exportButton = document.querySelector("#export-button");
    const summaryDate = document.querySelector("#summary-date");
    const summaryExportButton = document.querySelector("#summary-export-button");
    const summaryRange = document.querySelector("#summary-range");
    const summaryRows = document.querySelector("#summary-rows");
    const summaryTotal = document.querySelector("#summary-total");
    const summaryMessage = document.querySelector("#summary-message");
    const dayPanel = document.querySelector("#day-panel");
    const summaryPanel = document.querySelector("#summary-panel");
    const dayTab = document.querySelector("#day-tab");
    const summaryTab = document.querySelector("#summary-tab");
    const entryRows = document.querySelector("#entry-rows");
    const spentCell = document.querySelector("#spent-cell");
    const remainingCell = document.querySelector("#remaining-cell");
    const remainingValue = document.querySelector("#remaining-value");
    const remainingBox = document.querySelector("#remaining-box");
    const periodNote = document.querySelector("#period-note");
    const formMessage = document.querySelector("#form-message");
    const listMessage = document.querySelector("#list-message");
    const appControls = [
        ...entryForm.elements,
        filterDate,
        exportButton,
        summaryDate,
        summaryExportButton,
        dayTab,
        summaryTab,
    ];

    const moneyFormat = new Intl.NumberFormat("vi-VN");
    let savedBudget = 0;
    let periodSpent = 0;
    let daySpent = 0;
    let budgetSet = false;
    let previousRemaining = null;
    let backendReady = false;
    let backendInitialized = false;
    let backendConnecting = false;
    let backendWriteQueue = Promise.resolve();
    let backendWriteError = null;
    let editingEntryIndex = null;

    function loadStore() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === "object") {
                    return {
                        periods: Array.isArray(parsed.periods) ? parsed.periods : [],
                        entries:
                            parsed.entries && typeof parsed.entries === "object"
                                ? parsed.entries
                                : {},
                    };
                }
            }
        } catch (error) {
            // localStorage hỏng hoặc không đọc được → khởi tạo mới
        }
        const seed = {
            periods: LEGACY_SEED.periods.map((period) => ({ ...period })),
            entries: Object.fromEntries(
                Object.entries(LEGACY_SEED.entries).map(([date, items]) => [
                    date,
                    items.map((item) => ({ ...item })),
                ])
            ),
        };
        saveStore(seed);
        return seed;
    }

    function saveStore(store) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
        if (!backendReady) {
            return;
        }
        const snapshot = JSON.stringify(store);
        backendWriteError = null;
        setServerStatus("Đang lưu dữ liệu lên server...", "");
        backendWriteQueue = backendWriteQueue
            .catch(() => {})
            .then(async () => {
                const response = await fetch(`${API_BASE_URL}/api/store`, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: snapshot,
                });
                if (!response.ok) {
                    throw new Error("Server không lưu được dữ liệu");
                }
            })
            .then(() => {
                setServerStatus("Dữ liệu đã lưu trên server.", "ok");
            })
            .catch((error) => {
                backendWriteError = error;
                setServerStatus("Không đồng bộ được dữ liệu với server.", "error");
            });
    }

    function setServerStatus(text, kind) {
        serverStatus.textContent = text;
        serverStatus.className = kind ? `message ${kind}` : "message";
    }

    function isValidIsoDate(value) {
        if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
            return false;
        }
        const [year, month, day] = value.split("-").map(Number);
        const date = new Date(Date.UTC(year, month - 1, day));
        return (
            date.getUTCFullYear() === year &&
            date.getUTCMonth() === month - 1 &&
            date.getUTCDate() === day
        );
    }

    function folderNameFromIso(isoDate) {
        const [year, month, day] = isoDate.split("-");
        return `${day}-${month}-${year}`;
    }

    function formatStoredAmount(cents) {
        const whole = Math.trunc(cents / CENTS_FACTOR);
        const fraction = cents % CENTS_FACTOR;
        if (fraction === 0) {
            return String(whole);
        }
        return `${whole}.${String(fraction).padStart(2, "0")}`;
    }

    function storedTextToCents(text) {
        if (!/^\d+(\.\d{1,2})?$/.test(text)) {
            return null;
        }
        const [whole, fraction = ""] = text.split(".");
        const padded = `${fraction}00`.slice(0, 2);
        const cents = Number(whole) * CENTS_FACTOR + Number(padded);
        if (!Number.isSafeInteger(cents)) {
            return null;
        }
        return cents;
    }

    function parseMoney(raw) {
        if (typeof raw === "number") {
            if (!Number.isFinite(raw) || raw <= 0) {
                return null;
            }
            return storedTextToCents(
                raw.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1")
            );
        }
        if (typeof raw !== "string") {
            return null;
        }
        let text = raw.trim().replace(/\s/g, "");
        if (!text) {
            return null;
        }
        if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(text)) {
            text = text.replace(/\./g, "").replace(",", ".");
        } else if (/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(text)) {
            text = text.replace(/,/g, "");
        } else if (/^\d+(,\d{1,2})$/.test(text)) {
            text = text.replace(",", ".");
        }
        const cents = storedTextToCents(text);
        if (cents === null || cents <= 0) {
            return null;
        }
        return cents;
    }

    function parseBudget(raw) {
        if (raw === 0 || raw === "0") {
            return 0;
        }
        if (typeof raw === "string" && raw.trim() === "0") {
            return 0;
        }
        return parseMoney(raw);
    }

    function centsToAmount(cents) {
        return cents / CENTS_FACTOR;
    }

    function addDays(isoDate, dayCount) {
        const [year, month, day] = isoDate.split("-").map(Number);
        const date = new Date(Date.UTC(year, month - 1, day));
        date.setUTCDate(date.getUTCDate() + dayCount);
        const nextMonth = String(date.getUTCMonth() + 1).padStart(2, "0");
        const nextDay = String(date.getUTCDate()).padStart(2, "0");
        return `${date.getUTCFullYear()}-${nextMonth}-${nextDay}`;
    }

    function todayIso() {
        const now = new Date();
        const month = String(now.getMonth() + 1).padStart(2, "0");
        const day = String(now.getDate()).padStart(2, "0");
        return `${now.getFullYear()}-${month}-${day}`;
    }

    function periodEnd(start) {
        return addDays(start, PERIOD_DAY_COUNT - 1);
    }

    function readDayItems(store, isoDate) {
        const items = store.entries[isoDate];
        return Array.isArray(items) ? items.map((item) => ({ ...item })) : [];
    }

    function writeDayItems(store, isoDate, items) {
        if (!items.length) {
            delete store.entries[isoDate];
            return;
        }
        store.entries[isoDate] = items.map((item) => ({
            content: item.content,
            cents: item.cents,
        }));
    }

    function readPeriods(store) {
        return store.periods
            .map((period) => ({ start: period.start, budgetCents: period.budgetCents }))
            .sort((left, right) => left.start.localeCompare(right.start));
    }

    function writePeriods(store, periods) {
        store.periods = periods
            .map((period) => ({ start: period.start, budgetCents: period.budgetCents }))
            .sort((left, right) => left.start.localeCompare(right.start));
    }

    function rangesOverlap(start, otherStart) {
        const end = periodEnd(start);
        const otherEnd = periodEnd(otherStart);
        return start <= otherEnd && otherStart <= end;
    }

    function findPeriod(isoDate, periods) {
        return (
            periods.find(
                (period) => isoDate >= period.start && isoDate <= periodEnd(period.start)
            ) || null
        );
    }

    function spentBetween(store, start, end) {
        let spentCents = 0;
        let cursor = start;
        while (cursor <= end) {
            const items = readDayItems(store, cursor);
            spentCents += items.reduce((sum, item) => sum + item.cents, 0);
            cursor = addDays(cursor, 1);
        }
        return spentCents;
    }

    function summarizePeriod(store, period) {
        const end = periodEnd(period.start);
        const spentCents = spentBetween(store, period.start, end);
        return {
            start: period.start,
            end,
            budget: centsToAmount(period.budgetCents),
            spent: centsToAmount(spentCents),
            remaining: centsToAmount(period.budgetCents - spentCents),
            ended: todayIso() > end,
        };
    }

    function mapItems(items) {
        return items.map((item) => ({
            content: item.content,
            amount: centsToAmount(item.cents),
        }));
    }

    function describeDate(store, isoDate) {
        const periods = readPeriods(store);
        const period = findPeriod(isoDate, periods);
        const items = readDayItems(store, isoDate);
        const daySpentCents = items.reduce((sum, item) => sum + item.cents, 0);
        const windowEnd = periodEnd(isoDate);
        const windowSpentCents = spentBetween(store, isoDate, windowEnd);
        const base = {
            date: isoDate,
            items: mapItems(items),
            daySpent: centsToAmount(daySpentCents),
            hasFile: items.length > 0,
            windowSpent: centsToAmount(windowSpentCents),
        };
        if (!period) {
            const previous = periods.length
                ? summarizePeriod(store, periods[periods.length - 1])
                : null;
            return {
                ...base,
                budgetSet: false,
                budget: 0,
                periodSpent: centsToAmount(windowSpentCents),
                remaining: previous ? previous.remaining : 0,
                period: null,
                previous,
            };
        }
        const summary = summarizePeriod(store, period);
        return {
            ...base,
            budgetSet: true,
            budget: summary.budget,
            periodSpent: summary.spent,
            remaining: summary.remaining,
            period: summary,
            previous: null,
        };
    }

    function ensurePeriod(store, isoDate, budgetRaw) {
        const periods = readPeriods(store);
        const existing = findPeriod(isoDate, periods);
        if (existing) {
            return existing;
        }
        const budgetCents = parseBudget(budgetRaw);
        if (budgetCents === null || budgetCents <= 0) {
            return { error: "Nhập tổng tiền cho kỳ 7 ngày" };
        }
        if (periods.some((period) => rangesOverlap(isoDate, period.start))) {
            return { error: "Ngày này nằm trong kỳ 7 ngày đã có" };
        }
        periods.push({ start: isoDate, budgetCents });
        writePeriods(store, periods);
        return findPeriod(isoDate, periods);
    }

    function normalizeContent(raw) {
        if (typeof raw !== "string") {
            return null;
        }
        const content = raw.trim();
        if (!content || content.length > MAX_CONTENT_LENGTH) {
            return null;
        }
        if (/[\r\n]/.test(content)) {
            return null;
        }
        return content;
    }

    function saveEntry(payload) {
        if (!isValidIsoDate(payload.date)) {
            return { ok: false, message: "Ngày không hợp lệ" };
        }
        const content = normalizeContent(payload.content);
        if (!content) {
            return {
                ok: false,
                message: "Nội dung không được để trống và tối đa 200 ký tự",
            };
        }
        const cents = parseMoney(payload.amount);
        if (cents === null) {
            return {
                ok: false,
                message: "Số tiền phải lớn hơn 0, tối đa 2 chữ số thập phân",
            };
        }
        const store = loadStore();
        const period = ensurePeriod(store, payload.date, payload.budget);
        if (period.error) {
            return { ok: false, message: period.error };
        }
        const items = readDayItems(store, payload.date);
        items.push({ content, cents });
        writeDayItems(store, payload.date, items);
        saveStore(store);
        return {
            ok: true,
            message: "Đã lưu chi tiêu",
            ...describeDate(store, payload.date),
        };
    }

    function saveBudget(payload) {
        if (!isValidIsoDate(payload.date)) {
            return { ok: false, message: "Ngày không hợp lệ" };
        }
        const store = loadStore();
        const period = ensurePeriod(store, payload.date, payload.budget);
        if (period.error) {
            return { ok: false, message: period.error };
        }
        saveStore(store);
        return {
            ok: true,
            message: "Đã lưu tổng tiền cho 7 ngày",
            ...describeDate(store, payload.date),
        };
    }

    function listEntries(isoDate) {
        if (!isValidIsoDate(isoDate)) {
            return { ok: false, message: "Ngày lọc không hợp lệ" };
        }
        return { ok: true, ...describeDate(loadStore(), isoDate) };
    }

    function summarizeEntries(isoDate) {
        if (!isValidIsoDate(isoDate)) {
            return { ok: false, message: "Ngày tổng hợp không hợp lệ" };
        }
        const store = loadStore();
        const budgetPeriod = readPeriods(store).find((period) => period.start === isoDate);
        const today = todayIso();
        const scheduledEnd = periodEnd(isoDate);
        const end = today < isoDate
            ? null
            : today < scheduledEnd
              ? today
              : scheduledEnd;
        const entries = [];
        let spentCents = 0;
        if (end) {
            let cursor = isoDate;
            while (cursor <= end) {
                readDayItems(store, cursor).forEach((item) => {
                    entries.push({
                        date: cursor,
                        content: item.content,
                        amount: centsToAmount(item.cents),
                    });
                    spentCents += item.cents;
                });
                cursor = addDays(cursor, 1);
            }
        }
        return {
            ok: true,
            period: {
                start: isoDate,
                end,
                scheduledEnd,
                budget: budgetPeriod ? centsToAmount(budgetPeriod.budgetCents) : null,
            },
            entries,
            spent: centsToAmount(spentCents),
        };
    }

    function summarizeAllEntries() {
        const store = loadStore();
        const today = todayIso();
        const dataDates = [
            ...readPeriods(store).map((period) => period.start),
            ...Object.keys(store.entries).filter((date) => isValidIsoDate(date)),
        ].filter((date) => date <= today).sort();
        if (!dataDates.length) {
            return { ok: true, period: null, entries: [], spent: 0 };
        }

        const start = dataDates[0];
        const entries = [];
        let spentCents = 0;
        let cursor = start;
        while (cursor <= today) {
            readDayItems(store, cursor).forEach((item) => {
                entries.push({
                    date: cursor,
                    content: item.content,
                    amount: centsToAmount(item.cents),
                });
                spentCents += item.cents;
            });
            cursor = addDays(cursor, 1);
        }

        return {
            ok: true,
            period: { start, end: today, scheduledEnd: today, budget: null },
            entries,
            spent: centsToAmount(spentCents),
        };
    }

    function refreshSummaryDates(preferredStart) {
        const periods = readPeriods(loadStore());
        const dailyPeriod = isValidIsoDate(filterDate.value)
            ? findPeriod(filterDate.value, periods)
            : null;
        const currentPeriod = periods.find((period) => period.start === summaryDate.value);
        const allSelected = summaryDate.options.length > 0 && summaryDate.value === "";
        const selectedStart = allSelected
            ? ""
            : periods.find((period) => period.start === preferredStart)?.start
                ?? dailyPeriod?.start
                ?? currentPeriod?.start
                ?? periods[periods.length - 1]?.start
                ?? "";

        summaryDate.replaceChildren();
        const placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.textContent = periods.length
            ? "Tất cả chi tiêu"
            : "Chưa có dữ liệu";
        summaryDate.append(placeholder);
        periods.forEach((period) => {
            const option = document.createElement("option");
            option.value = period.start;
            option.textContent = `${formatVn(period.start)} · ${formatMoney(centsToAmount(period.budgetCents))} VND`;
            summaryDate.append(option);
        });
        summaryDate.value = selectedStart;
        return selectedStart;
    }

    function exportEntries(isoDate) {
        if (!isValidIsoDate(isoDate)) {
            return { ok: false, message: "Ngày xuất không hợp lệ" };
        }
        const items = readDayItems(loadStore(), isoDate);
        if (!items.length) {
            return { ok: false, message: "Chưa có file chi tiêu cho ngày đã chọn" };
        }
        const lines = items.map(
            (item) => `${item.content} - ${formatStoredAmount(item.cents)}`
        );
        const body = `\uFEFF${lines.join("\r\n")}\r\n`;
        return {
            ok: true,
            fileName: `chi-tieu-${folderNameFromIso(isoDate)}.txt`,
            body,
        };
    }

    function exportSummary(isoDate) {
        const allData = isoDate === "all";
        const summary = allData ? summarizeAllEntries() : summarizeEntries(isoDate);
        if (!summary.period) {
            return { ok: false, message: "Chưa có dữ liệu để tổng hợp" };
        }
        const rangeLine = allData
            ? `Tất cả chi tiêu: ${formatVn(summary.period.start)} - ${formatVn(summary.period.end)}`
            : `Kỳ: ${formatVn(summary.period.start)} - ${formatVn(summary.period.end || summary.period.scheduledEnd)}`;
        const lines = [
            rangeLine,
            summary.period.budget === null
                ? allData ? "Tổng tiền: Tất cả dữ liệu hiện có" : "Tổng tiền: Chưa nhập cho ngày bắt đầu này"
                : `Tổng tiền: ${formatMoney(summary.period.budget)} VND`,
            "",
            "Ngày - Nội dung - Số tiền (VND)",
            ...summary.entries.map(
                (item) => `${formatVn(item.date)} - ${item.content} - ${formatMoney(item.amount)}`
            ),
            "",
            `Tổng chi: ${formatMoney(summary.spent)} VND`,
        ];
        return {
            ok: true,
            fileName: allData
                ? `tong-hop-tat-ca-${folderNameFromIso(summary.period.start)}-${folderNameFromIso(summary.period.end)}.txt`
                : `tong-hop-7-ngay-${folderNameFromIso(summary.period.start)}.txt`,
            body: `\uFEFF${lines.join("\r\n")}\r\n`,
        };
    }
    function formatMoney(value) {
        const amount = Number(value);
        if (!Number.isFinite(amount)) {
            return "0";
        }
        if (Number.isInteger(amount)) {
            return moneyFormat.format(amount);
        }
        return new Intl.NumberFormat("vi-VN", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        }).format(amount);
    }

    function parseMoneyInput(raw) {
        if (typeof raw !== "string") {
            return null;
        }
        let text = raw.trim().replace(/\s/g, "");
        if (!text) {
            return null;
        }
        if (text === "0") {
            return 0;
        }
        if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(text)) {
            text = text.replace(/\./g, "").replace(",", ".");
        } else if (/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(text)) {
            text = text.replace(/,/g, "");
        } else if (/^\d+(,\d{1,2})$/.test(text)) {
            text = text.replace(",", ".");
        }
        if (!/^\d+(\.\d{1,2})?$/.test(text)) {
            return null;
        }
        return Number(text);
    }

    function setMessage(element, text, kind) {
        element.textContent = text;
        element.className = kind ? `message ${kind}` : "message";
    }

    function paintRemaining(element, amount) {
        element.textContent = formatMoney(amount);
        element.classList.toggle("negative", amount < 0);
    }

    function formatVn(isoDate) {
        const [year, month, day] = isoDate.split("-");
        return `${day}/${month}/${year}`;
    }

    function syncBudgetField() {
        budgetAmount.hidden = budgetSet;
        budgetLocked.hidden = !budgetSet;
        budgetLocked.textContent = formatMoney(savedBudget);
    }

    function captureState(payload) {
        budgetSet = payload.budgetSet === true;
        daySpent = Number(payload.daySpent) || 0;
        savedBudget = Number(payload.budget) || 0;
        previousRemaining = payload.previous
            ? Number(payload.previous.remaining)
            : null;
        periodSpent = budgetSet
            ? Number(payload.periodSpent) || 0
            : Number(payload.windowSpent) || 0;
        if (!budgetSet && document.activeElement !== budgetAmount) {
            budgetAmount.value = "";
        }
        syncBudgetField();
        if (payload.period) {
            const range = `${formatVn(payload.period.start)} - ${formatVn(payload.period.end)}`;
            periodNote.textContent = payload.period.ended
                ? `Đã hết 7 ngày (${range}). Còn lại trừ toàn bộ chi trong kỳ.`
                : `Kỳ 7 ngày: ${range}.`;
            return;
        }
        if (payload.previous) {
            const range = `${formatVn(payload.previous.start)} - ${formatVn(payload.previous.end)}`;
            periodNote.textContent = `Kỳ trước ${range} còn ${formatMoney(payload.previous.remaining)}. Nhập tổng mới cho 7 ngày tiếp theo.`;
            return;
        }
        periodNote.textContent = "Tổng tiền dùng cho 7 ngày kể từ ngày đang chọn.";
    }

    function updateRemainingPreview() {
        const pending = parseMoneyInput(entryAmount.value);
        const extra = pending === null ? 0 : pending;
        const typedBudget = budgetSet ? null : parseMoneyInput(budgetAmount.value);
        let remaining = previousRemaining === null ? 0 : previousRemaining;
        if (budgetSet) {
            remaining = savedBudget - periodSpent - extra;
        } else if (typedBudget !== null) {
            remaining = typedBudget - periodSpent - extra;
        }
        paintRemaining(remainingValue, remaining);
        remainingBox.classList.toggle("negative", remaining < 0);
        if (entryDate.value !== filterDate.value) {
            return;
        }
        spentCell.textContent = formatMoney(daySpent);
        paintRemaining(remainingCell, remaining);
    }

    function renderRows(items) {
        entryRows.replaceChildren();
        if (!items.length) {
            const row = document.createElement("tr");
            const cell = document.createElement("td");
            cell.colSpan = 4;
            cell.className = "empty";
            cell.textContent = "Chưa có khoản chi cho ngày này.";
            row.append(cell);
            entryRows.append(row);
            return;
        }
        items.forEach((item, index) => {
            const row = document.createElement("tr");
            const indexCell = document.createElement("td");
            const contentCell = document.createElement("td");
            const amountCell = document.createElement("td");
            const actionsCell = document.createElement("td");
            indexCell.textContent = String(index + 1);
            amountCell.className = "col-money";
            actionsCell.className = "col-actions";

            if (editingEntryIndex === index) {
                const contentInput = document.createElement("input");
                contentInput.className = "inline-edit-input";
                contentInput.maxLength = MAX_CONTENT_LENGTH;
                contentInput.value = item.content;
                contentInput.setAttribute("aria-label", "Sửa nội dung khoản chi");

                const amountInput = document.createElement("input");
                amountInput.className = "inline-edit-input";
                amountInput.inputMode = "decimal";
                amountInput.value = String(item.amount);
                amountInput.setAttribute("aria-label", "Sửa số tiền khoản chi");
                amountCell.append(amountInput);
                contentCell.append(contentInput);

                const saveButton = document.createElement("button");
                saveButton.type = "button";
                saveButton.dataset.entryAction = "save";
                saveButton.dataset.entryIndex = String(index);
                saveButton.textContent = "Lưu";

                const cancelButton = document.createElement("button");
                cancelButton.type = "button";
                cancelButton.dataset.entryAction = "cancel";
                cancelButton.dataset.entryIndex = String(index);
                cancelButton.textContent = "Hủy";
                actionsCell.append(saveButton, cancelButton);
            } else {
                contentCell.textContent = item.content;
                amountCell.textContent = formatMoney(item.amount);
                const editButton = document.createElement("button");
                editButton.type = "button";
                editButton.dataset.entryAction = "edit";
                editButton.dataset.entryIndex = String(index);
                editButton.textContent = "Sửa";
                actionsCell.append(editButton);
            }

            actionsCell.classList.add("row-actions");
            row.append(indexCell, contentCell, amountCell, actionsCell);
            entryRows.append(row);
        });
    }

    entryRows.addEventListener("click", async (event) => {
        const button = event.target.closest("button[data-entry-action]");
        if (!button) {
            return;
        }
        const action = button.dataset.entryAction;
        const index = Number(button.dataset.entryIndex);
        if (action === "edit") {
            editingEntryIndex = index;
            loadEntries();
            return;
        }
        if (action === "cancel") {
            editingEntryIndex = null;
            loadEntries();
            return;
        }

        const row = button.closest("tr");
        const content = normalizeContent(row.querySelector(".inline-edit-input[aria-label='Sửa nội dung khoản chi']").value);
        const cents = parseMoney(row.querySelector(".inline-edit-input[aria-label='Sửa số tiền khoản chi']").value);
        if (!content) {
            setMessage(listMessage, "Nội dung không được để trống và tối đa 200 ký tự", "error");
            return;
        }
        if (cents === null || cents <= 0) {
            setMessage(listMessage, "Số tiền phải lớn hơn 0, tối đa 2 chữ số thập phân", "error");
            return;
        }

        const dateItems = readDayItems(loadStore(), filterDate.value);
        if (!dateItems[index]) {
            setMessage(listMessage, "Không tìm thấy khoản chi để sửa", "error");
            return;
        }
        dateItems[index] = { content, cents };
        const store = loadStore();
        writeDayItems(store, filterDate.value, dateItems);
        saveStore(store);
        button.disabled = true;
        await backendWriteQueue;
        editingEntryIndex = backendWriteError ? index : null;
        loadEntries();
        if (backendWriteError) {
            setMessage(listMessage, "Đã sửa trên trình duyệt nhưng chưa đồng bộ lên server.", "error");
        } else {
            setMessage(listMessage, "Đã cập nhật khoản chi.", "ok");
        }
    });

    function renderSummary() {
        const allData = summaryDate.value === "";
        const payload = allData ? summarizeAllEntries() : summarizeEntries(summaryDate.value);
        summaryRows.replaceChildren();
        summaryTotal.textContent = formatMoney(payload.spent || 0);
        const period = payload.period;
        if (!period) {
            summaryRange.textContent = allData
                ? "Chưa có dữ liệu chi tiêu."
                : "Chọn kỳ tổng tiền để xem chi tiêu trong 7 ngày.";
            summaryRows.append(createEmptyRow("Chưa có dữ liệu để tổng hợp."));
            return;
        }
        if (allData) {
            summaryRange.textContent = `Tất cả chi tiêu · ${formatVn(period.start)} - ${formatVn(period.end)}`;
        } else if (period.end) {
            const budgetText = period.budget === null
                ? "Chưa nhập tổng tiền cho ngày bắt đầu này"
                : `Tổng tiền: ${formatMoney(period.budget)}`;
            summaryRange.textContent = `Kỳ ${formatVn(period.start)} - ${formatVn(period.end)} · ${budgetText}`;
        } else {
            const budgetText = period.budget === null
                ? "Chưa nhập tổng tiền cho ngày bắt đầu này"
                : `Tổng tiền: ${formatMoney(period.budget)}`;
            summaryRange.textContent = `Kỳ bắt đầu ${formatVn(period.start)} · Chưa tới ngày bắt đầu · ${budgetText}`;
        }
        if (!payload.entries.length) {
            summaryRows.append(createEmptyRow("Chưa có khoản chi trong khoảng thời gian này."));
            return;
        }
        payload.entries.forEach((item) => {
            const row = document.createElement("tr");
            const dateCell = document.createElement("td");
            const contentCell = document.createElement("td");
            const amountCell = document.createElement("td");
            dateCell.textContent = formatVn(item.date);
            contentCell.textContent = item.content;
            amountCell.textContent = formatMoney(item.amount);
            amountCell.className = "col-money";
            row.append(dateCell, contentCell, amountCell);
            summaryRows.append(row);
        });
    }

    function createEmptyRow(message) {
        const row = document.createElement("tr");
        const cell = document.createElement("td");
        cell.colSpan = 3;
        cell.className = "empty";
        cell.textContent = message;
        row.append(cell);
        return row;
    }

    function selectTab(selectedTab) {
        const showSummary = selectedTab === summaryTab;
        dayTab.setAttribute("aria-selected", String(!showSummary));
        summaryTab.setAttribute("aria-selected", String(showSummary));
        dayTab.tabIndex = showSummary ? -1 : 0;
        summaryTab.tabIndex = showSummary ? 0 : -1;
        dayPanel.hidden = showSummary;
        summaryPanel.hidden = !showSummary;
        if (showSummary) {
            refreshSummaryDates();
            renderSummary();
        }
    }

    function applyLedger(payload) {
        captureState(payload);
        renderRows(payload.items || []);
        updateRemainingPreview();
    }

    function loadEntries() {
        const date = filterDate.value;
        if (!date) {
            renderRows([]);
            spentCell.textContent = formatMoney(0);
            paintRemaining(remainingCell, 0);
            return;
        }
        setMessage(listMessage, "");
        const payload = listEntries(date);
        if (!payload.ok) {
            renderRows([]);
            spentCell.textContent = formatMoney(0);
            paintRemaining(remainingCell, 0);
            setMessage(listMessage, payload.message || "Không tải được danh sách", "error");
            return;
        }
        if (date === entryDate.value) {
            applyLedger(payload);
            return;
        }
        renderRows(payload.items || []);
        spentCell.textContent = formatMoney(payload.daySpent || 0);
        paintRemaining(remainingCell, payload.remaining || 0);
    }

    function refreshEntryBudget() {
        if (!entryDate.value) {
            return;
        }
        const payload = listEntries(entryDate.value);
        if (!payload.ok) {
            return;
        }
        captureState(payload);
        updateRemainingPreview();
        if (entryDate.value === filterDate.value) {
            loadEntries();
        }
    }

    entryForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        setMessage(formMessage, "");
        const body = {
            date: entryDate.value,
            content: entryContent.value,
            amount: entryAmount.value,
        };
        if (!budgetSet) {
            const budget = parseMoneyInput(budgetAmount.value);
            if (budget === null || budget <= 0) {
                setMessage(formMessage, "Nhập tổng tiền cho kỳ 7 ngày", "error");
                budgetAmount.focus();
                return;
            }
            body.budget = budgetAmount.value;
        }
        saveButton.disabled = true;
        try {
            if (!backendInitialized) {
                setMessage(formMessage, "Đang kết nối máy chủ, vui lòng thử lại.", "error");
                return;
            }
            const payload = saveEntry(body);
            if (!payload.ok) {
                setMessage(formMessage, payload.message || "Không lưu được", "error");
                return;
            }
            await backendWriteQueue;
            entryContent.value = "";
            entryAmount.value = "";
            entryContent.focus();
            filterDate.value = entryDate.value;
            refreshSummaryDates(entryDate.value);
            if (!summaryPanel.hidden) {
                renderSummary();
            }
            if (!backendReady || backendWriteError) {
                setMessage(formMessage, "Đã lưu trên trình duyệt nhưng chưa đồng bộ lên server.", "error");
            } else {
                setMessage(
                    formMessage,
                    `Đã lưu. Còn lại ${formatMoney(payload.remaining)}.`,
                    "ok"
                );
            }
            loadEntries();
        } finally {
            saveButton.disabled = false;
        }
    });

    budgetAmount.addEventListener("input", updateRemainingPreview);
    entryAmount.addEventListener("input", updateRemainingPreview);

    budgetAmount.addEventListener("change", async () => {
        if (!backendInitialized) {
            setMessage(formMessage, "Đang kết nối máy chủ, vui lòng thử lại.", "error");
            return;
        }
        if (budgetSet) {
            return;
        }
        const budget = parseMoneyInput(budgetAmount.value);
        if (!entryDate.value || budget === null || budget <= 0) {
            updateRemainingPreview();
            return;
        }
        const payload = saveBudget({
            date: entryDate.value,
            budget: budgetAmount.value,
        });
        if (!payload.ok) {
            setMessage(
                formMessage,
                payload.message || "Không lưu được tổng tiền",
                "error"
            );
            return;
        }
        await backendWriteQueue;
        captureState(payload);
        refreshSummaryDates(payload.date);
        if (!summaryPanel.hidden) {
            renderSummary();
        }
        if (!backendReady || backendWriteError) {
            setMessage(formMessage, "Đã lưu trên trình duyệt nhưng chưa đồng bộ lên server.", "error");
        } else {
            setMessage(
                formMessage,
                `Đã mở kỳ 7 ngày. Còn lại ${formatMoney(payload.remaining)}.`,
                "ok"
            );
        }
        if (entryDate.value === filterDate.value) {
            loadEntries();
        } else {
            updateRemainingPreview();
        }
    });

    entryDate.addEventListener("change", () => {
        try {
            refreshEntryBudget();
        } catch (error) {
            setMessage(
                formMessage,
                "Không tải được tổng tiền của ngày đã chọn",
                "error"
            );
        }
    });

    filterDate.addEventListener("change", () => {
        editingEntryIndex = null;
        refreshSummaryDates();
        try {
            loadEntries();
            if (!summaryPanel.hidden) {
                renderSummary();
            }
        } catch (error) {
            setMessage(listMessage, "Không tải được danh sách", "error");
        }
    });

    summaryDate.addEventListener("change", () => {
        if (summaryDate.value) {
            filterDate.value = summaryDate.value;
        }
        renderSummary();
        loadEntries();
    });
    dayTab.addEventListener("click", () => selectTab(dayTab));
    summaryTab.addEventListener("click", () => selectTab(summaryTab));

    function downloadExport(button, date, exporter, messageElement, successMessage) {
        if (!date) {
            setMessage(messageElement, "Chọn ngày cần xuất file", "error");
            return;
        }
        button.disabled = true;
        try {
            const result = exporter(date);
            if (!result.ok) {
                setMessage(messageElement, result.message || "Không xuất được file", "error");
                return;
            }
            const blob = new Blob([result.body], {
                type: "text/plain;charset=utf-8",
            });
            const link = document.createElement("a");
            link.href = URL.createObjectURL(blob);
            link.download = result.fileName;
            link.click();
            URL.revokeObjectURL(link.href);
            setMessage(messageElement, successMessage, "ok");
        } catch (error) {
            setMessage(messageElement, "Không xuất được file", "error");
        } finally {
            button.disabled = false;
        }
    }

    exportButton.addEventListener("click", () => {
        downloadExport(
            exportButton,
            filterDate.value,
            exportEntries,
            listMessage,
            "Đã tải file theo ngày đang lọc."
        );
    });

    summaryExportButton.addEventListener("click", () => {
        downloadExport(
            summaryExportButton,
            summaryDate.value || "all",
            exportSummary,
            summaryMessage,
            "Đã tải file tổng hợp 7 ngày."
        );
    });

    async function initializeBackend() {
        if (backendConnecting || backendReady) {
            return;
        }
        backendConnecting = true;
        appControls.forEach((control) => {
            control.disabled = true;
        });
        setServerStatus("Đang kết nối máy chủ...", "");

        const cachedStore = loadStore();
        try {
            const response = await fetch(`${API_BASE_URL}/api/store`);
            if (!response.ok) {
                throw new Error("Không đọc được dữ liệu trên máy chủ");
            }
            let store = await response.json();
            const serverHasData = store.periods?.length || Object.keys(store.entries || {}).length;
            if (!serverHasData) {
                store = cachedStore;
                const migration = await fetch(`${API_BASE_URL}/api/store`, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(store),
                });
                if (!migration.ok) {
                    throw new Error("Không chuyển được dữ liệu cũ lên máy chủ");
                }
            }
            localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
            backendReady = true;
            backendWriteError = null;
            setServerStatus("Đã kết nối; dữ liệu được lưu trên server.", "ok");
        } catch (error) {
            backendReady = false;
            backendWriteError = error;
            setServerStatus("Không kết nối được server; dữ liệu chỉ lưu trên trình duyệt.", "error");
        } finally {
            backendConnecting = false;
            backendInitialized = backendReady;
            appControls.forEach((control) => {
                control.disabled = !backendReady;
            });
            if (backendReady) {
                refreshSummaryDates();
                refreshEntryBudget();
                loadEntries();
                if (!summaryPanel.hidden) {
                    renderSummary();
                }
            }
        }
    }

    const today = todayIso();
    entryDate.value = today;
    filterDate.value = today;
    appControls.forEach((control) => {
        control.disabled = true;
    });
    initializeBackend();
})();