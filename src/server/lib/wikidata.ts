import { fetchJson } from "./http.ts";

interface SparqlResponse {
  results: { bindings: Record<string, { type: string; value: string }>[] };
}

/** Runs a SPARQL query against Wikidata and flattens the bindings to plain strings. */
export async function sparql(query: string): Promise<Record<string, string>[]> {
  const url = `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`;
  const res = await fetchJson<SparqlResponse>(url, {
    headers: { Accept: "application/sparql-results+json" },
    timeoutMs: 60_000,
  });
  return res.results.bindings.map((b) => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v.value])));
}

/** "Point(12.5 55.6)" → [12.5, 55.6] */
export function parseWktPoint(wkt: string | undefined): [number, number] | null {
  const m = wkt?.match(/Point\(([-\d.eE]+) ([-\d.eE]+)\)/);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

export const qid = (uri: string) => uri.replace("http://www.wikidata.org/entity/", "");
