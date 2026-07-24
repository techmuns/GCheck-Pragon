import type { Collector } from "./types";
import { googleCollector } from "./google";
import { indianKanoonCollector } from "./indiankanoon";
import { privateCircleCollector } from "./privatecircle";
import { cibilCollector } from "./cibil";

// Registry — maps a source id (from config) to its collector implementation.
export const collectors: Record<string, Collector> = {
  google: googleCollector,
  indiankanoon: indianKanoonCollector,
  privatecircle: privateCircleCollector,
  cibil: cibilCollector,
};

export type { Collector, CollectorContext } from "./types";
