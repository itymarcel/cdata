import { logger } from "../lib/logger.ts";
import { qid, sparql } from "../lib/wikidata.ts";

/** What Wikidata says about a Carbon Majors entity, enough to show its logo. */
export interface ProducerIdentity {
  wikidata: string;
  /** Hostname of the official website (P856), for its favicon. */
  website?: string;
  /** Commons file name of the logo (P154), or of the flag (P41) for nation states. */
  image?: string;
}

export interface ProducerRef {
  entity: string;
  type: string;
  lei?: string;
}

/**
 * Carbon Majors lists a few states as producers. Their names are not Wikidata
 * labels ("Former Soviet Union"), so they are mapped to the state's item here,
 * and its flag stands in for a logo.
 */
const NATION_STATES: Record<string, string> = {
  China: "Q148",
  Poland: "Q36",
  "North Korea": "Q423",
  Czechoslovakia: "Q33946",
  "Former Soviet Union": "Q15180",
};

const LEI = /^[0-9A-Z]{18}[0-9]{2}$/;

/** "Rio Tinto (1959-2018)" → "Rio Tinto"; "China (Coal, 1945-2004)" → "China" */
export const baseName = (entity: string) => entity.replace(/\s*\(.*\)\s*$/, "").trim();

/** Labels to try for an entity without an LEI match: "Chevron" is "Chevron Corporation" on Wikidata. */
export function nameVariants(entity: string): string[] {
  const name = baseName(entity);
  const variants = new Set([name]);
  if (/ Corp\.$/.test(name)) variants.add(name.replace(/ Corp\.$/, " Corporation"));
  else if (!/ (Corporation|Company|Group)$/.test(name)) variants.add(`${name} Corporation`);
  return [...variants];
}

const literal = (s: string) => JSON.stringify(s);
const host = (url: string | undefined) => {
  try {
    return url ? new URL(url).hostname : undefined;
  } catch {
    return undefined;
  }
};
/** "http://commons.wikimedia.org/wiki/Special:FilePath/BP%20Helios%20logo.svg" → "BP Helios logo.svg" */
const commonsFile = (url: string | undefined) =>
  url ? decodeURIComponent(url.replace(/^https?:\/\/commons\.wikimedia\.org\/wiki\/Special:FilePath\//, "")) : undefined;

function toIdentity(row: Record<string, string>, imageKey: string): ProducerIdentity {
  return { wikidata: qid(row.item!), website: host(row.site), image: commonsFile(row[imageKey]) };
}

/**
 * Matches producers to Wikidata items: by LEI first (exact), then by English
 * label or alias among items with an industry, preferring exact names and the
 * best-known item. Unmatched producers are simply left out. Never throws: logos
 * are decoration, and the emissions data must load without them.
 */
export async function identifyProducers(refs: ProducerRef[]): Promise<Map<string, ProducerIdentity>> {
  const found = new Map<string, ProducerIdentity>();
  try {
    // Nation states: the state's flag.
    const states = refs.filter((r) => r.type === "Nation State" && NATION_STATES[baseName(r.entity)]);
    if (states.length) {
      const ids = [...new Set(states.map((r) => NATION_STATES[baseName(r.entity)]!))];
      // A state may have had several flags; the last one adopted is the one people know.
      const rows = await sparql(
        `SELECT ?item ?flag WHERE {
          VALUES ?item { ${ids.map((id) => `wd:${id}`).join(" ")} }
          ?item p:P41 ?st . ?st ps:P41 ?flag . OPTIONAL { ?st pq:P580 ?start }
          FILTER NOT EXISTS { ?st wikibase:rank wikibase:DeprecatedRank }
        } ORDER BY DESC(?start)`,
      );
      const byId = new Map<string, ProducerIdentity>();
      for (const row of rows) if (!byId.has(qid(row.item!))) byId.set(qid(row.item!), toIdentity(row, "flag"));
      for (const r of states) {
        const identity = byId.get(NATION_STATES[baseName(r.entity)]!);
        if (identity) found.set(r.entity, identity);
      }
    }

    // Companies and state-owned entities with a valid LEI.
    const withLei = refs.filter((r) => r.type !== "Nation State" && r.lei && LEI.test(r.lei));
    if (withLei.length) {
      const rows = await sparql(
        `SELECT ?lei ?item ?logo ?site WHERE {
          VALUES ?lei { ${withLei.map((r) => literal(r.lei!)).join(" ")} }
          ?item wdt:P1278 ?lei .
          OPTIONAL { ?item wdt:P154 ?logo } OPTIONAL { ?item wdt:P856 ?site }
        }`,
      );
      const byLei = new Map<string, ProducerIdentity>();
      for (const row of rows) if (!byLei.has(row.lei!)) byLei.set(row.lei!, toIdentity(row, "logo"));
      for (const r of withLei) {
        const identity = byLei.get(r.lei!);
        if (identity) found.set(r.entity, identity);
      }
    }

    // Everyone else, by name.
    const rest = refs.filter((r) => r.type !== "Nation State" && !found.has(r.entity));
    if (rest.length) {
      const names = [...new Set(rest.flatMap((r) => nameVariants(r.entity)))];
      const rows = await sparql(
        `SELECT ?name ?item ?logo ?site ?links WHERE {
          VALUES ?name { ${names.map((n) => `${literal(n)}@en`).join(" ")} }
          ?item rdfs:label|skos:altLabel ?name ; wdt:P452 [] ; wikibase:sitelinks ?links .
          OPTIONAL { ?item wdt:P154 ?logo } OPTIONAL { ?item wdt:P856 ?site }
        }`,
      );
      for (const r of rest) {
        const [exact, ...others] = nameVariants(r.entity);
        const score = (row: Record<string, string>) => (row.name === exact ? 1e6 : 0) + Number(row.links ?? 0);
        const best = rows
          .filter((row) => row.name === exact || others.includes(row.name!))
          .sort((a, b) => score(b) - score(a))[0];
        if (best) found.set(r.entity, toIdentity(best, "logo"));
      }
    }
  } catch (err) {
    logger.warn(`Producer logos unavailable: ${err instanceof Error ? err.message : String(err)}`);
  }
  return found;
}
