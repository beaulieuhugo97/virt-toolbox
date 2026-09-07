import { Tool } from "../types";

// The virtualization domain, ported from the libvirt/virsh TUI script
// (scripts/Tools/Virtualization/). Four tools grouped by the tree:
//
//   Virtualization/Virtual_Machines → virsh        (VM lifecycle + snapshots)
//   Virtualization/Virtual_Machines → virt-images  (download / create / import)
//   Virtualization/Networking        → virt-net     (libvirt networks + forwarding)
//   Virtualization/Container         → docker       (throwaway container)
//
// Everything runs on the hypervisor host. virsh/virt-install commands need root
// and are interactive, so they run in terminal mode (a real TTY) so a sudo
// prompt can be answered. libvirt-backed tools gate on the libvirtd service
// (badge + Start button); docker gates on the `docker` group (badge + Add-me).
export const tools: Tool[] = [
  // ── VM lifecycle + snapshots ────────────────────────────────────────────────
  {
    id: "virsh",
    label: "virsh — manage VMs",
    category: "Virtualization/Virtual_Machines",
    deps: ["virsh", "virt-viewer"],
    service: "libvirtd",
    outputDir: "virsh",
    sections: [
      { id: "manage", label: "Manage" },
      { id: "snapshots", label: "Snapshots" },
    ],
    fields: [
      { id: "vmName", type: "text", label: "VM name", placeholder: "pwnbox", default: "pwnbox" },
      { id: "snapName", type: "text", label: "Snapshot name", section: "snapshots" },
      { id: "snapDesc", type: "text", label: "Snapshot description", section: "snapshots" },
    ],
    actions: [
      { id: "list", label: "List VMs", mode: "terminal", sudo: true, section: "manage", command: "sudo virsh --connect {LIBVIRT_URI} list --all" },
      { id: "start", label: "Start", mode: "terminal", sudo: true, section: "manage", command: "sudo virsh --connect {LIBVIRT_URI} start {vmName} && sudo virsh --connect {LIBVIRT_URI} list --all" },
      { id: "shutdown", label: "Shutdown", mode: "terminal", sudo: true, section: "manage", command: "sudo virsh --connect {LIBVIRT_URI} shutdown {vmName} && sudo virsh --connect {LIBVIRT_URI} list --all" },
      { id: "suspend", label: "Suspend", mode: "terminal", sudo: true, section: "manage", command: "sudo virsh --connect {LIBVIRT_URI} suspend {vmName} && sudo virsh --connect {LIBVIRT_URI} list --all" },
      { id: "resume", label: "Resume", mode: "terminal", sudo: true, section: "manage", command: "sudo virsh --connect {LIBVIRT_URI} resume {vmName} && sudo virsh --connect {LIBVIRT_URI} list --all" },
      { id: "reboot", label: "Reboot", mode: "terminal", sudo: true, section: "manage", command: "sudo virsh --connect {LIBVIRT_URI} reboot {vmName} && sudo virsh --connect {LIBVIRT_URI} list --all" },
      { id: "reset", label: "Force reset", mode: "terminal", sudo: true, section: "manage", command: "sudo virsh --connect {LIBVIRT_URI} reset {vmName} && sudo virsh --connect {LIBVIRT_URI} list --all" },
      { id: "destroy", label: "Force stop (destroy)", mode: "terminal", sudo: true, section: "manage", command: "sudo virsh --connect {LIBVIRT_URI} destroy {vmName} && sudo virsh --connect {LIBVIRT_URI} list --all" },
      { id: "undefine", label: "Delete (destroy + undefine)", mode: "terminal", sudo: true, section: "manage", command: "sudo virsh --connect {LIBVIRT_URI} destroy {vmName} ; sudo virsh --connect {LIBVIRT_URI} undefine {vmName} && sudo virsh --connect {LIBVIRT_URI} list --all" },
      { id: "viewer", label: "Open viewer", mode: "terminal", sudo: true, section: "manage", command: "sudo virt-viewer --connect {LIBVIRT_URI} {vmName}" },
      { id: "snap-list", label: "List snapshots", mode: "terminal", sudo: true, section: "snapshots", command: "sudo virsh --connect {LIBVIRT_URI} snapshot-list {vmName}" },
      { id: "snap-create", label: "Create snapshot", mode: "terminal", sudo: true, section: "snapshots", command: `sudo virsh --connect {LIBVIRT_URI} snapshot-create-as {vmName} '{snapName}' "{snapDesc}" && sudo virsh --connect {LIBVIRT_URI} snapshot-list {vmName}` },
      { id: "snap-revert", label: "Revert snapshot", mode: "terminal", sudo: true, section: "snapshots", command: "sudo virsh --connect {LIBVIRT_URI} snapshot-revert {vmName} '{snapName}' && sudo virsh --connect {LIBVIRT_URI} snapshot-list {vmName}" },
      { id: "snap-delete", label: "Delete snapshot", mode: "terminal", sudo: true, section: "snapshots", command: "sudo virsh --connect {LIBVIRT_URI} snapshot-delete {vmName} '{snapName}' && sudo virsh --connect {LIBVIRT_URI} snapshot-list {vmName}" },
    ],
  },

  // ── images: download an image, create a VM from ISO, import an existing disk ──
  {
    id: "virt-images",
    label: "Images & VM creation",
    category: "Virtualization/Virtual_Machines",
    deps: ["virsh", "virt-install"],
    service: "libvirtd",
    outputDir: "virsh",
    sections: [
      { id: "download", label: "Download" },
      { id: "create", label: "Create from ISO" },
      { id: "import", label: "Import disk" },
    ],
    fields: [
      // Download
      {
        id: "dlUrl",
        type: "text",
        label: "Image URL",
        section: "download",
        default: "https://deb.parrot.sh/parrot/iso/6.4/Parrot-security-6.4_amd64.iso",
        help:
          "Downloaded into the configured images directory and, if it is a .7z/.zip/.tar archive, extracted there. Presets — Parrot HTB: https://deb.parrot.sh/parrot/iso/6.4/Parrot-htb-6.4_amd64.iso · Kali ISO: https://cdimage.kali.org/kali-2025.3/kali-linux-2025.3-installer-amd64.iso · Kali qcow2: https://mirror.quantum5.ca/kali-images/kali-2025.2/kali-linux-2025.2-qemu-amd64.7z",
      },
      // Create from ISO
      { id: "cVmName", type: "text", label: "VM name", section: "create", default: "pwnbox" },
      { id: "cIso", type: "file", fileKind: "file", rootConfig: "IMAGES_DIR", label: "Installer ISO", section: "create", help: "Pick the .iso to boot from (defaults to the configured images directory)." },
      { id: "cOsVariant", type: "select", label: "OS variant", section: "create", options: ["debian12", "debian11", "ubuntu22.04", "win11", "win10", "generic"], default: "debian12" },
      { id: "cVcpus", type: "text", label: "vCPUs", section: "create", default: "8" },
      { id: "cRam", type: "text", label: "RAM (MB)", section: "create", default: "16384" },
      { id: "cDiskPath", type: "text", label: "Disk path (created)", section: "create", default: "{IMAGES_DIR}/{cVmName}.qcow2" },
      { id: "cDiskSize", type: "text", label: "Disk size (GB)", section: "create", default: "64" },
      { id: "cNet", type: "text", label: "Bridge / network interface", section: "create", default: "{DEFAULT_NET}" },
      {
        id: "cVirtioIso",
        type: "text",
        label: "VirtIO drivers ISO (Windows)",
        section: "create",
        default: "{IMAGES_DIR}/virtio-win.iso",
        when: { field: "cOsVariant", in: ["win11", "win10"] },
        help: "Attached as a second CD-ROM so the Windows installer can load virtio disk/net drivers.",
      },
      // Import existing disk
      { id: "iVmName", type: "text", label: "VM name", section: "import", default: "pwnbox" },
      { id: "iDisk", type: "file", fileKind: "file", rootConfig: "IMAGES_DIR", label: "Disk image (qcow2)", section: "import", help: "An existing bootable disk to import (from the configured images directory)." },
      { id: "iOsVariant", type: "select", label: "OS variant", section: "import", options: ["debian12", "debian11", "ubuntu22.04", "win11", "win10", "generic"], default: "debian12" },
      { id: "iVcpus", type: "text", label: "vCPUs", section: "import", default: "6" },
      { id: "iRam", type: "text", label: "RAM (MB)", section: "import", default: "8192" },
      { id: "iNet", type: "text", label: "Bridge / network interface", section: "import", default: "{DEFAULT_NET}" },
    ],
    actions: [
      {
        id: "download",
        label: "Download & place in images dir",
        mode: "terminal",
        sudo: true,
        section: "download",
        command:
          "cd {IMAGES_DIR} && sudo wget -N {dlUrl} && f=$(basename {dlUrl}) && case \"$f\" in *.7z) sudo 7z x -y \"$f\" ;; *.zip) sudo unzip -o \"$f\" ;; *.tar.*) sudo tar xf \"$f\" ;; esac ; sudo chmod 644 {IMAGES_DIR}/*.qcow2 {IMAGES_DIR}/*.iso 2>/dev/null ; ls -lh {IMAGES_DIR}",
      },
      {
        id: "create",
        label: "Create VM from ISO",
        mode: "terminal",
        sudo: true,
        section: "create",
        command:
          "sudo virt-install --connect {LIBVIRT_URI} --os-variant {cOsVariant} --name {cVmName} --ram {cRam} --vcpus {cVcpus} --cpu host --cdrom {cIso} --disk path={cDiskPath},size={cDiskSize},bus=virtio,cache=writeback,format=qcow2 --network bridge={cNet},model=virtio --graphics spice,listen=0.0.0.0 --video qxl --channel spicevmc,target_type=virtio,name=com.redhat.spice.0 --console pty,target_type=serial [[--disk path={cVirtioIso},device=cdrom]]",
      },
      {
        id: "import",
        label: "Import VM from disk",
        mode: "terminal",
        sudo: true,
        section: "import",
        command:
          "sudo virt-install --connect {LIBVIRT_URI} --os-variant {iOsVariant} --name {iVmName} --ram {iRam} --vcpus {iVcpus} --cpu host --disk path={iDisk},bus=virtio,cache=writeback --network bridge={iNet},model=virtio --graphics spice,listen=0.0.0.0 --video qxl --channel spicevmc,target_type=virtio,name=com.redhat.spice.0 --console pty,target_type=serial --import",
      },
    ],
  },

  // ── libvirt networks + IP forwarding ────────────────────────────────────────
  {
    id: "virt-net",
    label: "virsh networks",
    category: "Virtualization/Networking",
    deps: ["virsh", "iptables"],
    service: "libvirtd",
    outputDir: "virsh",
    sections: [
      { id: "manage", label: "Manage" },
      { id: "create", label: "Create" },
      { id: "forwarding", label: "IP forwarding" },
    ],
    fields: [
      { id: "netName", type: "text", label: "Network name", section: "manage", default: "default" },
      // Create
      { id: "cnetType", type: "select", label: "Network type", section: "create", options: { NAT: "nat", "Host-only": "host", Isolated: "isolated" }, default: "nat" },
      { id: "cnetName", type: "text", label: "Network name", section: "create", default: "nat" },
      { id: "cnetIp", type: "text", label: "Router IP", section: "create", default: "172.16.1.1" },
      { id: "cnetMask", type: "text", label: "Subnet mask", section: "create", default: "255.255.255.0" },
      { id: "cnetDhcpStart", type: "text", label: "DHCP start", section: "create", default: "172.16.1.10" },
      { id: "cnetDhcpEnd", type: "text", label: "DHCP end", section: "create", default: "172.16.1.100" },
      // Forwarding
      { id: "fwNet", type: "text", label: "Network name", section: "forwarding", default: "nat" },
    ],
    actions: [
      { id: "net-list", label: "List networks", mode: "terminal", sudo: true, section: "manage", command: "sudo virsh --connect {LIBVIRT_URI} net-list --all" },
      { id: "net-info", label: "Network info", mode: "terminal", sudo: true, section: "manage", command: "sudo virsh --connect {LIBVIRT_URI} net-info {netName}" },
      { id: "net-start", label: "Start network", mode: "terminal", sudo: true, section: "manage", command: "sudo virsh --connect {LIBVIRT_URI} net-start {netName} && sudo virsh --connect {LIBVIRT_URI} net-list --all" },
      { id: "net-stop", label: "Stop network", mode: "terminal", sudo: true, section: "manage", command: "sudo virsh --connect {LIBVIRT_URI} net-destroy {netName} && sudo virsh --connect {LIBVIRT_URI} net-list --all" },
      { id: "net-destroy", label: "Destroy (undefine + firewall cleanup)", mode: "terminal", sudo: true, section: "manage", command: "sudo virsh --connect {LIBVIRT_URI} net-destroy {netName} ; sudo virsh --connect {LIBVIRT_URI} net-undefine {netName} ; sudo iptables -D FORWARD -i virbr-{netName} -j ACCEPT 2>/dev/null ; sudo iptables -D FORWARD -o virbr-{netName} -j ACCEPT 2>/dev/null ; sudo virsh --connect {LIBVIRT_URI} net-list --all" },
      { id: "net-leases", label: "List DHCP leases", mode: "terminal", sudo: true, section: "manage", command: "sudo virsh --connect {LIBVIRT_URI} net-dhcp-leases {netName}" },
      { id: "net-ifaces", label: "List virbr interfaces", mode: "terminal", sudo: false, section: "manage", command: "ip addr show | grep virbr" },
      {
        id: "create-nat",
        label: "Create NAT network",
        mode: "terminal",
        sudo: true,
        section: "create",
        when: { field: "cnetType", equals: "nat" },
        command:
          `echo "<network><name>{cnetName}</name><forward mode='nat'/><bridge name='virbr-{cnetName}'/><ip address='{cnetIp}' netmask='{cnetMask}'><dhcp><range start='{cnetDhcpStart}' end='{cnetDhcpEnd}'/></dhcp></ip></network>" | sudo virsh --connect {LIBVIRT_URI} net-define /dev/stdin && sudo virsh --connect {LIBVIRT_URI} net-autostart {cnetName} && sudo virsh --connect {LIBVIRT_URI} net-start {cnetName} && sudo iptables -I FORWARD -i virbr-{cnetName} -j ACCEPT && sudo iptables -I FORWARD -o virbr-{cnetName} -j ACCEPT && sudo virsh --connect {LIBVIRT_URI} net-list --all`,
      },
      {
        id: "create-host",
        label: "Create host-only network",
        mode: "terminal",
        sudo: true,
        section: "create",
        when: { field: "cnetType", equals: "host" },
        command:
          `echo "<network><name>{cnetName}</name><bridge name='virbr-{cnetName}' stp='on' delay='0'/><ip address='{cnetIp}' netmask='{cnetMask}'><dhcp><range start='{cnetDhcpStart}' end='{cnetDhcpEnd}'/></dhcp></ip></network>" | sudo virsh --connect {LIBVIRT_URI} net-define /dev/stdin && sudo virsh --connect {LIBVIRT_URI} net-autostart {cnetName} && sudo virsh --connect {LIBVIRT_URI} net-start {cnetName} && sudo virsh --connect {LIBVIRT_URI} net-list --all`,
      },
      {
        id: "create-isolated",
        label: "Create isolated network",
        mode: "terminal",
        sudo: true,
        section: "create",
        when: { field: "cnetType", equals: "isolated" },
        command:
          `echo "<network><name>{cnetName}</name><bridge name='virbr-{cnetName}' stp='on' delay='0'/><ip address='{cnetIp}' netmask='{cnetMask}'><dhcp><range start='{cnetDhcpStart}' end='{cnetDhcpEnd}'/></dhcp></ip></network>" | sudo virsh --connect {LIBVIRT_URI} net-define /dev/stdin && sudo virsh --connect {LIBVIRT_URI} net-autostart {cnetName} && sudo virsh --connect {LIBVIRT_URI} net-start {cnetName} && sudo virsh --connect {LIBVIRT_URI} net-list --all`,
      },
      { id: "fwd-enable", label: "Enable IP forwarding", mode: "terminal", sudo: true, section: "forwarding", command: "sudo iptables -I FORWARD -i virbr-{fwNet} -j ACCEPT && sudo iptables -I FORWARD -o virbr-{fwNet} -j ACCEPT && sudo iptables -L FORWARD -n --line-numbers | grep virbr-{fwNet}" },
      { id: "fwd-disable", label: "Disable IP forwarding", mode: "terminal", sudo: true, section: "forwarding", command: "sudo iptables -D FORWARD -i virbr-{fwNet} -j ACCEPT ; sudo iptables -D FORWARD -o virbr-{fwNet} -j ACCEPT ; sudo iptables -L FORWARD -n --line-numbers | grep virbr-{fwNet} || echo 'no forwarding rules for virbr-{fwNet}'" },
    ],
  },

  // ── throwaway container ─────────────────────────────────────────────────────
  {
    id: "docker",
    category: "Virtualization/Container",
    deps: ["docker"],
    group: "docker",
    fields: [
      { id: "image", type: "select", label: "Image", options: ["parrotsec/security", "kalilinux/kali-rolling"], default: "parrotsec/security" },
      { id: "mount", type: "text", label: "Mount path", default: "/pwnbox" },
    ],
    actions: [{ id: "run", label: "Run container", mode: "terminal", command: "docker run --rm -ti --network host -v $PWD:{mount} {image}" }],
    notesTitle: "Requirements",
    notes: [
      { label: "The docker service must be running", command: "sudo systemctl start docker" },
      { label: "Your user must be in the docker group (use the Add-me badge above, then re-login)" },
    ],
  },
];
