/** Runtime configuration, read once from the environment. */
export const config = {
  port: Number(process.env.PORT ?? 3000),
  cacheDb: process.env.CACHE_DB ?? "data/cache.sqlite",
  isProduction: process.env.NODE_ENV === "production",
  schedulerEnabled: process.env.DISABLE_SCHEDULER !== "1",
  /** Identifies us politely to upstream servers without personal details. */
  userAgent: "climate-dashboard/0.1 (+open data viewer)",
} as const;
