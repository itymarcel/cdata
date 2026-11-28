/** Runtime configuration, read once from the environment. */
export const config = {
  port: Number(process.env.PORT ?? 3000),
  cacheDb: process.env.CACHE_DB ?? "data/cache.sqlite",
  /** Model files for the optional in-browser reader, kept as fetched (about 1–3 GB per model). */
  llmDir: process.env.LLM_CACHE_DIR ?? "data/llm",
  isProduction: process.env.NODE_ENV === "production",
  schedulerEnabled: process.env.DISABLE_SCHEDULER !== "1",
  /** Identifies us politely to upstream servers without personal details. */
  userAgent: "climate-dashboard/0.1 (+open data viewer)",
} as const;
