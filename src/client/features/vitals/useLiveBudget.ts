import { useEffect, useState } from "react";
import type { VitalSign } from "@shared/types.ts";
import { toDecimalYear } from "@shared/time.ts";

/**
 * Ticks a projected value every second between server refreshes, using the
 * parameters the server sent (start value, start date, rate). No constants here.
 */
export function useLiveValue(live: VitalSign["live"]): number | null {
  const [value, setValue] = useState<number | null>(null);
  useEffect(() => {
    if (!live) return;
    const tick = () => setValue(live.start - live.ratePerYear * (toDecimalYear(new Date()) - live.startT));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [live]);
  return live ? value : null;
}
