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
      { label: "Connection URI", key: "LIBVIRT_URI", type: "text", validation: "required" },
      { label: "Images directory", key: "IMAGES_DIR", type: "path", validation: "required" },
      { label: "Default network", key: "DEFAULT_NET", type: "text", validation: "required" },
    ],
  },
];

// Seed defaults — the values the tools assumed literally before they were made
// configurable, so an untouched config behaves exactly as it always did.
export const CONFIG_DEFAULTS: Record<string, string> = {
  // `qemu:///system` is what `sudo virsh` already resolves to; setting it
  // explicitly is what lets a session or remote URI work instead.
  LIBVIRT_URI: "qemu:///system",
  IMAGES_DIR: "/var/lib/libvirt/images",
  DEFAULT_NET: "virbr0",
};

/** Every config key, in declaration order. */
export const CONFIG_KEYS: string[] = CONFIG_GROUPS.flatMap((g) => g.items.map((i) => i.key));
