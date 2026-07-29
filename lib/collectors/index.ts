import type { Collector } from "./types";
import { googleCollector } from "./google";
import { indianKanoonCollector } from "./indiankanoon";
import { privateCircleCollector } from "./privatecircle";
import { cibilCollector } from "./cibil";
import { wikidataCollector } from "./wikidata";
import { registryCollector } from "./registry";
import { indiafilingsCollector } from "./indiafilings";
import { newsCollector } from "./news";
import { filingsCollector } from "./filings";

// Registry — maps a source id (from config) to its collector implementation.
export const collectors: Record<string, Collector> = {
  google: googleCollector,
  news: newsCollector,
  indiankanoon: indianKanoonCollector,
  wikidata: wikidataCollector,
  indiafilings: indiafilingsCollector,
  registry: registryCollector,
  filings: filingsCollector,
  privatecircle: privateCircleCollector,
  cibil: cibilCollector,
};

export type { Collector, CollectorContext } from "./types";
