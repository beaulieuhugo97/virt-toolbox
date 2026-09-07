import { Tool } from "../types";
import { tools as virtualization } from "./virtualization.tools";

// The single domain of this extension. Each *.tools.ts file exports a `tools`
// array grouped by category; this list is the registration (the bundle can't
// glob at runtime).
export const TOOLS: Tool[] = [...virtualization];
