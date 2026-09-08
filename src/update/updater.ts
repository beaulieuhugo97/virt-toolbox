import * as vscode from "vscode";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawn } from "child_process";

/**
 * Self-update for a side-loaded extension. The toolbox is not on the
 * marketplace, so VS Code will never update it — instead we keep the git
 * checkout the VSIX was built from (~/.virt-toolbox by default), pull it,
 * rebuild the VSIX and install it over the running copy. Exactly the manual
 * sequence the installer and the README print, behind one button.
 */

const DEFAULT_SOURCE = path.join(os.homedir(), ".virt-toolbox");
const VSIX_NAME = "virt-toolbox.vsix";

export interface UpdateInfo {
  sourceDir: string;
  branch: string;
  /** Commits the local checkout is behind / ahead of its upstream branch. */
  behind: number;
  ahead: number;
  /** Uncommitted local changes — a `git pull --ff-only` would likely fail. */
  dirty: boolean;
  localVersion: string;
  remoteVersion: string;
  available: boolean;
}

export class Updater {
  private readonly out = vscode.window.createOutputChannel("Virtualization Toolbox Update");
  private running = false;

  constructor(private readonly context: vscode.ExtensionContext) {}

  /**
   * The git checkout to update. Order: explicit setting, the repo this
   * extension is being developed from (F5 host), an open workspace folder, then
   * the installer's default location. A candidate only counts if it looks like
   * the toolbox repo — the manifest lives at the root (the repo is flat), so
   * checking for a package.json named virt-toolbox is what tells it apart from
   * any other git checkout that happens to be open.
   */
  sourceDir(): string | undefined {
    const configured = vscode.workspace
      .getConfiguration("virtToolbox")
      .get<string>("sourcePath", "")
      .trim();

    const candidates = [
      configured ? configured.replace(/^~(?=$|\/)/, os.homedir()) : undefined,
      this.context.extensionUri.fsPath,
      ...(vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath),
      DEFAULT_SOURCE,
    ];

    for (const dir of candidates) {
      if (!dir) continue;
      if (fs.existsSync(path.join(dir, ".git")) && readNameAt(path.join(dir, "package.json")) === "virt-toolbox") {
        return dir;
      }
    }
    return undefined;
  }

  /** Fetch from origin and report how the checkout compares to its upstream. */
  async check(): Promise<UpdateInfo | undefined> {
    const dir = this.sourceDir();
    if (!dir) return undefined;

    const branch = (await this.capture("git", ["rev-parse", "--abbrev-ref", "HEAD"], dir)).stdout.trim() || "main";
    const fetched = await this.capture("git", ["fetch", "--quiet", "origin"], dir, false, 60_000);
    if (fetched.code !== 0) {
      this.out.appendLine(`[check] git fetch failed: ${fetched.stderr.trim()}`);
      return undefined;
    }

    const tracked = await this.capture("git", ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], dir);
    const upstream = tracked.code === 0 ? tracked.stdout.trim() : `origin/${branch}`;

    const counts = await this.capture("git", ["rev-list", "--left-right", "--count", `HEAD...${upstream}`], dir);
    if (counts.code !== 0) {
      this.out.appendLine(`[check] no upstream for ${branch}: ${counts.stderr.trim()}`);
      return undefined;
    }
    const [ahead, behind] = counts.stdout.trim().split(/\s+/).map((n) => Number(n) || 0);

    const status = await this.capture("git", ["status", "--porcelain"], dir);
    const remotePkg = await this.capture("git", ["show", `${upstream}:package.json`], dir);

    return {
      sourceDir: dir,
      branch,
      behind,
      ahead,
      dirty: status.stdout.trim().length > 0,
      localVersion: readVersionAt(path.join(dir, "package.json")),
      remoteVersion: remotePkg.code === 0 ? readVersion(remotePkg.stdout) : "",
      available: behind > 0,
    };
  }

  /**
   * Pull, rebuild, reinstall. Confirms first, then streams every step into the
   * output channel behind a progress notification, and offers a reload at the
   * end (the new code only takes effect on reload).
   */
  async update(): Promise<void> {
    if (this.running) {
      vscode.window.showInformationMessage("Virtualization Toolbox is already updating.");
      this.out.show(true);
      return;
    }

    const dir = this.sourceDir();
    if (!dir) {
      const pick = await vscode.window.showErrorMessage(
        `Could not find the Virtualization Toolbox git checkout (looked in ${DEFAULT_SOURCE}). ` +
          "Set virtToolbox.sourcePath to its location.",
        "Open Settings"
      );
      if (pick) {
        void vscode.commands.executeCommand("workbench.action.openSettings", "virtToolbox.sourcePath");
      }
      return;
    }

    const info = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: "Virtualization Toolbox: checking for updates…" },
      () => this.check()
    );
    if (!info) {
      vscode.window.showErrorMessage(
        `Could not reach GitHub to check ${dir} for updates. See the "Virtualization Toolbox Update" output for details.`
      );
      this.out.show(true);
      return;
    }

    if (!info.available) {
      const pick = await vscode.window.showInformationMessage(
        `Virtualization Toolbox is up to date (v${info.localVersion}, ${info.branch}).`,
        "Rebuild & Reinstall Anyway"
      );
      if (!pick) return;
    } else {
      const target = info.remoteVersion && info.remoteVersion !== info.localVersion
        ? `v${info.localVersion} → v${info.remoteVersion}`
        : `${info.behind} new commit${info.behind === 1 ? "" : "s"}`;
      const pick = await vscode.window.showInformationMessage(
        `Update Virtualization Toolbox (${target})? This pulls ${info.branch}, rebuilds the VSIX and reinstalls it.`,
        { modal: true },
        "Update"
      );
      if (pick !== "Update") return;
    }

    // Uncommitted work would break `git pull --ff-only`; stashing keeps it
    // recoverable (`git stash pop`) instead of discarding it.
    let stash = false;
    if (info.dirty) {
      const pick = await vscode.window.showWarningMessage(
        `${dir} has uncommitted changes. Stash them and continue?`,
        { modal: true },
        "Stash & Update"
      );
      if (pick !== "Stash & Update") return;
      stash = true;
    }

    if (info.ahead > 0) {
      this.out.appendLine(
        `[warn] ${info.branch} is ${info.ahead} commit(s) ahead of upstream; the pull may not fast-forward.`
      );
    }

    this.running = true;
    this.out.clear();
    this.out.show(true);
    this.out.appendLine(`Updating ${dir} (${info.branch})…`);

    try {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "Virtualization Toolbox", cancellable: false },
        async (progress) => {
          if (stash) {
            progress.report({ message: "stashing local changes…" });
            await this.step("git", ["stash", "push", "-u", "-m", `virt-toolbox update ${new Date().toISOString()}`], dir);
          }

          progress.report({ message: "pulling from GitHub…" });
          await this.step("git", ["pull", "--ff-only"], dir);

          progress.report({ message: "installing npm packages…" });
          await this.step("npm", ["install"], dir);

          progress.report({ message: "building the VSIX…" });
          await this.step("npm", ["run", "package"], dir);

          progress.report({ message: "installing the extension…" });
          await this.install(path.join(dir, VSIX_NAME));
        }
      );
    } catch (err) {
      this.running = false;
      const message = err instanceof Error ? err.message : String(err);
      this.out.appendLine(`\n[failed] ${message}`);
      const pick = await vscode.window.showErrorMessage(`Virtualization Toolbox update failed: ${message}`, "Show Log");
      if (pick) this.out.show(true);
      if (stash) {
        vscode.window.showWarningMessage(`Your changes are stashed — run \`git stash pop\` in ${dir} to restore them.`);
      }
      return;
    }
    this.running = false;

    const version = readVersionAt(path.join(dir, "package.json"));
    this.out.appendLine(`\n[done] Virtualization Toolbox v${version} installed. Reload the window to use it.`);
    if (stash) {
      this.out.appendLine(`[note] Local changes were stashed — \`git stash pop\` in ${dir} to restore them.`);
    }
    const pick = await vscode.window.showInformationMessage(
      `Virtualization Toolbox v${version} installed. Reload to finish updating.`,
      "Reload Window",
      "Later"
    );
    if (pick === "Reload Window") {
      void vscode.commands.executeCommand("workbench.action.reloadWindow");
    }
  }

  /** Install the freshly built VSIX, preferring the in-process command over the `code` CLI. */
  private async install(vsix: string): Promise<void> {
    if (!fs.existsSync(vsix)) {
      throw new Error(`the build did not produce ${vsix}`);
    }
    try {
      await vscode.commands.executeCommand("workbench.extensions.installExtension", vscode.Uri.file(vsix));
      this.out.appendLine(`$ (vscode) install ${vsix}`);
    } catch (err) {
      this.out.appendLine(
        `[info] in-process install failed (${err instanceof Error ? err.message : String(err)}), falling back to the code CLI.`
      );
      await this.step("code", ["--install-extension", vsix, "--force"], path.dirname(vsix));
    }
  }

  /** Run a step, streaming to the output channel; reject on a non-zero exit. */
  private async step(cmd: string, args: string[], cwd: string): Promise<void> {
    this.out.appendLine(`\n$ ${cmd} ${args.join(" ")}`);
    const { code, stderr } = await this.capture(cmd, args, cwd, true);
    if (code !== 0) {
      throw new Error(`${cmd} ${args[0]} exited with ${code}${stderr.trim() ? ` — ${lastLine(stderr)}` : ""}`);
    }
  }

  private capture(
    cmd: string,
    args: string[],
    cwd: string,
    stream = false,
    timeoutMs?: number
  ): Promise<{ code: number | null; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      // Never let git block on a credential/passphrase prompt: there is no TTY
      // behind the extension host, so a prompt would hang the update forever.
      const child = spawn(cmd, args, {
        cwd,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "echo", SSH_ASKPASS_REQUIRE: "never" },
      });
      let stdout = "";
      let stderr = "";
      const timer = timeoutMs
        ? setTimeout(() => {
            stderr += `timed out after ${Math.round(timeoutMs / 1000)}s`;
            child.kill("SIGTERM");
          }, timeoutMs)
        : undefined;
      child.stdout.on("data", (d: Buffer) => {
        stdout += d.toString();
        if (stream) this.out.append(d.toString());
      });
      child.stderr.on("data", (d: Buffer) => {
        stderr += d.toString();
        if (stream) this.out.append(d.toString());
      });
      child.on("error", (err) => {
        if (timer) clearTimeout(timer);
        const message = (err as NodeJS.ErrnoException).code === "ENOENT" ? `${cmd} not found on PATH` : err.message;
        stderr += message;
        if (stream) this.out.appendLine(`[error] ${message}`);
        resolve({ code: 127, stdout, stderr });
      });
      child.on("close", (code) => {
        if (timer) clearTimeout(timer);
        resolve({ code, stdout, stderr });
      });
    });
  }

  dispose(): void {
    this.out.dispose();
  }
}

/** Version from a package.json path — "" if it is missing or unparseable. */
function readVersionAt(file: string): string {
  try {
    return readVersion(fs.readFileSync(file, "utf8"));
  } catch {
    return "";
  }
}

function readVersion(pkgJson: string): string {
  try {
    return String(JSON.parse(pkgJson).version ?? "");
  } catch {
    return "";
  }
}

/** `name` from a package.json path — "" if it is missing or unparseable. */
function readNameAt(file: string): string {
  try {
    return String(JSON.parse(fs.readFileSync(file, "utf8")).name ?? "");
  } catch {
    return "";
  }
}

function lastLine(s: string): string {
  const lines = s.trim().split("\n");
  return lines[lines.length - 1].trim();
}
