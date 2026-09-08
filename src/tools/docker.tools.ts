// The container half of the toolbox: containers, images, networks, volumes and
// Compose stacks. Same manifest schema as the libvirt tools — pure data, no
// per-tool code — with one difference that shapes every listing here.
//
// Where the virsh tools run everything in a terminal and let you read raw output,
// a docker listing is `mode: "captured"` with a tab-separated `--format`, paired
// with a parser id from src/parsers/index.ts. The webview turns that into a real
// sortable table. Interactive or streaming work (run -ti, exec, logs -f, build,
// pull, compose up) stays on a terminal, because it needs a TTY.
//
// Two rules the whole file follows:
//  - Every mutation ends `&& <list>`, so the refreshed state lands straight back
//    in the table. This is the virt-net idiom (net-start … && net-list --all).
//  - Captured runs have NO TTY. Nothing here is `sudo:` — docker is reached
//    through group membership (the `group` gate below), and anything that would
//    prompt (every prune) is a terminal action so docker's own [y/N] can answer.

import { Tool, Verify } from "../types";

// Probes, not deps. `deps` is checked with `command -v <name>`, which would show a
// red ✗ for a DOCKER_BIN=podman user whose setup is perfectly fine; a verify
// command can carry the token instead. `timeout 5 … </dev/null` is not optional:
// checkGates awaits every probe before posting a single badge, so one command
// that blocks (a sudo askpass with no TTY) would leave the tool with no badges at
// all rather than one red one.
const DOCKER_GATES: Verify[] = [
  {
    label: "docker CLI",
    command: "timeout 5 {DOCKER_BIN} --version >/dev/null 2>&1 </dev/null",
    hint: "DOCKER_BIN is not runnable — set it in Config (docker, podman, nerdctl, or 'sudo -n docker').",
  },
  {
    label: "daemon reachable",
    command: "timeout 5 {DOCKER_BIN} info >/dev/null 2>&1 </dev/null",
    hint: "Start the service with the badge above, or join the docker group and log out and back in.",
  },
];

// One --format per output shape, hoisted because each is reused by ~10 actions.
// Written as \\t (a literal backslash-t): docker's CLI expands it to a tab itself,
// whereas a real tab would render as a ragged gap in the command preview. Single
// quotes are mandatory — collapseUnquoted() only protects single-quoted spans.
// Every {out} is single-quoted: the timestamp it carries contains [ and ], which
// bash would otherwise read as a glob character class.
// {{.Field}} is safe from the {token} resolver: /\{(\w+)\}/ cannot match {.Field}
// because "." is not a word character. A single-brace {Field} WOULD be eaten.
const PS = "--format '{{.ID}}\\t{{.Names}}\\t{{.Image}}\\t{{.State}}\\t{{.Status}}\\t{{.Ports}}\\t{{.RunningFor}}'";
const IMG = "--format '{{.ID}}\\t{{.Repository}}\\t{{.Tag}}\\t{{.Size}}\\t{{.CreatedSince}}'";
const NET = "--format '{{.ID}}\\t{{.Name}}\\t{{.Driver}}\\t{{.Scope}}\\t{{.Internal}}\\t{{.IPv6}}'";
const VOL = "--format '{{.Name}}\\t{{.Driver}}\\t{{.Scope}}\\t{{.Mountpoint}}\\t{{.Labels}}'";

// The compose invocation prefix. Compose v2 is a docker CLI plugin, so it is
// "<bin> compose" rather than a binary of its own — which is also why podman 4+
// and nerdctl work by setting DOCKER_BIN alone.
const C = "{DOCKER_BIN} compose [[-f {composeFile}]] [[-p {project}]] [[--env-file {envFile}]] [[--profile {profile}]]";

export const tools: Tool[] = [
  // ── containers ──────────────────────────────────────────────────────────────
  {
    id: "docker",
    label: "Containers",
    category: "Container",
    verify: DOCKER_GATES,
    service: "docker",
    group: "docker",
    outputDir: "docker",
    sections: [
      { id: "run", label: "Run" },
      { id: "manage", label: "Manage" },
      { id: "files", label: "Files & inspect" },
      { id: "cleanup", label: "Cleanup" },
    ],
    fields: [
      // The container every non-run action targets, so it is global (no section):
      // a field outside the active tab resolves to "", which would silently strip
      // the target from `docker rm` on the Cleanup tab.
      { id: "cName", type: "text", label: "Container (name or ID)", placeholder: "pwnbox", help: "Copy the ID or Name column from the list." },
      // Run — the preset/custom pair is the virt-images idiom: "Custom image…"
      // has value "", which reveals the free-text field, and a hidden field
      // resolves to "", so {rPreset}{rImage} is whichever of the two is in play.
      {
        id: "rPreset",
        type: "select",
        label: "Image",
        section: "run",
        options: {
          "Parrot Security": "parrotsec/security",
          "Kali Rolling": "kalilinux/kali-rolling",
          "Debian stable (slim)": "debian:stable-slim",
          "Ubuntu 24.04": "ubuntu:24.04",
          "Alpine": "alpine:latest",
          "Custom image…": "",
        },
        default: "parrotsec/security",
      },
      { id: "rImage", type: "text", label: "Custom image", section: "run", placeholder: "ghcr.io/org/image:tag", when: { field: "rPreset", equals: "" } },
      // A segment whose values are whole flag bundles — select/segment tokens are
      // emitted unquoted precisely so they word-split into separate arguments.
      { id: "rMode", type: "segment", label: "Run mode", section: "run", options: { "Interactive shell": "--rm -ti", "Detached (background)": "-d" }, default: "--rm -ti" },
      { id: "rName", type: "text", label: "Container name", section: "run", help: "Blank lets docker generate one." },
      { id: "rNetwork", type: "text", label: "Network", section: "run", default: "host", help: "host, bridge, none, or a network from the Docker networks tool." },
      { id: "rSrc", type: "file", label: "Folder to bind-mount", section: "run", fileKind: "folder", help: "Left blank, nothing is mounted." },
      { id: "rMount", type: "text", label: "Mount it at", section: "run", default: "/pwnbox" },
      { id: "rPublish", type: "text", label: "Published ports", section: "run", placeholder: "-p 8080:80 -p 4444:4444" },
      { id: "rExtra", type: "text", label: "Extra docker run flags", section: "run", placeholder: "-e KEY=value --cap-add NET_ADMIN" },
      { id: "rPrivileged", type: "check", label: "Privileged", section: "run", flag: "--privileged" },
      { id: "rCmd", type: "text", label: "Command inside the container", section: "run", placeholder: "/bin/bash" },
      // Manage
      { id: "cAll", type: "check", label: "Include stopped", section: "manage", flag: "-a", default: "true" },
      { id: "cFilter", type: "text", label: "Filter", section: "manage", placeholder: "status=running" },
      { id: "cTail", type: "text", label: "Log lines", section: "manage", default: "200" },
      { id: "cShell", type: "text", label: "Shell", section: "manage", default: "/bin/bash" },
      // Files
      { id: "cCpSrc", type: "text", label: "Path inside the container", section: "files", default: "/root" },
      { id: "cCpDest", type: "file", label: "Destination on the host", section: "files", fileKind: "folder" },
    ],
    actions: [
      { id: "run", label: "Run container", mode: "terminal", section: "run", command: "{DOCKER_BIN} run {rMode} [[--name {rName}]] [[--network {rNetwork}]] [[-v {rSrc}:{rMount}]] {rPublish} {rExtra} {rPrivileged} {rPreset}{rImage} {rCmd}" },
      { id: "ps", label: "List containers", mode: "captured", section: "manage", parse: "docker.ps", command: `{DOCKER_BIN} ps {cAll} [[--filter {cFilter}]] ${PS}` },
      { id: "start", label: "Start", mode: "captured", section: "manage", parse: "docker.ps", command: `{DOCKER_BIN} start {cName} && {DOCKER_BIN} ps -a ${PS}` },
      { id: "stop", label: "Stop", mode: "captured", section: "manage", parse: "docker.ps", command: `{DOCKER_BIN} stop {cName} && {DOCKER_BIN} ps -a ${PS}` },
      { id: "restart", label: "Restart", mode: "captured", section: "manage", parse: "docker.ps", command: `{DOCKER_BIN} restart {cName} && {DOCKER_BIN} ps -a ${PS}` },
      { id: "pause", label: "Pause", mode: "captured", section: "manage", parse: "docker.ps", command: `{DOCKER_BIN} pause {cName} && {DOCKER_BIN} ps -a ${PS}` },
      { id: "unpause", label: "Unpause", mode: "captured", section: "manage", parse: "docker.ps", command: `{DOCKER_BIN} unpause {cName} && {DOCKER_BIN} ps -a ${PS}` },
      { id: "kill", label: "Force kill", mode: "captured", section: "manage", parse: "docker.ps", command: `{DOCKER_BIN} kill {cName} && {DOCKER_BIN} ps -a ${PS}` },
      { id: "exec", label: "Open a shell inside", mode: "terminal", section: "manage", command: "{DOCKER_BIN} exec -ti {cName} {cShell}" },
      { id: "attach", label: "Attach to the main process", mode: "terminal", section: "manage", command: "{DOCKER_BIN} attach {cName}" },
      { id: "logs-follow", label: "Follow logs", mode: "terminal", section: "manage", command: "{DOCKER_BIN} logs -f --tail {cTail} {cName}" },
      { id: "logs", label: "Last N log lines → file", mode: "captured", section: "manage", command: "{DOCKER_BIN} logs --tail {cTail} {cName} 2>&1 | tee '{out}'", output: "{timestamp}_{cName}_logs.txt" },
      { id: "stats", label: "Live resource stats", mode: "terminal", section: "manage", command: "{DOCKER_BIN} stats [[{cName}]]" },
      { id: "top", label: "Processes", mode: "captured", section: "manage", command: "{DOCKER_BIN} top {cName}" },
      { id: "port", label: "Published ports", mode: "captured", section: "files", command: "{DOCKER_BIN} port {cName}" },
      { id: "inspect", label: "Inspect → JSON file", mode: "captured", section: "files", command: "{DOCKER_BIN} inspect {cName} | tee '{out}'", output: "{timestamp}_{cName}_inspect.json" },
      { id: "diff", label: "Filesystem changes", mode: "captured", section: "files", command: "{DOCKER_BIN} diff {cName}" },
      { id: "cp", label: "Copy a path out of the container", mode: "captured", section: "files", command: "{DOCKER_BIN} cp {cName}:{cCpSrc} {cCpDest} && ls -lh {cCpDest}" },
      { id: "rm", label: "Remove container", mode: "captured", section: "cleanup", parse: "docker.ps", command: `{DOCKER_BIN} rm -f {cName} && {DOCKER_BIN} ps -a ${PS}` },
      { id: "stop-all", label: "Stop every running container", mode: "captured", section: "cleanup", parse: "docker.ps", command: `{DOCKER_BIN} ps -q | xargs -r {DOCKER_BIN} stop ; {DOCKER_BIN} ps -a ${PS}` },
      // Deliberately no -f: captured mode gives the child a stdin pipe that is
      // never written, so a prompt would hang. On a terminal, docker's own
      // "Are you sure? [y/N]" is the confirmation this codebase otherwise lacks.
      { id: "prune", label: "Prune stopped containers", mode: "terminal", section: "cleanup", command: "{DOCKER_BIN} container prune" },
    ],
    notesTitle: "Requirements",
    notes: [
      { label: "The docker service must be running", command: "sudo systemctl enable --now docker" },
      { label: "Your user must be in the docker group (use the Add-me badge above, then log out and back in) — listings are captured without a terminal, so they cannot answer a sudo prompt", command: 'sudo usermod -aG docker "$USER"' },
      {
        // The TUI warned about this before running; kali-rolling is a bare base image.
        label: "kalilinux/kali-rolling ships with no tools — install them inside the container (or kali-linux-large for the full set)",
        when: { field: "rPreset", equals: "kalilinux/kali-rolling" },
        command: "apt update && apt -y install kali-linux-headless",
      },
      { label: "If you must reach docker through sudo, set DOCKER_BIN to 'sudo -n docker' in Config and grant a passwordless rule — a captured run has no TTY, so a password prompt would hang forever", command: 'echo "$USER ALL=(root) NOPASSWD: $(command -v docker)" | sudo tee /etc/sudoers.d/virt-toolbox-docker' },
      { label: "Rootless docker and podman do not use the docker service or group, so those two badges stay red on an otherwise working setup — they are advisory" },
    ],
  },

  // ── images ──────────────────────────────────────────────────────────────────
  {
    id: "docker-images",
    label: "Images",
    category: "Container",
    verify: DOCKER_GATES,
    service: "docker",
    group: "docker",
    outputDir: "docker",
    sections: [
      { id: "browse", label: "Browse" },
      { id: "pull", label: "Pull & push" },
      { id: "build", label: "Build" },
      { id: "cleanup", label: "Storage" },
    ],
    fields: [
      // Global: Pull & push (tag) and Storage (save/rmi) both target it too.
      { id: "iRef", type: "text", label: "Image (name:tag or ID)", placeholder: "debian:stable-slim" },
      { id: "iFilter", type: "text", label: "Filter", section: "browse", placeholder: "dangling=true" },
      { id: "iAll", type: "check", label: "Include intermediate layers", section: "browse", flag: "-a" },
      { id: "pRef", type: "text", label: "Image to pull", section: "pull", default: "debian:stable-slim" },
      { id: "pPlatform", type: "select", label: "Platform", section: "pull", options: { "host default": "", "linux/amd64": "linux/amd64", "linux/arm64": "linux/arm64", "linux/arm/v7": "linux/arm/v7" }, default: "" },
      { id: "tNew", type: "text", label: "New tag / push target", section: "pull", placeholder: "ghcr.io/me/image:1.0" },
      { id: "bContext", type: "file", label: "Build context", section: "build", fileKind: "folder", required: true, help: "The folder containing your Dockerfile." },
      { id: "bDockerfile", type: "file", label: "Dockerfile", section: "build", help: "Blank uses <context>/Dockerfile." },
      { id: "bTag", type: "text", label: "Tag the result", section: "build", default: "myimage:latest" },
      { id: "bPlatform", type: "select", label: "Platform", section: "build", options: { "host default": "", "linux/amd64": "linux/amd64", "linux/arm64": "linux/arm64", "linux/arm/v7": "linux/arm/v7" }, default: "" },
      { id: "bArgs", type: "text", label: "Extra build flags", section: "build", placeholder: "--build-arg KEY=value --no-cache --progress plain" },
      { id: "lFile", type: "file", label: "Image tar to load", section: "cleanup" },
    ],
    actions: [
      { id: "ls", label: "List images", mode: "captured", section: "browse", parse: "docker.images", command: `{DOCKER_BIN} images {iAll} [[--filter {iFilter}]] ${IMG}` },
      { id: "history", label: "Layer history", mode: "captured", section: "browse", parse: "docker.history", command: "{DOCKER_BIN} history --format '{{.ID}}\\t{{.CreatedSince}}\\t{{.Size}}\\t{{.CreatedBy}}' {iRef}" },
      { id: "inspect", label: "Inspect → JSON file", mode: "captured", section: "browse", command: "{DOCKER_BIN} image inspect {iRef} | tee '{out}'", output: "{timestamp}_{iRef}_inspect.json" },
      // Terminal: pull/push draw progress bars, and login reads a password.
      { id: "pull", label: "Pull image", mode: "terminal", section: "pull", command: "{DOCKER_BIN} pull [[--platform {pPlatform}]] {pRef}" },
      { id: "tag", label: "Tag image", mode: "captured", section: "pull", parse: "docker.images", command: `{DOCKER_BIN} tag {iRef} {tNew} && {DOCKER_BIN} images ${IMG}` },
      { id: "push", label: "Push image", mode: "terminal", section: "pull", command: "{DOCKER_BIN} push {tNew}" },
      { id: "login", label: "Log in to a registry", mode: "terminal", section: "pull", command: "{DOCKER_BIN} login" },
      { id: "build", label: "Build image", mode: "terminal", section: "build", command: "{DOCKER_BIN} build -t {bTag} [[--platform {bPlatform}]] [[-f {bDockerfile}]] {bArgs} {bContext}" },
      { id: "save", label: "Save image → tar", mode: "captured", section: "cleanup", command: "{DOCKER_BIN} save {iRef} -o '{out}' && ls -lh '{out}'", output: "{timestamp}_{iRef}.tar" },
      { id: "load", label: "Load image from tar", mode: "captured", section: "cleanup", parse: "docker.images", command: `{DOCKER_BIN} load -i {lFile} && {DOCKER_BIN} images ${IMG}` },
      { id: "rmi", label: "Remove image", mode: "captured", section: "cleanup", parse: "docker.images", command: `{DOCKER_BIN} rmi {iRef} && {DOCKER_BIN} images ${IMG}` },
      { id: "df", label: "Disk usage", mode: "captured", section: "cleanup", parse: "docker.df", command: "{DOCKER_BIN} system df --format '{{.Type}}\\t{{.TotalCount}}\\t{{.Active}}\\t{{.Size}}\\t{{.Reclaimable}}'" },
      { id: "prune", label: "Prune dangling images", mode: "terminal", section: "cleanup", command: "{DOCKER_BIN} image prune" },
      { id: "prune-all", label: "Prune ALL unused images", mode: "terminal", section: "cleanup", command: "{DOCKER_BIN} image prune -a" },
      { id: "system-prune", label: "Reclaim space (system prune)", mode: "terminal", section: "cleanup", command: "{DOCKER_BIN} system prune" },
    ],
  },

  // ── networks ────────────────────────────────────────────────────────────────
  {
    id: "docker-networks",
    label: "Networks",
    category: "Container",
    verify: DOCKER_GATES,
    service: "docker",
    group: "docker",
    outputDir: "docker",
    sections: [
      { id: "manage", label: "Manage" },
      { id: "create", label: "Create" },
      { id: "connect", label: "Attach containers" },
    ],
    fields: [
      { id: "nName", type: "text", label: "Network", section: "manage", default: "bridge" },
      { id: "nFilter", type: "text", label: "Filter", section: "manage", placeholder: "driver=bridge" },
      { id: "ncName", type: "text", label: "Name", section: "create", default: "toolbox-net" },
      { id: "ncDriver", type: "select", label: "Driver", section: "create", options: ["bridge", "macvlan", "ipvlan", "overlay", "none"], default: "bridge" },
      { id: "ncSubnet", type: "text", label: "Subnet", section: "create", default: "172.20.0.0/16" },
      { id: "ncGateway", type: "text", label: "Gateway", section: "create", default: "172.20.0.1" },
      { id: "ncIpRange", type: "text", label: "IP range", section: "create", placeholder: "172.20.10.0/24" },
      // text, not `interface`: the host's interface list only enumerates NICs that
      // carry an IPv4 address, so a bare macvlan parent would be missing from it.
      { id: "ncParent", type: "text", label: "Parent interface", section: "create", placeholder: "eth0", when: { field: "ncDriver", in: ["macvlan", "ipvlan"] } },
      { id: "ncInternal", type: "check", label: "Internal (no outbound)", section: "create", flag: "--internal" },
      { id: "ncIpv6", type: "check", label: "Enable IPv6", section: "create", flag: "--ipv6" },
      { id: "nxNet", type: "text", label: "Network", section: "connect", default: "toolbox-net" },
      { id: "nxContainer", type: "text", label: "Container", section: "connect" },
      { id: "nxIp", type: "text", label: "Static IP", section: "connect", placeholder: "172.20.0.50" },
    ],
    actions: [
      { id: "ls", label: "List networks", mode: "captured", section: "manage", parse: "docker.networks", command: `{DOCKER_BIN} network ls [[--filter {nFilter}]] ${NET}` },
      { id: "inspect", label: "Inspect → JSON file", mode: "captured", section: "manage", command: "{DOCKER_BIN} network inspect {nName} | tee '{out}'", output: "{timestamp}_{nName}_network.json" },
      // Reuses the docker.ps parser: same output shape, so one parser per shape
      // rather than one per tool.
      { id: "members", label: "Containers on this network", mode: "captured", section: "manage", parse: "docker.ps", command: `{DOCKER_BIN} ps -a --filter network={nName} ${PS}` },
      { id: "rm", label: "Remove network", mode: "captured", section: "manage", parse: "docker.networks", command: `{DOCKER_BIN} network rm {nName} && {DOCKER_BIN} network ls ${NET}` },
      { id: "prune", label: "Prune unused networks", mode: "terminal", section: "manage", command: "{DOCKER_BIN} network prune" },
      { id: "create", label: "Create network", mode: "captured", section: "create", parse: "docker.networks", command: `{DOCKER_BIN} network create --driver {ncDriver} [[--subnet {ncSubnet}]] [[--gateway {ncGateway}]] [[--ip-range {ncIpRange}]] [[-o parent={ncParent}]] {ncInternal} {ncIpv6} {ncName} && {DOCKER_BIN} network ls ${NET}` },
      { id: "connect", label: "Connect a container", mode: "captured", section: "connect", parse: "docker.ps", command: `{DOCKER_BIN} network connect [[--ip {nxIp}]] {nxNet} {nxContainer} && {DOCKER_BIN} ps -a --filter network={nxNet} ${PS}` },
      { id: "disconnect", label: "Disconnect a container", mode: "captured", section: "connect", parse: "docker.ps", command: `{DOCKER_BIN} network disconnect {nxNet} {nxContainer} && {DOCKER_BIN} ps -a --filter network={nxNet} ${PS}` },
    ],
  },

  // ── volumes ─────────────────────────────────────────────────────────────────
  {
    id: "docker-volumes",
    label: "Volumes",
    category: "Container",
    verify: DOCKER_GATES,
    service: "docker",
    group: "docker",
    outputDir: "docker",
    sections: [
      { id: "manage", label: "Manage" },
      { id: "create", label: "Create" },
      { id: "backup", label: "Back up & restore" },
    ],
    fields: [
      // Global: Manage's size check runs it too, and a field outside the active
      // tab resolves to "", which would leave `docker run … du -sh /v` imageless.
      { id: "vbImage", type: "text", label: "Helper image", default: "alpine:latest", help: "A tiny image used only to read, tar and untar a volume's contents from the inside." },
      { id: "vName", type: "text", label: "Volume", section: "manage" },
      { id: "vFilter", type: "text", label: "Filter", section: "manage", placeholder: "dangling=true" },
      { id: "vcName", type: "text", label: "Name", section: "create", default: "toolbox-data" },
      { id: "vcDriver", type: "select", label: "Driver", section: "create", options: ["local"], default: "local" },
      { id: "vcOpts", type: "text", label: "Driver options (flags)", section: "create", placeholder: "-o type=nfs -o o=addr=10.0.0.1,rw" },
      { id: "vcLabels", type: "text", label: "Labels (flags)", section: "create", placeholder: "--label env=dev" },
      { id: "vbVolume", type: "text", label: "Volume", section: "backup" },
      { id: "vbTar", type: "file", label: "Backup archive to restore", section: "backup" },
    ],
    actions: [
      { id: "ls", label: "List volumes", mode: "captured", section: "manage", parse: "docker.volumes", command: `{DOCKER_BIN} volume ls [[--filter {vFilter}]] ${VOL}` },
      { id: "inspect", label: "Inspect → JSON file", mode: "captured", section: "manage", command: "{DOCKER_BIN} volume inspect {vName} | tee '{out}'", output: "{timestamp}_{vName}_volume.json" },
      { id: "users", label: "Containers using it", mode: "captured", section: "manage", parse: "docker.ps", command: `{DOCKER_BIN} ps -a --filter volume={vName} ${PS}` },
      // Sized from inside a container rather than with host `du`, which would need
      // sudo — and a captured run has no TTY to answer a password prompt with.
      { id: "du", label: "Size on disk", mode: "captured", section: "manage", command: "{DOCKER_BIN} run --rm -v {vName}:/v:ro {vbImage} du -sh /v" },
      { id: "rm", label: "Remove volume", mode: "captured", section: "manage", parse: "docker.volumes", command: `{DOCKER_BIN} volume rm {vName} && {DOCKER_BIN} volume ls ${VOL}` },
      { id: "prune", label: "Prune unused volumes", mode: "terminal", section: "manage", command: "{DOCKER_BIN} volume prune" },
      { id: "create", label: "Create volume", mode: "captured", section: "create", parse: "docker.volumes", command: `{DOCKER_BIN} volume create --driver {vcDriver} {vcOpts} {vcLabels} {vcName} && {DOCKER_BIN} volume ls ${VOL}` },
      // "$PWD" inside a captured run IS <outputsPath>/docker, and {out} is a bare
      // filename in that same folder, so the archive lands where the webview's
      // "Output file:" link points.
      { id: "backup", label: "Back up volume → tar.gz", mode: "captured", section: "backup", command: `{DOCKER_BIN} run --rm -v {vbVolume}:/data:ro -v "$PWD":/backup {vbImage} tar czf '/backup/{out}' -C /data . && ls -lh '{out}'`, output: "{timestamp}_{vbVolume}.tgz" },
      // Terminal: it overwrites live data. {vbTar} is a `file` field, so it arrives
      // single-quoted and survives a path with spaces inside the $( ) expansions.
      { id: "restore", label: "Restore tar.gz into volume", mode: "terminal", section: "backup", command: '{DOCKER_BIN} run --rm -v {vbVolume}:/data -v "$(dirname {vbTar})":/backup:ro {vbImage} tar xzf /backup/"$(basename {vbTar})" -C /data' },
    ],
  },

  // ── compose ─────────────────────────────────────────────────────────────────
  {
    id: "docker-compose",
    label: "Compose",
    category: "Container",
    verify: [
      ...DOCKER_GATES,
      {
        label: "compose plugin",
        command: "timeout 5 {DOCKER_BIN} compose version >/dev/null 2>&1 </dev/null",
        hint: "Compose v2 is a docker CLI plugin — install docker-compose-plugin, or point DOCKER_BIN at something that provides `compose`.",
      },
    ],
    service: "docker",
    group: "docker",
    outputDir: "docker",
    sections: [
      { id: "stack", label: "Stack" },
      { id: "services", label: "Services" },
      { id: "inspect", label: "Inspect" },
    ],
    fields: [
      // Global (no section) — every tab addresses the same stack. Named
      // composeFile, never `file`: a field id that collides with a config key or
      // with out/timestamp shadows it in the token map, and the manifest lint
      // only enforces per-tool uniqueness, so it would pass and misbehave.
      { id: "composeFile", type: "file", label: "Compose file", help: "docker-compose.yml / compose.yaml. Blank uses the one in the run directory." },
      { id: "project", type: "text", label: "Project name", help: "Defaults to the compose file's folder name." },
      { id: "envFile", type: "file", label: "Env file" },
      { id: "profile", type: "text", label: "Profile", placeholder: "dev" },
      { id: "service", type: "text", label: "Service", help: "Blank means every service." },
      { id: "detach", type: "check", label: "Detached", section: "stack", flag: "-d", default: "true" },
      { id: "rebuild", type: "check", label: "Rebuild images first", section: "stack", flag: "--build" },
      { id: "orphans", type: "check", label: "Remove orphans", section: "stack", flag: "--remove-orphans" },
      { id: "tail", type: "text", label: "Log lines", section: "services", default: "200" },
      { id: "cShell", type: "text", label: "Shell", section: "services", default: "/bin/sh" },
    ],
    actions: [
      { id: "up", label: "Up", mode: "terminal", section: "stack", command: `${C} up {detach} {rebuild} {orphans} [[{service}]]` },
      { id: "down", label: "Down", mode: "terminal", section: "stack", command: `${C} down {orphans}` },
      { id: "down-v", label: "Down + delete volumes", mode: "terminal", section: "stack", command: `${C} down --volumes {orphans}` },
      // Compose v2 dropped Go-template --format, so this is JSON — an array up to
      // 2.20 and NDJSON from 2.21, both of which docker.composePs accepts.
      { id: "ps", label: "Service status", mode: "captured", section: "stack", parse: "docker.composePs", command: `${C} ps -a --format json` },
      { id: "containers", label: "Project containers (detailed)", mode: "captured", section: "stack", parse: "docker.ps", when: { field: "project", truthy: true }, command: `{DOCKER_BIN} ps -a --filter label=com.docker.compose.project={project} ${PS}` },
      { id: "start", label: "Start", mode: "captured", section: "services", parse: "docker.composePs", command: `${C} start [[{service}]] && ${C} ps -a --format json` },
      { id: "stop", label: "Stop", mode: "captured", section: "services", parse: "docker.composePs", command: `${C} stop [[{service}]] && ${C} ps -a --format json` },
      { id: "restart", label: "Restart", mode: "captured", section: "services", parse: "docker.composePs", command: `${C} restart [[{service}]] && ${C} ps -a --format json` },
      { id: "build", label: "Build", mode: "terminal", section: "services", command: `${C} build [[{service}]]` },
      { id: "pull", label: "Pull images", mode: "terminal", section: "services", command: `${C} pull [[{service}]]` },
      { id: "exec", label: "Shell into a service", mode: "terminal", section: "services", command: `${C} exec {service} {cShell}` },
      { id: "run", label: "One-off run", mode: "terminal", section: "services", command: `${C} run --rm {service} {cShell}` },
      { id: "logs-follow", label: "Follow logs", mode: "terminal", section: "services", command: `${C} logs -f --tail {tail} [[{service}]]` },
      { id: "logs", label: "Last N log lines → file", mode: "captured", section: "services", command: `${C} logs --no-color --tail {tail} [[{service}]] 2>&1 | tee '{out}'`, output: "{timestamp}_compose_logs.txt" },
      { id: "config", label: "Validate & show merged config", mode: "captured", section: "inspect", command: `${C} config | tee '{out}'`, output: "{timestamp}_compose-config.yml" },
      { id: "images", label: "Images in use", mode: "terminal", section: "inspect", command: `${C} images` },
      { id: "top", label: "Processes", mode: "captured", section: "inspect", command: `${C} top` },
    ],
    notesTitle: "Compose",
    notes: [
      { label: "Compose v2 is a docker CLI plugin, invoked as `<DOCKER_BIN> compose` — verify it with", command: "{DOCKER_BIN} compose version" },
    ],
  },
];
