/**
 * Read-only query layer — pure functions over a store snapshot. The UI and
 * the AI tool layer both go through here; nothing reads store arrays directly.
 * Keep this surface stable so a persistent backend can replace the in-memory
 * store without touching callers.
 */
export * from "./portfolio";
export * from "./entities";
export * from "./lists";
export * from "./operations";
export * from "./buildings";
export * from "./units";
