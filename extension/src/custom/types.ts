import * as vscode from "vscode";
import { ParsedTable } from "../parsers";

/** Uniform result of a custom-panel action, sent to the webview. */
export interface CustomResult {
  action: string;
  /** A single table to render. */
  table?: ParsedTable;
  /** Several titled tables (e.g. the email analyzer's header/URL/IP breakdown). */
  tables?: ParsedTable[];
  /** Updated directory/state string shown in the panel header. */
  dir?: string;
  /** A plain message (e.g. "no data" / "tool not found"). */
  message?: string;
  /** Panel-specific state the front-end renders itself (the wordlists table). */
  state?: unknown;
}

/** A bespoke panel behind the customPanel escape hatch — a host module the panel RPC dispatches to. */
export interface CustomPanelHost {
  /** Initial state posted with showCustom. */
  initial(): CustomResult | Promise<CustomResult>;
  /** Handle a webview customAction and return a result to render. */
  handle(action: string, payload: any): Promise<CustomResult>;
  /**
   * Results the panel pushes on its own, outside a request/response turn — a
   * download reporting progress, say. The host forwards each one to whichever
   * tab currently shows the panel.
   */
  onEvent?: vscode.Event<CustomResult>;
}
