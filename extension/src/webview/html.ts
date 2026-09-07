import * as vscode from "vscode";

function nonce(): string {
  let s = "";
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    s += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return s;
}

/** The webview shell. Front-end logic and theme live in media/ and load by URI. */
export function getHtml(webview: vscode.Webview, mediaRoot: vscode.Uri, theme: string): string {
  const n = nonce();
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, "style.css"));
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, "main.js"));
  const csp = [
    `default-src 'none'`,
    `img-src ${webview.cspSource}`,
    `style-src ${webview.cspSource}`,
    `font-src ${webview.cspSource}`,
    `script-src 'nonce-${n}'`,
  ].join("; ");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link href="${styleUri}" rel="stylesheet" />
  <title>Virtualization Toolbox</title>
</head>
<body data-theme="${theme === "htb" ? "htb" : "adaptive"}">
  <div id="app">
    <div class="empty">Loading…</div>
  </div>
  <script nonce="${n}" src="${scriptUri}"></script>
</body>
</html>`;
}
