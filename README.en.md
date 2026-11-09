# dsh-panel-layout

[中文](README.md) | English

https://github.com/user-attachments/assets/9111c670-63ae-499f-ab50-a6fcf16fad87

| View | Light | Dark |
|---|---|---|
| Button row · 1 row | ![One button row (light)](https://github.com/user-attachments/assets/2868e611-14ed-4aa7-9e16-e0c783639fa5) | ![One button row (dark)](https://github.com/user-attachments/assets/9b7c6b2e-10f2-43cc-8a1d-21d96dab6653) |
| Button row · 2 rows | ![Two button rows (light)](https://github.com/user-attachments/assets/01c45f3d-7cc0-4ef2-ae1a-bac50c644027) | ![Two button rows (dark)](https://github.com/user-attachments/assets/56b6452c-c0d3-4e09-8979-b965003c9cfe) |
| List | ![List mode (light)](https://github.com/user-attachments/assets/82e14045-e8d3-49fe-a237-1318a238e5e1) | ![List mode (dark)](https://github.com/user-attachments/assets/f1d5eb52-d1c2-4dcf-9c48-707ce95bfcb5) |
| Settings row | ![Settings → General (light)](https://github.com/user-attachments/assets/980a08e6-227e-4df4-9b38-cff6f86fe349) | ![Settings → General (dark)](https://github.com/user-attachments/assets/19f613b3-fe3a-436f-9635-6589eb4e4a93) |

Layout, ordering and folding for the sidebar panel menu. Arrange the row of
Plugins / Plugin Market / Context / Task board / MCP entries as a button row or
a list, cap how many rows the button row may use, drag to reorder — and fold
whatever does not fit into More, together with Settings, Feedback and Sign in
from the bottom-left corner.

The global panel menu at the top of the DSH Web sidebar (`sidebar.panellist`) is
rendered by the shell: one row per entry with an icon and a label, then a More
launcher. The bottom-left account launcher *is* a More row while signed out,
and it holds Settings / Feedback / Sign in. This plugin merges both into one
configurable menu.

## What it does

| Capability | Behaviour |
|---|---|
| Layout switch | Settings → General → "Sidebar panel menu" toggles **Button row** and **List**; the button row is the default |
| Row cap | 1–3 rows, 1 by default; cells per row are measured from the real sidebar width (36px cell + 4px gap) |
| Drag to reorder | Drag any entry onto another one; row mode reads the left/right half for the insertion point, list mode the top/bottom half |
| Sort inside More | The rows More lists sort against each other: drop on a row's top half to insert above it, its bottom half to insert below — always along the menu's own vertical axis, whichever layout the panel bar uses. The shell's own "browse more plugins" and "create your plugin" rows take no part |
| Pull out of More | Entries inside More drag back up into the panel bar too — drop one on the front half of a row and it takes that slot, back in view |
| Move to front (touch) | Every More row carries an up-arrow button; one tap sends the entry to the head of the order, where the cap always shows it. A touch screen fires no HTML5 drag events, so this is the way there |
| Overflow | Entries past the cap are hidden and listed in the shell's own More menu, in the same order |
| List budget | List mode keeps the first four entries on screen; the fifth onwards go to More |
| Absorbing the bottom-left More | Settings / Feedback / Sign in become ordinary panel-menu entries that keep their original icons and reorder like anything else; the bottom-left More is hidden while signed out |
| Sign-in awareness | Once signed in the Sign in entry is dropped, and the bottom-left corner returns to the account avatar instead of staying hidden |
| Collapsed rail | The rail has no room and cannot be dragged; the bottom-left launcher stays visible there, so the three actions are still reachable |

Preferences live in the browser's `localStorage`
(`dsh-panel-layout:settings` / `dsh-panel-layout:order`) and do not touch the
shell's own pinning (`setPinned`).

## Install

```bash
dsh plugin --profile web add dsh-panel-layout
```

Or install it from the DSH plugin market. To track the source directly:
`dsh plugin --profile web add github:devome/dsh-panel-layout`.

A page refresh picks up an install; editing `lib/client.js` needs a Harness
restart before the browser module is regenerated.

## How it works

The shell hands the `sidebar.panellist` slot only each entry's **icon**. Row
geometry, the cap and the order belong to the shell and no slot exposes them,
so this plugin:

1. locates the panel bar through each row's `data-slot="sidebar.panellist"`
   anchor and recognises the More launcher by its `aria-haspopup="menu"`;
2. tags rows with its own `data-dpl-*` attributes, orders them with flex
   `order` and hides overflow with `display:none` — a shell re-render does not
   lose any of it;
3. gates every style behind the single `html[data-dpl-mode]` switch, so
   switching back to list mode or unloading the plugin restores the shell's own
   appearance;
4. uses `sidebar.panellist.actions` only for what the DOM cannot do: putting the
   entries the cap pushed out back into the shell's More menu. Those rows are
   drop targets as well, and sorting them writes back to the same `order`; the
   shell's own two rows are not this plugin's and take no part.

The absorbed actions go through: the shell's `settings.open` command when it has
a binding, otherwise the `openSettings` action the shell hands the launcher
(replaying "open the account menu → click its Settings row" only if that is not
reachable); the public questionnaire the shell itself links
(`__DSH_CONTACT_CONFIG__`, same defaults as the shell); and the Host account
stream's `startSignIn` — the authorize URL only appears once the attempt reaches
`waiting-browser`, so it is read from the account stream
(`remote.$stream`) one frame at a time rather than from the one-shot response.

No Harness client package is imported and only `--dsw-alias-*` theme tokens are
used, so a shell release that renames its classes does not break this.

## Development

```bash
node test/manifest.mjs                      # manifest, exports, patch, locales, icon
node test/smoke.mjs                         # pure functions + DOM reconciliation
DPL_JSDOM=/path/to/jsdom node test/smoke.mjs # point at jsdom (the pure part runs without it)
```

`test/smoke.mjs` drives one reconciliation pass over real nodes in jsdom:
recognising rows, ordering, the cap, overflow hiding, sign-in state, the rail
being left alone, and the rows inside More sorting against each other.

## Relation to `dsh-sidebar-panel-buttons`

Both write the same panel bar. `dsh-sidebar-panel-buttons` only toggles between
a button row and a list — no row cap, no ordering, no folding, and it leaves the
bottom-left corner alone.

This plugin is a superset: the same row/list switch plus a row cap, drag
ordering, overflow folding and the absorbed bottom-left actions. **Run only one
at a time** — with both enabled they rewrite the same nodes, and while row mode
looks similar, switching to list mode makes them displace each other. Disable
`dsh-sidebar-panel-buttons` after installing this.

## Known limits

- The expanded sidebar only. The collapsed rail keeps the shell's own
  appearance: no buttons added, no row spacing changed, no launcher hidden —
  those three have no room in the rail and stay where they are.
- Dragging uses HTML5 drag-and-drop, which a touch screen never fires; use the
  up-arrow on each More row there.
- Sending an entry to the front pushes the last visible one into More — the
  folding slot is fixed, so gaining one costs one.
- No icon is drawn here: panel entries copy the structure their plugin
  registered, the three absorbed actions reference symbols in the shell's
  sprite. If the shell renames those ids or inlines the paths, the three lose
  their icon (panel entries are unaffected).
- The row cap is measured in 36px cells; a shell that changes the cell size
  needs the `CELL` constant updated.

## License

MIT — see [LICENSE](LICENSE).
