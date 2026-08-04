import { companyNameVariants } from "../lib/collectors/wikidata";
import { assembleBrief } from "../lib/assemble";
import { defaultConfig } from "../lib/config";
import type { CollectorResult, Subject } from "../lib/types";

// Offline coverage for the Company Snapshot density work — no network. Two things
// it locks in: the spelling-variant expansion that lets "CESC Ltd" reach the
// Wikidata entity labelled "CESC Limited", and the assembler surfacing registry
// master data + Wikidata profile facts as one cited corporate-parameter block.

let failed = 0;
function ok(cond: boolean, label: string) {
  console.log(`  ${cond ? "✓" : "✗"} ${label}`);
  if (!cond) failed++;
}

// ── 1. Spelling variants ─────────────────────────────────────────────────────
console.log("company-name variants expand the way Wikidata labels expect");
{
  const v = companyNameVariants("CESC Ltd").map((s) => s.toLowerCase());
  ok(v.includes("cesc limited"), '"CESC Ltd" tries "CESC Limited"');
  ok(v.includes("cesc"), '"CESC Ltd" falls back to bare "CESC"');
  ok(v[0] === "cesc ltd", "the original spelling is tried first");

  const r = companyNameVariants("Larsen & Toubro Ltd").map((s) => s.toLowerCase());
  ok(r.includes("larsen and toubro ltd"), '"&" expands to "and"');
  ok(r.includes("larsen & toubro limited"), '"Ltd" expands to "Limited"');

  // No corporate suffix → no runaway broadening (the bare strip is a no-op).
  const t = companyNameVariants("Tata Consultancy Services");
  ok(t.length <= 3, "a suffix-less name does not explode into many variants");
}

// ── 2. Snapshot assembly from registry + Wikidata ────────────────────────────
console.log("\nCompany Snapshot is a cited corporate-parameter block");
{
  const subject: Subject = { type: "company", company: "CESC Ltd", promoters: [] };
  const collected: CollectorResult[] = [
    {
      sourceId: "indiafilings",
      sourceName: "MCA Registry (IndiaFilings)",
      kind: "api",
      status: "done",
      hits: [
        {
          title: "CESC Limited — registry record",
          url: "https://www.indiafilings.com/search/company-cin-L31901WB1978PLC031411",
          entity: "CESC Limited",
          extra: {
            category: "company-master",
            cin: "L31901WB1978PLC031411",
            incorporatedOn: "28 March 1978",
            roc: "RoC-Kolkata",
            listing: "Listed",
            authorisedCapital: "₹3,156.00 Cr",
          },
        },
      ],
    },
    {
      sourceId: "wikidata",
      sourceName: "Wikidata (Directors)",
      kind: "api",
      status: "done",
      hits: [
        { title: "Founded: 1897", url: "https://www.wikidata.org/wiki/Q3348734", entity: "CESC Ltd", extra: { category: "company-fact", label: "Founded", value: "1897" } },
        { title: "Headquarters: Kolkata", url: "https://www.wikidata.org/wiki/Q3348734", entity: "CESC Ltd", extra: { category: "company-fact", label: "Headquarters", value: "Kolkata" } },
        { title: "Industry: electricity supply", url: "https://www.wikidata.org/wiki/Q3348734", entity: "CESC Ltd", extra: { category: "company-fact", label: "Industry", value: "electricity supply" } },
        { title: "R. P. Goenka — Founder", url: "https://www.wikidata.org/wiki/Q7273895", entity: "CESC Ltd", extra: { category: "leadership", role: "Founder" } },
      ],
    },
  ];

  const brief = assembleBrief(subject, collected, defaultConfig);
  const snap = brief.sections.find((s) => s.id === "snapshot");
  const lines = (snap?.findings ?? []).map((f) => f.text);
  const text = lines.join(" | ");

  ok(!!snap && !snap.empty, "the snapshot section renders");
  ok(lines.some((l) => l.includes("L31901WB1978PLC031411")), "registry CIN is shown");
  ok(lines.some((l) => l.startsWith("Incorporated: 28 March 1978")), "registry incorporation date is shown");
  ok(lines.some((l) => l.startsWith("Authorised capital:")), "registry capital is shown");
  ok(lines.some((l) => l.startsWith("Headquarters: Kolkata")), "Wikidata HQ adds a dimension the registry lacks");
  ok(lines.some((l) => l.startsWith("Industry:")), "Wikidata industry is shown");
  // "Founded" (Wikidata) must not repeat "Incorporated" (registry).
  ok(!lines.some((l) => l.startsWith("Founded:")), "Wikidata 'Founded' is suppressed when the registry gave 'Incorporated'");
  // Every snapshot line is cited.
  ok((snap?.findings ?? []).every((f) => typeof f.sourceRef === "number"), "every snapshot line carries a citation");

  // The founder is a person → Key People, never a snapshot line.
  ok(!text.includes("Goenka"), "the founder is not mis-filed into the snapshot");
  const people = brief.sections.find((s) => s.id === "management");
  ok((people?.findings ?? []).some((f) => f.text.includes("Goenka")), "the founder is in Key People");
}

console.log(failed === 0 ? "\nsnapshot builds a dense, cited corporate profile" : `\n${failed} check(s) FAILED`);
process.exit(failed === 0 ? 0 : 1);
