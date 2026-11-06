import * as sim from "../sim";
import { cellHeight } from "../term";
import { type App, Quit } from "./app";
import { width } from "./chrome";
import { sgr } from "./theme";

export async function chooseDevices(a: App): Promise<sim.Device[]> {
  const devices = await sim.devices(a.signal);
  if (a.opts.udids.length > 0) {
    return a.opts.udids.map((udid) => {
      const d = devices.find((d) => d.udid === udid);
      if (!d) throw new Error(`no available simulator has UDID ${udid}`);
      return d;
    });
  }
  if (devices.length === 0) throw new Error("no iOS simulators are available; add one in Xcode");
  const booted = devices.filter((d) => d.booted);
  return booted.length > 0 ? booted : pick(a, devices);
}

// pick lists the simulators when none is booted. Space marks one or more and
// Enter shows them, or the selected one when none is marked; a digit or a
// click shows only that one.
async function pick(a: App, devices: sim.Device[]): Promise<sim.Device[]> {
  const top = 5;
  const marked = devices.map(() => false);
  const labelWidth = Math.max(...devices.map((d) => width(sim.label(d))));
  let sel = 0;
  let offset = 0;
  for (;;) {
    const visible = Math.max(1, a.size.rows - top - 1);
    if (sel < offset) offset = sel;
    else if (sel >= offset + visible) offset = sel - visible + 1;
    a.t.write(`\x1b[0m\x1b[2J\x1b[2;3H${sgr(a.pal.accent, "1")}◆ rexsim${sgr(a.pal.dim)}  choose simulators`);
    a.t.write(`\x1b[3;3H${sgr(a.pal.dim)}↑↓ move   space select   enter open   1–9 open one   q quit\x1b[0m`);
    for (let i = offset; i < devices.length && i < offset + visible; i++) {
      const lbl = sim.label(devices[i]);
      let mark = "○";
      let markStyle = sgr(a.pal.dim);
      if (marked[i]) {
        mark = "●";
        markStyle = sgr(a.pal.accent);
      }
      const label = lbl + " ".repeat(labelWidth - width(lbl));
      let text = sgr(a.pal.text);
      if (i === sel) {
        text = sgr(a.pal.chip, a.pal.chipText, "1");
        markStyle = markStyle.replace("\x1b[0;", `\x1b[0;${a.pal.chip};`);
      }
      a.t.write(`\x1b[${top + i - offset};3H${markStyle} ${mark} ${text} ${label} \x1b[0m`);
    }
    a.t.flush();

    const ev = await a.events.next();
    if (ev.kind === "quit") throw new Quit();
    if (ev.kind === "winch") {
      a.updateSize();
      continue;
    }
    if (ev.kind === "key") {
      const digit = ev.rune >= "1" && ev.rune <= "9" ? offset + Number(ev.rune) - 1 : -1;
      if (ev.name === "up" || ev.rune === "k") {
        sel = Math.max(0, sel - 1);
      } else if (ev.name === "down" || ev.rune === "j") {
        sel = Math.min(devices.length - 1, sel + 1);
      } else if (ev.rune === " ") {
        marked[sel] = !marked[sel];
      } else if (ev.name === "enter") {
        const chosen = devices.filter((_, i) => marked[i]);
        return chosen.length > 0 ? chosen : [devices[sel]];
      } else if (digit >= 0 && digit < devices.length) {
        return [devices[digit]];
      } else if (ev.rune === "q" || ["esc", "ctrl+c", "ctrl+]"].includes(ev.name)) {
        throw new Quit();
      }
    } else if (ev.kind === "mouse") {
      const row = Math.trunc(ev.y / cellHeight(a.size));
      if (ev.button === 0 && !ev.release && !ev.motion) {
        const i = offset + row - (top - 1);
        if (row >= top - 1 && i < devices.length) return [devices[i]];
      } else if (ev.button === 64) {
        sel = Math.max(0, sel - 1);
      } else if (ev.button === 65) {
        sel = Math.min(devices.length - 1, sel + 1);
      }
    }
  }
}
