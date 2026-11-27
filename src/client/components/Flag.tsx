import { useState } from "react";
import { iso3ToIso2 } from "@shared/iso.ts";

/**
 * A country's flag, sized to sit before its name in a list. Aggregates and
 * unknown codes get an empty slot of the same width, so names stay aligned.
 */
export function Flag({ iso3 }: { iso3: string }) {
  const iso2 = iso3ToIso2(iso3);
  const [failed, setFailed] = useState(false);
  if (!iso2 || failed) return <span className="flag flag--empty" aria-hidden="true" />;
  return <img className="flag" src={`/api/flag/${iso2}`} alt="" loading="lazy" onError={() => setFailed(true)} />;
}
