/** Re-exported so runtime/office.ts does not pull the whole config module graph. */

export type { ConfigError as ConfigErrorLike } from "./errors.js";
export type { ToolNameResolver, ValidateOptions } from "./validate.js";
export { validateAgents } from "./validate.js";
