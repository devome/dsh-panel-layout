/**
 * dsh-panel-layout — browser half.
 *
 * The sidebar's global panel menu (`sidebar.panellist`) is the column of
 * labelled rows above the workspace list, and the shell owns that markup: one
 * `nav` holds one `<button>` per panel entry plus a More launcher (the menu
 * primitive wraps that button in its own anchor span). The bottom-left
 * launcher in `sidebar.settings` is the account menu; while signed out it
 * renders as a plain 「更多」 row whose menu holds Settings / Feedback / Sign in.
 *
 * This plugin turns that region into a configurable menu:
 *
 *   1. **Layout** — `row` (a wrapped grid of 36px icon cells) or `list` (the
 *      shipped labelled column). The choice and the row cap live in one
 *      Settings → General row.
 *   2. **Row cap** — in row mode the menu shows at most `rows` rows, measured
 *      from the live width (36px per cell + 4px gap); in list mode the first
 *      four entries show and the rest fold into More.
 *   3. **Order** — drag any row onto another to reorder; the order is stored
 *      per browser and applied through flex `order`, so a shell re-render never
 *      loses it.
 *   4. **Overflow** — entries past the cap are hidden from the nav and listed
 *      in More, in the same order, so nothing becomes unreachable. Those rows
 *      drag back out onto the nav, and each carries a one-tap "move to front"
 *      control, since a touch screen fires no drag events.
 *   5. **Bottom-left 「更多」** — hidden while the account launcher reports a
 *      signed-out state (CSS only, so it returns the moment the account signs
 *      in), and its three actions move into the panel menu as first-class,
 *      reorderable entries that keep the glyphs the shell gives them: Settings
 *      via the shell's own open-settings action (its command when it has a
 *      binding, otherwise the action it hands the launcher), Feedback via the
 *      public questionnaire the shell links, Sign in via the Host account
 *      stream's `startSignIn`.
 *
 * Icons are never drawn here. A panel row shows whatever glyph its own plugin
 * registered, and that same markup travels with the row into More; the three
 * absorbed actions reference the shell's own sprite symbols, so they keep the
 * icons the account menu uses and follow the host's icon set.
 *
 * Why DOM work instead of a slot occupant: `sidebar.panellist` only feeds the
 * *glyph* inside each row — the row geometry, the cap and the order belong to
 * the shell, and no slot exposes them. The plugin therefore tags the rows it
 * finds (recognising each panel's row by its `data-slot="sidebar.panellist"`
 * glyph anchor, and the More launcher by its `aria-haspopup="menu"`), applies
 * ordering and visibility through attributes it owns, and re-reconciles from
 * one `MutationObserver` plus a `ResizeObserver`.
 *
 * `sidebar.panellist.actions` is still used, for what DOM work cannot do:
 * contributing rows to the shell's More menu. It lists the entries the current
 * cap (or the account state) kept out of the nav, so a menu row is never
 * duplicated between the nav and More.
 */

window.__ModuleLoader__.load({
	id: "dsh-panel-layout",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const react = require("react");

		//#region constants
		/** Dictionary namespace owned by this plugin. */
		const NS = "panel-layout";
		/** `<style>` tag identity, so a reload replaces rather than stacks. */
		const CSS_ID = "dsh-panel-layout/panel-layout.css";
		/** Plugin attribution on the injected tag. */
		const PLUGIN_ID = "dsh-panel-layout";
		/** Browser-stored preferences. */
		const SETTINGS_KEY = "dsh-panel-layout:settings";
		const ORDER_KEY = "dsh-panel-layout:order";
		/** Layout values. */
		const MODE_ROW = "row";
		const MODE_LIST = "list";
		/** Document-level state the stylesheet is gated on. */
		const MODE_ATTR = "data-dpl-mode";
		const WIDE_ATTR = "data-dpl-wide";
		/** Tags this plugin writes on the shell's own nodes. */
		const NAV_ATTR = "data-dpl-nav";
		const MORE_ATTR = "data-dpl-more";
		const LABEL_ATTR = "data-dpl-label";
		const HIDDEN_ATTR = "data-dpl-hidden";
		const UTIL_ATTR = "data-dpl-util";
		const PANEL_ATTR = "data-dpl-panel";
		/** The insertion marker inside the shell's More menu, kept apart from the
		   nav's own marker: a menu row is never sorted along the nav's axis. */
		const MENU_DROP_ATTR = "data-dpl-menu-drop";
		/** The renderer's anchor inside every panel row. */
		const PANEL_SLOT = '[data-slot="sidebar.panellist"]';
		/** The shell's bottom-left settings/account launcher. */
		const LAUNCHER_SLOT = '[data-slot="settings.launcher"]';
		/** Hides the popup menu while the fallback route clicks through it. */
		const QUIET_ATTR = "data-dpl-quiet";
		/** The three bottom-left actions, absorbed into the panel menu. */
		const UTILITIES = ["settings", "contact", "signin"];
		/** Entries a list-mode menu keeps on screen before folding into More. */
		const LIST_BUDGET = 4;
		/** One icon cell plus the gap it adds. */
		const CELL = 36;
		const GAP = 4;
		const MAX_ROWS = 3;
		/** Feedback questionnaire the shell links by default. */
		const DEFAULT_CONTACT_URL =
			"https://trtgsjkv6r.feishu.cn/share/base/form/shrcnlCoGElW7MQznGy9r3YYXcg?hide_uid=1&hide_device_info=1&hide_harness_version=1";
		//#endregion

		//#region styles
		const CSS = `
/* ── the panel list, when this plugin owns its geometry ─────────────────── */
html[data-dpl-mode] nav[data-dpl-nav] {
	box-sizing: border-box;
}

html[data-dpl-mode][data-dpl-wide] nav[data-dpl-nav][data-dpl-mode-core="row"] {
	flex-direction: row;
	flex-wrap: wrap;
	align-items: center;
	gap: 4px;
	padding-inline: 2px;
	margin-bottom: 8px;
}

/* One compact cell per entry, and the More launcher's anchor is the cell. */
html[data-dpl-mode][data-dpl-wide] nav[data-dpl-nav][data-dpl-mode-core="row"] > * {
	box-sizing: border-box;
	flex: 0 0 auto;
	margin: 0;
	padding: 0;
	width: 36px;
	height: 36px;
	display: flex;
	align-items: center;
	justify-content: center;
}

html[data-dpl-mode][data-dpl-wide] nav[data-dpl-nav][data-dpl-mode-core="row"] button {
	box-sizing: border-box;
	position: relative;
	flex: 0 0 auto;
	justify-content: center;
	gap: 0;
	width: 36px;
	height: 36px;
	min-height: 36px;
	margin: 0;
	padding: 0;
	border-radius: var(--dsw-radius-md);
}

/* The label cell is hidden; the row keeps its name as a native tooltip. */
html[data-dpl-mode][data-dpl-wide] nav[data-dpl-nav][data-dpl-mode-core="row"] span[data-dpl-label] {
	display: none;
}

/* ── the absorbed utilities ─────────────────────────────────────────────
   They copy the shell's own panel row value for value, so they read as one
   more menu entry rather than as an insertion. */
nav[data-dpl-nav] button[data-dpl-util] {
	box-sizing: border-box;
	align-items: center;
	gap: var(--dsh-sidebar-label-gap, 6px);
	min-height: 36px;
	width: 100%;
	margin: 0;
	padding: 7px calc(var(--dsh-sidebar-row-padding, 12px) - var(--dsh-sidebar-paint-inset, 3px));
	border: none;
	border-inline: var(--dsh-sidebar-paint-inset, 3px) solid transparent;
	border-radius: var(--dsw-radius-md);
	color: var(--dsw-alias-label-primary);
	font: inherit;
	line-height: 22px;
	text-align: left;
	cursor: pointer;
	background: transparent;
	display: flex;
}

@media (hover: hover) {
	nav[data-dpl-nav] button[data-dpl-util]:hover {
		background-color: var(--dsw-alias-interactive-bg-hover);
	}
}

nav[data-dpl-nav] button[data-dpl-util]:focus-visible {
	outline: 2px solid var(--dsw-alias-state-business-primary);
	outline-offset: -2px;
}

nav[data-dpl-nav] button[data-dpl-util] > span[data-dpl-util-glyph] {
	flex: none;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	color: var(--dsw-alias-label-primary);
}

nav[data-dpl-nav] button[data-dpl-util] > span[data-dpl-label] {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	min-width: 0;
}

html[data-dpl-mode][data-dpl-wide] nav[data-dpl-nav][data-dpl-mode-core="row"] button[data-dpl-util] {
	width: 36px;
	height: 36px;
	min-height: 36px;
	padding: 0;
	border-inline-width: 0;
	gap: 0;
}

/* ── cap and order ────────────────────────────────────────────────────── */
nav[data-dpl-nav] [data-dpl-hidden] {
	display: none !important;
}

nav[data-dpl-nav] [data-dpl-drop="before"],
nav[data-dpl-nav] [data-dpl-drop="after"] {
	position: relative;
}

nav[data-dpl-nav] [data-dpl-dragging] {
	opacity: 0.4;
}

html[data-dpl-mode] [data-dpl-drop="before"]::before,
html[data-dpl-mode] [data-dpl-drop="after"]::after {
	content: "";
	position: absolute;
	z-index: 5;
	background: var(--dsw-alias-state-business-primary);
	border-radius: 2px;
	pointer-events: none;
}

/* The insertion marker follows the flow axis: a rule between list rows and a
   line between grid cells. */
html[data-dpl-mode] nav[data-dpl-nav][data-dpl-mode-core="list"] [data-dpl-drop="before"]::before,
html[data-dpl-mode] nav[data-dpl-nav][data-dpl-mode-core="list"] [data-dpl-drop="after"]::after {
	left: 2px;
	right: 2px;
	height: 2px;
}

html[data-dpl-mode] nav[data-dpl-nav][data-dpl-mode-core="list"] [data-dpl-drop="before"]::before {
	top: -1px;
}

html[data-dpl-mode] nav[data-dpl-nav][data-dpl-mode-core="list"] [data-dpl-drop="after"]::after {
	bottom: -1px;
}

html[data-dpl-mode] nav[data-dpl-nav][data-dpl-mode-core="row"] [data-dpl-drop="before"]::before,
html[data-dpl-mode] nav[data-dpl-nav][data-dpl-mode-core="row"] [data-dpl-drop="after"]::after {
	top: 2px;
	bottom: 2px;
	width: 2px;
}

html[data-dpl-mode] nav[data-dpl-nav][data-dpl-mode-core="row"] [data-dpl-drop="before"]::before {
	left: -1px;
}

html[data-dpl-mode] nav[data-dpl-nav][data-dpl-mode-core="row"] [data-dpl-drop="after"]::after {
	right: -1px;
}

/* ── the bottom-left 「更多」 ────────────────────────────────────────────
   Hidden only while the account launcher reports itself signed out: the point
   is to move those three actions up, and a signed-in launcher is the account
   avatar rather than a 「更多」 row, so it stays. */
/* Only while the three actions really are up in the panel menu: the rail has
   no room for them, this plugin drops them there, and hiding the launcher too
   would leave Settings / Feedback / Sign in unreachable. The renderer gives
   each slot host an inline display: contents, so the hide must outrank it. */
html[data-dpl-mode][data-dpl-wide] [data-slot="settings.launcher"]:has(button[data-signed-out="true"]) {
	display: none !important;
}

/* While the fallback route clicks through the account menu, that menu is
   mounted but not shown: only the Settings dialog it opens should appear. */
html[data-dpl-quiet] [role="menu"] {
	visibility: hidden !important;
}

/* ── the Settings → General row ─────────────────────────────────────────── */
.dpl-row {
	display: flex;
	justify-content: space-between;
	align-items: center;
	gap: 24px;
	padding: 16px 0;
	border-bottom: 0.5px solid var(--dsw-alias-border-l2);
}

.dpl-rowText {
	min-width: 0;
	flex: 1;
}

.dpl-rowTitle {
	font-size: 14px;
	line-height: 20px;
}

.dpl-rowHint {
	margin-top: 4px;
	color: var(--dsw-alias-label-secondary);
	font-size: 12px;
	line-height: 18px;
}

.dpl-controls {
	display: flex;
	flex-direction: column;
	align-items: flex-end;
	gap: 8px;
	flex: none;
}

.dpl-segmented,
.dpl-stepper {
	display: inline-flex;
	align-items: center;
	gap: 2px;
	padding: 2px;
	border-radius: var(--dsw-radius-md);
	background: var(--dsw-alias-bg-module-platform, var(--dsw-alias-bg-layer-2));
}

.dpl-segment,
.dpl-stepper button {
	border: 0.5px solid transparent;
	background: transparent;
	color: var(--dsw-alias-label-secondary);
	font: inherit;
	font-size: 12px;
	line-height: 18px;
	padding: 4px 10px;
	border-radius: var(--dsw-radius-sm);
	cursor: pointer;
}

.dpl-stepper button {
	width: 24px;
	padding: 3px 0;
}

.dpl-segment[aria-pressed="true"],
.dpl-stepper button[aria-pressed="true"] {
	background: var(--dsw-alias-bg-layer-3, var(--dsw-alias-bg-layer-1));
	border-color: var(--dsw-alias-border-l3);
	color: var(--dsw-alias-label-primary);
}

.dpl-segment:focus-visible,
.dpl-stepper button:focus-visible {
	outline: 2px solid var(--dsw-alias-state-business-primary);
	outline-offset: 1px;
}

.dpl-rowCap {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	color: var(--dsw-alias-label-secondary);
	font-size: 12px;
	line-height: 18px;
}

.dpl-reset {
	border: none;
	background: transparent;
	color: var(--dsw-alias-label-secondary);
	font: inherit;
	font-size: 12px;
	line-height: 18px;
	padding: 0;
	cursor: pointer;
	text-decoration: underline;
	text-underline-offset: 2px;
}

.dpl-reset:hover {
	color: var(--dsw-alias-label-primary);
}

/* ── rows contributed to the shell's More menu ──────────────────────────── */
.dpl-menuSeparator {
	height: 1px;
	margin: 4px 6px;
	background: var(--dsw-alias-border-l2);
}

.dpl-menuItem {
	box-sizing: border-box;
	display: flex;
	align-items: center;
	gap: 6px;
	width: 100%;
	min-height: 34px;
	padding: 6px 8px;
	border: none;
	border-radius: var(--dsw-radius-md);
	background: transparent;
	color: var(--dsw-alias-label-primary);
	font: inherit;
	font-size: 13px;
	line-height: 20px;
	text-align: left;
	cursor: pointer;
}

@media (hover: hover) {
	.dpl-menuItem:hover {
		background: var(--dsw-alias-interactive-bg-hover);
	}
}

.dpl-menuItem:focus-visible {
	background: var(--dsw-alias-interactive-bg-hover);
	outline: none;
}

/* Rows sort against each other inside the menu as well. The menu is one
   vertical column whatever the nav is doing, so the marker is always a rule
   between two rows — it never follows the nav's own axis. */
html[data-dpl-mode] .dpl-menuItem[data-dpl-menu-drop] {
	position: relative;
}

html[data-dpl-mode] .dpl-menuItem[data-dpl-menu-drop="before"]::before,
html[data-dpl-mode] .dpl-menuItem[data-dpl-menu-drop="after"]::after {
	content: "";
	position: absolute;
	z-index: 5;
	left: 2px;
	right: 2px;
	height: 2px;
	background: var(--dsw-alias-state-business-primary);
	border-radius: 2px;
	pointer-events: none;
}

html[data-dpl-mode] .dpl-menuItem[data-dpl-menu-drop="before"]::before {
	top: -1px;
}

html[data-dpl-mode] .dpl-menuItem[data-dpl-menu-drop="after"]::after {
	bottom: -1px;
}

.dpl-menuItem[data-dpl-dragging] {
	opacity: 0.4;
}

/* One icon cell per row, sized to the icons the account menu draws for the
   three absorbed actions (16px). A panel's glyph keeps whatever size its own
   plugin gave it; this cell only positions it. */
.dpl-menuIcon {
	display: inline-flex;
	flex: none;
	width: 16px;
	height: 16px;
	align-items: center;
	justify-content: center;
	color: var(--dsw-alias-menu-icon, var(--dsw-alias-label-secondary));
}

/* A panel's own glyph arrives as markup: size it like the shell's icons and
   hand it the menu's icon colour without touching anything inside it. */
.dpl-menuGlyph {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 100%;
	height: 100%;
	color: inherit;
}

/* A panel's glyph is shown exactly as its plugin rendered it: no size, colour
   or shape is imposed on the markup, only the alignment of its box. */
.dpl-menuGlyph > svg {
	flex: none;
}

.dpl-menuGlyphBlank {
	display: inline-block;
	width: 100%;
	height: 100%;
}

/* The pointer-free way out of More: a button that brings the row to the head
   of the order, where the cap always shows it. */
.dpl-menuFront {
	display: inline-flex;
	flex: none;
	align-items: center;
	justify-content: center;
	width: 20px;
	height: 20px;
	margin-inline-start: auto;
	border-radius: var(--dsw-radius-sm, 4px);
	color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary));
	cursor: pointer;
	opacity: 0;
}

.dpl-menuItem:hover .dpl-menuFront,
.dpl-menuFront:focus-visible {
	opacity: 1;
}

.dpl-menuFront:hover {
	background: var(--dsw-alias-interactive-bg-hover);
	color: var(--dsw-alias-label-primary);
}

/* A touch screen has no hover, so the control stays visible for a coarse
   pointer instead of hiding until the row is tapped. */
@media (hover: none) {
	.dpl-menuFront {
		opacity: 1;
	}
}

.dpl-menuLabel {
	flex: 1;
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

@media (prefers-reduced-motion: reduce) {
	nav[data-dpl-nav] [data-dpl-drop]::before,
	nav[data-dpl-nav] [data-dpl-drop]::after {
		transition: none;
	}
}
`;
		/** Install the stylesheet once; a reload adopts the existing tag. */
		function injectCss() {
			if (typeof document === "undefined") return () => {};
			const selector = "style[data-plugin-css=" + JSON.stringify(CSS_ID) + "]";
			if (document.querySelector(selector) !== null) return () => {};
			const tag = document.createElement("style");
			tag.dataset.plugin = PLUGIN_ID;
			tag.dataset.pluginCss = CSS_ID;
			tag.textContent = CSS;
			document.head.appendChild(tag);
			return () => {
				tag.remove();
			};
		}
		//#endregion

		//#region preferences
		/**
		 * Preferences, read lazily so a blocked storage cannot break load. They
		 * live in one snapshot because the settings row renders both values.
		 */
		let persisted = null;
		const prefListeners = new Set();

		/** Clamp one stored preference record into its supported range. */
		function normalizePreferences(raw) {
			const mode = raw !== null && raw !== undefined && raw.mode === MODE_LIST ? MODE_LIST : MODE_ROW;
			let rows = raw !== null && raw !== undefined && typeof raw.rows === "number" && Number.isFinite(raw.rows) ? Math.round(raw.rows) : 1;
			if (rows < 1) rows = 1;
			if (rows > MAX_ROWS) rows = MAX_ROWS;
			return { mode, rows };
		}

		/** Read the stored preferences, defaulting to the compact single row. */
		function readStoredPreferences() {
			try {
				const raw = window.localStorage.getItem(SETTINGS_KEY);
				return normalizePreferences(raw === null ? null : JSON.parse(raw));
			} catch {
				return normalizePreferences(null);
			}
		}

		/** Current preferences; the first read consults storage. */
		function preferences() {
			if (persisted === null) persisted = readStoredPreferences();
			return persisted;
		}

		function notifyPrefs() {
			for (const listener of [...prefListeners]) {
				try {
					listener();
				} catch (error) {
					console.error("[dsh-panel-layout] preference listener failed:", error);
				}
			}
		}

		function subscribePrefs(listener) {
			prefListeners.add(listener);
			return () => {
				prefListeners.delete(listener);
			};
		}

		/** Write one preference (or several) and repaint every follower. */
		function setPreferences(patch, persist) {
			persisted = normalizePreferences({ ...preferences(), ...patch });
			if (persist) {
				try {
					window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(persisted));
				} catch {}
			}
			requestSync();
			notifyPrefs();
		}

		/** Read the stored order, or an empty list when none was saved. */
		function readStoredOrder() {
			try {
				const raw = window.localStorage.getItem(ORDER_KEY);
				if (raw === null) return [];
				const parsed = JSON.parse(raw);
				return Array.isArray(parsed) ? parsed.filter((entry) => typeof entry === "string") : [];
			} catch {
				return [];
			}
		}

		let order = readStoredOrder();

		/** Persist the order and repaint. */
		function setOrder(next) {
			order = next.filter((entry, index) => typeof entry === "string" && next.indexOf(entry) === index);
			try {
				window.localStorage.setItem(ORDER_KEY, JSON.stringify(order));
			} catch {}
			requestSync();
		}

		function resetOrder() {
			order = [];
			try {
				window.localStorage.removeItem(ORDER_KEY);
			} catch {}
			requestSync();
		}

		/**
		 * Merge a live id list into the stored order: known ids keep their saved
		 * position, ids seen for the first time append in live order, and ids that
		 * disappeared are dropped.
		 */
		function mergeOrder(ids) {
			const live = new Set(ids);
			const merged = order.filter((id) => live.has(id));
			for (const id of ids) if (!merged.includes(id)) merged.push(id);
			return merged;
		}
		//#endregion

		//#region visibility (shared with the More-menu rows)
		/** Entries the current cap pushed out of the nav: `{ id, label, kind }`. */
		let hiddenEntries = [];
		const visibilityListeners = new Set();

		function setHiddenEntries(next) {
			const same =
				next.length === hiddenEntries.length &&
				next.every(
					(entry, index) =>
						entry.id === hiddenEntries[index].id &&
						entry.label === hiddenEntries[index].label &&
						entry.kind === hiddenEntries[index].kind &&
						(entry.glyph ?? "") === (hiddenEntries[index].glyph ?? ""),
				);
			if (same) return;
			hiddenEntries = next;
			for (const listener of [...visibilityListeners]) {
				try {
					listener();
				} catch (error) {
					console.error("[dsh-panel-layout] visibility listener failed:", error);
				}
			}
		}

		function subscribeVisibility(listener) {
			visibilityListeners.add(listener);
			return () => {
				visibilityListeners.delete(listener);
			};
		}
		//#endregion

		//#region slots → ids and labels
		let slotsService = null;

		/** Resolve one slot registration label (a string, or a thunk). */
		function labelOf(option, fallbackId) {
			const label = option === undefined ? undefined : option.label;
			if (typeof label === "function") {
				try {
					return String(label());
				} catch {
					return fallbackId;
				}
			}
			return typeof label === "string" && label !== "" ? label : fallbackId;
		}

		/**
		 * The panel entries as the shell orders them. `plugins` is included: the
		 * shell forces that row and never offers a pin control for it.
		 */
		function panelEntries() {
			if (slotsService === null || typeof slotsService.entriesOfSlot !== "function") return [];
			let raw;
			try {
				raw = slotsService.entriesOfSlot("sidebar.panellist");
			} catch {
				return [];
			}
			const entries = [];
			for (const entry of raw) {
				const options = entry === undefined ? undefined : entry.options;
				if (options === undefined || typeof options.id !== "string") continue;
				entries.push({ id: options.id, label: labelOf(options, options.id), order: options.order ?? 0 });
			}
			return entries.sort((a, b) => a.order - b.order);
		}
		//#endregion

		//#region actions
		/** Services the utility actions need, filled in as they appear. */
		const services = { shortcuts: null, remote: null, theme: null, layout: null };

		/**
		 * Fire one of the shell's own commands by synthesizing the key gesture it is
		 * bound to. The service exposes the catalog, not a dispatch entry point, and
		 * its keyboard adapter listens on the window, so this goes through exactly
		 * the same path a real keypress takes — including the user's own rebinding.
		 * @param id - command id, such as `settings.open`.
		 * @returns whether a binding existed and the event was dispatched.
		 */
		function invokeCommand(id) {
			const shortcuts = services.shortcuts;
			if (shortcuts === null || shortcuts.catalog === undefined) return false;
			let row;
			try {
				row = shortcuts.catalog.getSnapshot().find((candidate) => candidate.id === id);
			} catch {
				return false;
			}
			const binding = row === undefined ? null : row.binding;
			if (binding === null || binding === undefined) return false;
			const gesture = {
				code: binding.code,
				composed: true,
				key: "",
				ctrlKey: binding.modifiers.includes("control"),
				altKey: binding.modifiers.includes("alt"),
				shiftKey: binding.modifiers.includes("shift"),
				metaKey: binding.modifiers.includes("meta"),
			};
			try {
				window.dispatchEvent(new KeyboardEvent("keydown", gesture));
				return true;
			} catch (error) {
				console.error("[dsh-panel-layout] could not dispatch the command:", error);
				return false;
			}
		}

		/**
		 * Open the shell's Settings dialog.
		 *
		 * The dialog is owned by the settings shell, and its open action lives on a
		 * shell-private store; the only public way in is the shell's own
		 * `settings.open` command, so the plugin replays that command's key gesture
		 * through the window the keyboard adapter already listens on. The user's
		 * own rebinding is honoured, and the shell's modal and region guards still
		 * apply.
		 */
		function openSettings() {
			if (invokeCommand("settings.open")) return;
			if (openSettingsDirectly()) return;
			/* Last resort: replay the path a person takes. The account menu's own
			   Settings row runs the same action, but the menu has to mount before
			   its row can be clicked — so it is opened hidden, and the row is
			   clicked in the same breath. Nothing flashes; the dialog is the only
			   thing that appears. */
			const launcher = document.querySelector(LAUNCHER_SLOT);
			const trigger = launcher === null ? null : launcher.querySelector('button[aria-haspopup="menu"]');
			if (trigger === null) {
				console.error("[dsh-panel-layout] no path to the Settings dialog in this profile");
				return;
			}
			document.documentElement.setAttribute(QUIET_ATTR, "");
			trigger.click();
			window.setTimeout(() => {
				document.documentElement.removeAttribute(QUIET_ATTR);
				const row = Array.from(document.querySelectorAll('[role="menuitem"]')).find((item) => item.querySelector('use[href="#dsw-icon-settings-outline-medium"]') !== null);
				if (row === undefined) {
					console.error("[dsh-panel-layout] the account menu offered no Settings row");
					return;
				}
				row.click();
			}, 0);
		}

		/**
		 * Call the shell's own open-settings action, taken from the account
		 * launcher's props.
		 *
		 * The shell hands that action to whatever occupies `settings.launcher`, so
		 * the launcher's own rendered node carries it — reading it there is the
		 * same call its account menu makes, minus the menu. React keeps props on a
		 * per-load key, so the lookup is a defensive best effort: when the shape
		 * is not what this build expects, this reports failure and the caller
		 * falls back to markup.
		 * @returns whether the dialog was asked to open.
		 */
		function openSettingsDirectly() {
			const launcher = document.querySelector(LAUNCHER_SLOT);
			const node = launcher === null ? null : launcher.querySelector("button");
			if (node === null) return false;
			const key = Object.keys(node).find((name) => name.startsWith("__reactFiber$") || name.startsWith("__reactInternalInstance$"));
			if (key === undefined) return false;
			try {
				let fiber = node[key];
				for (let depth = 0; depth < 16 && fiber !== null && fiber !== undefined; depth += 1) {
					const props = fiber.memoizedProps;
					if (props !== null && typeof props === "object" && typeof props.openSettings === "function") {
						props.openSettings();
						return true;
					}
					fiber = fiber.return;
				}
			} catch (error) {
				console.error("[dsh-panel-layout] the settings action was unreadable:", error);
			}
			return false;
		}

		/** Open a panel in the main column. */
		function openPanel(id) {
			const layout = services.layout;
			if (layout === null || typeof layout.selectPanel !== "function") return;
			try {
				layout.selectPanel(id);
			} catch (error) {
				console.error("[dsh-panel-layout] could not open panel:", error);
			}
		}

		/** Open the public feedback questionnaire, carrying the shell's hidden fields. */
		function openFeedback() {
			const config = globalThis.__DSH_CONTACT_CONFIG__;
			const configured =
				config !== null && typeof config === "object" && typeof config.contactFormUrl === "string" && /^https:\/\//.test(config.contactFormUrl)
					? config.contactFormUrl
					: DEFAULT_CONTACT_URL;
			let url;
			try {
				url = new URL(configured);
			} catch {
				url = new URL(DEFAULT_CONTACT_URL);
			}
			const source = config !== null && typeof config === "object" && typeof config.contactSource === "string" ? config.contactSource : "";
			const ratio = Number.isFinite(window.devicePixelRatio) ? window.devicePixelRatio : 1;
			const width = Math.round(window.screen.width * ratio);
			const height = Math.round(window.screen.height * ratio);
			const deviceInfo = [navigator.userAgent];
			if (width > 0 && height > 0) deviceInfo.push(`screen_resolution=${width}x${height}`);
			const fields = { source, device_info: deviceInfo.filter(Boolean).join("; ") };
			for (const [name, value] of Object.entries(fields)) {
				url.searchParams.set(`hide_${name}`, "1");
				if (value) url.searchParams.set(`prefill_${name}`, value);
			}
			window.open(url.href, "_blank", "noopener,noreferrer");
		}

		/** Account metadata the Host's `startSignIn` requires. */
		function accountMetadata() {
			const version =
				typeof globalThis.__DSH_CLIENT_VERSION__ === "string" && globalThis.__DSH_CLIENT_VERSION__ !== "" ? globalThis.__DSH_CLIENT_VERSION__ : PLUGIN_ID;
			let locale = "en";
			try {
				locale = String(document.documentElement.lang || navigator.language || "en");
			} catch {}
			return { version, locale, timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60 };
		}

		/**
		 * Start browser sign-in through the Host account service.
		 *
		 * The RPC response carries the attempt while it is still `initializing`, and
		 * the authorize URL only appears once the Host has moved the attempt to
		 * `waiting-browser`, so the URL is read from the account stream the shell
		 * itself follows rather than from that first response. The tab is preopened
		 * during the click (a popup opened later is blocked), then pointed at the URL
		 * the moment it shows up.
		 */
		async function beginSignIn() {
			const remote = services.remote;
			if (remote === null || remote.account === undefined || typeof remote.account.startSignIn !== "function") {
				console.error("[dsh-panel-layout] the account service is unavailable in this profile");
				return;
			}
			let popup = null;
			try {
				popup = window.open("about:blank", "_blank");
				if (popup !== null) popup.opener = null;
			} catch {}
			let stream = null;
			try {
				const result = await remote.account.startSignIn(accountMetadata(), window.location.origin, "web");
				if (result === null || typeof result !== "object" || result.ok !== true) throw new Error("the host refused the sign-in request");
				if (navigateToAuthorize(popup, result.value)) return;
				if (typeof remote.$stream !== "function") throw new Error("the account stream is unavailable in this profile");
				stream = remote.$stream({
					name: "account",
					open: (signal) => remote.account.watch(signal),
					ended: () => new Error("the account stream ended"),
				});
				for await (const frame of stream) {
					frame.accept();
					if (navigateToAuthorize(popup, frame.value)) return;
				}
			} catch (error) {
				console.error("[dsh-panel-layout] sign-in failed:", error);
				try {
					popup?.close();
				} catch {}
			} finally {
				if (stream !== null) void stream.dispose().catch(() => {});
			}
		}

		/**
		 * Point the preopened tab at one attempt's authorize URL.
		 * @param popup - the tab opened for this sign-in, when the browser allowed it.
		 * @param view - one account projection from the Host.
		 * @returns whether this view ended the wait (navigated, or the attempt is over).
		 */
		function navigateToAuthorize(popup, view) {
			const attempt = view === null || typeof view !== "object" ? undefined : view.attempt;
			if (attempt === undefined || attempt === null) return false;
			if (["failed", "expired", "cancelled", "succeeded"].includes(attempt.phase)) {
				try {
					if (!popup?.closed) popup?.close();
				} catch {}
				return true;
			}
			const authorizeUrl = attempt.authorizeUrl;
			if (typeof authorizeUrl !== "string" || authorizeUrl === "") return false;
			let href = authorizeUrl;
			try {
				const themed = new URL(authorizeUrl);
				const scheme = services.theme === null ? undefined : services.theme.getTheme?.()?.active?.colorScheme;
				if (typeof scheme === "string") themed.searchParams.set("theme", scheme);
				href = themed.href;
			} catch {}
			if (popup !== null && !popup.closed) popup.location.replace(href);
			else window.open(href, "_blank", "noopener,noreferrer");
			return true;
		}

		/** Run one absorbed utility. */
		function runUtility(id) {
			if (id === "settings") openSettings();
			else if (id === "contact") openFeedback();
			else if (id === "signin") void beginSignIn();
		}

		/** Whether the account launcher currently reports a signed-out state. */
		function signedOutNow() {
			const launcher = document.querySelector(LAUNCHER_SLOT);
			if (launcher === null) return true;
			const button = launcher.querySelector("button[data-signed-out]");
			return button === null || button.getAttribute("data-signed-out") === "true";
		}

		/** Utilities that apply to the current account state. */
		function activeUtilities() {
			return signedOutNow() ? [...UTILITIES] : UTILITIES.filter((id) => id !== "signin");
		}
		//#endregion

		//#region glyphs
		/*
		 * No icon is ever drawn here, and no row is left without one.
		 *
		 * A panel row keeps the glyph its own plugin registered — the navbar and
		 * the More menu both show that same markup, so the icon travels with the
		 * plugin and stays whatever the plugin ships. The three absorbed actions
		 * keep the glyphs the shell uses for them in its own account menu, taken
		 * from the shell's icon sprite rather than redrawn: the sprite is a page
		 * asset, so a `<use>` reference resolves anywhere, including the portalled
		 * menu, and follows the host's icon set across releases.
		 */
		const UTILITY_SYMBOLS = {
			settings: "dsw-icon-settings-outline-medium",
			contact: "dsw-icon-paper-plane-outline-medium",
			signin: "dsw-icon-user-outline-medium",
		};

		/** The sprite symbol the shell's own account menu uses for one utility. */
		function utilitySymbol(id) {
			return UTILITY_SYMBOLS[id] ?? UTILITY_SYMBOLS.settings;
		}

		/** A `<svg><use>` reference into the shell's icon sprite, as a React node. */
		function spriteIcon(symbol, size) {
			return react.createElement(
				"svg",
				{ width: size, height: size, "data-icon": symbol, "aria-hidden": "true", focusable: "false" },
				react.createElement("use", { href: "#" + symbol }),
			);
		}

		/** The same reference as a plain DOM node, for the nav the shell owns. */
		function spriteNode(symbol, size) {
			const ns = "http://www.w3.org/2000/svg";
			const svg = document.createElementNS(ns, "svg");
			svg.setAttribute("width", String(size));
			svg.setAttribute("height", String(size));
			svg.setAttribute("data-icon", symbol);
			svg.setAttribute("aria-hidden", "true");
			svg.setAttribute("focusable", "false");
			const use = document.createElementNS(ns, "use");
			use.setAttribute("href", "#" + symbol);
			svg.appendChild(use);
			return svg;
		}

		/** The markup one utility row shows in the nav. */
		function utilityIcon(id, size) {
			return spriteIcon(utilitySymbol(id), size);
		}
		//#endregion

		//#region DOM reconciliation
		/** The located panel-list container, while it is still in the document. */
		let taggedNav = null;
		/** Coalesced reconcile request. */
		let scheduled = false;
		let resizeObserver = null;
		let draggingId = null;

		function schedule() {
			if (scheduled) return;
			scheduled = true;
			const run = () => {
				scheduled = false;
				try {
					sync();
				} catch (error) {
					console.error("[dsh-panel-layout] panel menu sync failed:", error);
				}
			};
			if (typeof window.requestAnimationFrame === "function") window.requestAnimationFrame(run);
			else window.setTimeout(run, 0);
		}

		function requestSync() {
			schedule();
		}

		/** Locate the panel-list container through the renderer's slot anchor. */
		function locateNav() {
			const anchor = document.querySelector(PANEL_SLOT);
			return anchor === null ? null : anchor.closest("nav");
		}

		/** The row button a nav child carries, if any. */
		function buttonOf(child) {
			if (child.tagName === "BUTTON") return child;
			return child.querySelector("button");
		}

		/** The name the shell resolved for one row. */
		function rowLabel(button) {
			const label = button.getAttribute("aria-label");
			return label === null ? "" : label.trim();
		}

		/**
		 * Tag a row's label cell so the row layout can hide it, and report whether
		 * the shell is rendering the labelled (expanded) phase at all.
		 */
		function tagLabel(button) {
			const anchor = button.querySelector(PANEL_SLOT);
			let glyphCell = anchor === null ? null : anchor.closest("span");
			if (glyphCell === null) {
				for (const cell of Array.from(button.children)) {
					if (cell.tagName === "SPAN") {
						glyphCell = cell;
						break;
					}
				}
			}
			let labelled = false;
			for (const cell of Array.from(button.children)) {
				if (cell.tagName !== "SPAN" || cell === glyphCell) continue;
				labelled = true;
				if (cell.textContent.trim() === "") cell.removeAttribute(LABEL_ATTR);
				else cell.setAttribute(LABEL_ATTR, "");
			}
			return labelled;
		}

		/**
		 * The glyph markup a panel row renders, copied from the row itself.
		 *
		 * A row pushed into More keeps its own plugin's icon this way: the glyph is
		 * whatever that plugin registered (its own SVG, sprite reference or
		 * component output), and the row is still mounted while only CSS hides it,
		 * so the markup is current at every reconcile.
		 * @param host - the row host that owns the glyph anchor.
		 * @returns the glyph's inner markup, or "" when the panel renders none.
		 */
		function rowGlyph(host) {
			const anchor = host.querySelector(PANEL_SLOT);
			const markup = anchor === null ? "" : anchor.innerHTML.trim();
			if (markup !== "") return markup;
			/* A transient re-render can leave the anchor empty for one pass; the
			   row keeps the glyph it was last seen with rather than blinking to a
			   blank placeholder. */
			const id = host.dataset.dplId;
			return id === undefined ? "" : glyphCache.get(id) ?? "";
		}

		/** Last glyph markup seen for each panel id, so a re-render never blanks one. */
		const glyphCache = new Map();

		/** Build or refresh one absorbed utility button. */
		function utilityButton(nav, id, label) {
			let button = nav.querySelector('button[' + UTIL_ATTR + '="' + id + '"]');
			if (button === null) {
				button = document.createElement("button");
				button.type = "button";
				button.setAttribute(UTIL_ATTR, id);
				const glyphCell = document.createElement("span");
				glyphCell.setAttribute("data-dpl-util-glyph", "");
				glyphCell.setAttribute("aria-hidden", "true");
				glyphCell.appendChild(spriteNode(utilitySymbol(id), 16));
				const labelCell = document.createElement("span");
				labelCell.setAttribute(LABEL_ATTR, "");
				button.append(glyphCell, labelCell);
				button.addEventListener("click", () => {
					runUtility(id);
				});
			}
			button.setAttribute("aria-label", label);
			button.setAttribute("title", label);
			const labelCell = button.querySelector("span[" + LABEL_ATTR + "]");
			if (labelCell !== null) labelCell.textContent = label;
			return button;
		}

		/** Drop utility buttons that no longer apply (Sign in after signing in). */
		function pruneUtilities(nav, keep) {
			for (const child of Array.from(nav.children)) {
				const id = child.getAttribute(UTIL_ATTR);
				if (id === null || keep.includes(id)) continue;
				child.remove();
			}
		}

		/** Localized name of one absorbed utility. */
		function utilityLabel(id) {
			const language = String(document.documentElement.lang || "en").toLowerCase();
			const dictionary = language.startsWith("zh") ? zh : en;
			if (id === "settings") return dictionary.utilitySettings;
			if (id === "contact") return dictionary.utilityContact;
			return dictionary.utilitySignIn;
		}

		/**
		 * One reconcile pass: identify rows, place the absorbed utilities, apply the
		 * cap and the order, and republish what the More menu must list instead.
		 */
		function sync() {
			if (typeof document === "undefined") return;
			let nav = taggedNav;
			if (nav !== null && !nav.isConnected) {
				taggedNav = null;
				nav = null;
			}
			if (nav === null) {
				nav = locateNav();
				if (nav === null) {
					document.documentElement.removeAttribute(WIDE_ATTR);
					return;
				}
				taggedNav = nav;
				nav.setAttribute(NAV_ATTR, "");
				observeResize(nav);
			}

			const prefs = preferences();
			const entries = panelEntries();
			const entryById = new Map(entries.map((entry) => [entry.id, entry]));
			const idByLabel = new Map();
			for (const entry of entries) if (!idByLabel.has(entry.label)) idByLabel.set(entry.label, entry.id);

			/* First pass: name every panel row and note whether labels render at
			   all. The rail keeps its shipped geometry untouched. */
			let wide = false;
			let moreHost = null;
			const used = new Set();
			const panelHosts = [];
			for (const child of Array.from(nav.children)) {
				if (child.hasAttribute(UTIL_ATTR)) continue;
				const button = buttonOf(child);
				if (button === null) continue;
				if (button.getAttribute("aria-haspopup") === "menu") {
					moreHost = child;
					child.setAttribute(MORE_ATTR, "");
					/* The launcher is a row too, with a label of its own; tagging
					   it keeps its name cell out of the 36px cell in row mode, and
					   the native tooltip carries the name the cell gave up. */
					if (tagLabel(button)) wide = true;
					const moreLabel = rowLabel(button);
					if (moreLabel !== "") button.setAttribute("title", moreLabel);
					continue;
				}
				child.setAttribute(PANEL_ATTR, "");
				if (tagLabel(button)) wide = true;
				const label = rowLabel(button);
				let id = idByLabel.get(label);
				if (id === undefined || used.has(id)) id = entries.map((entry) => entry.id).find((candidate) => !used.has(candidate));
				if (id === undefined) continue;
				used.add(id);
				child.dataset.dplId = id;
				panelHosts.push({ host: child, id });
				if (label !== "") button.setAttribute("title", label);
			}

			if (!wide) {
				document.documentElement.removeAttribute(WIDE_ATTR);
				for (const child of Array.from(nav.children)) {
					child.style.order = "";
					child.removeAttribute(HIDDEN_ATTR);
					child.removeAttribute(PANEL_ATTR);
					child.removeAttribute(MORE_ATTR);
					const button = buttonOf(child);
					if (button !== null) button.draggable = false;
				}
				pruneUtilities(nav, []);
				setHiddenEntries([]);
				return;
			}
			document.documentElement.setAttribute(WIDE_ATTR, "");
			nav.setAttribute("data-dpl-mode-core", prefs.mode === MODE_LIST ? "list" : "row");

			const utilities = activeUtilities();
			const panelIds = panelHosts.map((row) => row.id);
			const liveIds = mergeOrder([...panelIds, ...utilities.filter((id) => !panelIds.includes(id))]);
			const position = new Map(liveIds.map((id, index) => [id, index]));

			/* Cap: row mode packs 36px cells into whole rows and keeps one cell for
			   the More launcher once anything overflows; list mode keeps four. The
			   shell renders More because this plugin registers a row there.
			   A host without that launcher has nowhere to put the overflow, so
			   nothing may be hidden — truncating would strand entries beyond
			   reach. That host is below the declared floor; this keeps a forced
			   install degraded rather than broken. */
			const hasMore = moreHost !== null;
			const width = nav.clientWidth;
			const perRow = width > 0 ? Math.max(1, Math.floor((width + GAP) / (CELL + GAP))) : 0;
			/* Row mode packs whole rows of cells; when the entries do not fit, the
			   last cell of the last row becomes the More launcher, so the budget
			   loses one. List mode keeps the first four and lets More be the fifth
			   row. */
			const total = liveIds.length;
			let visibleCount;
			if (!hasMore) visibleCount = total;
			else if (prefs.mode === MODE_LIST) visibleCount = Math.min(total, LIST_BUDGET);
			else {
				const capacity = perRow * prefs.rows;
				visibleCount = total > capacity ? Math.max(0, capacity - 1) : total;
			}
			const visible = new Set(liveIds.slice(0, visibleCount));

			/* Utilities that fit are inserted in their stored position; the rest are
			   listed in More and never rendered in the nav. */
			const shownUtilities = utilities.filter((id) => visible.has(id));
			pruneUtilities(nav, shownUtilities);
			for (const id of shownUtilities) {
				const button = utilityButton(nav, id, utilityLabel(id));
				if (button.parentElement !== nav) nav.appendChild(button);
				button.dataset.dplId = id;
				button.draggable = true;
				button.style.order = String(position.get(id) ?? Number.MAX_SAFE_INTEGER);
				button.removeAttribute(HIDDEN_ATTR);
				wireDrag(button, id);
			}

			for (const row of panelHosts) {
				row.host.style.order = String(position.get(row.id) ?? Number.MAX_SAFE_INTEGER);
				const button = buttonOf(row.host);
				if (button !== null) button.draggable = true;
				wireDrag(row.host, row.id);
				if (visible.has(row.id)) row.host.removeAttribute(HIDDEN_ATTR);
				else row.host.setAttribute(HIDDEN_ATTR, "");
			}
			if (moreHost !== null) {
				moreHost.setAttribute(MORE_ATTR, "");
				moreHost.removeAttribute(HIDDEN_ATTR);
				moreHost.style.order = String(liveIds.length + 1);
			}

			/* More lists everything the nav gave up, in the same stored order. */
			const hidden = [];
			for (const id of liveIds) {
				if (visible.has(id)) continue;
				if (UTILITIES.includes(id)) hidden.push({ id, label: utilityLabel(id), kind: "utility", glyph: "" });
				else {
					const entry = entryById.get(id);
					if (entry === undefined) continue;
					const row = panelHosts.find((candidate) => candidate.id === id);
					const glyph = row === undefined ? "" : rowGlyph(row.host);
					if (glyph !== "") glyphCache.set(id, glyph);
					hidden.push({ id, label: entry.label, kind: "panel", glyph });
				}
			}
			setHiddenEntries(hidden);
		}

		function observeResize(nav) {
			if (resizeObserver !== null) resizeObserver.disconnect();
			if (typeof ResizeObserver !== "function") return;
			resizeObserver = new ResizeObserver(() => schedule());
			try {
				resizeObserver.observe(nav);
			} catch {}
		}

		/** Wire HTML5 drag-and-drop for one row host. */
		function wireDrag(host, id) {
			if (host.dataset.dplDrag === "1") return;
			host.dataset.dplDrag = "1";
			host.addEventListener("dragstart", (event) => {
				draggingId = host.dataset.dplId ?? id;
				host.setAttribute("data-dpl-dragging", "");
				try {
					event.dataTransfer.effectAllowed = "move";
					event.dataTransfer.setData("text/plain", draggingId ?? "");
				} catch {}
			});
			host.addEventListener("dragend", () => {
				host.removeAttribute("data-dpl-dragging");
				draggingId = null;
				clearDropMarks();
			});
			host.addEventListener("dragover", (event) => {
				const target = host.dataset.dplId ?? null;
				if (draggingId === null || draggingId === target) return;
				event.preventDefault();
				try {
					event.dataTransfer.dropEffect = "move";
				} catch {}
				clearDropMarks(host);
				host.setAttribute("data-dpl-drop", dropSide(host, event) ? "after" : "before");
			});
			host.addEventListener("dragleave", () => {
				host.removeAttribute("data-dpl-drop");
			});
			host.addEventListener("drop", (event) => {
				event.preventDefault();
				const from = draggingId;
				const to = host.dataset.dplId ?? null;
				const after = dropSide(host, event);
				clearDropMarks();
				if (from === null || to === null || from === to) return;
				reorder(from, to, after);
			});
		}

		/** Start dragging one row inside the More menu. */
		function beginMenuDrag(event, id) {
			draggingId = typeof id === "string" ? id : null;
			const host = event.currentTarget;
			if (host !== null && host !== undefined) host.setAttribute("data-dpl-dragging", "");
			try {
				event.dataTransfer.effectAllowed = "move";
				event.dataTransfer.setData("text/plain", id);
			} catch {}
		}

		/** End a drag that started in the More menu. */
		function endMenuDrag(event) {
			const host = event === null || event === undefined ? null : event.currentTarget;
			if (host !== null && host !== undefined) host.removeAttribute("data-dpl-dragging");
			draggingId = null;
			clearDropMarks();
		}

		/** Which edge of the hovered menu row the pointer is on. */
		function menuDropSide(host, event) {
			const rect = host.getBoundingClientRect();
			return event.clientY >= rect.top + rect.height / 2;
		}

		/** Mark the menu row the pointer is over: above it or below it. */
		function menuDragOver(event, id) {
			if (draggingId === null || draggingId === id) return;
			event.preventDefault();
			try {
				event.dataTransfer.dropEffect = "move";
			} catch {}
			const host = event.currentTarget;
			clearDropMarks(host);
			host.setAttribute(MENU_DROP_ATTR, menuDropSide(host, event) ? "after" : "before");
		}

		/** Sort the dragged entry next to the menu row it was dropped on. */
		function menuDrop(event, id) {
			event.preventDefault();
			const from = draggingId;
			const after = menuDropSide(event.currentTarget, event);
			clearDropMarks();
			if (from === null || from === id) return;
			reorder(from, id, after);
		}

		/** Which side of the hovered row the pointer is on. */
		function dropSide(host, event) {
			const rect = host.getBoundingClientRect();
			const rowMode = (taggedNav?.getAttribute("data-dpl-mode-core") ?? "list") === "row";
			if (rowMode) return event.clientX >= rect.left + rect.width / 2;
			return event.clientY >= rect.top + rect.height / 2;
		}

		/** Clear every insertion marker, on a nav row or on a menu row. */
		function clearDropMarks(keep) {
			if (typeof document === "undefined") return;
			for (const node of document.querySelectorAll(`[data-dpl-drop], [${MENU_DROP_ATTR}]`)) {
				if (node === keep) continue;
				node.removeAttribute("data-dpl-drop");
				node.removeAttribute(MENU_DROP_ATTR);
			}
		}

		/**
		 * Move one id next to another in the stored order.
		 * @param from - dragged id.
		 * @param to - hovered id.
		 * @param after - insert after the hovered row rather than before it.
		 */
		function reorder(from, to, after) {
			const ids = mergeOrder(allLiveIds());
			const fromIndex = ids.indexOf(from);
			if (fromIndex === -1 || ids.indexOf(to) === -1) return;
			ids.splice(fromIndex, 1);
			const anchor = ids.indexOf(to);
			const insertAt = anchor === -1 ? ids.length : anchor + (after ? 1 : 0);
			ids.splice(insertAt, 0, from);
			setOrder(ids);
		}

		/**
		 * Move one id to the head of the stored order.
		 *
		 * The cap always keeps the head of the order on screen, so this is the
		 * pointer-free way to pull an entry out of More: one tap, no drag.
		 * @param id - the entry to bring forward.
		 */
		function moveToFront(id) {
			const ids = mergeOrder(allLiveIds());
			if (!ids.includes(id)) return;
			setOrder([id, ...ids.filter((candidate) => candidate !== id)]);
		}

		/** Every id the menu currently knows about: panels first, then utilities. */
		function allLiveIds() {
			const ids = panelEntries().map((entry) => entry.id);
			for (const id of activeUtilities()) if (!ids.includes(id)) ids.push(id);
			return ids;
		}
		//#endregion

		//#region settings row
		/** Simplified Chinese dictionary (the key-set source of truth). */
		const zh = {
			"meta.title": "侧边栏面板菜单",
			"meta.description": "面板菜单的按钮行/列表布局、行数上限与拖动排序，溢出项与设置/反馈/登录一起收进「更多」。",
			title: "侧边栏面板菜单",
			description: "面板菜单的排布方式；拖动任意一项即可调整顺序。",
			layout: "菜单布局",
			row: "按钮行",
			list: "列表",
			rows: "按钮行最多",
			rowUnit: "行",
			reset: "恢复默认顺序",
			moveToFront: "移到最前",
			utilitySettings: "设置",
			utilityContact: "意见反馈",
			utilitySignIn: "登录",
		};
		/** English dictionary, checked complete against the zh key set. */
		const en = {
			"meta.title": "Sidebar panel menu",
			"meta.description": "Button-row or list layout, row cap and drag ordering for the sidebar panel menu, with overflow and Settings / Feedback / Sign in folded into More.",
			title: "Sidebar panel menu",
			description: "How the panel menu is arranged; drag any entry to change the order.",
			layout: "Menu layout",
			row: "Button row",
			list: "List",
			rows: "Row cap",
			rowUnit: "row(s)",
			reset: "Reset order",
			moveToFront: "Move to front",
			utilitySettings: "Settings",
			utilityContact: "Feedback",
			utilitySignIn: "Sign in",
		};

		/** Fallback translator for compositions without a locale seat. */
		function fallbackLabel(key) {
			const language = String(document.documentElement.lang || "en").toLowerCase();
			const dictionary = language.startsWith("zh") ? zh : en;
			return dictionary[key] ?? key;
		}

		/** Subscribe one React component to a plain snapshot getter. */
		function useStoreSnapshot(subscribe, read) {
			return react.useSyncExternalStore(subscribe, read, read);
		}

		/** The General settings row that owns the layout and the row cap. */
		function PanelLayoutRow(props) {
			const t = typeof props.t === "function" ? props.t : fallbackLabel;
			const prefs = useStoreSnapshot(subscribePrefs, preferences);
			const caps = [];
			for (let value = 1; value <= MAX_ROWS; value += 1) caps.push(value);
			return react.createElement(
				"div",
				{ className: "dpl-row" },
				react.createElement(
					"div",
					{ className: "dpl-rowText" },
					react.createElement("div", { className: "dpl-rowTitle" }, t("title")),
					react.createElement("div", { className: "dpl-rowHint" }, t("description")),
				),
				react.createElement(
					"div",
					{ className: "dpl-controls" },
					react.createElement(
						"div",
						{ className: "dpl-segmented", role: "group", "aria-label": t("layout") },
						[MODE_ROW, MODE_LIST].map((value) =>
							react.createElement(
								"button",
								{
									key: value,
									type: "button",
									className: "dpl-segment",
									"aria-pressed": prefs.mode === value ? "true" : "false",
									onClick: () => {
										setPreferences({ mode: value }, true);
									},
								},
								t(value),
							),
						),
					),
					prefs.mode === MODE_ROW
						? react.createElement(
								"div",
								{ className: "dpl-rowCap" },
								react.createElement("span", null, t("rows")),
								react.createElement(
									"div",
									{ className: "dpl-stepper", role: "group", "aria-label": t("rows") },
									caps.map((value) =>
										react.createElement(
											"button",
											{
												key: value,
												type: "button",
												"aria-pressed": prefs.rows === value ? "true" : "false",
												onClick: () => {
													setPreferences({ rows: value }, true);
												},
											},
											String(value),
										),
									),
								),
								react.createElement("span", null, t("rowUnit")),
							)
						: null,
					react.createElement(
						"button",
						{
							type: "button",
							className: "dpl-reset",
							onClick: () => {
								resetOrder();
							},
						},
						t("reset"),
					),
				),
			);
		}
		//#endregion

		//#region More-menu rows
		/**
		 * One menu row, matching the shell's own rows.
		 *
		 * A row is draggable and a drop target at the same time: the menu floats
		 * above the panel list, so dragging one of its entries onto a row up
		 * there reorders it like any other entry — which is how an entry that the
		 * cap pushed out gets pulled back into view — and dropping it onto
		 * another row of the menu sorts the entries the cap kept below the fold.
		 * The marker inside the menu always sits between two rows: the menu is
		 * one column regardless of how the nav above it is laid out.
		 * @param props - the entry id, the icon node, the label, and the select handler.
		 */
		function MenuRow({ id, icon, label, hint, onSelect, onFront }) {
			return react.createElement(
				"button",
				{
					type: "button",
					role: "menuitem",
					className: "dpl-menuItem",
					"data-dpl-menu-id": id,
					draggable: true,
					onClick: onSelect,
					onDragStart: (event) => beginMenuDrag(event, id),
					onDragEnd: endMenuDrag,
					onDragOver: (event) => menuDragOver(event, id),
					onDragLeave: (event) => event.currentTarget.removeAttribute(MENU_DROP_ATTR),
					onDrop: (event) => menuDrop(event, id),
				},
				react.createElement("span", { className: "dpl-menuIcon", "aria-hidden": "true" }, icon),
				react.createElement("span", { className: "dpl-menuLabel" }, label),
				/* Dragging works with a pointer; a touch screen fires no drag
				   events, so the same reorder gets a button too — one tap puts the
				   entry at the front, which is where the cap always shows it. */
				react.createElement(
					"span",
					{
						className: "dpl-menuFront",
						role: "button",
						tabIndex: 0,
						title: hint,
						"aria-label": hint,
						"data-dpl-menu-front": id,
						onClick: (event) => {
							event.stopPropagation();
							onFront();
						},
						onKeyDown: (event) => {
							if (event.key !== "Enter" && event.key !== " ") return;
							event.preventDefault();
							event.stopPropagation();
							onFront();
						},
					},
					react.createElement("svg", { width: 14, height: 14, "data-icon": "dsw-icon-chevron-up-outline-regular", "aria-hidden": "true", focusable: "false" },
						react.createElement("use", { href: "#dsw-icon-chevron-up-outline-regular" })),
				),
			);
		}

		/**
		 * A panel's own glyph as a node for the menu.
		 *
		 * The glyph is copied from the row that plugin mounted, as a node — it is
		 * cloned out of the live DOM rather than rebuilt from a string, so the menu
		 * shows exactly the icon the plugin ships and nothing this plugin authored.
		 * The row stays mounted (only CSS hides it), so the clone is current at
		 * every render; a row that rendered no glyph still gets its cell, so every
		 * label starts at the same offset.
		 * @param props - the panel id and the glyph markup captured with it.
		 */
		function PanelGlyph({ id, markup }) {
			if (markup === "") return react.createElement("span", { className: "dpl-menuGlyphBlank" });
			const attach = (cell) => {
				if (cell === null) return;
				const host = taggedNav === null ? null : Array.from(taggedNav.children).find((row) => row.dataset.dplId === id);
				const anchor = host === null || host === undefined ? null : host.querySelector(PANEL_SLOT);
				if (anchor === null) return;
				cell.replaceChildren(...Array.from(anchor.childNodes, (node) => node.cloneNode(true)));
			};
			return react.createElement("span", { className: "dpl-menuGlyph", ref: attach });
		}

		/**
		 * Rows contributed to the shell's More menu: the entries the current cap or
		 * account state kept out of the nav, so nothing is duplicated and nothing
		 * becomes unreachable.
		 */
		function PanelMoreEntries(props) {
			const hidden = useStoreSnapshot(subscribeVisibility, () => hiddenEntries);
			const t = typeof props.t === "function" ? props.t : fallbackLabel;
			const onDismiss = typeof props.onDismiss === "function" ? props.onDismiss : () => {};
			if (hidden.length === 0) return null;
			const rows = hidden.map((entry) => {
				if (entry.kind === "utility") {
					return react.createElement(MenuRow, {
						key: entry.id,
						id: entry.id,
						icon: utilityIcon(entry.id, 16),
						label: entry.label,
						hint: t("moveToFront"),
						onSelect: () => {
							onDismiss();
							runUtility(entry.id);
						},
						onFront: () => {
							onDismiss();
							moveToFront(entry.id);
						},
					});
				}
				return react.createElement(MenuRow, {
					key: entry.id,
					id: entry.id,
					icon: react.createElement(PanelGlyph, { id: entry.id, markup: entry.glyph ?? "" }),
					label: entry.label,
					hint: t("moveToFront"),
					onSelect: () => {
						onDismiss();
						openPanel(entry.id);
					},
					onFront: () => {
						onDismiss();
						moveToFront(entry.id);
					},
				});
			});
			return react.createElement(
				react.Fragment,
				null,
				react.createElement("div", { className: "dpl-menuSeparator", role: "separator" }),
				rows,
			);
		}
		//#endregion

		//#region plugin
		/**
		 * Install the layout: stylesheet, mode gate, DOM reconciliation, the
		 * Settings row and the More-menu rows.
		 * @param ctx - client root context.
		 */
		function apply(ctx) {
			if (typeof document === "undefined") return;
			slotsService = ctx.get("slots") ?? null;
			ctx.effect(() => injectCss(), "panel-layout: stylesheet");
			ctx.effect(() => {
				document.documentElement.setAttribute(MODE_ATTR, preferences().mode);
				const observer = new MutationObserver(() => schedule());
				observer.observe(document.documentElement, {
					childList: true,
					subtree: true,
					attributes: true,
					attributeFilter: ["aria-label", "data-signed-out", "lang"],
				});
				const onStorage = (event) => {
					if (event.key !== null && event.key !== SETTINGS_KEY && event.key !== ORDER_KEY) return;
					persisted = readStoredPreferences();
					order = readStoredOrder();
					schedule();
					notifyPrefs();
				};
				window.addEventListener("storage", onStorage);
				schedule();
				return () => {
					observer.disconnect();
					window.removeEventListener("storage", onStorage);
					resizeObserver?.disconnect();
					resizeObserver = null;
					if (taggedNav !== null) {
						for (const child of Array.from(taggedNav.children)) {
							child.style.order = "";
							child.removeAttribute(HIDDEN_ATTR);
							child.removeAttribute(MORE_ATTR);
							child.removeAttribute(PANEL_ATTR);
							delete child.dataset.dplId;
						}
						taggedNav.removeAttribute(NAV_ATTR);
						taggedNav.removeAttribute("data-dpl-mode-core");
						taggedNav = null;
					}
					document.documentElement.removeAttribute(WIDE_ATTR);
				};
			}, "panel-layout: panel list");
			ctx.effect(() => {
				const paint = () => document.documentElement.setAttribute(MODE_ATTR, preferences().mode);
				paint();
				return subscribePrefs(paint);
			}, "panel-layout: mode gate");
			ctx.inject(["locale"], (scope) => {
				scope.effect(() => scope.locale.register(NS, { zh, en }), "panel-layout: dictionaries");
			});
			ctx.inject(["slots"], (scope) => {
				slotsService = scope.slots;
				scope.effect(() => scope.slots.subscribe("sidebar.panellist", () => schedule()), "panel-layout: panel registrations");
				try {
					/* Inside the slot's own inject so the rows return with its declarer
					   (the sidebar shell) instead of failing while it is still mounting. */
					scope.slots.inject("sidebar.panellist.actions", () =>
						scope.slots.register({ name: "sidebar.panellist.actions", id: PLUGIN_ID, order: 40, locale: NS }, PanelMoreEntries),
					);
				} catch (error) {
					console.error("[dsh-panel-layout] could not register the More-menu rows:", error);
				}
				try {
					scope.slots.inject("settings.general.item", () =>
						scope.slots.register({ name: "settings.general.item", id: PLUGIN_ID, order: 12, locale: NS }, PanelLayoutRow),
					);
				} catch (error) {
					console.error("[dsh-panel-layout] could not register the settings row:", error);
				}
			});
			ctx.inject(["shortcuts"], (scope) => {
				services.shortcuts = scope.shortcuts;
			});
			ctx.inject(["remote", "remote.account"], (scope) => {
				/* `remote.account` is a namespace below `remote`; the stream factory
				   lives on `remote` itself. */
				const root = scope.remote;
				services.remote = {
					account: scope["remote.account"],
					$stream: typeof root.$stream === "function" ? root.$stream.bind(root) : undefined,
				};
			});
			ctx.inject(["theme"], (scope) => {
				services.theme = scope.theme;
			});
			ctx.inject(["layout"], (scope) => {
				services.layout = scope.layout;
			});
		}
		//#endregion

		exports.apply = apply;
		exports.inject = [];
		exports.__internals = {
			normalizePreferences,
			mergeOrder,
			activeUtilities,
			utilityLabel,
			utilitySymbol,
			rowGlyph,
			setPreferences,
			preferences,
			setOrder,
			resetOrder,
			moveToFront,
			allLiveIds,
			readStoredOrder,
			sync,
			reorder,
			/** Point the DOM path at a slots service without booting the client. */
			__setSlots(service) {
				slotsService = service;
			},
			/** Forget the located nav, so a test can rebuild the markup. */
			__forgetNav() {
				taggedNav = null;
			},
			/** Entries the last reconcile pushed out of the nav. */
			hiddenEntries() {
				return hiddenEntries;
			},
			constants: { SETTINGS_KEY, ORDER_KEY, MODE_ROW, MODE_LIST, LIST_BUDGET, MAX_ROWS, UTILITIES },
			styles: () => CSS,
			/** The shell's own open-settings action, when its launcher carries one. */
			openSettingsDirectly,
		};
		return module.exports;
	},
});
