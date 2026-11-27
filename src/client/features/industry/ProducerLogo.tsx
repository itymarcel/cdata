import { useState } from "react";
import type { CarbonMajor } from "@shared/types.ts";

/** "Saudi Aramco" → "SA", "BP" → "BP", "Gazprom" → "G", "China (Coal, 1945-2004)" → "C" */
export function initials(entity: string): string {
  const words = entity.replace(/\s*\(.*\)\s*$/, "").split(/[\s-]+/).filter((w) => /^[\p{L}\d]/u.test(w));
  if (words.length === 1) return /^[\p{Lu}\d]{2,}/u.test(words[0]!) ? words[0]!.slice(0, 2) : words[0]![0]!.toUpperCase();
  return words
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

/**
 * The producer's logo (its site's favicon or its Commons logo), or its flag for
 * nation states. Falls back to initials when Wikidata has nothing to offer.
 */
export function ProducerLogo({ producer }: { producer: CarbonMajor }) {
  const [failed, setFailed] = useState(false);
  const isState = producer.type === "Nation State";
  if (!producer.wikidata || failed) {
    return (
      <span className="producer-logo producer-logo--initials" aria-hidden="true">
        {initials(producer.entity)}
      </span>
    );
  }
  return (
    <img
      className={isState ? "flag" : "producer-logo"}
      src={`/api/producer-logo/${producer.wikidata}`}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}
