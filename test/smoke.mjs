/**
 * Behaviour checks for the browser half.
 *
 * Run: node test/smoke.mjs
 *
 * The bundle is executed against a real DOM (jsdom, when available) so the
 * reconcile pass runs on live nodes rather than on a mock: the scan uses
 * `children`, `dataset`, `closest`, `aria-label`, `style.order` and hidden
 * attributes exactly as it does in the page. React is stubbed — only the DOM
 * path is under test here, not the two slot components.
 *
 * jsdom is deliberately not a dependency of this package (the plugin ships
 * with no runtime dependencies). Install it wherever convenient and point at
 * it:
 *
 *   npm install --no-save jsdom && npm test
 *   DPL_JSDOM=/srv/n8n/node_modules/jsdom npm test
 *
 * Without jsdom the DOM half is skipped and the pure-function half still runs.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
let checks = 0;

function check(description, condition, detail = "") {
	checks += 1;
	if (condition) console.log(`  ok  ${description}`);
	else {
		failures.push(description);
		console.error(`fail  ${description} ${detail}`);
	}
}

// ── load jsdom, or skip the DOM half ──────────────────────────────────────
let JSDOM;
for (const candidate of [process.env.DPL_JSDOM, "jsdom"]) {
	if (candidate === undefined) continue;
	try {
		const specifier = candidate.startsWith("/") ? pathToFileURL(join(candidate, "lib/api.js")).href : candidate;
		const loaded = await import(specifier);
		JSDOM = loaded.JSDOM ?? loaded.default?.JSDOM;
		if (JSDOM !== undefined) break;
	} catch {}
}

if (JSDOM !== undefined) {
	// ── the bundle, materialized against one window ─────────────────────────
	const dom = new JSDOM("<!doctype html><html lang=\"zh-CN\"><head></head><body></body></html>", {
		url: "http://127.0.0.1:3080/",
		pretendToBeVisual: true,
	});
	const { window } = dom;
	const document = window.document;
	Object.defineProperty(window, "localStorage", { value: (() => {
		const map = new Map();
		return {
			getItem: (key) => (map.has(key) ? map.get(key) : null),
			setItem: (key, value) => map.set(key, String(value)),
			removeItem: (key) => map.delete(key),
			clear: () => map.clear(),
		};
	})(), configurable: true });

	/** A minimal React stand-in: enough for the module's top-level requires. */
	const reactStub = {
		/* Real React flattens nested child arrays; mirror that so the trees below
		   read the same as the rendered DOM. */
		createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
		useSyncExternalStore: (_subscribe, read) => read(),
		Fragment: Symbol("React.Fragment"),
		useId: () => "dpl-id",
	};

	let registration;
	window.__ModuleLoader__ = { load: (value) => void (registration = value) };
	const source = readFileSync(join(root, "lib", "client.js"), "utf8");
	/*
	 * In the page these are globals; here they are function parameters, so the
	 * bundle's bare `document` / `navigator` / observer references resolve to
	 * the jsdom window instead of Node's (absent) browser globals.
	 */
	new Function(
		"window",
		"document",
		"navigator",
		"globalThis",
		"MutationObserver",
		"ResizeObserver",
		"require",
		source,
	)(window, window.document, window.navigator, window, window.MutationObserver, window.ResizeObserver ?? undefined, () => reactStub);
	check("the bundle registers through window.__ModuleLoader__", registration !== undefined);

	const exports = registration.factory((name) => {
		if (name === "react") return reactStub;
		throw new Error(`unexpected module: ${name}`);
	});
	const inner = exports.__internals;
	check("the module exposes apply and inject", typeof exports.apply === "function" && Array.isArray(exports.inject));

	// ── pure functions ─────────────────────────────────────────────────────
	console.log("\npreferences");
	const defaults = inner.normalizePreferences(null);
	check("defaults to the compact single-row layout", defaults.mode === "row" && defaults.rows === 1, JSON.stringify(defaults));
	check("list survives a round trip", inner.normalizePreferences({ mode: "list", rows: 2 }).mode === "list");
	check("unknown modes fall back to the row", inner.normalizePreferences({ mode: "grid" }).mode === "row");
	check("the row cap clamps to at least one row", inner.normalizePreferences({ rows: 0 }).rows === 1);
	check("the row cap clamps to the supported maximum", inner.normalizePreferences({ rows: 99 }).rows === inner.constants.MAX_ROWS);
	check("fractional caps round", inner.normalizePreferences({ rows: 2.4 }).rows === 2);
	inner.setPreferences({ mode: "row", rows: 2 }, false);
	check("setPreferences updates the live snapshot", inner.preferences().mode === "row" && inner.preferences().rows === 2);

	console.log("\norder merge");
	inner.setOrder(["b", "a"]);
	check("a saved order wins over live order", inner.mergeOrder(["a", "b", "c"]).join(",") === "b,a,c", inner.mergeOrder(["a", "b", "c"]).join(","));
	inner.setOrder(["gone", "b"]);
	check("ids that disappeared are dropped", inner.mergeOrder(["a", "b"]).join(",") === "b,a", inner.mergeOrder(["a", "b"]).join(","));
	inner.setOrder(["a", "a", "b"]);
	check("duplicate ids collapse", inner.readStoredOrder().join(",") === "a,b", inner.readStoredOrder().join(","));
	inner.resetOrder();
	check("reset clears the saved order", inner.readStoredOrder().length === 0);

	// ── cell arithmetic ────────────────────────────────────────────────────
	console.log("\nrow cells");
	/* The nav's inline padding sits inside its client box, so cells only get
	   width - 2*2; n cells need n*36 + (n-1)*4. */
	const capacityOf = typeof inner.rowCapacity === "function" ? inner.rowCapacity : () => NaN;
	check("the row capacity is a pure function the tests can pin", typeof inner.rowCapacity === "function");
	check("a 264px nav packs six cells", capacityOf(264) === 6, String(capacityOf(264)));
	check("a 280px nav packs seven", capacityOf(280) === 7, String(capacityOf(280)));
	/* 277px: 277 mod 40 = 37, the band a width-plus-gap estimate rounds up. */
	check("the nav's inline padding is not cell room", capacityOf(277) === 6, String(capacityOf(277)));
	check("a nav too narrow for one cell still reports one", capacityOf(20) === 1, String(capacityOf(20)));
	check("an unmeasured nav reports no cells", capacityOf(0) === 0, String(capacityOf(0)));

	// ── DOM reconcile ──────────────────────────────────────────────────────
	console.log("\nDOM reconcile");

	/** The six panels this profile registers, in shell order. */
	const PANELS = [
		{ id: "plugins", label: "插件", order: 0 },
		{ id: "dsh-market", label: "插件市场", order: 1 },
		{ id: "workbuddy", label: "WorkBuddy", order: 2 },
		{ id: "context", label: "上下文", order: 20 },
		{ id: "task-board", label: "任务板", order: 20 },
		{ id: "mcp-connector", label: "MCP", order: 40 },
	];
	inner.__setSlots({ entriesOfSlot: () => PANELS.map((panel) => ({ options: panel })) });

	/**
	 * Rebuild the sidebar markup the shell renders: one button per panel with a
	 * glyph anchor and a label cell, the More launcher in its own wrapper, and
	 * the bottom-left account launcher.
	 */
	function buildSidebar({ signedOut = true, labelled = true, width = 200, withMore = true, panels = PANELS } = {}) {
		document.body.innerHTML = "";
		const nav = document.createElement("nav");
		nav.setAttribute("aria-label", "全局面板");
		for (const panel of panels) {
			const button = document.createElement("button");
			button.type = "button";
			button.setAttribute("aria-label", panel.label);
			const glyph = document.createElement("span");
			glyph.setAttribute("data-slot", "sidebar.panellist");
			/* The glyph that panel's own plugin registers: a sprite reference here,
			   standing in for whatever markup that plugin ships. */
			glyph.innerHTML = `<svg width="16" height="16" data-icon="panel-${panel.id}"><use href="#panel-${panel.id}"></use></svg>`;
			button.appendChild(glyph);
			if (labelled) {
				const title = document.createElement("span");
				title.textContent = panel.label;
				button.appendChild(title);
			}
			nav.appendChild(button);
		}
		const wrap = document.createElement("span");
		const more = document.createElement("button");
		more.type = "button";
		more.setAttribute("aria-label", "更多");
		more.setAttribute("aria-haspopup", "menu");
		const moreGlyph = document.createElement("span");
		moreGlyph.setAttribute("aria-hidden", "true");
		more.appendChild(moreGlyph);
		if (labelled) {
			const moreTitle = document.createElement("span");
			moreTitle.textContent = "更多";
			more.appendChild(moreTitle);
		}
		wrap.appendChild(more);
		if (withMore) nav.appendChild(wrap);
		document.body.appendChild(nav);

		const launcher = document.createElement("div");
		launcher.setAttribute("data-slot", "settings.launcher");
		const account = document.createElement("button");
		account.type = "button";
		account.setAttribute("data-signed-out", signedOut ? "true" : "false");
		launcher.appendChild(account);
		document.body.appendChild(launcher);

		Object.defineProperty(nav, "clientWidth", { value: width, configurable: true });
		inner.__forgetNav();
		return { nav, more };
	}

	const visibleRows = (nav) => Array.from(nav.children).filter((row) => !row.hasAttribute("data-dpl-hidden"));
	const utilIds = (nav) => Array.from(nav.querySelectorAll("button[data-dpl-util]")).map((button) => button.getAttribute("data-dpl-util"));

	/** Row mode, one row, narrow sidebar: five cells fit, one is the More launcher. */
	inner.setPreferences({ mode: "row", rows: 1 }, false);
	inner.resetOrder();
	const narrow = buildSidebar({ width: 200 });
	inner.sync();
	check("the nav is tagged as the panel list", narrow.nav.hasAttribute("data-dpl-nav"));
	check("the row layout is applied", narrow.nav.getAttribute("data-dpl-mode-core") === "row");
	check("the expanded phase is detected", document.documentElement.hasAttribute("data-dpl-wide"));
	check("label cells are tagged", narrow.nav.querySelector("span[data-dpl-label]") !== null);
	check("the More launcher is recognised", narrow.nav.querySelector("[data-dpl-more]") !== null);
	/* The launcher is a row like any other: in row mode its name cell must be
	   tagged too, or the 36px cell shows the first character of its label. */
	check("the More launcher's name cell is tagged", narrow.nav.querySelector("[data-dpl-more] span[data-dpl-label]") !== null);
	check("the More launcher keeps its name as a tooltip", narrow.nav.querySelector("[data-dpl-more] button").getAttribute("title") === "更多");
	const oneRowCap = capacityOf(200);
	check("one row caps the visible cells", visibleRows(narrow.nav).length === oneRowCap, `${visibleRows(narrow.nav).length} of ${oneRowCap}`);
	check("overflow rows are hidden, not removed", narrow.nav.children.length > visibleRows(narrow.nav).length);
	const narrowUtils = utilIds(narrow.nav);
	check("a tight row cap pushes the absorbed utilities out of the nav", narrowUtils.length === 0, narrowUtils.join(","));
	check("overflow rows keep their place in the DOM", narrow.nav.querySelectorAll('[data-dpl-hidden]').length > 0);

	/** Entries that fill the row exactly used to take the More launcher's cell
	   with them, so the launcher wrapped onto a second row of its own. 264px is
	   the shell's default 280px sidebar minus its 8px inline padding: six cells
	   a row, so six entries plus More is one too many. */
	inner.__setSlots({ entriesOfSlot: () => PANELS.slice(0, 3).map((panel) => ({ options: panel })) });
	const filled = buildSidebar({ width: 264, panels: PANELS.slice(0, 3) });
	inner.sync();
	check("a filled row still keeps a cell for More", visibleRows(filled.nav).length === 6, `${visibleRows(filled.nav).length}`);
	check("a filled row hands one entry to the menu", inner.hiddenEntries().length === 1, JSON.stringify(inner.hiddenEntries().map((entry) => entry.id)));
	check("the More launcher survives the trim", visibleRows(filled.nav).some((row) => row.hasAttribute("data-dpl-more")));
	inner.__setSlots({ entriesOfSlot: () => PANELS.map((panel) => ({ options: panel })) });

	/** A width in the 36–39 band past a whole cell: 277px fits six cells, not
	   the seven a width-plus-gap estimate reports. */
	const padded = buildSidebar({ width: 277 });
	inner.sync();
	check("a padded width does not buy a seventh cell", visibleRows(padded.nav).length === 6, `${visibleRows(padded.nav).length}`);

	/** Row mode, three rows, wide sidebar: everything fits, nothing hides. */
	inner.setPreferences({ mode: "row", rows: 3 }, false);
	const wide = buildSidebar({ width: 1200 });
	inner.sync();
	check("a wide three-row menu hides nothing", visibleRows(wide.nav).length === wide.nav.children.length, `${visibleRows(wide.nav).length}/${wide.nav.children.length}`);
	const wideUtils = utilIds(wide.nav);
	check("a wide menu places all three absorbed utilities", ["settings", "contact", "signin"].every((id) => wideUtils.includes(id)), wideUtils.join(","));
	check("absorbed utilities are draggable", wide.nav.querySelector('button[data-dpl-util="settings"]').draggable === true);
	check("absorbed utilities carry their label cell", wide.nav.querySelector('button[data-dpl-util="settings"] span[data-dpl-label]') !== null);

	/** List mode keeps four entries on screen. */
	inner.setPreferences({ mode: "list", rows: 1 }, false);
	const list = buildSidebar({ width: 240 });
	inner.sync();
	check("list mode marks the nav as a list", list.nav.getAttribute("data-dpl-mode-core") === "list");
	const listEntries = visibleRows(list.nav).filter((row) => !row.hasAttribute("data-dpl-more"));
	check("list mode keeps four panel entries", listEntries.length === 4, `${listEntries.length}`);
	check("list mode still shows the More launcher", visibleRows(list.nav).some((row) => row.hasAttribute("data-dpl-more")));

	/* A host below the declared floor renders no More launcher. Nothing may be
	   hidden there: the overflow rows would have no menu to appear in, so the
	   cap has to give way instead of stranding entries out of reach. */
	inner.setPreferences({ mode: "row", rows: 1 }, false);
	const floorless = buildSidebar({ width: 200, withMore: false });
	inner.sync();
	check("a host without More hides nothing", floorless.nav.querySelectorAll("[data-dpl-hidden]").length === 0, `${floorless.nav.querySelectorAll("[data-dpl-hidden]").length} hidden`);
	check("a host without More shows every row", visibleRows(floorless.nav).length === floorless.nav.children.length);
	check("a host without More reports no overflow to the menu", inner.hiddenEntries().length === 0, JSON.stringify(inner.hiddenEntries().map((entry) => entry.id)));

	/** Order: a saved order becomes flex order, and More still renders last. */
	inner.setPreferences({ mode: "row", rows: 3 }, false);
	const ordered = buildSidebar({ width: 1200 });
	inner.sync();
	const hostOf = (id) => Array.from(ordered.nav.children).find((row) => row.dataset.dplId === id);
	check("panel rows carry their slot id", hostOf("plugins") !== undefined && hostOf("mcp-connector") !== undefined);
	inner.setOrder(["mcp-connector", "plugins"]);
	inner.sync();
	check("the stored order becomes flex order", Number(hostOf("mcp-connector").style.order) < Number(hostOf("plugins").style.order), `${hostOf("mcp-connector").style.order} / ${hostOf("plugins").style.order}`);
	check("More sorts after every entry", Number(ordered.nav.querySelector("[data-dpl-more]").style.order) > Number(hostOf("plugins").style.order));

	/** Reordering through the drag API moves one id next to another. */
	inner.reorder("plugins", "mcp-connector", false);
	inner.sync();
	const savedAfterDrag = inner.readStoredOrder();
	check(
		"a drag inserts at the drop position",
		savedAfterDrag.indexOf("plugins") === savedAfterDrag.indexOf("mcp-connector") - 1,
		savedAfterDrag.join(","),
	);
	inner.resetOrder();

	/** Account state: Sign in disappears once the launcher reports signed in. */
	const signedIn = buildSidebar({ signedOut: false, width: 1200 });
	inner.sync();
	check("Sign in is not offered while signed in", !utilIds(signedIn.nav).includes("signin"), utilIds(signedIn.nav).join(","));
	check("Settings stays available while signed in", utilIds(signedIn.nav).includes("settings"));

	/** The icon rail keeps its shipped geometry. */
	const rail = buildSidebar({ labelled: false, width: 240 });
	inner.sync();
	check("the icon rail is left untouched", !document.documentElement.hasAttribute("data-dpl-wide"));
	check("no row is hidden in the rail", Array.from(rail.nav.children).every((row) => !row.hasAttribute("data-dpl-hidden")));
	check("the rail is not restyled", rail.nav.getAttribute("data-dpl-mode-core") === null);
	/* The bottom-left launcher carries Settings / Feedback / Sign in. Hiding it
	   is only safe while those three are up in the panel menu; the rail drops
	   them, so the rule must be scoped to the expanded state as well. */
	const css = inner.styles();
	check(
		"the launcher is only hidden in the expanded state",
		/\[data-dpl-mode\]\[data-dpl-wide\]\s+\[data-slot="settings\.launcher"\]/.test(css),
		css.match(/html\[data-dpl-mode\][^{]*settings\.launcher[^{]*\{/)?.[0] ?? "rule not found",
	);
	check(
		"the launcher hide never applies to the rail",
		!/html\[data-dpl-mode\]\s*\[data-slot="settings\.launcher"\]/.test(css),
	);

	/* ── 0.2.2-rc.2 row wrapper ─────────────────────────────────────────────
	   The shell now renders each panel row as `div.panelEntry > button.panelRow`,
	   with the glyph anchor one level deeper inside `span.panelGlyph`, and — for
	   an unpinnable wide row — a hover unpin button as the wrapper's second
	   child. The reconcile must still find one cell per panel, keep the drag
	   host on the wrapper, and leave the pin control out of its own path. */
	console.log("\n0.2.2-rc.2 row wrapper");

	/** 0.2.2-rc.2 sidebar markup: entry wrapper, glyph span, optional unpin. */
	function buildWrappedSidebar({ labelled = true, width = 1200, unpin = true, withMore = true } = {}) {
		document.body.innerHTML = "";
		const nav = document.createElement("nav");
		nav.setAttribute("aria-label", "全局面板");
		for (const panel of PANELS) {
			const entry = document.createElement("div");
			entry.className = labelled ? "panelEntry panelEntryWide" : "panelEntry";
			const button = document.createElement("button");
			button.type = "button";
			button.className = "panelRow";
			button.setAttribute("aria-label", panel.label);
			const glyph = document.createElement("span");
			glyph.className = "panelGlyph";
			glyph.setAttribute("aria-hidden", "true");
			/* The renderer's slot anchor: a div with display:contents inside the
			   glyph span, holding whatever icon that panel's plugin registered. */
			const anchor = document.createElement("div");
			anchor.setAttribute("data-slot", "sidebar.panellist");
			anchor.setAttribute("style", "display: contents");
			anchor.innerHTML = `<svg width="16" height="16" data-icon="panel-${panel.id}"><use href="#panel-${panel.id}"></use></svg>`;
			glyph.appendChild(anchor);
			button.appendChild(glyph);
			if (labelled) {
				const title = document.createElement("span");
				title.className = "panelTitle";
				title.textContent = panel.label;
				button.appendChild(title);
			}
			entry.appendChild(button);
			if (unpin && labelled) {
				const pin = document.createElement("button");
				pin.type = "button";
				pin.className = "hHd-Xa_panelUnpin";
				pin.setAttribute("aria-label", `从侧边栏取消固定${panel.label}`);
				entry.appendChild(pin);
			}
			nav.appendChild(entry);
		}
		if (withMore) {
			const wrap = document.createElement("div");
			wrap.className = "moreAnchor";
			const more = document.createElement("button");
			more.type = "button";
			more.className = "panelRow";
			more.setAttribute("aria-label", "更多");
			more.setAttribute("aria-haspopup", "menu");
			const moreGlyph = document.createElement("span");
			moreGlyph.setAttribute("aria-hidden", "true");
			more.appendChild(moreGlyph);
			if (labelled) {
				const moreTitle = document.createElement("span");
				moreTitle.textContent = "更多";
				more.appendChild(moreTitle);
			}
			wrap.appendChild(more);
			nav.appendChild(wrap);
		}
		document.body.appendChild(nav);

		const launcher = document.createElement("div");
		launcher.setAttribute("data-slot", "settings.launcher");
		const account = document.createElement("button");
		account.type = "button";
		account.setAttribute("data-signed-out", "true");
		launcher.appendChild(account);
		document.body.appendChild(launcher);

		Object.defineProperty(nav, "clientWidth", { value: width, configurable: true });
		inner.__forgetNav();
		return { nav };
	}

	inner.setPreferences({ mode: "row", rows: 3 }, false);
	inner.resetOrder();
	const wrapped = buildWrappedSidebar();
	inner.sync();
	const wrappedHosts = Array.from(wrapped.nav.children).filter((row) => row.dataset.dplId !== undefined);
	check("the nav is located through the rc.2 entry wrapper", wrapped.nav.hasAttribute("data-dpl-nav"));
	check("the row layout applies over the wrapper", wrapped.nav.getAttribute("data-dpl-mode-core") === "row");
	check(
		"every wrapped row still resolves to its panel",
		PANELS.every((panel) => wrappedHosts.some((row) => row.dataset.dplId === panel.id)),
		wrappedHosts.map((row) => row.dataset.dplId).join(","),
	);
	check("the unpin button never becomes a second cell", visibleRows(wrapped.nav).length === wrapped.nav.children.length, `${visibleRows(wrapped.nav).length}/${wrapped.nav.children.length}`);
	const wrappedFirst = Array.from(wrapped.nav.children)[0];
	check("the drag host is the entry wrapper", wrappedFirst.classList.contains("panelEntry") && wrappedFirst.getAttribute("data-dpl-drag") === "1", `${wrappedFirst.className} drag=${wrappedFirst.getAttribute("data-dpl-drag")}`);
	check("the row button carries the drag flag", wrappedFirst.querySelector("button.panelRow").draggable === true);
	check("the pin control stays out of the drag path", wrappedFirst.querySelector("button[class*=panelUnpin]").draggable !== true);
	check("the name cell is tagged inside the row button", wrappedFirst.querySelector("span.panelTitle").hasAttribute("data-dpl-label"));
	check("the More launcher is recognised inside its rc.2 wrapper", wrapped.nav.querySelector("[data-dpl-more] button")?.getAttribute("title") === "更多");

	inner.setOrder(["mcp-connector", "plugins"]);
	inner.sync();
	const wrappedHostOf = (id) => Array.from(wrapped.nav.children).find((row) => row.dataset.dplId === id);
	check(
		"the stored order lands on the wrapper",
		Number(wrappedHostOf("mcp-connector").style.order) < Number(wrappedHostOf("plugins").style.order),
		`${wrappedHostOf("mcp-connector").style.order} / ${wrappedHostOf("plugins").style.order}`,
	);
	inner.resetOrder();

	/** The rc.2 rail renders no label cell and no unpin button; nothing applies. */
	const wrappedRail = buildWrappedSidebar({ labelled: false, width: 240 });
	inner.sync();
	check("the rc.2 icon rail is left untouched", !document.documentElement.hasAttribute("data-dpl-wide") && wrappedRail.nav.getAttribute("data-dpl-mode-core") === null);

	/* Both rc.2 shapes are CSS-only — jsdom has no layout — so pin the two rules
	   that keep a 36px cell a 36px cell and keep the pin control out of it. */
	const rowCellRule = css.slice(css.indexOf('nav[data-dpl-nav][data-dpl-mode-core="row"] > *'));
	check(
		"row cells drop the shell's inline border",
		/border:\s*0/.test(rowCellRule.slice(0, rowCellRule.indexOf("}"))),
		rowCellRule.slice(0, rowCellRule.indexOf("}")).replace(/\s+/g, " "),
	);
	const rowButtonStart = css.indexOf('row"] button');
	const rowButtonSelector = css.slice(rowButtonStart, css.indexOf("{", rowButtonStart));
	check(
		"the cell rule steps around the shell's unpin control",
		rowButtonSelector.includes(':not([class*="panelUnpin"])'),
		rowButtonSelector.replace(/\s+/g, " "),
	);
	const unpinRule = css.slice(css.indexOf('button[class*="panelUnpin"]'));
	check(
		"the unpin control keeps a corner placement in the cell",
		/position:\s*absolute/.test(unpinRule.slice(0, unpinRule.indexOf("}")))
			&& /width:\s*16px/.test(unpinRule.slice(0, unpinRule.indexOf("}"))),
		unpinRule.slice(0, unpinRule.indexOf("}")).replace(/\s+/g, " "),
	);

	/* jsdom resolves these selectors through its cascade, so the cell and the
	   shell's unpin control are checked as they lay out rather than as text. The
	   shell's own rule stands underneath at its real specificity: the row rules
	   must no longer reach the pin, and the pin must not blow up the cell. */
	/* The boot-time stylesheet is not in the document yet — the sections below
	   drive the DOM path directly — so stand it up here the way apply() does,
	   after the shell's bundled CSS, as in the page. */
	const shellStyle = document.createElement("style");
	shellStyle.textContent = ".hHd-Xa_panelUnpin { position: absolute; width: 28px; height: 28px; display: inline-flex; }";
	document.head.appendChild(shellStyle);
	const pluginStyle = document.createElement("style");
	pluginStyle.textContent = css;
	document.head.appendChild(pluginStyle);
	const cascade = buildWrappedSidebar();
	inner.sync();
	/* The mode gate is an apply()-time effect, so paint it here as boot does. */
	document.documentElement.setAttribute("data-dpl-mode", inner.preferences().mode);
	const cascadeRow = window.getComputedStyle(cascade.nav.querySelector("button.panelRow"));
	const cascadePin = window.getComputedStyle(cascade.nav.querySelector("button[class*=panelUnpin]"));
	check("a cell button lays out as a 36px cell", cascadeRow.width === "36px" && cascadeRow.position === "relative", `${cascadeRow.width} ${cascadeRow.position}`);
	check("the unpin control overrides the shell's 28px corner", cascadePin.width === "16px" && cascadePin.position === "absolute", `${cascadePin.width} ${cascadePin.position}`);
	pluginStyle.remove();
	shellStyle.remove();

	/* ── opening Settings without flashing the account menu ─────────────────
	   The shell hands its open-settings action to the launcher's occupant, so
	   the launcher's own node carries it; reading it there is one call, no
	   menu. When that shape is absent the lookup must simply report failure and
	   let the caller fall back. */
	console.log("\nopen settings");
	const built = buildSidebar({ signedOut: true });
	check("without a shell node there is no direct route", inner.openSettingsDirectly() === false);

	const holder = built && document.querySelector('[data-slot="settings.launcher"] button');
	let opened = 0;
	const carrier = { memoizedProps: { openSettings: () => { opened += 1; } } };
	holder["__reactFiber$test"] = { memoizedProps: { openSettings: undefined }, return: { memoizedProps: {}, return: carrier } };
	check("the route is found up the fiber chain", inner.openSettingsDirectly() === true);
	check("the route calls the shell's own action exactly once", opened === 1, `opened ${opened}`);
	check("a node with throwaway props never throws", (() => {
		try {
			holder["__reactFiber$broken"] = { get memoizedProps() { throw new Error("nope"); } };
			return true;
		} catch { return false; }
	})());

	/* ── the command-registry route comes first ─────────────────────────────
	   The Desktop client hands bindings to a native keyboard bridge and drops
	   synthesized keydowns, so the registry's own invoke is the only route that
	   answers there. It must run before the gesture replay, carry the modal the
	   shell would have reported, and stand down when the command is absent. */
	inner.__setShortcuts({ catalog: { getSnapshot: () => [] } });
	check("a catalog without settings.open offers no registry route", inner.invokeRegistered("settings.open") === false);

	const invoked = [];
	const shortcuts = {
		catalog: {
			getSnapshot: () => [{ id: "settings.open", label: "Open settings", binding: { code: "Comma", modifiers: ["control"] } }],
		},
		registry: {
			invoke: (id, context) => {
				invoked.push({ id, context });
			},
		},
	};
	inner.__setShortcuts(shortcuts);
	check("the registry route reports success", inner.invokeRegistered("settings.open") === true);
	check("the registry route names the command", invoked.length === 1 && invoked[0].id === "settings.open", JSON.stringify(invoked));
	check("the registry route reports no modal when none is open", invoked[0].context.modal === null, JSON.stringify(invoked[0].context));
	check("the registry route falls back to the page region", invoked[0].context.region === "page");

	const modal = document.createElement("div");
	modal.setAttribute("data-shortcut-modal", "settings");
	document.body.appendChild(modal);
	inner.invokeRegistered("settings.open");
	check("the registry route reports the open modal", invoked[1].context.modal === "settings", JSON.stringify(invoked[1].context));
	modal.remove();

	invoked.length = 0;
	inner.openSettings();
	check("openSettings takes the registry route first", invoked.length === 1 && invoked[0].id === "settings.open", JSON.stringify(invoked));

	const brokenRegistry = {
		catalog: shortcuts.catalog,
		registry: {
			invoke: () => {
				throw new Error("no command registry");
			},
		},
	};
	inner.__setShortcuts(brokenRegistry);
	check("a throwing registry never escapes", inner.invokeRegistered("settings.open") === false);
	inner.__setShortcuts(null);

	/* ── every route is believed only once the panel is on screen ───────────
	   A narrow window turns the sidebar into a drawer, and that drawer is a
	   dialog carrying `data-shortcut-modal="sidebar"`: from then on the shell
	   drops any command declaring its own modals, silently, while a registry
	   call still looks like it went through. So the shell's own Settings button
	   — which opens the panel through its store and bypasses both the command
	   table and that guard — is tried first, and each route is confirmed only
	   by the panel appearing. */
	const tick = () => new Promise((resolve) => { window.setTimeout(resolve, 0); });
	check("no trigger is found while the document has none", inner.settingsTrigger() === null);
	check("nothing reports as shown before anything opens", inner.settingsShown() === false);

	const panel = document.createElement("div");
	panel.setAttribute("data-shortcut-modal", "settings");
	const triggerButton = document.createElement("button");
	triggerButton.setAttribute("aria-haspopup", "dialog");
	triggerButton.setAttribute("aria-expanded", "false");
	const triggerAnchor = document.createElement("span");
	triggerAnchor.setAttribute("data-slot", "settings.trigger");
	triggerButton.appendChild(triggerAnchor);
	document.body.appendChild(triggerButton);
	let triggerWorks = true;
	triggerButton.addEventListener("click", () => {
		if (!triggerWorks) return;
		triggerButton.setAttribute("aria-expanded", "true");
		document.body.appendChild(panel);
	});

	check("the trigger is found through its slot", inner.settingsTrigger() === triggerButton);
	check("a closed trigger does not count as shown", inner.settingsShown() === false);

	inner.__setShortcuts(shortcuts);
	invoked.length = 0;
	inner.openSettings();
	await tick();
	check("openSettings clicks the shell's own button first", panel.isConnected && invoked.length === 0, JSON.stringify(invoked));
	check("the trigger is left expanded", triggerButton.getAttribute("aria-expanded") === "true");
	check("the shown panel is recognised", inner.settingsShown() === true);
	let extraClicks = 0;
	triggerButton.addEventListener("click", () => { extraClicks += 1; });
	inner.openSettings();
	await tick();
	check("an already open panel is not toggled shut", panel.isConnected && extraClicks === 0, `clicks ${extraClicks}`);

	/* A trigger that is present but does nothing must not end the chain: the
	   registry is tried next, and when that one paints the panel the chain
	   stops there instead of replaying a gesture nobody listens for. */
	panel.remove();
	triggerButton.setAttribute("aria-expanded", "false");
	triggerWorks = false;
	let gesturing = 0;
	const keydownListener = () => { gesturing += 1; };
	document.addEventListener("keydown", keydownListener, true);
	const paintingRegistry = {
		catalog: shortcuts.catalog,
		registry: {
			invoke: (id) => {
				invoked.push({ id });
				document.body.appendChild(panel);
			},
		},
	};
	inner.__setShortcuts(paintingRegistry);
	invoked.length = 0;
	inner.openSettings();
	await tick();
	await tick();
	check("a dead trigger hands over to the registry", invoked.length === 1 && invoked[0].id === "settings.open", JSON.stringify(invoked));
	check("the chain stops once the panel appears", panel.isConnected && gesturing === 0, `gestures ${gesturing}`);

	/* Nothing answers: the report has to name every route that was tried, so a
	   failure on a phone — where no console is in reach — is at least findable
	   in the Desktop log. */
	panel.remove();
	triggerButton.setAttribute("aria-expanded", "false");
	const silentRegistry = {
		catalog: { getSnapshot: () => [] },
		registry: { invoke: () => undefined },
	};
	inner.__setShortcuts(silentRegistry);
	const warnings = [];
	const realWarn = console.warn;
	console.warn = (...args) => { warnings.push(args.join(" ")); };
	try {
		inner.openSettings();
		await tick();
		await tick();
		await tick();
		await tick();
	} finally {
		console.warn = realWarn;
	}
	document.removeEventListener("keydown", keydownListener, true);
	check("a total failure is reported once", warnings.length === 1, JSON.stringify(warnings));
	check(
		"the report names every route tried",
		warnings[0] !== undefined && warnings[0].includes("shell trigger") && warnings[0].includes("command registry") && warnings[0].includes("key gesture") && warnings[0].includes("launcher action") && warnings[0].includes("account menu"),
		warnings[0],
	);
	inner.__setShortcuts(null);
	triggerButton.remove();

	/* ── the gesture replay goes to the document ────────────────────────────
	   The shell's keyboard adapter is a capture listener on the document, so a
	   gesture dispatched on the window never reaches it. The adapter's own
	   consume() preventDefaults a gesture it handles, which is what the replay
	   reports back. */
	let heard = 0;
	const captureListener = (event) => {
		heard += 1;
		event.preventDefault();
	};
	document.addEventListener("keydown", captureListener, true);
	inner.__setShortcuts(shortcuts);
	check("a gesture the adapter consumes reports success", inner.invokeCommand("settings.open") === true && heard === 1, `heard ${heard}`);
	document.removeEventListener("keydown", captureListener, true);
	heard = 0;
	check("a gesture nobody consumes reports failure", inner.invokeCommand("settings.open") === false && heard === 0, `heard ${heard}`);
	inner.__setShortcuts({ catalog: shortcuts.catalog, registry: undefined });
	check("no binding means no gesture", inner.invokeCommand("settings.unknown") === false);
	inner.__setShortcuts(null);

	/* The last-resort menu row is matched by its icon or its wording, so a
	   build that swaps the glyph still opens Settings. */
	const settingsMenuItem = document.createElement("button");
	settingsMenuItem.setAttribute("role", "menuitem");
	settingsMenuItem.setAttribute("aria-label", inner.utilityLabel("settings"));
	check("a row is matched by its label alone", inner.settingsRow(settingsMenuItem) === true);
	settingsMenuItem.removeAttribute("aria-label");
	settingsMenuItem.textContent = inner.utilityLabel("settings");
	check("a row is matched by its text alone", inner.settingsRow(settingsMenuItem) === true);
	const otherMenuItem = document.createElement("button");
	otherMenuItem.setAttribute("role", "menuitem");
	otherMenuItem.textContent = inner.utilityLabel("contact");
	check("a different row is not matched", inner.settingsRow(otherMenuItem) === false);

	/** A nav that leaves the document is dropped and re-located. */
	document.body.innerHTML = "";
	inner.sync();
	check("a removed nav is forgotten", !document.documentElement.hasAttribute("data-dpl-wide"));

	// ── plugin boot: both registrations land on their slots ────────────────
	console.log("\nplugin boot");
	document.body.innerHTML = "";
	const registered = [];
	const effects = [];
	const fakeCtx = {
		get: (name) => (name === "slots" ? { entriesOfSlot: () => [] } : undefined),
		effect: (fn, label) => {
			effects.push(label);
			const dispose = fn();
			return typeof dispose === "function" ? dispose : () => {};
		},
		inject: (names, callback) => {
			const scope = {
				slots: {
					entriesOfSlot: () => [],
					subscribe: () => () => {},
					inject: (key, factory) => (factory === undefined ? () => {} : factory()),
					register: (options, component) => {
						registered.push({ ...options, component });
						return () => {};
					},
				},
				locale: { register: () => () => {} },
				shortcuts: { catalog: { getSnapshot: () => [] } },
				remote: { account: {} },
				theme: { getTheme: () => ({ active: { colorScheme: "dark" } }) },
				layout: { selectPanel: () => {} },
				effect: (fn, label) => {
					effects.push(label);
					const dispose = fn();
					return typeof dispose === "function" ? dispose : () => {};
				},
			};
			callback(scope);
		},
	};
	exports.apply(fakeCtx);
	check("apply installs the stylesheet", document.head.querySelector('style[data-plugin="dsh-panel-layout"]') !== null);
	check("apply paints the mode gate", document.documentElement.getAttribute("data-dpl-mode") === "row" || document.documentElement.getAttribute("data-dpl-mode") === "list");
	check("apply registers the General settings row", registered.some((row) => row.name === "settings.general.item"));
	check("apply registers the More-menu rows", registered.some((row) => row.name === "sidebar.panellist.actions"));
	check("both slot rows render a component", registered.every((row) => typeof row.component === "function"));
	check("the settings row is ordered after appearance", (registered.find((row) => row.name === "settings.general.item")?.order ?? 0) > 10);
	check("apply wires effects with labels", effects.every((label) => typeof label === "string" && label.startsWith("panel-layout:")));

	// ── the two slot components render the expected controls ───────────────
	console.log("\nslot components");
	const settingsRow = registered.find((row) => row.name === "settings.general.item").component;
	const moreRow = registered.find((row) => row.name === "sidebar.panellist.actions").component;
	const rowTree = settingsRow({ t: (key) => key });
	check("the settings row is one shell-style row", rowTree.props.className === "dpl-row");
	check("the settings row has a label block and a control block", rowTree.children.length === 2);
	const controls = rowTree.children[1];
	const segmented = controls.children.find((child) => child.props.className === "dpl-segmented");
	check("the layout control offers both modes", segmented.children.length === 2);
	check("the compact row is the pressed option by default", segmented.children[0].props["aria-pressed"] === "true");
	const reset = controls.children.find((child) => child.props.className === "dpl-reset");
	check("the row offers a reset", reset !== undefined && reset.children[0] === "reset");

	inner.setPreferences({ mode: "row", rows: 2 }, false);
	const rowCap = settingsRow({ t: (key) => key }).children[1].children.find((child) => child.props.className === "dpl-rowCap");
	check("row mode shows the cap control", rowCap !== undefined);
	check("the cap control offers one row per level", rowCap.children[1].children.length === inner.constants.MAX_ROWS);
	check("the saved cap is the pressed level", rowCap.children[1].children[1].props["aria-pressed"] === "true");

	inner.setPreferences({ mode: "list", rows: 2 }, false);
	const listRow = settingsRow({ t: (key) => key }).children[1];
	check("list mode hides the cap control", listRow.children.filter(Boolean).every((child) => child.props.className !== "dpl-rowCap"));

	/* `apply` adopts whatever slots service the context exposes; restore the test roster. */
	inner.__setSlots({ entriesOfSlot: () => PANELS.map((panel) => ({ options: panel })) });
	inner.setPreferences({ mode: "row", rows: 3 }, false);
	const roomy = buildSidebar({ width: 1600 });
	inner.sync();
	check("a roomy menu publishes nothing hidden", inner.hiddenEntries().length === 0);
	check("the More menu contributes nothing when the nav shows everything", moreRow({ t: (key) => key, onDismiss: () => {} }) === null);

	// Force overflow by shrinking the budget, then let the reconcile publish it.
	inner.setPreferences({ mode: "list", rows: 1 }, false);
	const tight = buildSidebar({ width: 1600 });
	inner.sync();
	const hidden = inner.hiddenEntries();
	check("a capped menu publishes what it hid", hidden.length > 0, `${hidden.length}`);
	check(
		"hidden entries carry a label",
		hidden.every((entry) => typeof entry.label === "string" && entry.label !== "" && (entry.kind === "panel" || entry.kind === "utility")),
		JSON.stringify(hidden),
	);
	const moreTree = moreRow({ t: (key) => key, onDismiss: () => {} });
	check("the More menu starts with a separator", moreTree.children[0].props.className === "dpl-menuSeparator");
	check("the More menu lists every hidden entry", moreTree.children.length === hidden.length + 1, `${moreTree.children.length - 1} vs ${hidden.length}`);
	check(
		"each More row carries its label and a select handler",
		moreTree.children.slice(1).every((row) => typeof row.props.label === "string" && row.props.label !== "" && typeof row.props.onSelect === "function"),
	);
	check("the tight nav still keeps its More launcher", tight.nav.querySelector("[data-dpl-more]") !== null);
	check("the hidden entries are not duplicated in the nav", tight.nav.querySelectorAll("button[data-dpl-util]").length === 0);

	/* ── icons: every row keeps the icon it belongs to ──────────────────────
	   This plugin draws no glyph of its own: the absorbed utilities reference
	   the shell's own sprite entries, and a panel listed in More carries the
	   markup its own row renders, so no row is ever left blank. */
	console.log("\nicons");
	inner.setPreferences({ mode: "row", rows: 3 }, false);
	inner.resetOrder();
	const iconNav = buildSidebar({ width: 1400 });
	inner.sync();
	for (const id of ["settings", "contact", "signin"]) {
		const button = iconNav.nav.querySelector(`button[data-dpl-util="${id}"]`);
		const use = button === null ? null : button.querySelector("use");
		check(
			`the ${id} row references the shell's own icon`,
			use !== null && use.getAttribute("href") === "#" + inner.utilitySymbol(id),
			button === null ? "row missing" : button.innerHTML.slice(0, 120),
		);
		check(`the ${id} row draws no glyph of its own`, button !== null && button.querySelector("path") === null);
	}

	inner.setPreferences({ mode: "list", rows: 1 }, false);
	const glyphNav = buildSidebar({ width: 1600 });
	inner.sync();
	const glyphHidden = inner.hiddenEntries().filter((entry) => entry.kind === "panel");
	check(
		"a hidden panel keeps its own glyph markup",
		glyphHidden.length > 0 && glyphHidden.every((entry) => /<use href="#panel-/.test(entry.glyph ?? "")),
		JSON.stringify(glyphHidden.map((entry) => [entry.id, entry.glyph])),
	);
	const glyphTree = moreRow({ t: (key) => key, onDismiss: () => {} });
	const glyphRows = glyphTree.children.slice(1);
	check("every More row receives an icon node", glyphRows.every((row) => row.props.icon !== null && row.props.icon !== undefined));
	const panelGlyphRows = glyphRows.filter((row) => typeof row.props.icon.type === "function");
	check(
		"no panel row falls back to an empty placeholder",
		panelGlyphRows.length > 0 && panelGlyphRows.every((row) => /<svg/.test(row.props.icon.props.markup ?? "")),
		JSON.stringify(panelGlyphRows.map((row) => row.props.icon.props.markup ?? null)),
	);
	check("the nav leaks no icon markup into its labels", glyphNav.nav.querySelector("button[data-dpl-util]") === null);

	/* ── a way out of More without a pointer drag ───────────────────────────
	   Touch screens fire no HTML5 drag events, so every More row also carries a
	   control that brings it to the head of the order, where the cap shows it. */
	console.log("\nmove to front");
	const frontTree = moreRow({ t: (key) => key, onDismiss: () => {} });
	const frontRows = frontTree.children.slice(1);
	check(
		"every More row offers a move-to-front handler",
		frontRows.every((row) => typeof row.props.onFront === "function"),
		`${frontRows.length} rows`,
	);
	check("the control has a localized accessible name", inner.utilityLabel("settings") !== null && frontRows.every((row) => row.props.hint === "moveToFront"));

	/* The row itself is a component, so the control is asserted through the
	   reorder it performs rather than through the tree. */
	const hiddenBefore = inner.hiddenEntries();
	const promotedId = hiddenBefore[hiddenBefore.length - 1].id;
	const liveBefore = inner.allLiveIds();
	inner.moveToFront(promotedId);
	const orderAfter = inner.readStoredOrder();
	check("moving one to the front puts it first in the order", orderAfter[0] === promotedId, `${orderAfter[0]} vs ${promotedId}`);
	check(
		"moving one to the front keeps exactly the ids it had",
		orderAfter.length === liveBefore.length && liveBefore.every((id) => orderAfter.includes(id)),
		`${liveBefore.length} -> ${orderAfter.length}`,
	);
	inner.sync();
	const stillHidden = inner.hiddenEntries().map((entry) => entry.id);
	check("the promoted entry leaves More and the tail takes its place", !stillHidden.includes(promotedId) && stillHidden.length > 0, stillHidden.join(","));
	inner.resetOrder();

	/* ── sorting the rows the menu lists ────────────────────────────────────
	   Whatever the cap kept below the fold lives in More, so those rows sort
	   against each other too — and the marker there is always a rule between
	   two rows, because the menu is one column whoever laid out the nav. The
	   two rows the shell contributes (browse / create a plugin) are its own and
	   take no part in this. */
	console.log("\nsorting inside the More menu");
	const renderedMenuRows = () => {
		const tree = moreRow({ t: (key) => key, onDismiss: () => {} });
		return tree === null ? [] : tree.children.slice(1).map((node) => node.type(node.props));
	};
	/* A stand-in for the DOM node the handler gets through currentTarget. */
	const fakeRow = (top = 0, height = 34) => {
		const attrs = new Map();
		return {
			attrs,
			getBoundingClientRect: () => ({ top, left: 0, width: 220, height }),
			setAttribute: (key, value) => void attrs.set(key, value),
			removeAttribute: (key) => void attrs.delete(key),
		};
	};
	const startDrag = (row, host) => row.props.onDragStart({ currentTarget: host, dataTransfer: { setData: () => {} } });
	const hoverRow = (row, host, clientY, clientX = 0) => {
		let prevented = 0;
		row.props.onDragOver({ currentTarget: host, clientY, clientX, dataTransfer: {}, preventDefault: () => { prevented += 1; } });
		return prevented;
	};
	const dropOnRow = (row, host, clientY, clientX = 0) =>
		row.props.onDrop({ currentTarget: host, clientY, clientX, dataTransfer: {}, preventDefault: () => {} });

	/* Row layout above, a narrow sidebar: five entries fold into More. */
	inner.setPreferences({ mode: "row", rows: 1 }, false);
	inner.resetOrder();
	const menuNav = buildSidebar({ width: 200 });
	inner.sync();
	const menuRows = renderedMenuRows();
	check("the row layout folds entries into the menu", menuRows.length > 1, `${menuRows.length}`);
	check("the nav really hid rows the menu now lists", menuNav.nav.querySelectorAll("[data-dpl-hidden]").length > 0);
	check(
		"every menu row is both draggable and a drop target",
		menuRows.every((row) => row.props.draggable === true && typeof row.props.onDragOver === "function" && typeof row.props.onDrop === "function"),
	);
	check("no menu row is left without a drag end", menuRows.every((row) => typeof row.props.onDragEnd === "function"));
	/* The marker needs its own rule: the nav's marker selectors are scoped to
	   `nav[data-dpl-nav]` and would never paint a row inside the menu. */
	check(
		"the menu carries its own insertion marker",
		/\.dpl-menuItem\[data-dpl-menu-drop="before"\]::before/.test(css) &&
			/\.dpl-menuItem\[data-dpl-menu-drop="after"\]::after/.test(css),
		css.match(/[^\n]*dpl-menu-drop[^\n]*/)?.[0] ?? "no rule",
	);
	check("the menu marker never borrows the nav's axis", !/nav\[data-dpl-nav\][^{]*dpl-menuItem/.test(css));

	/* A drag that started inside the menu makes its rows accept the drop. */
	const draggedHost = fakeRow();
	startDrag(menuRows[0], draggedHost);
	check("the dragged row is dimmed like a nav row", draggedHost.attrs.get("data-dpl-dragging") === "");

	/* The marker follows the menu's own axis. A pointer on the right half but in
	   the upper half of the row still means "insert above": the nav's row-mode
	   horizontal rule must not leak in here. */
	const markerRow = fakeRow(100, 34);
	const markerPrevented = hoverRow(menuRows[2], markerRow, 105, 210);
	check("hovering a menu row accepts the drop", markerPrevented === 1);
	check("the menu marker sits above the upper half of the row", markerRow.attrs.get("data-dpl-menu-drop") === "before", markerRow.attrs.get("data-dpl-menu-drop"));
	const lowerRow = fakeRow(100, 34);
	hoverRow(menuRows[2], lowerRow, 128);
	check("the menu marker sits below the lower half of the row", lowerRow.attrs.get("data-dpl-menu-drop") === "after", lowerRow.attrs.get("data-dpl-menu-drop"));

	/* Sort one menu entry after another: the order it lands in is the same
	   order the nav holds, so nothing here is a menu-only list. */
	const draggingRowId = inner.hiddenEntries()[0].id;
	const targetRowId = inner.hiddenEntries()[2].id;
	const draggingRow = menuRows.find((row) => row.props["data-dpl-menu-id"] === draggingRowId);
	const targetRow = menuRows.find((row) => row.props["data-dpl-menu-id"] === targetRowId);
	check("both ends of the drag are in the menu", draggingRow !== undefined && targetRow !== undefined);
	/* A marker left on a real node is what the next hover has to clean up. */
	const staleMarker = document.createElement("button");
	staleMarker.setAttribute("data-dpl-menu-drop", "before");
	document.body.appendChild(staleMarker);
	dropOnRow(targetRow, fakeRow(), 30);
	const sortedOrder = inner.readStoredOrder();
	check(
		"dropping one menu row under another moves it there",
		sortedOrder.indexOf(draggingRowId) === sortedOrder.indexOf(targetRowId) + 1,
		sortedOrder.join(","),
	);
	check("the drop clears the insertion markers", !staleMarker.hasAttribute("data-dpl-menu-drop"));
	check("the drop keeps every id it had", sortedOrder.length === inner.allLiveIds().length, `${sortedOrder.length}`);
	staleMarker.remove();

	/* The row cannot be dropped on itself, and a drag that ends puts the row's
	   own state back so the next render is clean. */
	const selfBefore = inner.readStoredOrder().join(",");
	startDrag(targetRow, draggedHost);
	dropOnRow(targetRow, fakeRow(), 30);
	check("dropping a row on itself changes nothing", inner.readStoredOrder().join(",") === selfBefore);
	hoverRow(targetRow, fakeRow(), 30);
	targetRow.props.onDragEnd({ currentTarget: draggedHost });
	check("a finished drag releases the row", !draggedHost.attrs.has("data-dpl-dragging") && !draggedHost.attrs.has("data-dpl-menu-drop"));
	check("a finished drag stops accepting drops", hoverRow(menuRows[1], fakeRow(), 30) === 0);

	/* The same menu in list layout: the rows behave identically. */
	inner.setPreferences({ mode: "list", rows: 1 }, false);
	inner.resetOrder();
	const listNav = buildSidebar({ width: 1600 });
	inner.sync();
	const listMenuRows = renderedMenuRows();
	check("the list layout folds entries into the menu", listMenuRows.length > 1, `${listMenuRows.length}`);
	const listDragId = inner.hiddenEntries()[listMenuRows.length - 1].id;
	const listTargetId = inner.hiddenEntries()[0].id;
	const listDragRow = listMenuRows.find((row) => row.props["data-dpl-menu-id"] === listDragId);
	const listTargetRow = listMenuRows.find((row) => row.props["data-dpl-menu-id"] === listTargetId);
	startDrag(listDragRow, fakeRow());
	dropOnRow(listTargetRow, fakeRow(), 0);
	const listOrder = inner.readStoredOrder();
	check(
		"list layout sorts a menu row the same way",
		listOrder.indexOf(listDragId) === listOrder.indexOf(listTargetId) - 1,
		listOrder.join(","),
	);
	check("list layout still lists the same entries in the nav", visibleRows(listNav.nav).length > 0);
	inner.resetOrder();

} else {
	console.log("jsdom is not available — the DOM half was skipped (npm install --no-save jsdom)");
}

console.log(failures.length === 0 ? `\n${checks} checks passed` : `\n${failures.length} of ${checks} checks failed`);
process.exit(failures.length === 0 ? 0 : 1);
