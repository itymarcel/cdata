import type { CarbonMajorsData } from "@shared/types.ts";
import { config } from "../config.ts";
import { logger } from "../lib/logger.ts";
import type { SourceStore } from "../lib/source-store.ts";

interface Image {
  body: ArrayBuffer;
  type: string;
}

const FAVICON = (host: string) => `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;
const COMMONS = (file: string) =>
  `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=96`;

async function fetchImage(url: string): Promise<Image | null> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": config.userAgent }, signal: AbortSignal.timeout(10_000) });
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || !type.startsWith("image/")) return null;
    return { body: await res.arrayBuffer(), type };
  } catch {
    return null;
  }
}

/**
 * Logos for Carbon Majors producers, fetched once and kept in memory. Only
 * Wikidata items present in the Carbon Majors payload are served, so the route
 * can't be used to fetch arbitrary URLs.
 *
 * Companies: the website's favicon first, since it is square and made to be
 * legible at 16–32 px, then the Commons logo (often a wide wordmark). Nation
 * states: their flag from Commons.
 */
export function createProducerLogos(store: SourceStore) {
  const images = new Map<string, Promise<Image | null>>();

  async function resolve(wikidata: string): Promise<Image | null> {
    const env = store.peek<CarbonMajorsData>("carbonMajors");
    const entity = env?.data.entities.find((e) => e.wikidata === wikidata);
    if (!entity) return null;
    const candidates: string[] = [];
    if (entity.website && entity.type !== "Nation State") {
      candidates.push(FAVICON(entity.website));
      // The favicon service sometimes knows "www.bp.com" but not "bp.com".
      if (!entity.website.startsWith("www.")) candidates.push(FAVICON(`www.${entity.website}`));
    }
    if (entity.image) candidates.push(COMMONS(entity.image));
    for (const url of candidates) {
      const image = await fetchImage(url);
      if (image) return image;
    }
    logger.debug(`No logo for ${entity.entity}`);
    return null;
  }

  return async function logo(wikidata: string): Promise<Response> {
    if (!/^Q\d+$/.test(wikidata)) return new Response("Bad id", { status: 400 });
    let image = images.get(wikidata);
    if (!image) {
      image = resolve(wikidata);
      images.set(wikidata, image);
    }
    const found = await image;
    if (!found) {
      images.delete(wikidata); // try again next time, the upstream may have been down
      return new Response("No logo", { status: 404, headers: { "Cache-Control": "public, max-age=86400" } });
    }
    return new Response(found.body, {
      headers: { "Content-Type": found.type, "Cache-Control": "public, max-age=604800" },
    });
  };
}
