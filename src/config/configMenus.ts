// The config menus. These declarations drive the settings webview, and every key
// here is injectable into a tool's command or field default as a {TOKEN} — see
// template/resolver.ts. Keep them to values that more than one tool needs: a
// one-off belongs in that tool's field defaults, not here.

export type ConfigInputType =
  | "text"
  | "path";

export interface ConfigItem {
  label: string;
  key: string;
  type: ConfigInputType;
  validation: "required" | "optional";
}

export interface ConfigGroup {
  title: string;
  items: ConfigItem[];
}

export const CONFIG_GROUPS: ConfigGroup[] = [
  {
    title: "Libvirt",
    items: [
      // Text, not path: the value may be `virsh`, `sudo virsh`, `sudo -n virsh`, or
      // `virsh -c qemu+ssh://host/system` — none of which a file picker helps with.
      { label: "virsh CLI", key: "VIRSH_BIN", type: "text", validation: "required" },
      { label: "virt-install CLI", key: "VIRT_INSTALL_BIN", type: "text", validation: "required" },
      { label: "Connection URI", key: "LIBVIRT_URI", type: "text", validation: "required" },
      { label: "Images directory", key: "IMAGES_DIR", type: "path", validation: "required" },
      { label: "Default network", key: "DEFAULT_NET", type: "text", validation: "required" },
    ],
  },
  {
    title: "Docker",
    items: [
      // Text, not path: the value may be `podman`, `nerdctl`, `sudo -n docker`, or
      // `env DOCKER_HOST=ssh://host docker` — none of which a folder picker helps with.
      { label: "Docker CLI", key: "DOCKER_BIN", type: "text", validation: "required" },
    ],
  },
];

// Seed defaults — the values the tools assumed literally before they were made
// configurable, so an untouched config behaves exactly as it always did.
export const CONFIG_DEFAULTS: Record<string, string> = {
  // The virsh invocation every libvirt tool runs. Plain `virsh` — with no sudo —
  // is what makes captured listings possible at all: a captured run gets a stdin
  // pipe and never a TTY, so a sudo password prompt would hang forever. Members
  // of the `libvirt` group reach qemu:///system unprivileged for reads AND
  // writes (polkit's org.libvirt.unix.manage). Outside that group, set this to
  // "sudo virsh" (terminal actions only) or "sudo -n virsh" with a NOPASSWD rule.
  VIRSH_BIN: "virsh",
  // Symmetric escape hatch for VM creation. Dropping the old hardcoded `sudo`
  // also fixes a latent bug: `sudo virt-install` spawns the graphical console as
  // root, which has no XAUTHORITY or WAYLAND_DISPLAY for the user's session.
  VIRT_INSTALL_BIN: "virt-install",
  // `qemu:///system` is what `sudo virsh` already resolved to; setting it
  // explicitly is what lets a session or remote URI work instead.
  LIBVIRT_URI: "qemu:///system",
  IMAGES_DIR: "/var/lib/libvirt/images",
  DEFAULT_NET: "virbr0",
  // The container CLI every docker tool invokes. Swapping it here is what lets
  // podman/nerdctl users, or a passwordless `sudo -n docker`, drive the same tools.
  DOCKER_BIN: "docker",
};

/** Every config key, in declaration order. */
export const CONFIG_KEYS: string[] = CONFIG_GROUPS.flatMap((g) => g.items.map((i) => i.key));
