import type { Collector } from "./types";
import { googleCollector } from "./google";
import { indianKanoonCollector } from "./indiankanoon";
import { privateCircleCollector } from "./privatecircle";
import { cibilCollector } from "./cibil";
import { mcaCollector } from "./mca";
import { filingsCollector } from "./filings";

// Registry — maps a source id (from config) to its collector implementation.
export const collectors: Record<string, Collector> = {
  google: googleCollector,
  indiankanoon: indianKanoonCollector,
  mca: mcaCollector,
  filings: filingsCollector,
  privatecircle: privateCircleCollector,
  cibil: cibilCollector,
};

export type { Collector, CollectorContext } from "./types";
