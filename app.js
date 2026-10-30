(function () {
    "use strict";

    const STORAGE_KEY = "expense-management-v1";
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
    const entryDate = document.querySelector("#entry-date");
    const budgetAmount = document.querySelector("#budget-amount");
    const budgetLocked = document.querySelector("#budget-locked");
    const entryContent = document.querySelector("#entry-content");
    const entryAmount = document.querySelector("#entry-amount");
    const saveButton = document.querySelector("#save-button");
    const filterDate = document.querySelector("#filter-date");
    const exportButton = document.querySelector("#export-button");
    const summaryDate = document.querySelector("#summary-date");
    const summaryRange = document.querySelector("#summary-range");
    const summaryRows = document.querySelector("#summary-rows");
    const summaryTotal = document.querySelector("#summary-total");
    const dayPanel = document.querySelector("#day-panel");
    const summaryPanel = document.querySelector("#summary-panel");
    const dayTab = document.querySelector("#day-tab");
    const summaryTab = document.querySelector("#summary-tab");
    const dayFilter = document.querySelector(".filter-bar");
    const entryRows = document.querySelector("#entry-rows");
    const spentCell = document.querySelector("#spent-cell");
    const periodSpentCell = document.querySelector("#period-spent-cell");
    const remainingCell = document.querySelector("#remaining-cell");
    const remainingValue = document.querySelector("#remaining-value");
    const remainingBox = document.querySelector("#remaining-box");
    const periodNote = document.querySelector("#period-note");
    const formMessage = document.querySelector("#form-message");
    const listMessage = document.querySelector("#list-message");

    const moneyFormat = new Intl.NumberFormat("vi-VN");
    let savedBudget = 0;
    let periodSpent = 0;
    let daySpent = 0;
    let budgetSet = false;
    let previousRemaining = null;

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
        const period = findPeriod(isoDate, readPeriods(store));
        if (!period) {
            return { ok: true, period: null, entries: [], spent: 0 };
        }
        const today = todayIso();
        const scheduledEnd = periodEnd(period.start);
        const end = today < period.start
            ? null
            : today < scheduledEnd
              ? today
              : scheduledEnd;
        const entries = [];
        let spentCents = 0;
        if (end) {
            let cursor = period.start;
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
            period: { start: period.start, end, scheduledEnd, budget: centsToAmount(period.budgetCents) },
            entries,
            spent: centsToAmount(spentCents),
        };
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
        const counted =
            budgetSet || typedBudget !== null ? periodSpent + extra : periodSpent;
        periodSpentCell.textContent = formatMoney(counted);
        paintRemaining(remainingCell, remaining);
    }

    function renderRows(items) {
        entryRows.replaceChildren();
        if (!items.length) {
            const row = document.createElement("tr");
            const cell = document.createElement("td");
            cell.colSpan = 3;
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
            indexCell.textContent = String(index + 1);
            contentCell.textContent = item.content;
            amountCell.textContent = formatMoney(item.amount);
            amountCell.className = "col-money";
            row.append(indexCell, contentCell, amountCell);
            entryRows.append(row);
        });
    }

    function renderSummary() {
        const payload = summarizeEntries(summaryDate.value);
        summaryRows.replaceChildren();
        summaryTotal.textContent = formatMoney(payload.spent || 0);
        if (!payload.period) {
            summaryRange.textContent = "Ngày này chưa có tổng tiền được nhập cho kỳ 7 ngày.";
            summaryRows.append(createEmptyRow("Chưa có dữ liệu tổng hợp cho ngày này."));
            return;
        }
        const period = payload.period;
        if (period.end) {
            summaryRange.textContent = `Kỳ ${formatVn(period.start)} - ${formatVn(period.end)} · Tổng tiền: ${formatMoney(period.budget)}`;
        } else {
            summaryRange.textContent = `Kỳ bắt đầu ${formatVn(period.start)} · Chưa tới ngày bắt đầu · Tổng tiền: ${formatMoney(period.budget)}`;
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
        dayFilter.hidden = showSummary;
        if (showSummary) {
            summaryDate.value = filterDate.value || entryDate.value || todayIso();
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
            periodSpentCell.textContent = formatMoney(0);
            paintRemaining(remainingCell, 0);
            return;
        }
        setMessage(listMessage, "");
        const payload = listEntries(date);
        if (!payload.ok) {
            renderRows([]);
            spentCell.textContent = formatMoney(0);
            periodSpentCell.textContent = formatMoney(0);
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
        periodSpentCell.textContent = formatMoney(payload.periodSpent || 0);
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

    entryForm.addEventListener("submit", (event) => {
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
            const payload = saveEntry(body);
            if (!payload.ok) {
                setMessage(formMessage, payload.message || "Không lưu được", "error");
                return;
            }
            entryContent.value = "";
            entryAmount.value = "";
            entryContent.focus();
            filterDate.value = entryDate.value;
            setMessage(
                formMessage,
                `Đã lưu. Còn lại ${formatMoney(payload.remaining)}.`,
                "ok"
            );
            loadEntries();
        } finally {
            saveButton.disabled = false;
        }
    });

    budgetAmount.addEventListener("input", updateRemainingPreview);
    entryAmount.addEventListener("input", updateRemainingPreview);

    budgetAmount.addEventListener("change", () => {
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
        captureState(payload);
        setMessage(
            formMessage,
            `Đã mở kỳ 7 ngày. Còn lại ${formatMoney(payload.remaining)}.`,
            "ok"
        );
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
        summaryDate.value = filterDate.value;
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
        filterDate.value = summaryDate.value;
        renderSummary();
        loadEntries();
    });
    dayTab.addEventListener("click", () => selectTab(dayTab));
    summaryTab.addEventListener("click", () => selectTab(summaryTab));

    exportButton.addEventListener("click", () => {
        const date = filterDate.value;
        if (!date) {
            setMessage(listMessage, "Chọn ngày cần xuất file", "error");
            return;
        }
        exportButton.disabled = true;
        try {
            const result = exportEntries(date);
            if (!result.ok) {
                setMessage(listMessage, result.message || "Không xuất được file", "error");
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
            setMessage(listMessage, "Đã tải file theo ngày đang lọc.", "ok");
        } catch (error) {
            setMessage(listMessage, "Không xuất được file", "error");
        } finally {
            exportButton.disabled = false;
        }
    });

    const today = todayIso();
    entryDate.value = today;
    filterDate.value = today;
    summaryDate.value = today;
    try {
        loadEntries();
    } catch (error) {
        setMessage(listMessage, "Không tải được danh sách", "error");
    }
})();