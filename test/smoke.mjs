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
	function buildSidebar({ signedOut = true, labelled = true, width = 200 } = {}) {
		document.body.innerHTML = "";
		const nav = document.createElement("nav");
		nav.setAttribute("aria-label", "全局面板");
		for (const panel of PANELS) {
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
		nav.appendChild(wrap);
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
	const oneRowCap = Math.max(1, Math.floor((200 + 4) / (36 + 4)));
	check("one row caps the visible cells", visibleRows(narrow.nav).length === oneRowCap, `${visibleRows(narrow.nav).length} of ${oneRowCap}`);
	check("overflow rows are hidden, not removed", narrow.nav.children.length > visibleRows(narrow.nav).length);
	const narrowUtils = utilIds(narrow.nav);
	check("a tight row cap pushes the absorbed utilities out of the nav", narrowUtils.length === 0, narrowUtils.join(","));
	check("overflow rows keep their place in the DOM", narrow.nav.querySelectorAll('[data-dpl-hidden]').length > 0);

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
} else {
	console.log("jsdom is not available — the DOM half was skipped (npm install --no-save jsdom)");
}

console.log(failures.length === 0 ? `\n${checks} checks passed` : `\n${failures.length} of ${checks} checks failed`);
process.exit(failures.length === 0 ? 0 : 1);
