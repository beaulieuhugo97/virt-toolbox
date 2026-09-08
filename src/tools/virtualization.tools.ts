// The libvirt domain, ported from the libvirt/virsh bash TUI this project grew
// out of. Seven tools grouped by the tree:
//
//   Virtual_Machines → virsh           (VM lifecycle, inspect, XML)
//   Virtual_Machines → virsh-snapshots (snapshot browse/create/manage)
//   Virtual_Machines → virsh-devices   (disks, NICs, vCPU/memory)
//   Virtual_Machines → virt-images     (library, download, create, import)
//   Networking       → virt-net        (libvirt networks + forwarding)
//   Storage          → virsh-pools     (storage pools and volumes)
//   Host             → virsh-host      (host info and capabilities)
//
// Everything runs on the hypervisor host, and — unlike the bash TUI this came
// from — almost nothing runs under sudo. Membership of the `libvirt` group is
// what grants access: polkit's org.libvirt.unix.manage covers reads AND writes,
// so `virsh` reaches qemu:///system unprivileged. That is not a tidiness point,
// it is the whole design: a captured run gets a stdin pipe and never a TTY, so a
// sudo password prompt would hang forever, and dropping sudo is what lets every
// listing be `mode: "captured"` and render as a sortable table.
//
// What still needs root is kept on a terminal and marked `sudo: true`: writing
// into the root-owned images directory, and the iptables/sysctl actions.

import { Tool, Verify } from "../types";

// The virsh invocation, hoisted because most of the ~130 actions below carry it.
// VIRSH_BIN is configurable so a user outside the libvirt group can set it to
// "sudo virsh" (terminal actions only) or "sudo -n virsh" with a NOPASSWD rule.
const V = "{VIRSH_BIN} --connect {LIBVIRT_URI}";

// Probes, not `deps`, and specifically NOT `service: "libvirtd"`.
//
// libvirtd is deprecated in favour of the modular daemons (virtqemud,
// virtnetworkd, virtstoraged), which are SOCKET-ACTIVATED: libvirtd.service is
// commonly disabled and inactive while virtqemud.service also reports "inactive"
// because nothing has opened its socket yet — and virsh works perfectly.
// `systemctl is-active` therefore lies in both directions, and the badge's Start
// button would start a daemon the host has deliberately retired. Only a real
// virsh call proves reachability, and making that call is itself what activates
// the socket.
//
// `timeout 5 … </dev/null` is not optional: checkGates awaits every probe before
// posting a single badge, so one command that blocks (a `sudo virsh` askpass
// with no TTY) would leave the tool with NO badges rather than one red one.
const LIBVIRT_GATES: Verify[] = [
  {
    label: "virsh CLI",
    command: "timeout 5 {VIRSH_BIN} --version >/dev/null 2>&1 </dev/null",
    hint: "VIRSH_BIN is not runnable — set it in Config (virsh, or 'sudo -n virsh' if you are not in the libvirt group).",
  },
  {
    label: "hypervisor reachable",
    command: `timeout 5 ${V} version >/dev/null 2>&1 </dev/null`,
    hint: "libvirt did not answer on LIBVIRT_URI. Join the libvirt group with the badge beside this one and log out and back in — the modular daemons are socket-activated, so there is no service to start.",
  },
];

// The access notes every libvirt tool carries. The sudo warning is first because
// it is the one way a user can put themselves into a hang rather than an error.
const ACCESS_NOTES = [
  {
    label:
      "Join the libvirt group, then log out and back in — that is what grants unprivileged access to qemu:///system, for writes as well as reads",
    command: 'sudo usermod -aG libvirt "$USER"',
  },
  {
    label:
      "Do NOT set VIRSH_BIN to plain 'sudo virsh': listings are captured without a terminal, so a password prompt would hang until you press Stop. If you must use sudo, grant a passwordless rule and set VIRSH_BIN to 'sudo -n virsh'",
    command: 'echo "$USER ALL=(root) NOPASSWD: $(command -v virsh)" | sudo tee /etc/sudoers.d/virt-toolbox-virsh',
  },
  {
    label:
      "There is no libvirtd service to start on a modern host — virtqemud and friends are socket-activated and report 'inactive' until something connects, which is why the badges above probe virsh itself",
  },
];

export const tools: Tool[] = [
  // ── VM lifecycle, inspection and XML ────────────────────────────────────────
  {
    id: "virsh",
    label: "virsh — manage VMs",
    category: "Virtual_Machines",
    deps: ["virt-viewer"],
    verify: LIBVIRT_GATES,
    group: "libvirt",
    outputDir: "virsh",
    sections: [
      { id: "manage", label: "Manage" },
      { id: "inspect", label: "Inspect" },
      { id: "config", label: "XML & config" },
      { id: "delete", label: "Delete" },
    ],
    fields: [
      // Global: every tab addresses the same VM, and a field outside the active
      // tab resolves to "" — which would silently drop the target from `undefine`.
      { id: "vmName", type: "text", label: "VM name", placeholder: "pwnbox", help: "Copy the Name column from the list." },
      { id: "listAll", type: "check", label: "Include stopped", section: "manage", flag: "--all", default: "true" },
      {
        id: "listFilter",
        type: "select",
        label: "Show only",
        section: "manage",
        options: { "All states": "", Running: "--state-running", Paused: "--state-paused", "Shut off": "--state-shutoff", "With a snapshot": "--with-snapshot", Autostart: "--autostart" },
        default: "",
      },
      { id: "listTitle", type: "check", label: "Show title column", section: "manage", flag: "--title" },
      { id: "autostartOn", type: "segment", label: "Autostart", section: "manage", options: { Enable: "", Disable: "--disable" }, default: "" },
      { id: "saveFile", type: "file", label: "Saved state file", section: "manage", help: "Written by Save state, below." },
      {
        id: "statsGroup",
        type: "select",
        label: "Statistics",
        section: "inspect",
        options: { Everything: "", CPU: "--cpu-total", Memory: "--balloon", vCPU: "--vcpu", Block: "--block", Interface: "--interface", State: "--state" },
        default: "",
      },
      { id: "xmlFile", type: "file", label: "Domain XML file", section: "config" },
      { id: "newName", type: "text", label: "New name", section: "config", placeholder: "renamed-vm" },
      { id: "descTarget", type: "segment", label: "Set", section: "config", options: { Description: "", Title: "--title" }, default: "" },
      { id: "descText", type: "text", label: "Text", section: "config" },
      { id: "delManagedSave", type: "check", label: "Remove managed-save state", section: "delete", flag: "--managed-save", default: "true" },
      { id: "delSnapshots", type: "check", label: "Remove snapshot metadata", section: "delete", flag: "--snapshots-metadata" },
      { id: "delNvram", type: "check", label: "Remove NVRAM (UEFI vars)", section: "delete", flag: "--nvram" },
      {
        id: "delStorage",
        type: "check",
        label: "Also delete every disk",
        section: "delete",
        flag: "--remove-all-storage",
        help: "Deletes every volume in the domain XML that libvirt can resolve in a pool — including an installer ISO shared with other VMs. Irreversible, and there is no confirmation prompt.",
      },
      { id: "delConfirm", type: "text", label: "Type DELETE to arm disk deletion", section: "delete", placeholder: "DELETE" },
    ],
    actions: [
      { id: "list", label: "List VMs", mode: "captured", section: "manage", parse: "virsh.domains", command: `${V} list {listAll} {listFilter} {listTitle}` },
      { id: "start", label: "Start", mode: "captured", section: "manage", parse: "virsh.domains", command: `${V} start {vmName} && ${V} list --all` },
      { id: "shutdown", label: "Shutdown", mode: "captured", section: "manage", parse: "virsh.domains", command: `${V} shutdown {vmName} && ${V} list --all` },
      { id: "reboot", label: "Reboot", mode: "captured", section: "manage", parse: "virsh.domains", command: `${V} reboot {vmName} && ${V} list --all` },
      { id: "suspend", label: "Suspend", mode: "captured", section: "manage", parse: "virsh.domains", command: `${V} suspend {vmName} && ${V} list --all` },
      { id: "resume", label: "Resume", mode: "captured", section: "manage", parse: "virsh.domains", command: `${V} resume {vmName} && ${V} list --all` },
      { id: "reset", label: "Force reset", mode: "captured", section: "manage", parse: "virsh.domains", command: `${V} reset {vmName} && ${V} list --all` },
      { id: "destroy", label: "Force stop (destroy)", mode: "captured", section: "manage", parse: "virsh.domains", command: `${V} destroy {vmName} && ${V} list --all` },
      { id: "autostart", label: "Set autostart", mode: "captured", section: "manage", parse: "virsh.info", command: `${V} autostart {autostartOn} {vmName} && ${V} dominfo {vmName}` },
      // Terminal: dumping a VM's RAM to disk takes minutes and prints nothing.
      { id: "save", label: "Save state → file", mode: "terminal", section: "manage", command: `${V} save {vmName} '{out}'`, output: "{timestamp}_{vmName}.save" },
      { id: "restore", label: "Restore from a saved state", mode: "terminal", section: "manage", command: `${V} restore {saveFile}` },
      { id: "managedsave", label: "Managed save", mode: "terminal", section: "manage", command: `${V} managedsave {vmName}` },
      { id: "managedsave-remove", label: "Drop managed save", mode: "captured", section: "manage", parse: "virsh.domains", command: `${V} managedsave-remove {vmName} && ${V} list --all --managed-save` },
      // Terminal: a real TTY, and Ctrl+] to escape.
      { id: "console", label: "Open serial console", mode: "terminal", section: "manage", command: `${V} console {vmName}` },
      // No sudo: a GUI under root has no XAUTHORITY/WAYLAND_DISPLAY for the
      // user's session, so `sudo virt-viewer` silently fails to appear.
      { id: "viewer", label: "Open graphical viewer", mode: "terminal", section: "manage", command: "virt-viewer --connect {LIBVIRT_URI} {vmName}" },
      { id: "info", label: "VM info", mode: "captured", section: "inspect", parse: "virsh.info", command: `${V} dominfo {vmName}` },
      { id: "state", label: "State & reason", mode: "captured", section: "inspect", command: `${V} domstate --reason {vmName}` },
      // With no VM name the optional group drops and domstats covers every domain.
      { id: "stats", label: "Statistics", mode: "captured", section: "inspect", parse: "virsh.domstats", command: `${V} domstats {statsGroup} [[{vmName}]]` },
      { id: "display", label: "Display connection URI", mode: "captured", section: "inspect", command: `${V} domdisplay --all {vmName}` },
      { id: "guestinfo", label: "Guest agent info", mode: "captured", section: "inspect", command: `${V} guestinfo {vmName}` },
      { id: "dumpxml", label: "Dump XML → file", mode: "captured", section: "inspect", command: `${V} dumpxml {vmName} | tee '{out}'`, output: "{timestamp}_{vmName}_domain.xml" },
      { id: "dumpxml-inactive", label: "Dump persistent XML → file", mode: "captured", section: "config", command: `${V} dumpxml --inactive {vmName} | tee '{out}'`, output: "{timestamp}_{vmName}_inactive.xml" },
      // Terminal: spawns $VISUAL/$EDITOR, which needs a TTY.
      { id: "edit", label: "Edit XML in an editor", mode: "terminal", section: "config", command: `${V} edit {vmName}` },
      { id: "define", label: "Define from XML file", mode: "captured", section: "config", parse: "virsh.domains", command: `${V} define {xmlFile} && ${V} list --all` },
      { id: "create-transient", label: "Create transient VM from XML", mode: "captured", section: "config", parse: "virsh.domains", command: `${V} create {xmlFile} && ${V} list --all` },
      { id: "rename", label: "Rename", mode: "captured", section: "config", parse: "virsh.domains", command: `${V} domrename {vmName} {newName} && ${V} list --all` },
      { id: "desc", label: "Set title / description", mode: "captured", section: "config", parse: "virsh.info", command: `${V} desc {vmName} {descTarget} --config --new-desc "{descText}" && ${V} dominfo {vmName}` },
      // Deliberately does NOT reference {delStorage}, so ticking that box cannot
      // leak into the safe variant.
      { id: "undefine", label: "Delete VM (keeps its disks)", mode: "captured", section: "delete", parse: "virsh.domains", command: `${V} destroy {vmName} 2>/dev/null ; ${V} undefine {delManagedSave} {delSnapshots} {delNvram} {vmName} && ${V} list --all` },
      // The nearest thing to a confirmation this codebase can offer: terminal
      // mode is not one (runInTerminal sendTexts immediately) and captured mode
      // cannot prompt at all, so the action only EXISTS once the box is ticked
      // and the word DELETE is typed.
      {
        id: "undefine-storage",
        label: "Delete VM AND every disk (irreversible)",
        mode: "captured",
        section: "delete",
        parse: "virsh.domains",
        when: { all: [{ field: "delStorage", truthy: true }, { field: "delConfirm", equals: "DELETE" }] },
        command: `${V} destroy {vmName} 2>/dev/null ; ${V} undefine {delManagedSave} {delSnapshots} {delNvram} {delStorage} {vmName} && ${V} list --all`,
      },
    ],
    notesTitle: "Access",
    notes: [
      ...ACCESS_NOTES,
      { label: "`virsh console` needs a serial console in the guest (the Create action configures one) — press Ctrl+] to detach" },
      { label: "`virsh edit` opens $VISUAL or $EDITOR, defaulting to vi, and validates the XML before defining it" },
    ],
  },

  // ── snapshots ───────────────────────────────────────────────────────────────
  {
    id: "virsh-snapshots",
    label: "VM snapshots",
    category: "Virtual_Machines",
    verify: LIBVIRT_GATES,
    group: "libvirt",
    outputDir: "virsh",
    sections: [
      { id: "browse", label: "Browse" },
      { id: "create", label: "Create" },
      { id: "manage", label: "Revert & delete" },
    ],
    fields: [
      // Both global. Scoping snapName would blank it on two of three tabs, and
      // `snapshot-revert <domain> [<snapshotname>]` takes the name OPTIONALLY —
      // so a blank one changes what the command means rather than failing loudly.
      { id: "vmName", type: "text", label: "VM name", placeholder: "kali" },
      { id: "snapName", type: "text", label: "Snapshot name", placeholder: "Post-Install" },
      { id: "snapParent", type: "check", label: "Show parent column", section: "browse", flag: "--parent", default: "true" },
      { id: "snapFilter", type: "select", label: "Show only", section: "browse", options: { All: "", Roots: "--roots", Leaves: "--leaves", External: "--external", Internal: "--internal" }, default: "" },
      { id: "snapDesc", type: "text", label: "Description", section: "create" },
      { id: "snapDiskOnly", type: "check", label: "Disk only (no RAM state)", section: "create", flag: "--disk-only" },
      { id: "snapQuiesce", type: "check", label: "Quiesce guest filesystems", section: "create", flag: "--quiesce", help: "Needs qemu-guest-agent running inside the guest." },
      { id: "snapAtomic", type: "check", label: "Atomic", section: "create", flag: "--atomic" },
      { id: "snapHalt", type: "check", label: "Halt the VM afterwards", section: "create", flag: "--halt" },
      { id: "snapLive", type: "check", label: "Live (do not pause)", section: "create", flag: "--live" },
      { id: "snapNoMeta", type: "check", label: "No libvirt metadata", section: "create", flag: "--no-metadata" },
      { id: "revertState", type: "segment", label: "After reverting", section: "manage", options: { "Leave as-is": "", Running: "--running", Paused: "--paused" }, default: "" },
      { id: "revertForce", type: "check", label: "Force (risky reverts)", section: "manage", flag: "--force" },
      { id: "delScope", type: "segment", label: "Delete", section: "manage", options: { "Just this snapshot": "", "…and its children": "--children", "Children only": "--children-only", "Metadata only": "--metadata" }, default: "" },
    ],
    actions: [
      { id: "list", label: "List snapshots", mode: "captured", section: "browse", parse: "virsh.snapshots", command: `${V} snapshot-list {vmName} {snapParent} {snapFilter}` },
      // --tree prints no dashed rule, so there is no table to parse.
      { id: "tree", label: "Snapshot tree", mode: "captured", section: "browse", command: `${V} snapshot-list {vmName} --tree` },
      { id: "info", label: "Snapshot info", mode: "captured", section: "browse", parse: "virsh.info", command: `${V} snapshot-info {vmName} '{snapName}'` },
      { id: "current", label: "Current snapshot", mode: "captured", section: "browse", command: `${V} snapshot-current --name {vmName}` },
      { id: "parent", label: "Parent snapshot", mode: "captured", section: "browse", command: `${V} snapshot-parent {vmName} '{snapName}'` },
      { id: "xml", label: "Dump snapshot XML → file", mode: "captured", section: "browse", command: `${V} snapshot-dumpxml {vmName} '{snapName}' | tee '{out}'`, output: "{timestamp}_{vmName}_{snapName}.xml" },
      { id: "with-snapshots", label: "VMs that have snapshots", mode: "captured", section: "browse", parse: "virsh.domains", command: `${V} list --all --with-snapshot` },
      // The description sits in an optional group so an empty one drops the flag
      // rather than storing a blank description.
      {
        id: "create",
        label: "Create snapshot",
        mode: "captured",
        section: "create",
        parse: "virsh.snapshots",
        command: `${V} snapshot-create-as {vmName} --name '{snapName}' [[--description "{snapDesc}"]] {snapDiskOnly} {snapQuiesce} {snapAtomic} {snapHalt} {snapLive} {snapNoMeta} && ${V} snapshot-list {vmName} --parent`,
      },
      { id: "revert", label: "Revert to snapshot", mode: "captured", section: "manage", parse: "virsh.snapshots", command: `${V} snapshot-revert {vmName} '{snapName}' {revertState} {revertForce} && ${V} snapshot-list {vmName} --parent` },
      { id: "delete", label: "Delete snapshot", mode: "captured", section: "manage", parse: "virsh.snapshots", command: `${V} snapshot-delete {vmName} '{snapName}' {delScope} && ${V} snapshot-list {vmName} --parent` },
      { id: "set-current", label: "Mark as current", mode: "captured", section: "manage", command: `${V} snapshot-current {vmName} '{snapName}' && ${V} snapshot-current --name {vmName}` },
      { id: "edit", label: "Edit snapshot XML", mode: "terminal", section: "manage", command: `${V} snapshot-edit {vmName} '{snapName}'` },
    ],
    notesTitle: "Access",
    notes: [
      ...ACCESS_NOTES,
      { label: "An internal snapshot of a running VM includes its RAM and can be slow; --disk-only is the fast, crash-consistent alternative" },
    ],
  },

  // ── VM hardware ─────────────────────────────────────────────────────────────
  {
    id: "virsh-devices",
    label: "VM hardware & devices",
    category: "Virtual_Machines",
    verify: LIBVIRT_GATES,
    group: "libvirt",
    outputDir: "virsh",
    sections: [
      { id: "overview", label: "Overview" },
      { id: "disks", label: "Disks" },
      { id: "nics", label: "Network" },
      { id: "resources", label: "CPU & memory" },
    ],
    fields: [
      { id: "vmName", type: "text", label: "VM name", placeholder: "kali" },
      {
        id: "applyTo",
        type: "segment",
        label: "Apply to",
        options: { "Next boot (config)": "--config", "Running VM (live)": "--live", "Live and persist": "--live --config", Current: "--current" },
        default: "--config",
        help: "A --config change only lands in the persistent XML, which is why the listing refreshed after each change below uses --inactive.",
      },
      { id: "blkInactive", type: "check", label: "Show next-boot config", section: "overview", flag: "--inactive", default: "true" },
      { id: "ifaddrSource", type: "select", label: "Address source", section: "overview", options: ["lease", "agent", "arp"], default: "lease" },
      { id: "dTarget", type: "text", label: "Target device", section: "disks", default: "vdb" },
      { id: "dSource", type: "file", label: "Disk image / ISO", section: "disks", rootConfig: "IMAGES_DIR" },
      { id: "dBus", type: "select", label: "Bus", section: "disks", options: ["virtio", "sata", "scsi", "ide", "usb"], default: "virtio" },
      { id: "dType", type: "select", label: "Device type", section: "disks", options: { Disk: "disk", "CD-ROM": "cdrom" }, default: "disk" },
      { id: "dFormat", type: "select", label: "Format", section: "disks", options: ["qcow2", "raw"], default: "qcow2" },
      { id: "dCache", type: "select", label: "Cache mode", section: "disks", options: ["writeback", "none", "writethrough", "directsync", "unsafe"], default: "writeback" },
      { id: "dReadonly", type: "check", label: "Read-only", section: "disks", flag: "--mode readonly" },
      { id: "dNewSize", type: "text", label: "Resize to", section: "disks", placeholder: "80G" },
      { id: "nType", type: "select", label: "Interface type", section: "nics", options: { "Virtual network": "network", "Host bridge": "bridge", Direct: "direct" }, default: "network" },
      {
        id: "nSource",
        type: "text",
        label: "Source",
        section: "nics",
        default: "default",
        help: "A libvirt NETWORK name for type=network (e.g. default), or a BRIDGE device for type=bridge (e.g. virbr0). These are not interchangeable.",
      },
      { id: "nModel", type: "select", label: "Model", section: "nics", options: ["virtio", "e1000e", "rtl8139"], default: "virtio" },
      { id: "nMac", type: "text", label: "MAC address", section: "nics", placeholder: "52:54:00:aa:bb:cc" },
      { id: "nLink", type: "segment", label: "Link state", section: "nics", options: { Up: "up", Down: "down" }, default: "up" },
      { id: "rVcpus", type: "text", label: "vCPUs", section: "resources", placeholder: "4" },
      { id: "rMaxVcpus", type: "text", label: "Maximum vCPUs", section: "resources", placeholder: "8" },
      { id: "rMem", type: "text", label: "Memory", section: "resources", placeholder: "8G" },
      { id: "rMaxMem", type: "text", label: "Maximum memory", section: "resources", placeholder: "16G" },
    ],
    actions: [
      { id: "blocks", label: "Block devices", mode: "captured", section: "overview", parse: "virsh.blocks", command: `${V} domblklist {vmName} --details {blkInactive}` },
      { id: "ifaces", label: "Network interfaces", mode: "captured", section: "overview", parse: "virsh.ifaces", command: `${V} domiflist {vmName} {blkInactive}` },
      { id: "ifaddr", label: "Interface addresses", mode: "captured", section: "overview", parse: "virsh.ifaces", command: `${V} domifaddr {vmName} --source {ifaddrSource}` },
      { id: "fsinfo", label: "Guest filesystems", mode: "captured", section: "overview", parse: "virsh.table", command: `${V} domfsinfo {vmName}` },
      { id: "xml", label: "Dump XML → file", mode: "captured", section: "overview", command: `${V} dumpxml {vmName} | tee '{out}'`, output: "{timestamp}_{vmName}_domain.xml" },
      { id: "attach", label: "Attach disk", mode: "captured", section: "disks", parse: "virsh.blocks", command: `${V} attach-disk {vmName} {dSource} {dTarget} --targetbus {dBus} --type {dType} --subdriver {dFormat} --cache {dCache} {dReadonly} {applyTo} && ${V} domblklist {vmName} --details --inactive` },
      { id: "detach", label: "Detach disk", mode: "captured", section: "disks", parse: "virsh.blocks", command: `${V} detach-disk {vmName} {dTarget} {applyTo} && ${V} domblklist {vmName} --details --inactive` },
      { id: "change-media", label: "Change CD-ROM media", mode: "captured", section: "disks", parse: "virsh.blocks", command: `${V} change-media {vmName} {dTarget} {dSource} --update {applyTo} && ${V} domblklist {vmName} --details --inactive` },
      { id: "blkinfo", label: "Disk size info", mode: "captured", section: "disks", parse: "virsh.info", command: `${V} domblkinfo {vmName} {dTarget}` },
      { id: "blkresize", label: "Resize the guest's view of a disk", mode: "captured", section: "disks", command: `${V} blockresize {vmName} {dTarget} {dNewSize}` },
      { id: "blkstat", label: "Disk I/O statistics", mode: "captured", section: "disks", command: `${V} domblkstat {vmName} {dTarget}` },
      { id: "nic-attach", label: "Attach interface", mode: "captured", section: "nics", parse: "virsh.ifaces", command: `${V} attach-interface {vmName} {nType} {nSource} --model {nModel} [[--mac {nMac}]] {applyTo} && ${V} domiflist {vmName} --inactive` },
      { id: "nic-detach", label: "Detach interface", mode: "captured", section: "nics", parse: "virsh.ifaces", command: `${V} detach-interface {vmName} {nType} [[--mac {nMac}]] {applyTo} && ${V} domiflist {vmName} --inactive` },
      { id: "nic-link", label: "Set link state", mode: "captured", section: "nics", command: `${V} domif-setlink {vmName} {nMac} {nLink} --config && ${V} domif-getlink {vmName} {nMac} --config` },
      { id: "nic-stat", label: "Interface statistics", mode: "captured", section: "nics", command: `${V} domifstat {vmName} {nMac}` },
      { id: "vcpucount", label: "vCPU counts", mode: "captured", section: "resources", command: `${V} vcpucount {vmName}` },
      { id: "setvcpus", label: "Set vCPUs", mode: "captured", section: "resources", parse: "virsh.info", command: `${V} setvcpus {vmName} {rVcpus} {applyTo} && ${V} dominfo {vmName}` },
      { id: "setmaxvcpus", label: "Set maximum vCPUs", mode: "captured", section: "resources", parse: "virsh.info", command: `${V} setvcpus {vmName} {rMaxVcpus} --maximum --config && ${V} dominfo {vmName}` },
      { id: "setmem", label: "Set memory", mode: "captured", section: "resources", parse: "virsh.info", command: `${V} setmem {vmName} {rMem} {applyTo} && ${V} dominfo {vmName}` },
      { id: "setmaxmem", label: "Set maximum memory", mode: "captured", section: "resources", parse: "virsh.info", command: `${V} setmaxmem {vmName} {rMaxMem} --config && ${V} dominfo {vmName}` },
      { id: "memstat", label: "Guest memory statistics", mode: "captured", section: "resources", command: `${V} dommemstat {vmName}` },
      { id: "cpustats", label: "Guest CPU statistics", mode: "captured", section: "resources", command: `${V} cpu-stats {vmName} --total` },
      // Deliberately unparsed: vcpuinfo prints "CPU time  N/A" with no colon,
      // which the key/value parser would silently drop.
      { id: "vcpuinfo", label: "Per-vCPU detail", mode: "captured", section: "resources", command: `${V} vcpuinfo {vmName}` },
    ],
    notesTitle: "Access",
    notes: [
      ...ACCESS_NOTES,
      { label: "Live attach/detach and the guest statistics need a RUNNING domain; on a stopped VM they report an error and no table" },
      { label: "Guest filesystems and the 'agent' address source additionally need qemu-guest-agent inside the guest" },
    ],
  },

  // ── images, downloads and VM creation ───────────────────────────────────────
  {
    id: "virt-images",
    label: "Images & VM creation",
    category: "Virtual_Machines",
    deps: ["wget"],
    verify: [
      ...LIBVIRT_GATES,
      {
        label: "virt-install",
        command: "timeout 5 {VIRT_INSTALL_BIN} --version >/dev/null 2>&1 </dev/null",
        hint: "VIRT_INSTALL_BIN is not runnable — install virt-install (virt-manager on Debian), or set it in Config.",
      },
    ],
    group: "libvirt",
    outputDir: "virsh",
    sections: [
      { id: "library", label: "Library" },
      { id: "download", label: "Download" },
      { id: "create", label: "Create from ISO" },
      { id: "import", label: "Import disk" },
    ],
    fields: [
      // Global: the Library tab lists it and the Download tab rescans it.
      { id: "poolName", type: "text", label: "Storage pool", default: "default", help: "`default` on Debian/Ubuntu, often `images` on Fedora — check the Library tab." },
      {
        id: "dlPreset",
        type: "select",
        label: "Image",
        section: "download",
        help: "Pick a known image, or Custom URL to type your own.",
        options: {
          "Parrot Security (ISO)": "https://deb.parrot.sh/parrot/iso/6.4/Parrot-security-6.4_amd64.iso",
          "Parrot HTB (ISO)": "https://deb.parrot.sh/parrot/iso/6.4/Parrot-htb-6.4_amd64.iso",
          "Kali Linux (ISO)": "https://cdimage.kali.org/kali-2025.3/kali-linux-2025.3-installer-amd64.iso",
          "Kali Linux (qcow2, 7z)": "https://mirror.quantum5.ca/kali-images/kali-2025.2/kali-linux-2025.2-qemu-amd64.7z",
          "VirtIO drivers for Windows (ISO)": "https://fedorapeople.org/groups/virt/virtio-win/direct-downloads/stable-virtio/virtio-win.iso",
          "Custom URL…": "",
        },
        default: "https://deb.parrot.sh/parrot/iso/6.4/Parrot-security-6.4_amd64.iso",
      },
      { id: "dlUrl", type: "text", label: "Custom image URL", section: "download", placeholder: "https://example.com/image.iso", when: { field: "dlPreset", equals: "" }, help: "Used when the preset above is Custom URL." },
      { id: "dlIfPresent", type: "select", label: "If it is already downloaded", section: "download", options: { "Download only if newer": "-N", "Keep the existing file": "-nc", "Delete and re-download": '-O "$(basename {dlPreset}{dlUrl})"' }, default: "-N" },
      { id: "cVmName", type: "text", label: "VM name", section: "create", default: "pwnbox" },
      { id: "cIso", type: "file", label: "Installer ISO", section: "create", fileKind: "file", rootConfig: "IMAGES_DIR", help: "The installer image to boot from." },
      { id: "cOsVariant", type: "select", label: "OS variant", section: "create", options: ["debian12", "debian11", "ubuntu22.04", "win11", "win10", "generic"], default: "debian12" },
      { id: "cVcpus", type: "text", label: "vCPUs", section: "create", default: "8" },
      { id: "cRam", type: "text", label: "RAM (MB)", section: "create", default: "16384" },
      { id: "cDiskPath", type: "text", label: "Disk path (created)", section: "create", default: "{IMAGES_DIR}/{cVmName}.qcow2" },
      { id: "cDiskSize", type: "text", label: "Disk size (GB)", section: "create", default: "64" },
      { id: "cNetKind", type: "segment", label: "Attach to", section: "create", options: { "Host bridge": "bridge", "libvirt network": "network" }, default: "bridge" },
      { id: "cNet", type: "text", label: "Bridge / network name", section: "create", default: "{DEFAULT_NET}" },
      {
        id: "cGraphics",
        type: "select",
        label: "Graphical console",
        section: "create",
        options: {
          "SPICE (this machine only)": "spice,listen=127.0.0.1",
          "SPICE (all interfaces)": "spice,listen=0.0.0.0",
          "VNC (this machine only)": "vnc,listen=127.0.0.1",
          None: "none",
        },
        default: "spice,listen=127.0.0.1",
        help: "Listening on all interfaces exposes an unauthenticated console to everyone who can reach this host.",
      },
      { id: "cVirtioIso", type: "text", label: "VirtIO drivers ISO (Windows)", section: "create", default: "{IMAGES_DIR}/virtio-win.iso", when: { field: "cOsVariant", in: ["win11", "win10"] }, help: "Attached as a second CD so Windows setup can load the storage driver." },
      { id: "iVmName", type: "text", label: "VM name", section: "import", default: "pwnbox" },
      { id: "iDisk", type: "file", label: "Disk image (qcow2)", section: "import", fileKind: "file", rootConfig: "IMAGES_DIR", help: "An existing disk to boot as-is." },
      { id: "iOsVariant", type: "select", label: "OS variant", section: "import", options: ["debian12", "debian11", "ubuntu22.04", "win11", "win10", "generic"], default: "debian12" },
      { id: "iVcpus", type: "text", label: "vCPUs", section: "import", default: "6" },
      { id: "iRam", type: "text", label: "RAM (MB)", section: "import", default: "8192" },
      { id: "iNetKind", type: "segment", label: "Attach to", section: "import", options: { "Host bridge": "bridge", "libvirt network": "network" }, default: "bridge" },
      { id: "iNet", type: "text", label: "Bridge / network name", section: "import", default: "{DEFAULT_NET}" },
      {
        id: "iGraphics",
        type: "select",
        label: "Graphical console",
        section: "import",
        options: {
          "SPICE (this machine only)": "spice,listen=127.0.0.1",
          "SPICE (all interfaces)": "spice,listen=0.0.0.0",
          "VNC (this machine only)": "vnc,listen=127.0.0.1",
          None: "none",
        },
        default: "spice,listen=127.0.0.1",
      },
    ],
    actions: [
      // The images directory is typically drwx--x--x root:root, so `ls` fails for
      // an unprivileged user: --x permits traversal but not listing. Reading the
      // pool through libvirt's storage API is the only unprivileged way to see
      // what is actually in there.
      { id: "volumes", label: "Images in the pool", mode: "captured", section: "library", parse: "virsh.volumes", command: `${V} vol-list {poolName} --details` },
      { id: "pools", label: "Storage pools", mode: "captured", section: "library", parse: "virsh.pools", command: `${V} pool-list --all --details` },
      { id: "vms", label: "Existing VMs", mode: "captured", section: "library", parse: "virsh.domains", command: `${V} list --all` },
      { id: "refresh", label: "Rescan the pool", mode: "captured", section: "library", parse: "virsh.volumes", command: `${V} pool-refresh {poolName} && ${V} vol-list {poolName} --details` },
      // Keeps sudo: the target directory is root-owned, so wget/7z/rm/chmod all
      // need root there. The trailing pool-refresh makes the new file show up in
      // the Library tab without a manual rescan.
      {
        id: "download",
        label: "Download & place in images dir",
        mode: "terminal",
        sudo: true,
        section: "download",
        command:
          'cd {IMAGES_DIR} && sudo wget {dlIfPresent} {dlPreset}{dlUrl} && f=$(basename {dlPreset}{dlUrl}) && case "$f" in *.7z) sudo 7z x -y "$f" && sudo rm -f "$f" ;; *.zip) sudo unzip -o "$f" && sudo rm -f "$f" ;; *.tar.*) sudo tar xf "$f" && sudo rm -f "$f" ;; esac ; sudo chmod 644 {IMAGES_DIR}/*.qcow2 {IMAGES_DIR}/*.iso 2>/dev/null ; ' +
          `${V} pool-refresh {poolName} ; ${V} vol-list {poolName} --details`,
      },
      {
        id: "create",
        label: "Create VM from ISO",
        mode: "terminal",
        section: "create",
        command:
          "{VIRT_INSTALL_BIN} --connect {LIBVIRT_URI} --os-variant {cOsVariant} --name {cVmName} --ram {cRam} --vcpus {cVcpus} --cpu host --cdrom {cIso} --disk path={cDiskPath},size={cDiskSize},bus=virtio,cache=writeback,format=qcow2 --network {cNetKind}={cNet},model=virtio --graphics {cGraphics} --video qxl --channel spicevmc,target_type=virtio,name=com.redhat.spice.0 --console pty,target_type=serial [[--disk path={cVirtioIso},device=cdrom]]",
      },
      // A dry run: assembles and prints the domain XML without defining anything.
      {
        id: "create-preview",
        label: "Preview the XML (dry run)",
        mode: "captured",
        section: "create",
        command:
          "{VIRT_INSTALL_BIN} --connect {LIBVIRT_URI} --os-variant {cOsVariant} --name {cVmName} --ram {cRam} --vcpus {cVcpus} --cpu host --cdrom {cIso} --disk path={cDiskPath},size={cDiskSize},bus=virtio,cache=writeback,format=qcow2 --network {cNetKind}={cNet},model=virtio --graphics {cGraphics} --video qxl --channel spicevmc,target_type=virtio,name=com.redhat.spice.0 --console pty,target_type=serial [[--disk path={cVirtioIso},device=cdrom]] --print-xml | tee '{out}'",
        output: "{timestamp}_{cVmName}_preview.xml",
      },
      {
        id: "import",
        label: "Import VM from disk",
        mode: "terminal",
        section: "import",
        command:
          "{VIRT_INSTALL_BIN} --connect {LIBVIRT_URI} --os-variant {iOsVariant} --name {iVmName} --ram {iRam} --vcpus {iVcpus} --cpu host --disk path={iDisk},bus=virtio,cache=writeback --network {iNetKind}={iNet},model=virtio --graphics {iGraphics} --video qxl --channel spicevmc,target_type=virtio,name=com.redhat.spice.0 --console pty,target_type=serial --import",
      },
      {
        id: "import-preview",
        label: "Preview the XML (dry run)",
        mode: "captured",
        section: "import",
        command:
          "{VIRT_INSTALL_BIN} --connect {LIBVIRT_URI} --os-variant {iOsVariant} --name {iVmName} --ram {iRam} --vcpus {iVcpus} --cpu host --disk path={iDisk},bus=virtio,cache=writeback --network {iNetKind}={iNet},model=virtio --graphics {iGraphics} --video qxl --channel spicevmc,target_type=virtio,name=com.redhat.spice.0 --console pty,target_type=serial --import --print-xml | tee '{out}'",
        output: "{timestamp}_{iVmName}_preview.xml",
      },
    ],
    notesTitle: "Windows guests",
    notes: [
      { label: "Download the Windows 11 ISO manually from Microsoft, then move it into the images directory", when: { field: "cOsVariant", in: ["win11", "win10"] }, command: "sudo mv ~/Downloads/Win*.iso {IMAGES_DIR}/" },
      { label: "Windows needs the VirtIO storage driver at install time — fetch the driver ISO first", when: { field: "cOsVariant", in: ["win11", "win10"] }, command: "sudo wget -N -P {IMAGES_DIR} https://fedorapeople.org/groups/virt/virtio-win/direct-downloads/stable-virtio/virtio-win.iso" },
      { label: "Install the SPICE guest tools inside the guest for a usable console", when: { field: "cOsVariant", in: ["win11", "win10"] }, command: "sudo dnf install spice-gtk-tools" },
      { label: "Windows Build Tools are worth installing in the guest if you plan to compile there", when: { field: "cOsVariant", in: ["win11", "win10"] } },
      { label: "Downloading keeps sudo because the images directory is owned by root — everything else on this tool runs unprivileged through libvirt" },
    ],
  },

  // ── libvirt networks + forwarding ───────────────────────────────────────────
  {
    id: "virt-net",
    label: "virsh networks",
    category: "Networking",
    deps: ["iptables"],
    verify: LIBVIRT_GATES,
    group: "libvirt",
    outputDir: "virsh",
    sections: [
      { id: "manage", label: "Manage" },
      { id: "create", label: "Create" },
      { id: "ports", label: "Ports" },
      { id: "forwarding", label: "IP forwarding" },
    ],
    fields: [
      { id: "netName", type: "text", label: "Network", default: "default" },
      { id: "netAll", type: "check", label: "Include inactive", section: "manage", flag: "--all", default: "true" },
      { id: "netAutostart", type: "segment", label: "Autostart", section: "manage", options: { Enable: "", Disable: "--disable" }, default: "" },
      { id: "cnetType", type: "select", label: "Network type", section: "create", options: { NAT: "nat", "Host-only": "host", Isolated: "isolated" }, default: "nat" },
      { id: "cnetName", type: "text", label: "Network name", section: "create", default: "nat" },
      { id: "cnetBridge", type: "text", label: "Bridge device", section: "create", default: "virbr-{cnetName}" },
      { id: "cnetIp", type: "text", label: "Router IP", section: "create", default: "172.16.1.1" },
      { id: "cnetMask", type: "text", label: "Subnet mask", section: "create", default: "255.255.255.0" },
      { id: "cnetDhcpStart", type: "text", label: "DHCP start", section: "create", default: "172.16.1.10" },
      { id: "cnetDhcpEnd", type: "text", label: "DHCP end", section: "create", default: "172.16.1.100" },
      { id: "portUuid", type: "text", label: "Port UUID", section: "ports" },
      { id: "fwBridge", type: "text", label: "Bridge device", section: "forwarding", default: "virbr0", help: "The bridge itself, not the network name — `default` uses virbr0." },
    ],
    actions: [
      { id: "net-list", label: "List networks", mode: "captured", section: "manage", parse: "virsh.networks", command: `${V} net-list {netAll}` },
      { id: "net-info", label: "Network info", mode: "captured", section: "manage", parse: "virsh.info", command: `${V} net-info {netName}` },
      { id: "net-start", label: "Start network", mode: "captured", section: "manage", parse: "virsh.networks", command: `${V} net-start {netName} && ${V} net-list --all` },
      { id: "net-stop", label: "Stop network", mode: "captured", section: "manage", parse: "virsh.networks", command: `${V} net-destroy {netName} && ${V} net-list --all` },
      { id: "net-autostart", label: "Set autostart", mode: "captured", section: "manage", parse: "virsh.networks", command: `${V} net-autostart {netAutostart} {netName} && ${V} net-list --all` },
      { id: "net-undefine", label: "Stop & undefine network", mode: "captured", section: "manage", parse: "virsh.networks", command: `${V} net-destroy {netName} 2>/dev/null ; ${V} net-undefine {netName} && ${V} net-list --all` },
      { id: "net-leases", label: "DHCP leases", mode: "captured", section: "manage", parse: "virsh.leases", command: `${V} net-dhcp-leases {netName}` },
      { id: "net-xml", label: "Dump network XML → file", mode: "captured", section: "manage", command: `${V} net-dumpxml {netName} | tee '{out}'`, output: "{timestamp}_{netName}_network.xml" },
      { id: "net-edit", label: "Edit network XML", mode: "terminal", section: "manage", command: `${V} net-edit {netName}` },
      // Replaces `ip addr show | grep virbr`, which missed every bridge not named virbr*.
      { id: "net-ifaces", label: "List host bridges", mode: "captured", section: "manage", command: "ip -br addr show type bridge" },
      {
        id: "create-nat",
        label: "Create NAT network",
        mode: "captured",
        section: "create",
        parse: "virsh.networks",
        when: { field: "cnetType", equals: "nat" },
        command: `echo "<network><name>{cnetName}</name><forward mode='nat'/><bridge name='{cnetBridge}'/><ip address='{cnetIp}' netmask='{cnetMask}'><dhcp><range start='{cnetDhcpStart}' end='{cnetDhcpEnd}'/></dhcp></ip></network>" | ${V} net-define /dev/stdin && ${V} net-autostart {cnetName} && ${V} net-start {cnetName} && ${V} net-list --all`,
      },
      {
        id: "create-host",
        label: "Create host-only network",
        mode: "captured",
        section: "create",
        parse: "virsh.networks",
        when: { field: "cnetType", equals: "host" },
        command: `echo "<network><name>{cnetName}</name><bridge name='{cnetBridge}' stp='on' delay='0'/><ip address='{cnetIp}' netmask='{cnetMask}'><dhcp><range start='{cnetDhcpStart}' end='{cnetDhcpEnd}'/></dhcp></ip></network>" | ${V} net-define /dev/stdin && ${V} net-autostart {cnetName} && ${V} net-start {cnetName} && ${V} net-list --all`,
      },
      {
        id: "create-isolated",
        label: "Create isolated network",
        mode: "captured",
        section: "create",
        parse: "virsh.networks",
        when: { field: "cnetType", equals: "isolated" },
        command: `echo "<network><name>{cnetName}</name><bridge name='{cnetBridge}' stp='on' delay='0'/><ip address='{cnetIp}' netmask='{cnetMask}'><dhcp><range start='{cnetDhcpStart}' end='{cnetDhcpEnd}'/></dhcp></ip></network>" | ${V} net-define /dev/stdin && ${V} net-autostart {cnetName} && ${V} net-start {cnetName} && ${V} net-list --all`,
      },
      { id: "port-list", label: "Network ports", mode: "captured", section: "ports", parse: "virsh.table", command: `${V} net-port-list {netName}` },
      { id: "port-xml", label: "Port XML → file", mode: "captured", section: "ports", command: `${V} net-port-dumpxml {netName} {portUuid} | tee '{out}'`, output: "{timestamp}_{netName}_port.xml" },
      // Unprivileged reads that answer the same questions the iptables actions do.
      { id: "ipfwd-show", label: "Kernel IP forwarding", mode: "captured", section: "forwarding", command: "sysctl net.ipv4.ip_forward net.ipv6.conf.all.forwarding" },
      { id: "routes", label: "Routing table", mode: "captured", section: "forwarding", command: "ip route show" },
      // These genuinely need root: iptables needs CAP_NET_ADMIN even to list, and
      // sysctl -w writes /proc/sys. So they stay on a terminal, where sudo works.
      { id: "ipfwd-enable", label: "Enable kernel IP forwarding", mode: "terminal", sudo: true, section: "forwarding", command: "sudo sysctl -w net.ipv4.ip_forward=1" },
      { id: "fwd-status", label: "Show FORWARD rules", mode: "terminal", sudo: true, section: "forwarding", command: "sudo iptables -L FORWARD -n -v --line-numbers" },
      { id: "fwd-enable", label: "Accept traffic on this bridge", mode: "terminal", sudo: true, section: "forwarding", command: "sudo iptables -I FORWARD -i {fwBridge} -j ACCEPT && sudo iptables -I FORWARD -o {fwBridge} -j ACCEPT && sudo iptables -L FORWARD -n --line-numbers | grep {fwBridge}" },
      { id: "fwd-disable", label: "Remove those rules", mode: "terminal", sudo: true, section: "forwarding", command: "sudo iptables -D FORWARD -i {fwBridge} -j ACCEPT ; sudo iptables -D FORWARD -o {fwBridge} -j ACCEPT ; sudo iptables -L FORWARD -n --line-numbers | grep {fwBridge} || echo 'no forwarding rules for {fwBridge}'" },
    ],
    notesTitle: "Access",
    notes: [
      ...ACCESS_NOTES,
      { label: "The Create actions pipe XML into virsh's stdin — which is also where sudo would read a password, so they break under a 'sudo virsh' VIRSH_BIN even in a terminal" },
      { label: "Since libvirt 5.1 the default firewall backend on Fedora is nftables, and libvirt installs its own per-network rules. The iptables actions here are a legacy workaround: usually unnecessary, and on an nftables host they land in the compat table rather than libvirt's own" },
    ],
  },

  // ── storage pools and volumes ───────────────────────────────────────────────
  {
    id: "virsh-pools",
    label: "Storage pools & volumes",
    category: "Storage",
    verify: LIBVIRT_GATES,
    group: "libvirt",
    outputDir: "virsh",
    sections: [
      { id: "pools", label: "Pools" },
      { id: "volumes", label: "Volumes" },
      { id: "newpool", label: "New pool" },
      { id: "newvol", label: "New volume" },
    ],
    fields: [
      // Global: Volumes and New volume both address a pool, and a blank one would
      // turn `vol-create-as {poolName} {nvName} {nvCapacity}` into a two-argument
      // call that virsh reads as pool=name, name=capacity.
      { id: "poolName", type: "text", label: "Storage pool", default: "default", help: "`default` on Debian/Ubuntu, often `images` on Fedora — see the Pools tab." },
      { id: "poolAll", type: "check", label: "Include inactive", section: "pools", flag: "--all", default: "true" },
      { id: "poolDetails", type: "check", label: "Show capacity & allocation", section: "pools", flag: "--details", default: "true" },
      { id: "poolType", type: "text", label: "Only this type", section: "pools", placeholder: "dir,netfs" },
      { id: "poolAutostart", type: "segment", label: "Autostart", section: "pools", options: { Enable: "", Disable: "--disable" }, default: "" },
      { id: "poolDelConfirm", type: "text", label: "Type DELETE to arm storage deletion", section: "pools", placeholder: "DELETE" },
      { id: "volName", type: "text", label: "Volume", section: "volumes", placeholder: "pwnbox.qcow2" },
      { id: "volDetails", type: "check", label: "Show capacity & allocation", section: "volumes", flag: "--details", default: "true" },
      { id: "volNewName", type: "text", label: "Clone name", section: "volumes", placeholder: "pwnbox-copy.qcow2" },
      { id: "volNewSize", type: "text", label: "New size", section: "volumes", placeholder: "80G" },
      { id: "volShrink", type: "check", label: "Allow shrinking", section: "volumes", flag: "--shrink" },
      { id: "volFile", type: "file", label: "Local file to upload", section: "volumes" },
      { id: "volDelConfirm", type: "text", label: "Type DELETE to arm volume deletion", section: "volumes", placeholder: "DELETE" },
      { id: "npName", type: "text", label: "Pool name", section: "newpool", default: "toolbox-pool" },
      { id: "npType", type: "select", label: "Pool type", section: "newpool", options: ["dir", "fs", "netfs", "logical", "disk", "iscsi", "gluster", "zfs"], default: "dir" },
      { id: "npTarget", type: "file", label: "Target directory", section: "newpool", fileKind: "folder", rootConfig: "IMAGES_DIR", default: "{IMAGES_DIR}" },
      { id: "npSourceHost", type: "text", label: "Source host", section: "newpool", when: { field: "npType", in: ["netfs", "iscsi", "gluster"] } },
      { id: "npSourcePath", type: "text", label: "Source path", section: "newpool", when: { field: "npType", in: ["fs", "netfs", "gluster"] } },
      { id: "npSourceDev", type: "text", label: "Source device", section: "newpool", when: { field: "npType", in: ["logical", "disk"] } },
      { id: "nvName", type: "text", label: "Volume name", section: "newvol", default: "new-disk.qcow2" },
      { id: "nvCapacity", type: "text", label: "Capacity", section: "newvol", default: "20G" },
      { id: "nvFormat", type: "select", label: "Format", section: "newvol", options: ["qcow2", "raw", "qed", "vmdk"], default: "qcow2" },
      { id: "nvAlloc", type: "text", label: "Initial allocation", section: "newvol", placeholder: "0" },
      { id: "nvPrealloc", type: "check", label: "Preallocate metadata", section: "newvol", flag: "--prealloc-metadata" },
      { id: "nvBacking", type: "text", label: "Backing volume", section: "newvol", placeholder: "base.qcow2" },
      { id: "nvBackingFmt", type: "select", label: "Backing format", section: "newvol", options: ["qcow2", "raw"], default: "qcow2", when: { field: "nvBacking", truthy: true } },
    ],
    actions: [
      { id: "list", label: "List pools", mode: "captured", section: "pools", parse: "virsh.pools", command: `${V} pool-list {poolAll} {poolDetails} [[--type {poolType}]]` },
      { id: "info", label: "Pool info", mode: "captured", section: "pools", parse: "virsh.info", command: `${V} pool-info {poolName}` },
      { id: "start", label: "Start pool", mode: "captured", section: "pools", parse: "virsh.pools", command: `${V} pool-start {poolName} && ${V} pool-list --all --details` },
      { id: "stop", label: "Stop pool", mode: "captured", section: "pools", parse: "virsh.pools", command: `${V} pool-destroy {poolName} && ${V} pool-list --all --details` },
      { id: "refresh", label: "Rescan pool contents", mode: "captured", section: "pools", parse: "virsh.volumes", command: `${V} pool-refresh {poolName} && ${V} vol-list {poolName} --details` },
      { id: "autostart", label: "Set autostart", mode: "captured", section: "pools", parse: "virsh.pools", command: `${V} pool-autostart {poolAutostart} {poolName} && ${V} pool-list --all --details` },
      { id: "capabilities", label: "Pool capabilities → file", mode: "captured", section: "pools", command: `${V} pool-capabilities | tee '{out}'`, output: "{timestamp}_pool-capabilities.xml" },
      { id: "xml", label: "Dump pool XML → file", mode: "captured", section: "pools", command: `${V} pool-dumpxml {poolName} | tee '{out}'`, output: "{timestamp}_{poolName}_pool.xml" },
      { id: "edit", label: "Edit pool XML", mode: "terminal", section: "pools", command: `${V} pool-edit {poolName}` },
      // Removes the DEFINITION only; the files on disk survive.
      { id: "undefine", label: "Undefine pool (keeps the files)", mode: "captured", section: "pools", parse: "virsh.pools", command: `${V} pool-destroy {poolName} 2>/dev/null ; ${V} pool-undefine {poolName} && ${V} pool-list --all --details` },
      // Removes the FILES. Armed, because there is no prompt to fall back on.
      {
        id: "delete",
        label: "Delete the pool's underlying storage (irreversible)",
        mode: "captured",
        section: "pools",
        parse: "virsh.pools",
        when: { field: "poolDelConfirm", equals: "DELETE" },
        command: `${V} pool-delete {poolName} && ${V} pool-list --all --details`,
      },
      { id: "vols", label: "List volumes", mode: "captured", section: "volumes", parse: "virsh.volumes", command: `${V} vol-list {poolName} {volDetails}` },
      { id: "vol-info", label: "Volume info", mode: "captured", section: "volumes", parse: "virsh.info", command: `${V} vol-info --pool {poolName} {volName}` },
      { id: "vol-path", label: "Volume path", mode: "captured", section: "volumes", command: `${V} vol-path --pool {poolName} {volName}` },
      { id: "vol-xml", label: "Dump volume XML → file", mode: "captured", section: "volumes", command: `${V} vol-dumpxml --pool {poolName} {volName} | tee '{out}'`, output: "{timestamp}_{volName}_volume.xml" },
      { id: "vol-resize", label: "Resize volume", mode: "captured", section: "volumes", parse: "virsh.volumes", command: `${V} vol-resize --pool {poolName} {volName} {volNewSize} {volShrink} && ${V} vol-list {poolName} --details` },
      // Terminal: copies a whole image with no progress output, so a captured run
      // would look hung for minutes.
      { id: "vol-clone", label: "Clone volume", mode: "terminal", section: "volumes", command: `${V} vol-clone --pool {poolName} {volName} {volNewName}` },
      { id: "vol-download", label: "Download volume → file", mode: "terminal", section: "volumes", command: `${V} vol-download --pool {poolName} {volName} '{out}'`, output: "{timestamp}_{volName}" },
      { id: "vol-upload", label: "Upload a file into a volume", mode: "terminal", section: "volumes", command: `${V} vol-upload --pool {poolName} {volName} {volFile}` },
      {
        id: "vol-delete",
        label: "Delete volume (irreversible)",
        mode: "captured",
        section: "volumes",
        parse: "virsh.volumes",
        when: { field: "volDelConfirm", equals: "DELETE" },
        command: `${V} vol-delete --pool {poolName} {volName} && ${V} vol-list {poolName} --details`,
      },
      {
        id: "vol-wipe",
        label: "Wipe volume contents (irreversible)",
        mode: "terminal",
        section: "volumes",
        when: { field: "volDelConfirm", equals: "DELETE" },
        command: `${V} vol-wipe --pool {poolName} {volName}`,
      },
      { id: "define", label: "Define pool only", mode: "captured", section: "newpool", parse: "virsh.pools", command: `${V} pool-define-as {npName} {npType} [[--source-host {npSourceHost}]] [[--source-path {npSourcePath}]] [[--source-dev {npSourceDev}]] [[--target {npTarget}]] && ${V} pool-list --all --details` },
      { id: "create", label: "Define, build, start & autostart", mode: "captured", section: "newpool", parse: "virsh.pools", command: `${V} pool-define-as {npName} {npType} [[--source-host {npSourceHost}]] [[--source-path {npSourcePath}]] [[--source-dev {npSourceDev}]] [[--target {npTarget}]] && ${V} pool-build {npName} && ${V} pool-start {npName} && ${V} pool-autostart {npName} && ${V} pool-list --all --details` },
      { id: "vol-create", label: "Create volume", mode: "captured", section: "newvol", parse: "virsh.volumes", command: `${V} vol-create-as {poolName} {nvName} {nvCapacity} --format {nvFormat} [[--allocation {nvAlloc}]] {nvPrealloc} [[--backing-vol {nvBacking}]] [[--backing-vol-format {nvBackingFmt}]] && ${V} vol-list {poolName} --details` },
    ],
    notesTitle: "Access",
    notes: [
      ...ACCESS_NOTES,
      { label: "Undefine removes only the pool's definition; Delete removes the files it points at, which is why the latter has to be armed with the word DELETE" },
    ],
  },

  // ── host information ────────────────────────────────────────────────────────
  {
    id: "virsh-host",
    label: "Host & capabilities",
    category: "Host",
    verify: LIBVIRT_GATES,
    // No `group` gate: everything here is read-only, and libvirt grants
    // org.libvirt.unix.monitor to every local user — a red "not in the libvirt
    // group" badge on a tool that works perfectly would be noise.
    outputDir: "virsh",
    sections: [
      { id: "overview", label: "Overview" },
      { id: "capabilities", label: "Capabilities" },
      { id: "resources", label: "Resources" },
      { id: "devices", label: "Host devices" },
    ],
    fields: [
      { id: "capArch", type: "select", label: "Architecture", section: "capabilities", options: ["x86_64", "aarch64", "i686"], default: "x86_64" },
      { id: "capVirt", type: "select", label: "Virtualisation type", section: "capabilities", options: ["kvm", "qemu"], default: "kvm" },
      { id: "capMachine", type: "text", label: "Machine type", section: "capabilities", placeholder: "q35" },
      {
        id: "devCap",
        type: "select",
        label: "Capability",
        section: "devices",
        options: { Everything: "", PCI: "--cap pci", USB: "--cap usb_device", Network: "--cap net", Storage: "--cap storage", "SCSI host": "--cap scsi_host", System: "--cap system" },
        default: "",
      },
      { id: "devName", type: "text", label: "Device", section: "devices", placeholder: "pci_0000_00_02_0" },
    ],
    actions: [
      { id: "version", label: "libvirt & hypervisor versions", mode: "captured", section: "overview", parse: "virsh.info", command: `${V} version` },
      { id: "nodeinfo", label: "Host CPU & memory", mode: "captured", section: "overview", parse: "virsh.info", command: `${V} nodeinfo` },
      { id: "uri", label: "Canonical connection URI", mode: "captured", section: "overview", command: `${V} uri` },
      { id: "hostname", label: "Hypervisor hostname", mode: "captured", section: "overview", command: `${V} hostname` },
      { id: "maxvcpus", label: "Maximum vCPUs per guest", mode: "captured", section: "overview", command: `${V} maxvcpus` },
      { id: "domains", label: "Every VM on this host", mode: "captured", section: "overview", parse: "virsh.domains", command: `${V} list --all --title --managed-save` },
      { id: "all-stats", label: "Statistics for every VM", mode: "captured", section: "overview", parse: "virsh.domstats", command: `${V} domstats --state --balloon --vcpu` },
      { id: "sysinfo", label: "Host SMBIOS → file", mode: "captured", section: "overview", command: `${V} sysinfo | tee '{out}'`, output: "{timestamp}_sysinfo.xml" },
      { id: "capabilities", label: "Host capabilities → file", mode: "captured", section: "capabilities", command: `${V} capabilities | tee '{out}'`, output: "{timestamp}_capabilities.xml" },
      { id: "domcapabilities", label: "Guest capabilities → file", mode: "captured", section: "capabilities", command: `${V} domcapabilities [[--arch {capArch}]] [[--virttype {capVirt}]] [[--machine {capMachine}]] | tee '{out}'`, output: "{timestamp}_domcapabilities.xml" },
      { id: "cpu-models", label: "CPU models for this architecture", mode: "captured", section: "capabilities", command: `${V} cpu-models {capArch}` },
      { id: "hyp-cpu-models", label: "CPU models the hypervisor reports", mode: "captured", section: "capabilities", command: `${V} hypervisor-cpu-models [[--virttype {capVirt}]]` },
      { id: "cpustats", label: "Host CPU usage", mode: "captured", section: "resources", parse: "virsh.info", command: `${V} nodecpustats --percent` },
      { id: "memstats", label: "Host memory", mode: "captured", section: "resources", parse: "virsh.info", command: `${V} nodememstats` },
      { id: "cpumap", label: "Host CPU map", mode: "captured", section: "resources", command: `${V} nodecpumap` },
      { id: "freecell", label: "NUMA free memory", mode: "captured", section: "resources", command: `${V} freecell --all` },
      { id: "freepages", label: "NUMA free pages", mode: "captured", section: "resources", command: `${V} freepages --all` },
      { id: "nodedev-list", label: "Host devices", mode: "captured", section: "devices", command: `${V} nodedev-list {devCap}` },
      { id: "nodedev-tree", label: "Host device tree", mode: "captured", section: "devices", command: `${V} nodedev-list --tree` },
      { id: "nodedev-info", label: "Device info", mode: "captured", section: "devices", parse: "virsh.info", command: `${V} nodedev-info {devName}` },
      { id: "nodedev-xml", label: "Device XML → file", mode: "captured", section: "devices", command: `${V} nodedev-dumpxml {devName} | tee '{out}'`, output: "{timestamp}_{devName}.xml" },
    ],
    notesTitle: "Access",
    notes: [
      { label: "Everything here is read-only, and libvirt grants monitor access to every local user — so this tool works even outside the libvirt group, unlike the others" },
      { label: "Host devices are what PCI passthrough is configured from; detaching one from the host is deliberately not offered here, because it can take down a device the host is using" },
    ],
  },
];
