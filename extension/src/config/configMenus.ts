// The config menus, ported from scripts/env/config.env's *_CONFIG_MENU arrays.
// In the TUI these 5-tuples drive `config`'s generic editor; here the same
// declarations drive the settings webview. One declaration, both front-ends.

export type ConfigInputType =
  | "text"
  | "password"
  | "port"
  | "network_interface"
  | "wordlist";

export interface ConfigItem {
  label: string;
  key: string;
  type: ConfigInputType;
  validation: "required" | "optional" | "port";
}

export interface ConfigGroup {
  title: string;
  items: ConfigItem[];
}

export const CONFIG_GROUPS: ConfigGroup[] = [
  {
    title: "Local",
    items: [
      { label: "Local IP Address", key: "LIP", type: "network_interface", validation: "required" },
      { label: "Local Port", key: "LPORT", type: "port", validation: "port" },
    ],
  },
  {
    title: "Remote",
    items: [
      { label: "Remote Host", key: "RHOST", type: "text", validation: "required" },
      { label: "Remote IP Address", key: "RIP", type: "text", validation: "required" },
      { label: "Remote Port", key: "RPORT", type: "text", validation: "required" },
      { label: "Remote Username", key: "RUSER", type: "text", validation: "required" },
      { label: "Remote Password", key: "RPASSWORD", type: "password", validation: "required" },
    ],
  },
  {
    title: "Wordlists",
    items: [
      { label: "Wordlists Directory", key: "WORDLISTS_DIR", type: "wordlist", validation: "optional" },
      { label: "Password Wordlist", key: "PASS_WORDLIST_FILE", type: "wordlist", validation: "optional" },
      { label: "Username Wordlist", key: "USER_WORDLIST_FILE", type: "wordlist", validation: "optional" },
      { label: "Directory Wordlist", key: "DIR_WORDLIST", type: "wordlist", validation: "optional" },
      { label: "Subdomain Wordlist", key: "SUBDOM_WORDLIST", type: "wordlist", validation: "optional" },
    ],
  },
  {
    title: "Active Directory",
    items: [
      { label: "Domain Name", key: "DOMAIN", type: "text", validation: "required" },
      { label: "Domain Controller IP", key: "DC_IP", type: "text", validation: "required" },
    ],
  },
];

// Seed defaults, mirroring config.env's literal values. DOMAIN/DC_IP intentionally
// omitted — they fall back to RHOST/RIP at read time (see ConfigStore), matching
// config.env's `DOMAIN="$RHOST"` / `DC_IP="$RIP"`.
export const CONFIG_DEFAULTS: Record<string, string> = {
  LIP: "10.10.10.10",
  LPORT: "1337",
  RIP: "10.100.100.100",
  RPORT: "80",
  RHOST: "box.htb",
  RUSER: "user.name",
  RPASSWORD: "Pa5%W0rD",
  WORDLISTS_DIR: "~/.virt-toolbox/wordlists",
  PASS_WORDLIST_FILE: "~/.virt-toolbox/wordlists/rockyou.txt",
  USER_WORDLIST_FILE: "~/.virt-toolbox/wordlists/windows-usernames-wordlist.txt",
  DIR_WORDLIST: "~/.virt-toolbox/wordlists/discovery-wordlist.txt",
  SUBDOM_WORDLIST: "~/.virt-toolbox/wordlists/subdomain-wordlist.txt",
};

/** Every config key, in declaration order. */
export const CONFIG_KEYS: string[] = CONFIG_GROUPS.flatMap((g) => g.items.map((i) => i.key));
