# 🖥️ Virtualization Toolbox

A VS Code extension that puts **libvirt/KVM** and **docker** behind native webview
forms — manage `virsh` VMs, create them with `virt-install`, snapshot them, wire up
libvirt networks, and spin throwaway containers. Pick a tool, fill in the fields,
review the exact command it will run, and launch it.

## ℹ️ Status

> [!WARNING]  
> This repository is in active development.

## 🛠️ Compatibility

> [!NOTE]
> The extension runs anywhere VS Code runs, but the tools it drives need a Linux
> host with libvirt/KVM — the machine that *hosts* your VMs. Work locally, or over
> **Remote-SSH / WSL**: the extension host and every command it runs execute on the
> remote/WSL machine, not the local client.

No distribution is special-cased — `libvirt`, `virt-install` and `docker` ship
everywhere. The extension gates each tool on what is actually present:

| | |
| --- | --- |
| **Missing binary** | the tool is badged with what to install |
| **`libvirtd` stopped** | badge with a **Start** button |
| **Not in the `docker` group** | badge with an **Add me** button |

KVM acceleration needs VT-x/AMD-V enabled in your BIOS/UEFI. Without it libvirt
still works, but VMs fall back to plain emulation and run very slowly.

## 🧰 Tools

| Tool | What it covers |
| --- | --- |
| **virsh** | VM lifecycle — start, shutdown, suspend, reboot, destroy, undefine, viewer — plus snapshot create/revert/delete |
| **Images & VM creation** | download an image into the images directory, create a VM from an ISO (`virt-install`), or import an existing qcow2 |
| **virsh networks** | list/start/stop libvirt networks, create NAT / host-only / isolated networks, and toggle IP forwarding |
| **docker** | run a throwaway container on the host network with the working directory mounted |

## 🔗 Requirements

> [!IMPORTANT]  
> [VS Code](https://code.visualstudio.com/) with the `code` shell command on your
> `PATH` (Command Palette → *Shell Command: Install 'code' command in PATH*). The
> one-line installer additionally needs `git`, `curl`, `unzip` and `npm` (Node.js)
> to build the extension — it offers to install any that are missing via `apt`,
> `dnf`, `pacman` or `zypper`, and offers to install the libvirt stack too.

## 📥 Installation

One-liner — clones the repo to `~/.virt-toolbox`, builds the extension, and
installs it into VS Code:

```bash
curl -fsSL "https://virt.hugo.quebec/download/install?$(date +%s)" | bash
```

Or manually:

```bash
git clone https://github.com/beaulieuhugo97/virt-toolbox.git ~/.virt-toolbox
cd ~/.virt-toolbox
npm install && npm run package
code --install-extension virt-toolbox.vsix
```

> [!TIP]
> Hacking on the extension itself? Open the repo in VS Code and press **F5** for an
> Extension Development Host. See [ARCHITECTURE.md](ARCHITECTURE.md) for how the
> manifest-driven form engine fits together.

## 🔄 Updating

The toolbox is side-loaded, not on the marketplace, so VS Code will never update
it for you. Pull and rebuild in place:

```bash
cd ~/.virt-toolbox && git pull && npm install && npm run package \
  && code --install-extension virt-toolbox.vsix --force
```

## 🚀 Usage

1. Open the toolbox in VS Code: `code ~/.virt-toolbox`
2. Click the **Virtualization Toolbox** icon in the activity bar.
3. Press **`Ctrl+Alt+V`** (`Cmd+Alt+V` on macOS) to fuzzy-find any tool by name, or
   browse the tree. Star tools to pin them to **Favorites**.
4. Fill in the form and review the resolved command.
5. **Run** — `virsh` and `virt-install` need root and are interactive, so they run
   in an integrated terminal where the `sudo` prompt works. Every run is saved to
   **Run History** (the history icon in the Tools title bar).

Each run executes in `~/.virt-toolbox/outputs/<tool>/`, and any output file lands
there. Point **`virtToolbox.outputsPath`** somewhere else to keep runs beside a
project instead.

> [!TIP]
> The panel adapts to your VS Code color theme by default. Prefer the bold Hack
> The Box green-on-navy look? Set **`virtToolbox.theme`** to `htb` in Settings.

## ⚙️ Configuration

> [!TIP]
> The **Configuration** view (the gear icon in the Tools title bar) holds the
> values shared across tools, and they inject into every command:
>
> | Key | Default | Used for |
> | --- | --- | --- |
> | `LIBVIRT_URI` | `qemu:///system` | passed as `--connect` to every `virsh`, `virt-install` and `virt-viewer` call — point it at `qemu:///session` or a remote host |
> | `IMAGES_DIR` | `/var/lib/libvirt/images` | where images are downloaded, where disks are created, and where the ISO/disk pickers start |
> | `DEFAULT_NET` | `virbr0` | the bridge new VMs are attached to |
>
> They persist to VS Code workspace state.

## 📄 License

See [LICENSE.md](LICENSE.md).

---

_All third-party tools used by the extension are the work of their respective authors. Users are responsible for compliance with each tool's individual license terms._
