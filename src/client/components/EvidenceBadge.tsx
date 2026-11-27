import type { Evidence } from "@shared/types.ts";
import { EVIDENCE_LABEL } from "../lib/colors.ts";
import "./components.css";

/** Shape, not just colour, carries the evidence type so it survives greyscale and colour-blindness. */
const GLYPH: Record<Evidence, string> = {
  observed: "●",
  modelled: "◐",
  reported: "○",
  curated: "◆",
};

export function EvidenceBadge({ evidence, compact = false }: { evidence: Evidence; compact?: boolean }) {
  return (
    <span className={`evidence evidence--${evidence}`} title={EVIDENCE_LABEL[evidence]}>
      <span aria-hidden="true">{GLYPH[evidence]}</span>
      {compact ? <span className="visually-hidden">{evidence}</span> : <span>{evidence}</span>}
    </span>
  );
}

export function EvidenceLegend() {
  return (
    <div className="evidence-legend">
      {(Object.keys(GLYPH) as Evidence[]).map((e) => (
        <EvidenceBadge key={e} evidence={e} />
      ))}
    </div>
  );
}
