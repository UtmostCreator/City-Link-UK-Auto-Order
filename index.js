// ==UserScript==
// @name         Citylink Booking Helper (Search -> Details, UI + Next/GO + Panel Log)
// @namespace    local.citylink.booking.helper
// @version      2026-01-17.8
// @description  Citylink booking automation with UI, Next/GO buttons, Pause/Resume, Minimize, notifications, and in-panel logging across SPA pages. (Stops at payment)
// @match        https://booking.citylink.co.uk/*
// @run-at       document-end
// @noframes
// ==/UserScript==

(() => {
    "use strict";

    // =========================================================
    // Random timing (fast but human-like)
    // =========================================================
    const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
    const delayInteractionMs = () => randInt(150, 358);
    const delayLoadMs = () => randInt(333, 1333);

    // =========================================================
    // Config
    // =========================================================
    const CFG = {
        mountSel: ".min-h-screen.flex.flex-col.bg-gray-primary.bg-opacity-100",
        wrapperSel: ".search-bar__wrapper",
        uiId: "cl-booking-helper-ui",
        notifMs: delayLoadMs(),
        waitMs: delayLoadMs(),
        pollMs: 90,
        goMaxHops: 12,
    };

    const OPTIONS = {
        from: [
            "Dunblane Newton Loan",
            "Grangemouth Inchyra Rd",
            "Grangemouth",
            "Edinburgh Princes Street",
            "Edinburgh Shandwick Place",
        ],
        to: [
            "Dunblane Newton Loan",
            "Grangemouth Inchyra Rd",
            "Grangemouth",
            "Edinburgh Princes Street",
            "Edinburgh Shandwick Place",
        ],
    };

    const DEFAULTS = {
        from: "Grangemouth Inchyra Rd",
        to: "Edinburgh Princes Street",
        departTime: "07.00",
        returnTime: "17.00",
    };

    const STOP = Symbol("STOP");

    // =========================================================
    // Micro-toolkit
    // =========================================================
    const $ = (s, r = document) => r.querySelector(s);
    const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
    const S = (ms) => new Promise((r) => setTimeout(r, ms));
    const norm = (s) => (s ?? "").toString().replace(/\s+/g, " ").trim();
    const eq = (a, b) => norm(a).toLowerCase() === norm(b).toLowerCase();
    const visible = (el) => !!(el && (el.offsetParent !== null || el.getClientRects().length));
    const textOf = (el) => norm(el?.innerText ?? el?.textContent ?? "");

    async function W(selOrFn, opt = {}) {
        const timeoutMs = opt.timeoutMs ?? CFG.waitMs;
        const pollMs = opt.pollMs ?? CFG.pollMs;
        const t0 = Date.now();

        while (Date.now() - t0 < timeoutMs) {
            try {
                const v = typeof selOrFn === "function" ? selOrFn() : document.querySelector(selOrFn);
                if (v) return v;
            } catch {}
            await S(pollMs);
        }
        return null;
    }

    async function WV(selOrFn, opt = {}) {
        return W(() => {
            const v = typeof selOrFn === "function" ? selOrFn() : document.querySelector(selOrFn);
            return v && visible(v) ? v : null;
        }, opt);
    }

    async function retryWait(selOrFn, attempts = 6, timeoutFn = delayLoadMs) {
        for (let i = 0; i < attempts; i++) {
            const v = await W(selOrFn, { timeoutMs: timeoutFn() });
            if (v) return v;
            await S(delayInteractionMs());
        }
        return null;
    }

    // =========================================================
    // Runner state (Pause/Resume)
    // =========================================================
    const Runner = {
        busy: false,
        paused: localStorage.getItem("cl_paused") === "1",

        setPaused(v) {
            this.paused = !!v;
            localStorage.setItem("cl_paused", this.paused ? "1" : "0");
        },

        togglePaused() {
            this.setPaused(!this.paused);
            return this.paused;
        },

        reset() {
            this.busy = false;
            // keep paused state
        },
    };

    // =========================================================
    // Notifications
    // =========================================================
    function notifHost(container) {
        let host = $("#cl_notifs");
        if (host) return host;

        host = document.createElement("div");
        host.id = "cl_notifs";
        host.style.position = "fixed";
        host.style.left = "50%";
        host.style.top = "10px";
        host.style.transform = "translateX(-50%)";
        host.style.zIndex = "2147483647";
        host.style.display = "flex";
        host.style.flexDirection = "column";
        host.style.gap = "8px";
        host.style.pointerEvents = "none";
        container.appendChild(host);
        return host;
    }

    function notify(container, msg) {
        const host = notifHost(container);
        const el = document.createElement("div");
        el.textContent = msg;
        el.style.pointerEvents = "none";
        el.style.background = "rgba(16, 6, 159, 0.96)";
        el.style.color = "white";
        el.style.padding = "8px 12px";
        el.style.borderRadius = "10px";
        el.style.font = "12px/1.2 system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, sans-serif";
        el.style.boxShadow = "0 6px 18px rgba(0,0,0,0.25)";
        el.style.maxWidth = "92vw";
        el.style.whiteSpace = "nowrap";
        el.style.overflow = "hidden";
        el.style.textOverflow = "ellipsis";
        host.appendChild(el);
        setTimeout(() => el.remove(), CFG.notifMs);
    }

    // =========================================================
    // Panel log
    // =========================================================
    function panelEnsureLog(panel) {
        if (!panel || panel.querySelector("#cl_action")) return;

        const action = document.createElement("div");
        action.id = "cl_action";
        action.style.font = "12px/1.3 system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, sans-serif";
        action.style.color = "#10069f";
        action.style.opacity = "0.9";
        action.textContent = "Action: Idle";

        const logTitle = document.createElement("div");
        logTitle.style.marginTop = "8px";
        logTitle.style.font = "12px/1.3 system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, sans-serif";
        logTitle.style.color = "#10069f";
        logTitle.style.fontWeight = "700";
        logTitle.textContent = "Log";

        const logBox = document.createElement("div");
        logBox.id = "cl_log";
        logBox.style.marginTop = "6px";
        logBox.style.padding = "8px";
        logBox.style.borderRadius = "10px";
        logBox.style.background = "rgba(0,0,0,0.08)";
        logBox.style.maxHeight = "160px";
        logBox.style.overflowY = "auto";
        logBox.style.whiteSpace = "pre-wrap";
        logBox.style.font =
            "11px/1.35 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace";
        logBox.textContent = "";

        panel.appendChild(action);
        panel.appendChild(logTitle);
        panel.appendChild(logBox);
    }

    function panelAction(panel, text) {
        const el = panel?.querySelector?.("#cl_action");
        if (el) el.textContent = `Action: ${text}`;
    }

    function panelLog(panel, level, msg) {
        const ts = new Date().toLocaleTimeString();
        const line = `[${ts}] ${level.toUpperCase()}: ${msg}`;
        if (level === "error") console.error(line);
        else console.log(line);

        const box = panel?.querySelector?.("#cl_log");
        if (!box) return;
        box.textContent = (box.textContent ? box.textContent + "\n" : "") + line;
        box.scrollTop = box.scrollHeight;
    }

    function fail(container, panel, msg, err) {
        panelLog(panel, "error", `${msg}${err?.message ? ` (${err.message})` : ""}`);
        notify(container, `ERROR: ${msg}`);
        throw err || new Error(msg);
    }

    // =========================================================
    // Pacing + Human click
    // =========================================================
    let __cl_lastActionAt = 0;

    async function pace(minGapMs) {
        const gap = typeof minGapMs === "number" ? minGapMs : delayInteractionMs();
        const now = Date.now();
        const wait = __cl_lastActionAt + gap - now;
        if (wait > 0) await S(wait);
        __cl_lastActionAt = Date.now();
    }

    async function clickHumanPaced(el) {
        if (!el) return false;
        await pace();

        try {
            el.scrollIntoView({ block: "center", inline: "center" });
        } catch {}

        const r = el.getBoundingClientRect();
        const x = r.left + r.width * (0.30 + Math.random() * 0.40);
        const y = r.top + r.height * (0.30 + Math.random() * 0.40);

        const win = el.ownerDocument?.defaultView || document.defaultView;
        const ev = (t) =>
            new MouseEvent(t, {
                bubbles: true,
                cancelable: true,
                view: win,
                clientX: x,
                clientY: y,
            });

        el.dispatchEvent(ev("mousemove"));
        el.dispatchEvent(ev("mouseover"));
        el.dispatchEvent(ev("mouseenter"));
        el.dispatchEvent(ev("mousedown"));
        await S(randInt(35, 120));
        el.dispatchEvent(ev("mouseup"));
        el.dispatchEvent(ev("click"));
        return true;
    }

    async function clickSafe(el) {
        if (!el) return false;

        if (visible(el)) {
            return clickHumanPaced(el);
        }

        // Not visible (e.g. display:none on mobile header) -> still try direct click
        try {
            el.click();
            return true;
        } catch {}

        try {
            el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
            return true;
        } catch {}

        return false;
    }

    // =========================================================
    // Native input typing (for autocomplete)
    // =========================================================
    function setNativeValue(el, value) {
        if (!el) return;
        const proto = Object.getPrototypeOf(el);
        const desc = Object.getOwnPropertyDescriptor(el, "value") || Object.getOwnPropertyDescriptor(proto, "value");
        if (desc && typeof desc.set === "function") desc.set.call(el, value);
        else el.value = value;
    }

    async function typeLikeUser(el, value, minDelay = 25, maxDelay = 75) {
        if (!el) return;

        el.focus();
        await new Promise(requestAnimationFrame);

        setNativeValue(el, "");
        el.dispatchEvent(new Event("input", { bubbles: true }));

        for (let i = 0; i < value.length; i++) {
            const next = value.slice(0, i + 1);
            setNativeValue(el, next);

            const ch = value[i];
            el.dispatchEvent(new KeyboardEvent("keydown", { key: ch, bubbles: true }));
            el.dispatchEvent(new KeyboardEvent("keypress", { key: ch, bubbles: true }));
            el.dispatchEvent(new Event("input", { bubbles: true }));
            el.dispatchEvent(new KeyboardEvent("keyup", { key: ch, bubbles: true }));

            if (typeof el.setSelectionRange === "function") el.setSelectionRange(next.length, next.length);
            await S(randInt(minDelay, maxDelay));
        }

        el.dispatchEvent(new Event("change", { bubbles: true }));
        if (typeof el.setSelectionRange === "function") el.setSelectionRange(value.length, value.length);
    }

    function findButtonContainingSvg(root, svgSelector) {
        if (!root) return null;
        return Array.from(root.querySelectorAll("button")).find((b) => b.querySelector(svgSelector)) || null;
    }

    // =========================================================
    // LOGIN CHECK COOLDOWN (10–15 min)
    // =========================================================
    const LOGIN_CHECK = {
        keyNextAt: "cl_login_next_check_at",
        minMs: 10 * 60 * 1000,
        maxMs: 15 * 60 * 1000,

        now() {
            return Date.now();
        },

        nextAt() {
            return parseInt(localStorage.getItem(this.keyNextAt) || "0", 10);
        },

        setNextAt(ts) {
            localStorage.setItem(this.keyNextAt, String(ts));
        },

        scheduleNext() {
            const next = this.now() + randInt(this.minMs, this.maxMs);
            this.setNextAt(next);
            return next;
        },

        canCheck() {
            return this.now() >= this.nextAt();
        },
    };

    // =========================================================
    // LOGIN GUARD (desktop + mobile) + COOLDOWN
    // =========================================================
    function findLoginInHeader(scope = document) {
        const nav = scope.querySelector(".header__nav");
        if (!nav) return null;

        const candidates = Array.from(nav.querySelectorAll("a.header__link.cursor-pointer, a.header__link"));
        return candidates.find((a) => textOf(a).toLowerCase() === "login") || null;
    }

    function findMobileMenuButton(scope = document) {
        return scope.querySelector("button.mobile-menu-button") || null;
    }

    function findVisibleLoginAnywhere(scope = document) {
        const candidates = Array.from(scope.querySelectorAll("a,button,[role='button']"));
        return (
            candidates.find((el) => {
                if (!visible(el)) return false;
                return textOf(el).toLowerCase() === "login";
            }) || null
        );
    }

    async function openMobileMenuIfNeeded(panel) {
        const menuBtn = findMobileMenuButton(document);
        if (!menuBtn || !visible(menuBtn)) return false;

        if (findVisibleLoginAnywhere(document)) return true;

        panelLog(panel, "info", "Mobile menu button detected -> opening menu");
        await clickHumanPaced(menuBtn);
        await S(250);
        return true;
    }

    let __cl_login_check_inflight = false;

    async function guardLoginIfPresent(container, panel) {
        // Run login detection only once per 10–15 minutes
        if (!LOGIN_CHECK.canCheck()) return false;
        if (__cl_login_check_inflight) return false;

        __cl_login_check_inflight = true;

        // Schedule next check immediately (even if we fail to find anything)
        const nextAt = LOGIN_CHECK.scheduleNext();

        try {
            panelLog(panel, "info", `Login check running. Next check after: ${new Date(nextAt).toLocaleTimeString()}`);

            // 1) Desktop header (may be hidden on mobile, still clickable sometimes)
            const headerLogin = findLoginInHeader(document);
            if (headerLogin) {
                panelLog(panel, "info", "Login detected (header) -> clicking");
                notify(container, "Login detected -> opening login");
                await clickSafe(headerLogin);
                return true;
            }

            // 2) Mobile menu open + re-check
            await openMobileMenuIfNeeded(panel);

            const loginAfterMenu = findVisibleLoginAnywhere(document);
            if (loginAfterMenu) {
                panelLog(panel, "info", "Login detected (mobile menu) -> clicking");
                notify(container, "Login detected -> opening login");
                await clickHumanPaced(loginAfterMenu);
                return true;
            }

            // 3) Final fallback: global scan (visible only)
            const anyVisibleLogin = findVisibleLoginAnywhere(document);
            if (anyVisibleLogin) {
                panelLog(panel, "info", "Login detected (fallback visible scan) -> clicking");
                notify(container, "Login detected -> opening login");
                await clickHumanPaced(anyVisibleLogin);
                return true;
            }

            return false;
        } finally {
            __cl_login_check_inflight = false;
        }
    }

    // =========================================================
    // Overlay removal guard
    // =========================================================
    function isBlockingAdOverlay(el) {
        if (!(el instanceof HTMLElement)) return false;
        const c = el.classList;
        return (
            c.contains("fixed") &&
            c.contains("top-0") &&
            c.contains("left-0") &&
            c.contains("w-screen") &&
            c.contains("h-screen") &&
            c.contains("bg-white") &&
            c.contains("bg-opacity-75") &&
            c.contains("z-50") &&
            c.contains("flex") &&
            c.contains("items-center")
        );
    }

    function removeAdOverlaysOnce(panelRoot) {
        const overlays = Array.from(document.querySelectorAll("div.fixed.z-50")).filter(isBlockingAdOverlay);
        if (!overlays.length) return 0;

        overlays.forEach((el) => {
            try {
                el.remove();
            } catch {
                el.style.display = "none";
                el.style.pointerEvents = "none";
                el.style.opacity = "0";
            }
        });

        if (panelRoot) panelLog(panelRoot, "info", `Removed overlay(s): ${overlays.length}`);
        return overlays.length;
    }

    function startAdOverlayGuard(panelRoot) {
        if (window.__cl_ad_guard_started__) return;
        window.__cl_ad_guard_started__ = true;

        removeAdOverlaysOnce(panelRoot);

        const mo = new MutationObserver(() => removeAdOverlaysOnce(panelRoot));
        mo.observe(document.documentElement, { childList: true, subtree: true });

        if (panelRoot) panelLog(panelRoot, "info", "Ad overlay guard started");
    }

    // =========================================================
    // waitAppReady()
    // =========================================================
    async function waitAppReady(panelRoot) {
        removeAdOverlaysOnce(panelRoot);

        const okRoot = await retryWait(() => document.querySelector(CFG.mountSel), 6, delayLoadMs);
        if (!okRoot) return false;

        removeAdOverlaysOnce(panelRoot);

        for (let i = 0; i < 4; i++) {
            const ok = await W(
                () => {
                    removeAdOverlaysOnce(panelRoot);
                    const overlay =
                        document.querySelector("[role='progressbar']") ||
                        document.querySelector(".spinner") ||
                        document.querySelector(".loading") ||
                        document.querySelector(".overlay");
                    return overlay ? null : true;
                },
                { timeoutMs: delayLoadMs() }
            );

            if (ok) break;
            await S(delayInteractionMs());
        }

        await S(delayInteractionMs());
        return true;
    }

    // =========================================================
    // UI
    // =========================================================
    function todayDay() {
        return new Date().getDate();
    }

    function timeOptions() {
        const out = [];
        for (let h = 0; h <= 23; h++) out.push(String(h).padStart(2, "0") + ".00");
        return out;
    }

    function getSettings() {
        return {
            from: $("#cl_from")?.value ?? DEFAULTS.from,
            to: $("#cl_to")?.value ?? DEFAULTS.to,
            day: parseInt($("#cl_day")?.value ?? String(todayDay()), 10),
            departTime: $("#cl_dep")?.value ?? DEFAULTS.departTime,
            returnTime: $("#cl_ret")?.value ?? DEFAULTS.returnTime,
        };
    }

    function setStatus(text) {
        const el = $("#cl_status");
        if (el) el.textContent = text;
    }

    function applyMinState(root) {
        const body = $("#cl_ui_body", root);
        const btnMin = $("#cl_btn_min", root);
        if (!body || !btnMin) return;

        const minimized = localStorage.getItem("cl_ui_minimized") === "1";
        body.style.display = minimized ? "none" : "flex";
        btnMin.textContent = minimized ? "Expand" : "Minimize";
    }

    function applyPauseState(root) {
        const btnPause = $("#cl_btn_pause", root);
        if (!btnPause) return;

        btnPause.textContent = Runner.paused ? "Resume" : "Pause";
        btnPause.style.opacity = Runner.paused ? "0.85" : "1";
    }

    function ensureUI(mountEl) {
        let root = document.getElementById(CFG.uiId);
        if (root) {
            applyMinState(root);
            applyPauseState(root);
            return root;
        }

        const mkBtn = (txt, primary) => {
            const b = document.createElement("button");
            b.type = "button";
            b.textContent = txt;
            b.style.height = "34px";
            b.style.padding = "0 14px";
            b.style.borderRadius = "10px";
            b.style.border = "1px solid rgba(16, 6, 159, 0.25)";
            b.style.background = primary ? "#10069f" : "white";
            b.style.color = primary ? "white" : "#10069f";
            b.style.font = "13px/1 system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, sans-serif";
            b.style.cursor = "pointer";
            return b;
        };

        const mkSelect = (id, label, opts, defVal) => {
            const wrap = document.createElement("div");
            wrap.style.display = "flex";
            wrap.style.flexDirection = "column";
            wrap.style.gap = "4px";

            const lab = document.createElement("label");
            lab.textContent = label;
            lab.style.font = "12px/1.2 system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, sans-serif";
            lab.style.color = "#10069f";
            lab.style.fontWeight = "700";

            const sel = document.createElement("select");
            sel.id = id;
            sel.style.height = "34px";
            sel.style.borderRadius = "10px";
            sel.style.border = "1px solid rgba(16, 6, 159, 0.25)";
            sel.style.padding = "0 10px";
            sel.style.font = "13px/1 system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, sans-serif";
            sel.style.outline = "none";
            sel.style.background = "white";

            for (const t of opts) {
                const o = document.createElement("option");
                o.value = t;
                o.textContent = t;
                sel.appendChild(o);
            }
            if (defVal != null) sel.value = defVal;

            wrap.appendChild(lab);
            wrap.appendChild(sel);
            return wrap;
        };

        const mkNumber = (id, label, min, max, defVal) => {
            const opts = [];
            for (let i = min; i <= max; i++) opts.push(String(i));
            return mkSelect(id, label, opts, String(defVal));
        };

        root = document.createElement("div");
        root.id = CFG.uiId;
        root.style.position = "sticky";
        root.style.top = "0";
        root.style.zIndex = "2147483647";
        root.style.width = "100%";
        root.style.padding = "10px 12px";
        root.style.borderBottom = "1px solid rgba(16, 6, 159, 0.18)";
        root.style.background = "rgba(255,255,255,0.92)";
        root.style.backdropFilter = "blur(8px)";
        root.style.boxShadow = "0 10px 22px rgba(0,0,0,0.08)";

        const wrap = document.createElement("div");
        wrap.style.maxWidth = "1100px";
        wrap.style.margin = "0 auto";
        wrap.style.display = "flex";
        wrap.style.flexDirection = "column";
        wrap.style.gap = "10px";

        const top = document.createElement("div");
        top.style.display = "flex";
        top.style.alignItems = "center";
        top.style.justifyContent = "space-between";
        top.style.gap = "10px";
        top.style.flexWrap = "wrap";

        const title = document.createElement("div");
        title.textContent = "Citylink Helper";
        title.style.font = "14px/1.2 system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, sans-serif";
        title.style.color = "#10069f";
        title.style.fontWeight = "800";

        const actions = document.createElement("div");
        actions.style.display = "flex";
        actions.style.gap = "8px";
        actions.style.flexWrap = "wrap";

        const btnGo = mkBtn("GO", true);
        const btnNext = mkBtn("Next step", false);
        const btnPause = mkBtn(Runner.paused ? "Resume" : "Pause", false);
        const btnMin = mkBtn("Minimize", false);
        const btnReset = mkBtn("Reset", false);

        btnGo.id = "cl_btn_go";
        btnNext.id = "cl_btn_next";
        btnPause.id = "cl_btn_pause";
        btnMin.id = "cl_btn_min";
        btnReset.id = "cl_btn_reset";

        actions.appendChild(btnGo);
        actions.appendChild(btnNext);
        actions.appendChild(btnPause);
        actions.appendChild(btnMin);
        actions.appendChild(btnReset);

        top.appendChild(title);
        top.appendChild(actions);

        const grid = document.createElement("div");
        grid.style.display = "grid";
        grid.style.gridTemplateColumns = "repeat(auto-fit, minmax(200px, 1fr))";
        grid.style.gap = "10px";

        grid.appendChild(mkSelect("cl_from", "FROM", OPTIONS.from, DEFAULTS.from));
        grid.appendChild(mkSelect("cl_to", "TO", OPTIONS.to, DEFAULTS.to));
        grid.appendChild(mkNumber("cl_day", "Ticket For (day)", 1, 31, todayDay()));
        grid.appendChild(mkSelect("cl_dep", "Depart Time", timeOptions(), DEFAULTS.departTime));
        grid.appendChild(mkSelect("cl_ret", "Return Time", timeOptions(), DEFAULTS.returnTime));

        const footer = document.createElement("div");
        footer.style.display = "flex";
        footer.style.alignItems = "center";
        footer.style.gap = "10px";
        footer.style.flexWrap = "wrap";

        const status = document.createElement("div");
        status.id = "cl_status";
        status.textContent = Runner.paused ? "Paused" : "Idle";
        status.style.font = "12px/1.2 system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, sans-serif";
        status.style.color = "#10069f";
        status.style.opacity = "0.9";
        footer.appendChild(status);

        const body = document.createElement("div");
        body.id = "cl_ui_body";
        body.style.display = "flex";
        body.style.flexDirection = "column";
        body.style.gap = "10px";

        body.appendChild(grid);
        body.appendChild(footer);
        panelEnsureLog(body);

        wrap.appendChild(top);
        wrap.appendChild(body);
        root.appendChild(wrap);

        mountEl.insertBefore(root, mountEl.firstChild);

        // Minimize binding
        btnMin.addEventListener("click", () => {
            const minimized = localStorage.getItem("cl_ui_minimized") === "1";
            localStorage.setItem("cl_ui_minimized", minimized ? "0" : "1");
            applyMinState(root);
        });

        // Pause binding
        btnPause.addEventListener("click", () => {
            Runner.togglePaused();
            applyPauseState(root);
            setStatus(Runner.paused ? "Paused" : "Idle");
            notify(mountEl, Runner.paused ? "Paused" : "Resumed");
        });

        // Reset binding
        btnReset.addEventListener("click", () => {
            Runner.reset();
            setStatus("Idle (reset)");
            panelAction(body, "Idle (reset)");
            panelLog(body, "info", "Runner reset");
            notify(mountEl, "runner reset");
        });

        applyMinState(root);
        applyPauseState(root);

        return root;
    }

    // =========================================================
    // Page detection (Stops at payment)
    // =========================================================
    function pageKey() {
        const u = location.href;
        if (u.includes("/#/results")) return "results";
        if (u.includes("/#/summary")) return "summary";
        if (u.includes("/#/passengers")) return "passengers";
        if (u.includes("/#/details")) return "details";
        if (u.includes("/#/payment")) return "payment";
        return "search";
    }

    // =========================================================
    // Search-page finders
    // =========================================================
    const findWrapper = () => $(CFG.wrapperSel);

    function findTypeSelect(wrapper) {
        const labels = $$("label", wrapper).filter((l) => eq(l.textContent, "Type"));
        for (const lab of labels) {
            const box = lab.closest("div");
            const sel = box?.parentElement?.querySelector("select");
            if (sel) return sel;
        }
        return wrapper.querySelector("select");
    }

    const findFromInput = (wrapper) => $("#From", wrapper) || $("#From");
    const findToInput = (wrapper) => $("#To", wrapper) || $("#To");
    const findDepartureBtn = (wrapper) => $$("button", wrapper).find((b) => b.textContent.includes("Departure Date")) || null;
    const findReturnBtn = (wrapper) => $$("button", wrapper).find((b) => b.textContent.includes("Add A Return")) || null;
    const findPassengersBtn =
        (wrapper) => $$("button", wrapper).find((b) => b.textContent.includes("Select Passengers")) || null;
    const findSearchBtn = (wrapper) => wrapper.querySelector(".search-button__inner") || document.querySelector(".search-button__inner");

    function findFlatpickrDay(dayNum) {
        return (
            $$(".flatpickr-day").find((d) => {
                if (!d || d.classList.contains("disabled")) return false;
                if (d.classList.contains("prevMonthDay") || d.classList.contains("nextMonthDay")) return false;
                if (!visible(d)) return false;
                return norm(d.textContent) === String(dayNum);
            }) || null
        );
    }

    async function chooseAutocomplete(inputEl, valueText) {
        await pace();
        await typeLikeUser(inputEl, valueText);
        await S(delayInteractionMs());

        const dropdown = await WV(
            () =>
                document.querySelector(
                    ".flex.absolute.top-full.left-0.w-full.z-50.bg-white.rounded-b-xl.max-h-96.overflow-y-scroll.border.border-solid"
                ),
            { timeoutMs: delayLoadMs() }
        );

        if (!dropdown) return false;

        const btn = $$(
            "button.bg-none.border-none.outline-none.m-3.w-full.flex.justify-start.text-left.text-blue-primary.text-base.font-serif",
            dropdown
        ).find((b) => eq(b.textContent, valueText));

        if (!btn) return false;

        await clickHumanPaced(btn);
        await S(delayInteractionMs());
        return true;
    }

    async function pickTimeAndDone(timeText) {
        const area = $$(".datePicker__time").find(visible) || $(".datePicker__time");
        if (!area) return false;

        const sel = area.querySelector("select.styled-select") || $("select.styled-select");
        if (!sel) return false;

        const opt = Array.from(sel.options || []).find((o) => eq(o.textContent, timeText));
        if (!opt) return false;

        sel.value = opt.value;
        sel.dispatchEvent(new Event("change", { bubbles: true }));

        const done = $("#doneButton") || area.querySelector("#doneButton");
        if (done) await clickHumanPaced(done);

        return true;
    }

    // =========================================================
    // Steps (search page)
    // =========================================================
    async function step_type(container, panel, wrapper) {
        panelAction(panel, "Search: selecting Type = Single/Return");
        panelLog(panel, "info", "Selecting Type: Single/Return");

        const sel = findTypeSelect(wrapper);
        if (!sel) fail(container, panel, "Type select not found");

        const opt = Array.from(sel.options).find((o) => eq(o.textContent, "Single/Return"));
        if (!opt) fail(container, panel, 'Option "Single/Return" not found');

        await pace();
        sel.value = opt.value;
        sel.dispatchEvent(new Event("change", { bubbles: true }));
        notify(container, "type selected");
    }

    async function step_from(container, panel, wrapper, st) {
        panelAction(panel, `Search: selecting FROM = ${st.from}`);
        panelLog(panel, "info", `Selecting FROM: ${st.from}`);

        const input = findFromInput(wrapper);
        if (!input) fail(container, panel, "From input not found");

        const ok = await chooseAutocomplete(input, st.from);
        if (!ok) fail(container, panel, "FROM option not found/clickable");
        notify(container, "FROM selected");
    }

    async function step_to(container, panel, wrapper, st) {
        panelAction(panel, `Search: selecting TO = ${st.to}`);
        panelLog(panel, "info", `Selecting TO: ${st.to}`);

        const input = findToInput(wrapper);
        if (!input) fail(container, panel, "To input not found");

        const btn = $$("button.m-2.flex.w-full.items-center.border-none").find((b) => b.querySelector("#To"));
        if (btn) await clickHumanPaced(btn);

        const ok = await chooseAutocomplete(input, st.to);
        if (!ok) fail(container, panel, "TO option not found/clickable");
        notify(container, "TO selected");
    }

    async function step_depart(container, panel, wrapper, st) {
        panelAction(panel, `Search: departure date=${st.day}, time=${st.departTime}`);
        panelLog(panel, "info", `Selecting departure date ${st.day} and time ${st.departTime}`);

        const btn = findDepartureBtn(wrapper);
        if (!btn) fail(container, panel, "Departure Date button not found");
        await clickHumanPaced(btn);

        const dayEl = await retryWait(() => findFlatpickrDay(st.day), 6, delayLoadMs);
        if (!dayEl) fail(container, panel, "Departure day not found in calendar");
        await clickHumanPaced(dayEl);
        notify(container, "dep date selected");

        const ok = await W(() => pickTimeAndDone(st.departTime), { timeoutMs: delayLoadMs() });
        if (!ok) fail(container, panel, "Departure time select not found");
        notify(container, "dep time selected");
    }

    async function step_return(container, panel, wrapper, st) {
        panelAction(panel, `Search: return date=${st.day}, time=${st.returnTime}`);
        panelLog(panel, "info", `Selecting return date ${st.day} and time ${st.returnTime}`);

        let btn = findReturnBtn(wrapper);
        if (!btn) fail(container, panel, "Add A Return button not found");

        if (btn.disabled) {
            btn = await retryWait(
                () => {
                    const b = findReturnBtn(wrapper);
                    return b && !b.disabled ? b : null;
                },
                6,
                delayLoadMs
            );
            if (!btn) fail(container, panel, "Add A Return still disabled");
        }
        await clickHumanPaced(btn);

        const dayEl = await retryWait(() => findFlatpickrDay(st.day), 6, delayLoadMs);
        if (!dayEl) fail(container, panel, "Return day not found in calendar");
        await clickHumanPaced(dayEl);
        notify(container, "ret date selected");

        const ok = await W(() => pickTimeAndDone(st.returnTime), { timeoutMs: delayLoadMs() });
        if (!ok) fail(container, panel, "Return time select not found");
        notify(container, "ret time selected");
    }

    function readStepperValue(controlsEl) {
        if (!controlsEl) return NaN;
    
        // Most reliable: find standalone text node between buttons (e.g. " 1 ")
        const rawTextNodes = Array.from(controlsEl.childNodes)
            .filter((n) => n.nodeType === Node.TEXT_NODE)
            .map((n) => (n.textContent || "").trim())
            .join(" ");
    
        let m = rawTextNodes.match(/\b\d+\b/);
    
        // Fallback: parse from full textContent if text nodes were merged/empty
        if (!m) m = (controlsEl.textContent || "").match(/\b\d+\b/);
    
        return m ? parseInt(m[0], 10) : NaN;
    }
    
    async function step_passengers_searchpage(container, panel, wrapper) {
        panelAction(panel, "Search: adding 1 Adult passenger");
        panelLog(panel, "info", "Opening passengers panel and clicking Adult + then Done");

        const btn = findPassengersBtn(wrapper);
        if (!btn) fail(container, panel, "Passengers button not found");
        await clickHumanPaced(btn);

        const controls = adultLi.querySelector("div.flex.items-center.justify-center.text-blue-primary");
        if (!controls) fail(container, panel, "Adult controls container not found");
        
        // ✅ NEW: if already 1 adult, do not click +
        const currentAdult = readStepperValue(controls);
        
        if (Number.isFinite(currentAdult) && currentAdult >= 1) {
            panelLog(panel, "info", `Adult already selected (${currentAdult}) -> skipping +`);
            notify(container, `Adult already = ${currentAdult} (skip add)`);
        } else {
            const plusBtn = findButtonContainingSvg(controls, "svg.h-7"); // your existing selector for +
            if (!plusBtn) fail(container, panel, "Adult plus control not found");
        
            panelLog(panel, "info", `Adult currently = ${Number.isFinite(currentAdult) ? currentAdult : "?"} -> clicking +`);
            await clickHumanPaced(plusBtn);
            notify(container, "Adult added");
        }

        // ✅ keep your existing "Done" click below (must still run)
        const doneBtn = await W(() => {
            const b = list.querySelector("button.bg-blue-primary.hover\\:bg-blue-700.rounded-xl.text-white.font-serif");
            return b && visible(b) ? b : null;
        }, { timeoutMs: delayLoadMs() });
        
        if (!doneBtn) fail(container, panel, "Passengers Done button not found");
        
        await clickHumanPaced(doneBtn);


        const list = await WV("ul.list-none.m-4.md\\:m-0.w-full.p-0.flex.flex-col", { timeoutMs: delayLoadMs() });
        if (!list) fail(container, panel, "Passengers list not found");

        const adultLi = Array.from(list.querySelectorAll("li.w-full.flex.border-gray-primary.border-solid")).find((li) => {
            const label = li.querySelector("span.text-blue-primary.font-semibold.block.ml-2.mt-2");
            return label && eq(label.textContent, "Adult");
        });
        if (!adultLi) fail(container, panel, "Adult row not found");

        const controls = adultLi.querySelector("div.flex.items-center.justify-center.text-blue-primary");
        if (!controls) fail(container, panel, "Adult controls container not found");

        const plusBtn = findButtonContainingSvg(controls, "svg.h-7");
        if (!plusBtn) fail(container, panel, "Adult plus control not found");
        await clickHumanPaced(plusBtn);

        const doneBtn = await W(
            () => {
                const b = list.querySelector("button.bg-blue-primary.hover\\:bg-blue-700.rounded-xl.text-white.font-serif");
                return b && visible(b) ? b : null;
            },
            { timeoutMs: delayLoadMs() }
        );
        if (!doneBtn) fail(container, panel, "Passengers Done button not found");

        await clickHumanPaced(doneBtn);
        notify(container, "Adult added");
    }

    async function step_search(container, panel, wrapper) {
        panelAction(panel, "Search: clicking Search");
        panelLog(panel, "info", "Clicking search button");

        let btn = findSearchBtn(wrapper);
        if (!btn) fail(container, panel, "Search button (.search-button__inner) not found");

        if (btn && btn.tagName !== "BUTTON") {
            const b2 = btn.closest("button");
            if (b2) btn = b2;
        }

        await clickHumanPaced(btn);
        notify(container, "search clicked");
    }

    function inferSearchStep(wrapper, st) {
        const typeSel = findTypeSelect(wrapper);
        const fromIn = findFromInput(wrapper);
        const toIn = findToInput(wrapper);

        const typeOk = !!(
            typeSel && Array.from(typeSel.options).some((o) => o.selected && eq(o.textContent, "Single/Return"))
        );
        const fromOk = !!(fromIn && eq(fromIn.value, st.from));
        const toOk = !!(toIn && eq(toIn.value, st.to));

        if (!typeOk) return 1;
        if (!fromOk) return 2;
        if (!toOk) return 3;
        return 4;
    }

    // =========================================================
    // Steps (results/summary/passengers/details)
    // =========================================================
    async function step_results(container, panel) {
        panelAction(panel, "Results: selecting first outward + return and clicking Continue");
        panelLog(panel, "info", "Waiting for outward-results and return-results");

        const outward = await retryWait(() => document.getElementById("outward-results"), 6, delayLoadMs);
        if (!outward) fail(container, panel, "Outward results not found");

        const ret = await retryWait(() => document.getElementById("return-results"), 6, delayLoadMs);
        if (!ret) fail(container, panel, "Return results not found");

        panelAction(panel, "Results: selecting outward (first card__select)");
        const oSel = outward.querySelector("div.card div.card__select");
        if (!oSel) fail(container, panel, "Outward first card__select not found");
        await clickHumanPaced(oSel);
        await S(delayInteractionMs());
        notify(container, "Outward selected");

        await S(300);

        panelAction(panel, "Results: selecting return (first card__select)");
        const rSel = ret.querySelector("div.card div.card__select");
        if (!rSel) fail(container, panel, "Return first card__select not found");
        await clickHumanPaced(rSel);
        await S(delayInteractionMs());
        notify(container, "Return selected");

        panelAction(panel, "Results: clicking Continue");
        const contBtn = await retryWait(
            () => {
                const scope = document.querySelector("div.basket") || document.querySelector(".basket_footer") || document;
                const btns = Array.from(scope.querySelectorAll("button"));
                return (
                    btns.find((x) => {
                        if (!visible(x)) return false;
                        const t = norm(x.textContent).toLowerCase();
                        return t === "continue" || (t.includes("continue") && !t.includes("billing"));
                    }) || null
                );
            },
            8,
            delayLoadMs
        );

        if (!contBtn) fail(container, panel, "Continue button not found on results page");
        await clickHumanPaced(contBtn);
        notify(container, "Continue clicked");
    }

    async function step_summary(container, panel) {
        panelAction(panel, "Summary: clicking Proceed To checkout");
        panelLog(panel, "info", "Finding Proceed To checkout button");

        const btn = await retryWait(
            () => {
                const scope = document.querySelector(".basket_footer") || document;
                const all = Array.from(scope.querySelectorAll("button"));
                return all.find((x) => visible(x) && norm(x.textContent).toLowerCase().includes("proceed to checkout")) || null;
            },
            8,
            delayLoadMs
        );

        if (!btn) fail(container, panel, "Proceed To checkout button not found");
        await clickHumanPaced(btn);
        notify(container, "Proceed to checkout clicked");
    }

    async function step_passengers_page(container, panel) {
        panelAction(panel, "Passengers: Continue to billing info");
        panelLog(panel, "info", "Selecting delivery method and clicking Continue");

        const label = document.querySelector('label[for="1"]');
        const input = document.querySelector('input[name="deliveryMethod"][value="1"]');
        if (!label && !input) fail(container, panel, "Delivery method option (1) not found");

        if (label && visible(label)) await clickHumanPaced(label);
        else if (input) await clickHumanPaced(input);
        notify(container, "Delivery method selected");

        const cont = await retryWait(
            () => {
                const scope = document.querySelector(".basket_footer") || document;
                const btns = Array.from(scope.querySelectorAll("button"));
                return btns.find((x) => visible(x) && /continue to billing info/i.test(norm(x.textContent))) || null;
            },
            8,
            delayLoadMs
        );

        if (!cont) fail(container, panel, "Continue to billing info button not found (passengers)");
        await clickHumanPaced(cont);
        notify(container, "Continue to billing clicked");
    }

    async function step_details(container, panel) {
        panelAction(panel, "Details: clicking Continue to payment info");
        panelLog(panel, "info", "Finding Continue to payment info button");

        const cont = await retryWait(
            () => {
                const scope = document.querySelector(".basket_footer") || document;
                const btns = Array.from(scope.querySelectorAll("button"));
                return (
                    btns.find((x) => {
                        if (!visible(x)) return false;
                        const t = norm(x.innerText).toLowerCase();
                        return t.includes("continue to payment info");
                    }) || null
                );
            },
            8,
            delayLoadMs
        );

        if (!cont) fail(container, panel, "Continue to payment info button not found (details)");
        await clickHumanPaced(cont);
        notify(container, "Continue to payment clicked");
    }

    // =========================================================
    // runOne / runGo
    // =========================================================
    async function runOne(container, panel) {
        if (Runner.paused) {
            panelAction(panel, "PAUSED");
            panelLog(panel, "info", "Paused by user. No action taken.");
            notify(container, "Paused");
            return STOP;
        }

        panelLog(panel, "info", "waitAppReady()");
        const ready = await waitAppReady(panel);
        if (!ready) fail(container, panel, "App not ready (root/overlay)");

        // Login guard (cooldown 10–15 min)
        const loginClicked = await guardLoginIfPresent(container, panel);
        if (loginClicked) {
            panelAction(panel, "STOP: login required");
            panelLog(panel, "info", "Automation stopped: login page opened.");
            return STOP;
        }

        const page = pageKey();
        panelLog(panel, "info", `Page detected: ${page}`);

        if (page === "payment") {
            panelAction(panel, "STOP: payment page (manual)");
            panelLog(panel, "info", "Reached payment page. Automation stops here.");
            notify(container, "Payment reached: manual step");
            return STOP;
        }

        const st = getSettings();

        if (page === "search") {
            const wrapper = await retryWait(() => findWrapper(), 6, delayLoadMs);
            if (!wrapper) fail(container, panel, "search-bar__wrapper not found");

            const next = inferSearchStep(wrapper, st);
            setStatus(`Running search step ${next}`);
            panelAction(panel, `Search: step ${next}`);

            if (next === 1) return step_type(container, panel, wrapper);
            if (next === 2) return step_from(container, panel, wrapper, st);
            if (next === 3) return step_to(container, panel, wrapper, st);

            const depBtn = findDepartureBtn(wrapper);
            const retBtn = findReturnBtn(wrapper);
            const passBtn = findPassengersBtn(wrapper);
            const searchBtn = findSearchBtn(wrapper);

            if (depBtn?.textContent?.includes("Departure Date")) return step_depart(container, panel, wrapper, st);
            if (retBtn?.textContent?.includes("Add A Return")) return step_return(container, panel, wrapper, st);
            if (passBtn?.textContent?.includes("Select Passengers")) return step_passengers_searchpage(container, panel, wrapper);
            if (searchBtn) return step_search(container, panel, wrapper);

            panelLog(panel, "error", "No actionable step found on search page");
            notify(container, "No actionable step found");
            return;
        }

        if (page === "results") return step_results(container, panel);
        if (page === "summary") return step_summary(container, panel);
        if (page === "passengers") return step_passengers_page(container, panel);
        if (page === "details") return step_details(container, panel);

        panelLog(panel, "error", `No handler for page: ${page}`);
        notify(container, `No handler for ${page}`);
    }

    async function runGo(container, panel) {
        panelAction(panel, "GO: running page-to-page automation");
        panelLog(panel, "info", `GO started (maxHops=${CFG.goMaxHops})`);
        notify(container, "GO");

        for (let i = 0; i < CFG.goMaxHops; i++) {
            if (Runner.paused) {
                panelAction(panel, "PAUSED");
                panelLog(panel, "info", "GO stopped: paused by user.");
                notify(container, "GO paused");
                break;
            }

            panelLog(panel, "info", `GO hop ${i + 1}: runOne()`);

            const before = location.href;
            const res = await runOne(container, panel);

            if (res === STOP) {
                panelLog(panel, "info", "GO stopped (STOP returned).");
                break;
            }

            await W(() => (location.href !== before ? true : null), { timeoutMs: delayLoadMs() });
            await S(delayInteractionMs());
        }

        panelAction(panel, "GO: finished");
        panelLog(panel, "info", "GO finished");
    }

    // =========================================================
    // Mount + SPA resilience
    // =========================================================
    async function mount() {
        const mountEl = await WV(CFG.mountSel, { timeoutMs: delayLoadMs() });
        if (!mountEl) return;

        notifHost(mountEl);
        const ui = ensureUI(mountEl);
        const panel = ui.querySelector("#cl_ui_body") || ui;

        startAdOverlayGuard(panel);

        const btnGo = $("#cl_btn_go", ui);
        const btnNext = $("#cl_btn_next", ui);

        if (!btnGo || !btnNext) return;

        if (!btnGo.dataset.bound) {
            btnGo.dataset.bound = "1";
            btnGo.addEventListener("click", async () => {
                if (Runner.busy) return;

                if (Runner.paused) {
                    notify(mountEl, "Paused (click Resume first)");
                    return;
                }

                Runner.busy = true;
                try {
                    setStatus("GO running…");
                    await runGo(mountEl, panel);
                    setStatus("GO finished");
                } catch (e) {
                    setStatus(`Error: ${e.message}`);
                    fail(mountEl, panel, "GO failed", e);
                } finally {
                    Runner.busy = false;
                }
            });
        }

        if (!btnNext.dataset.bound) {
            btnNext.dataset.bound = "1";
            btnNext.addEventListener("click", async () => {
                if (Runner.busy) return;

                if (Runner.paused) {
                    notify(mountEl, "Paused (click Resume first)");
                    return;
                }

                Runner.busy = true;
                try {
                    setStatus("Next running…");
                    panelAction(panel, "Next: executing current step");
                    const res = await runOne(mountEl, panel);
                    setStatus(res === STOP ? "Stopped" : "Next done");
                    panelAction(panel, "Next: done");
                } catch (e) {
                    setStatus(`Error: ${e.message}`);
                    fail(mountEl, panel, "Next step failed", e);
                } finally {
                    Runner.busy = false;
                }
            });
        }

        setStatus(Runner.paused ? "Paused" : "Idle");
        panelAction(panel, Runner.paused ? "PAUSED" : "Idle");
    }

    function watchSPA() {
        let last = location.href;
        const tick = async () => {
            if (location.href !== last) {
                last = location.href;
                await S(delayInteractionMs());
                await mount();
            }
            setTimeout(tick, 250);
        };
        tick();
    }

    function observeMount() {
        const mo = new MutationObserver(() => {
            const mountEl = $(CFG.mountSel);
            if (!mountEl) return;
            if (!document.getElementById(CFG.uiId)) mount();
        });
        mo.observe(document.documentElement, { childList: true, subtree: true });
    }

    mount();
    watchSPA();
    observeMount();
})();
