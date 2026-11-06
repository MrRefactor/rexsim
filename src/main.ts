// rexsim shows an iOS simulator in a Rex pane that you can tap, swipe and
// type into.
import { parseArgs } from "node:util";
import { install, uninstall } from "./install";
import { run } from "./view/app";

const usage = `usage: rexsim [flags] | rexsim install | rexsim uninstall
  --udid UDID   a simulator to show; repeat it or separate UDIDs with commas to show several.
                Without it, rexsim asks unless one is booted
  --agent ID    the Rex block that ^S sends screenshots to; the Rex action sets it
  --fps N       frames per second to stream (default 60)`;

async function main(args: string[]): Promise<void> {
  if (args[0] === "install") return install();
  if (args[0] === "uninstall") return uninstall();
  const { values } = parseArgs({
    args,
    options: {
      udid: { type: "string", multiple: true, default: [] },
      agent: { type: "string", default: "" },
      fps: { type: "string", default: "60" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) {
    console.log(usage);
    return;
  }
  const fps = Number(values.fps);
  if (!Number.isInteger(fps) || fps <= 0) throw new Error(`invalid --fps ${values.fps}`);
  const udids = values.udid.flatMap((s) => s.split(",")).map((u) => u.trim()).filter(Boolean);
  await run({ udids, agent: values.agent, fps });
}

try {
  await main(process.argv.slice(2));
  process.exit(0);
} catch (err) {
  console.error("rexsim:", err instanceof Error ? err.message : err);
  process.exit(1);
}
