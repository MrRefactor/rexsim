// Installs and runs Meta's idb_companion, which reads the simulator's
// framebuffer and injects HID events through CoreSimulator.
import { closeSync, chmodSync, existsSync, lstatSync, mkdirSync, openSync, renameSync, rmSync, statSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const version = "1.7.8";
const archiveURL = `https://github.com/facebook/idb/releases/download/v${version}/idb-companion.macos-arm64.tar.gz`;
const archiveSHA256 = "44369a2df0b62e3a1764de61bd09280999c7e9b27ea8f20bff1ea3a9db0302a2";

export function cacheDir(): string {
  return join(homedir(), "Library", "Caches", "rexsim");
}

// binary returns the path of idb_companion. It downloads the pinned release
// on first use.
export async function binary(signal: AbortSignal, progress: (text: string) => void): Promise<string> {
  const dir = join(cacheDir(), `idb-companion-${version}`);
  const bin = join(dir, "idb_companion");
  try {
    if (statSync(bin).mode & 0o111) return bin;
  } catch {}
  progress(`downloading idb_companion ${version}…`);
  const res = await fetch(archiveURL, { signal });
  if (!res.ok) throw new Error(`download ${archiveURL}: ${res.status} ${res.statusText}`);
  const data = new Uint8Array(await res.arrayBuffer());
  if (new Bun.CryptoHasher("sha256").update(data).digest("hex") !== archiveSHA256) {
    throw new Error("idb_companion download has the wrong checksum");
  }
  const partial = `${dir}.partial-${process.pid}`;
  rmSync(partial, { recursive: true, force: true });
  try {
    await extract(data, partial);
    renameSync(partial, dir);
  } catch (err) {
    rmSync(partial, { recursive: true, force: true });
    throw err;
  }
  return bin;
}

// extract unpacks with macOS's bsdtar, which refuses entries with absolute
// paths or ".." unless given -P.
async function extract(data: Uint8Array, dest: string): Promise<void> {
  mkdirSync(dest, { recursive: true });
  const tar = Bun.spawn(["tar", "-xzf", "-", "-C", dest], { stdin: data, stdout: "ignore", stderr: "pipe" });
  if ((await tar.exited) !== 0) {
    throw new Error(`extract idb_companion: ${(await new Response(tar.stderr).text()).trim()}`);
  }
}

export class Companion {
  private closed: Promise<void> | null = null;

  constructor(
    readonly socket: string,
    private proc: Bun.Subprocess,
  ) {}

  get exited(): Promise<number> {
    return this.proc.exited;
  }

  close(): Promise<void> {
    this.closed ??= (async () => {
      if (this.proc.exitCode === null && this.proc.signalCode === null) {
        this.proc.kill("SIGTERM");
        const timer = setTimeout(() => this.proc.kill("SIGKILL"), 2000);
        await this.proc.exited;
        clearTimeout(timer);
      }
      try {
        unlinkSync(this.socket);
      } catch {}
    })();
    return this.closed;
  }
}

// start runs a companion for one simulator on a private Unix socket. The
// socket lives in /tmp, not $TMPDIR, because a socket path must fit in 104
// bytes. A TCP port would listen on every interface without authentication.
export async function start(signal: AbortSignal, bin: string, udid: string): Promise<Companion> {
  const short = udid.slice(0, 8);
  const sock = join(socketDir(), `${process.pid}-${short}.sock`);
  try {
    unlinkSync(sock);
  } catch {}

  const root = cacheDir();
  mkdirSync(root, { recursive: true });
  const logPath = join(root, `companion-${short}.log`);
  const log = openSync(logPath, "w", 0o600);
  let proc: Bun.Subprocess;
  try {
    proc = Bun.spawn([bin, "--udid", udid, "--grpc-domain-sock", sock], { stdin: "ignore", stdout: log, stderr: log });
  } finally {
    closeSync(log);
  }
  const c = new Companion(sock, proc);
  let exited = false;
  proc.exited.then(() => (exited = true));

  const deadline = Date.now() + 30_000;
  while (!existsSync(sock)) {
    if (signal.aborted) {
      await c.close();
      throw signal.reason;
    }
    if (exited) throw new Error(`idb_companion exited; see ${logPath}`);
    if (Date.now() > deadline) {
      await c.close();
      throw new Error(`idb_companion did not start; see ${logPath}`);
    }
    await Bun.sleep(50);
  }
  return c;
}

// socketDir returns rexsim's private directory for Unix sockets, creating it
// with mode 0700.
export function socketDir(): string {
  const dir = `/tmp/rexsim-${process.getuid!()}`;
  try {
    mkdirSync(dir, { mode: 0o700 });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
  }
  const st = lstatSync(dir);
  if (!st.isDirectory() || st.uid !== process.getuid!()) {
    throw new Error(`${dir} is not a directory owned by you`);
  }
  chmodSync(dir, 0o700);
  return dir;
}
