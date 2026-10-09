/**
 * The right-click menu of every app window (D8): Cut, Copy, Paste and Select All in a text field, Copy for selected
 * text, and Copy Link Address for a web link. Nothing else (no Back, Reload, Save As or Inspect), except Inspect
 * Element while running from source. Pure data from the `context-menu` event's params, so the choices are unit tested;
 * main.ts pops it up. Electron is imported for types only.
 *
 * The menu is drawn by Electron on Windows and Linux and by the OS on macOS; nativeTheme.themeSource = "dark" (main.ts)
 * makes both dark (electron.d.ts, `themeSource`).
 */

import type { MenuItemConstructorOptions } from "electron";

/** The part of Electron's `ContextMenuParams` the menu needs. */
export interface ContextMenuInput {
  readonly isEditable: boolean;
  readonly selectionText: string;
  readonly linkURL: string;
  readonly editFlags: { readonly canCut: boolean; readonly canCopy: boolean; readonly canPaste: boolean; readonly canSelectAll: boolean };
}

export interface ContextMenuActions {
  /** Puts text on the clipboard. */
  readonly copyText: (text: string) => void;
  /** Opens the developer tools on the clicked element. Given only when running from source: a packaged app has no Inspect. */
  readonly inspect?: () => void;
}

/** Only web links can be copied: not javascript:, file:, mailto: or anything else a page might link to. */
export function isCopyableLink(raw: string): boolean {
  try {
    const { protocol } = new URL(raw);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

/** The items to show, or [] when there is nothing to offer (then no menu pops up). */
export function contextMenuTemplate(params: ContextMenuInput, actions: ContextMenuActions): MenuItemConstructorOptions[] {
  const groups: MenuItemConstructorOptions[][] = [];
  const flags = params.editFlags;
  if (params.isEditable) {
    groups.push([
      { role: "cut", enabled: flags.canCut },
      { role: "copy", enabled: flags.canCopy },
      { role: "paste", enabled: flags.canPaste },
    ]);
    groups.push([{ role: "selectAll", enabled: flags.canSelectAll }]);
  } else if (params.selectionText.trim() !== "") {
    groups.push([{ role: "copy", enabled: flags.canCopy }]);
  }
  if (isCopyableLink(params.linkURL)) {
    groups.push([{ label: "Copy Link Address", click: () => actions.copyText(params.linkURL) }]);
  }
  if (actions.inspect) {
    const { inspect } = actions;
    groups.push([{ label: "Inspect Element", click: () => inspect() }]);
  }
  return groups.flatMap((group, i) => (i === 0 ? group : [{ type: "separator" as const }, ...group]));
}
