import type { Key, Mouse } from "../input";
import * as sim from "../sim";
import { cellHeight, cellWidth } from "../term";
import { animate } from "./animate";
import type { App } from "./app";
import { clip, drawChrome, width } from "./chrome";
import { footerRows } from "./layout";
import type { Phone } from "./phone";
import { sgr } from "./theme";

const sidebarCols = 34;
const listTop = 4;

// Sidebar lists every simulator beside the phones, to show or hide them.
export type Sidebar = { devices: sim.Device[]; sel: number; offset: number };

// panelCol is the column where the sidebar starts, or the pane's width when
// it is closed.
export function panelCol(a: App): number {
  return a.sidebar ? Math.max(0, a.size.cols - sidebarCols) : a.size.cols;
}

// toggleSidebar slides the simulator list in from the right, or back out.
export async function toggleSidebar(a: App): Promise<void> {
  if (a.sidebar) {
    await animate(a, () => {
      a.sidebar = null;
    });
    return;
  }
  let devices: sim.Device[];
  try {
    devices = await sim.devices(a.signal);
  } catch (err) {
    a.flash((err as Error).message);
    return;
  }
  await animate(a, () => {
    a.sidebar = { devices, sel: 0, offset: 0 };
  });
}

function phoneFor(a: App, udid: string): Phone | null {
  return a.phones.find((p) => p.device.udid === udid) ?? null;
}

// toggleDevice shows the selected simulator, booting it if needed, or hides
// it and shuts it down, and slides the list away. Only one simulator starts
// at a time.
async function toggleDevice(a: App): Promise<void> {
  const sb = a.sidebar!;
  if (sb.devices.length === 0) return;
  const d = sb.devices[sb.sel];
  const p = phoneFor(a, d.udid);
  if (p) {
    if (a.phones.length === 1) {
      a.flash("Keep one simulator open, or quit with ⌃]");
      return;
    }
    await animate(a, () => {
      a.removePhone(p);
      a.sidebar = null;
    });
    return;
  }
  const starting = a.phones.find((q) => q.connecting);
  if (starting) {
    a.flash(`Wait for ${starting.device.name} to start`);
    return;
  }
  await animate(a, () => {
    a.focus = a.add([d])[0];
    a.sidebar = null;
  });
}

// markShutDown keeps the list's state in step when a phone closes.
export function markShutDown(a: App, udid: string): void {
  for (const d of a.sidebar?.devices ?? []) if (d.udid === udid) d.booted = false;
}

// sidebarKey handles a key while the list is open and reports whether it
// did. The list takes the arrows, Space, Enter and typing, so they don't
// reach a phone by surprise; other shortcuts still work.
export async function sidebarKey(a: App, k: Key): Promise<boolean> {
  const sb = a.sidebar!;
  if (k.name === "up" || k.rune === "k") {
    sb.sel = Math.max(0, sb.sel - 1);
  } else if (k.name === "down" || k.rune === "j") {
    sb.sel = Math.max(0, Math.min(sb.devices.length - 1, sb.sel + 1));
  } else if (k.name === "enter" || k.rune === " ") {
    await toggleDevice(a);
    return true;
  } else if (k.name === "esc" || k.name === "ctrl+o") {
    await toggleSidebar(a);
    return true;
  } else if (k.name.startsWith("ctrl+")) {
    return false;
  } else {
    return true;
  }
  drawChrome(a);
  return true;
}

// sidebarMouse handles clicks and the wheel over the list and reports
// whether it did. Movement and releases pass through, so a drag that started
// on a phone still lifts its finger when it ends over the list.
export async function sidebarMouse(a: App, m: Mouse): Promise<boolean> {
  if (!a.sidebar || m.motion || m.release || Math.trunc(m.x / cellWidth(a.size)) < panelCol(a)) return false;
  const sb = a.sidebar;
  if (m.button === 64) {
    sb.sel = Math.max(0, sb.sel - 1);
    drawChrome(a);
  } else if (m.button === 65) {
    sb.sel = Math.max(0, Math.min(sb.devices.length - 1, sb.sel + 1));
    drawChrome(a);
  } else if (m.button === 0) {
    const row = Math.trunc(m.y / cellHeight(a.size));
    const i = sb.offset + Math.trunc((row - listTop) / 2);
    if (row >= listTop && i < sb.devices.length) {
      sb.sel = i;
      await toggleDevice(a);
    }
  }
  return true;
}

type Segment = [text: string, style: string];

// drawSidebar draws the list with its left edge at col, clipped to the pane,
// after clearing each row from clearFrom, so it can slide in steps.
export function drawSidebar(a: App, sb: Sidebar | null, col: number, clearFrom: number): void {
  const s = a.size;
  for (let row = 1; row < s.rows - footerRows; row++) a.t.write(`\x1b[${row + 1};${clearFrom + 1}H\x1b[0m\x1b[K`);
  if (!sb || col >= s.cols) return;
  const room = s.cols - col;
  const inner = room - 2;
  const edge: Segment = ["│ ", sgr(a.pal.frame)];
  const line = (row: number, ...segs: Segment[]) => {
    a.t.write(`\x1b[${row + 1};${col + 1}H`);
    let left = room;
    for (const [text, style] of segs) {
      const shown = width(text) > left ? [...text].slice(0, left).join("") : text;
      a.t.write(style + shown);
      left -= width(shown);
    }
    a.t.write("\x1b[0m");
  };
  for (let row = 1; row < s.rows - footerRows; row++) line(row, edge);
  line(2, edge, ["Simulators", sgr(a.pal.text, "1")], [`  ${sb.devices.length}`, sgr(a.pal.dim)]);

  const visible = Math.max(1, Math.trunc((s.rows - footerRows - listTop) / 2));
  if (sb.sel < sb.offset) sb.offset = sb.sel;
  else if (sb.sel >= sb.offset + visible) sb.offset = sb.sel - visible + 1;
  for (let i = sb.offset; i < sb.devices.length && i < sb.offset + visible; i++) {
    const d = sb.devices[i];
    const bg = i === sb.sel ? [a.pal.chip] : [];
    const style = (...params: string[]) => sgr(...bg, ...params);
    let mark = "○ ";
    let markStyle = style(a.pal.dim);
    if (phoneFor(a, d.udid)) {
      mark = "● ";
      markStyle = style(a.pal.accent);
    } else if (d.booted) {
      mark = "● ";
    }
    const r = listTop + (i - sb.offset) * 2;
    line(r, edge, [mark, markStyle], [fit(d.name, inner - 2), style(a.pal.text, "1")]);
    line(r + 1, edge, ["  ", style()], [fit(d.runtime, inner - 2), style(a.pal.dim)]);
  }
}

// fit clips or pads s to exactly n columns.
function fit(s: string, n: number): string {
  if (n <= 0) return "";
  s = clip(s, n);
  return s + " ".repeat(n - width(s));
}
