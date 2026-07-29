"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import type {
  CaseRow,
  Concern,
  Development,
  Person,
  PrintBrief,
  SourceQualityRow,
  SourceRef,
} from "@/lib/printBrief";

// ── One-page A4-portrait pre-meeting brief (print / PDF) ─────────────────────
// A purpose-built institutional report, not a print of the on-screen dashboard.
// Fixed structure, dynamic content: every section caps its rows, collapses when
// empty, and the whole thing is engineered to land on exactly one page. All the
// ranking/capping/claim-typing is done upstream in buildPrintBrief — this file
// is layout only.
//
// It is portalled to <body> so a single print rule can isolate it: the app is
// hidden and only this one page is rendered to PDF. Hidden on screen (it appears
// only when printing, or in the /print-preview harness).

export default function BriefPrint({ brief }: { brief: PrintBrief }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setHost(document.body);
  }, []);
  if (!host) return null;
  return createPortal(<PrintDoc brief={brief} />, host);
}

// Every inline [n] resolves against this map, so a citation number is a live
// link to the source itself — no scrolling to the appendix to follow a claim.
const SourceUrls = createContext<Record<number, string>>({});

/** A citation number. Renders as a link wherever the source has a URL. */
function Ref({ n }: { n?: number }) {
  const urls = useContext(SourceUrls);
  if (n === undefined) return null;
  const url = urls[n];
  if (!url) return <span className="pb-ref">[{n}]</span>;
  return (
    <a className="pb-ref pb-ref-link" href={url} target="_blank" rel="noreferrer" title={url}>
      [{n}]
    </a>
  );
}

function PrintDoc({ brief }: { brief: PrintBrief }) {
  return (
    <SourceUrls.Provider value={brief.sourceUrls}>
    <div className="pb-root">
      <div className="pb-page">
        <Header brief={brief} />
        <VerdictRow brief={brief} />
        <SummaryStrip brief={brief} />
        {/* Portrait is ~90mm narrower than landscape, so the key–value snapshot
            runs full width as a band rather than crowding a column. */}
        <Snapshot fields={brief.snapshot} />

        <div className="pb-body">
          {/* Left: the analysis. Right: the record it rests on. The itemised
              concerns carry their own facts now, so the timeline moves across
              to keep the two columns near the same depth. */}
          <div className="pb-col pb-col-left">
            <ExecutiveVerdict text={brief.executive} />
            <KeyConcerns concerns={brief.concerns} extra={brief.extraConcerns} />
          </div>

          <div className="pb-col pb-col-right">
            <KeyPeople people={brief.people} extra={brief.extraPeople} isDirector={brief.isDirector} />
            <Cases cases={brief.cases} extra={brief.extraCases} />
            <RecentDevelopments items={brief.developments} extra={brief.extraDevelopments} />
            <SourceQuality rows={brief.sourceQuality} gaps={brief.researchGaps} />
          </div>
        </div>

        <Footer brief={brief} />
      </div>
    </div>
    </SourceUrls.Provider>
  );
}

// ── Header ────────────────────────────────────────────────────────────────────

function Header({ brief }: { brief: PrintBrief }) {
  return (
    <header className="pb-header">
      {/* Brand and date share the top rule; the subject title takes the full
          page width beneath it — portrait has none to spare on flanking. */}
      <div className="pb-header-top">
        <div className="pb-brand">
          <span className="pb-brand-mark">Paragon</span>
          <span className="pb-brand-sep">|</span>
          <span className="pb-brand-sub">Pre-Meeting Research</span>
        </div>
        <div className="pb-gen">
          <span className="pb-gen-label">Generated</span>
          <span className="pb-gen-val">{brief.generatedAt}</span>
        </div>
      </div>
      <div className="pb-title-wrap">
        <h1 className="pb-title">{brief.company}</h1>
        {brief.subtitle && <div className="pb-subtitle">{brief.subtitle}</div>}
      </div>
    </header>
  );
}

function VerdictRow({ brief }: { brief: PrintBrief }) {
  return (
    <div className="pb-verdict-row">
      <p className="pb-verdict">{brief.verdictSentence}</p>
      <span className={`pb-pill pb-tone-${brief.pill.tone}`}>{brief.pill.label}</span>
    </div>
  );
}

// ── Summary strip ─────────────────────────────────────────────────────────────

function SummaryStrip({ brief }: { brief: PrintBrief }) {
  return (
    <div className="pb-strip">
      {brief.metrics.map((m, i) => (
        <div className="pb-metric" key={i}>
          <div className={`pb-metric-val pb-fg-${m.tone}`}>
            <span className={`pb-dot pb-bg-${m.tone}`} />
            {m.value}
          </div>
          <div className="pb-metric-label">{m.label}</div>
        </div>
      ))}
    </div>
  );
}

// ── Section shell ─────────────────────────────────────────────────────────────

function Section({
  title,
  meta,
  className,
  children,
}: {
  title: string;
  meta?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={className ? `pb-section ${className}` : "pb-section"}>
      <div className="pb-head">
        <span className="pb-head-title">{title}</span>
        {meta && <span className="pb-head-meta">{meta}</span>}
      </div>
      {children}
    </section>
  );
}

// ── Left column ────────────────────────────────────────────────────────────────

function ExecutiveVerdict({ text }: { text: string }) {
  return (
    <Section title="Executive Verdict">
      <p className="pb-exec">{text}</p>
    </Section>
  );
}

function claimClass(claim: string): string {
  switch (claim) {
    case "Verified":
      return "pb-claim-verified";
    case "Alleged":
      return "pb-claim-alleged";
    case "Under review":
      return "pb-claim-review";
    default:
      return "pb-claim-reported";
  }
}

function KeyConcerns({ concerns, extra }: { concerns: Concern[]; extra: number }) {
  if (concerns.length === 0) {
    return (
      <Section title="Key Concerns">
        <div className="pb-clear">
          <span className="pb-dot pb-bg-green" />
          No red-flag or review-level concerns surfaced across the sources that completed.
        </div>
      </Section>
    );
  }
  return (
    <Section title="Key Concerns" meta={extra > 0 ? `+${extra} more in dashboard` : undefined}>
      <ul className="pb-concerns">
        {concerns.map((c, i) => (
          <ConcernCard c={c} key={i} />
        ))}
      </ul>
    </Section>
  );
}

// The card leads with the matter itself, then the hard facts (who it names,
// which authority, how much, as of when), then the source's own words, then the
// consequence — so a reader knows exactly what the issue is without opening the
// citation. The category is demoted to a chip; it is the least useful line.
function ConcernCard({ c }: { c: Concern }) {
  return (
    <li className={`pb-concern pb-edge-${c.tone}`}>
      <div className="pb-concern-top">
        <span className="pb-concern-title">{c.title}</span>
        <span className={`pb-claim ${claimClass(c.claim)}`}>{c.claim}</span>
        <Ref n={c.sourceRef} />
      </div>
      <div className="pb-concern-facts">
        <span className={`pb-cat pb-cat-${c.tone}`}>{c.category}</span>
        {c.facts.map((f, i) => (
          <span className="pb-fact" key={i}>
            <span className="pb-fact-label">{f.label}</span> {f.value}
          </span>
        ))}
      </div>
      {c.evidence && (
        <div className="pb-concern-evidence">
          &ldquo;{c.evidence}&rdquo;
          {c.evidenceSource && <span className="pb-evidence-src"> — {c.evidenceSource}</span>}
        </div>
      )}
      <div className="pb-concern-why">
        <span className="pb-why-label">So what</span> {c.whyItMatters}
      </div>
    </li>
  );
}

function RecentDevelopments({ items, extra }: { items: Development[]; extra: number }) {
  if (items.length === 0) return null;
  return (
    <Section title="Recent Developments" meta={extra > 0 ? `+${extra} more` : undefined}>
      <ul className="pb-devs">
        {items.map((d, i) => (
          <li className="pb-dev" key={i}>
            <span className="pb-dev-date">{d.date ?? "—"}</span>
            <span className="pb-dev-head">{d.headline}</span>
            <span className={`pb-dev-status pb-fg-${d.tone}`}>
              {d.status}
              <Ref n={d.sourceRef} />
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

// ── Right column ───────────────────────────────────────────────────────────────

function Snapshot({ fields }: { fields: PrintBrief["snapshot"] }) {
  if (fields.length === 0) return null;
  return (
    <Section title="Company Snapshot" className="pb-band">
      <dl className="pb-snap">
        {fields.map((f, i) => (
          <div className="pb-snap-item" key={i}>
            <dt className="pb-snap-label">{f.label}</dt>
            <dd className="pb-snap-val">{f.value}</dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}

function KeyPeople({ people, extra, isDirector }: { people: Person[]; extra: number; isDirector: boolean }) {
  if (people.length === 0) return null;
  return (
    <Section title={isDirector ? "Associated People" : "Key People"} meta={extra > 0 ? `+${extra} more` : undefined}>
      <table className="pb-table">
        <colgroup>
          <col style={{ width: "50%" }} />
          <col style={{ width: "32%" }} />
          <col style={{ width: "18%" }} />
        </colgroup>
        <tbody>
          {people.map((p, i) => (
            <tr key={i}>
              <td className="pb-clip">
                <span className="pb-person-name">{p.name}</span>
              </td>
              <td className="pb-clip">{p.role ?? "—"}</td>
              <td className={`pb-num pb-clip ${p.flag ? "pb-fg-amber" : ""}`} title={p.flag}>
                {p.tenure ?? "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

function Cases({ cases, extra }: { cases: CaseRow[]; extra: number }) {
  if (cases.length === 0) return null;
  return (
    <Section title="Court & Regulatory" meta={extra > 0 ? `+${extra} more` : undefined}>
      <table className="pb-table">
        <colgroup>
          <col style={{ width: "27%" }} />
          <col style={{ width: "46%" }} />
          <col style={{ width: "27%" }} />
        </colgroup>
        <tbody>
          {cases.map((c, i) => (
            <tr key={i}>
              <td className="pb-date-col pb-clip">{c.date ?? "—"}</td>
              <td>
                <span className="pb-case-name pb-clip-b">{c.name}</span>
                {c.authority && <span className="pb-case-auth pb-clip-b">{c.authority}</span>}
              </td>
              <td className="pb-clip">
                <span className={`pb-status pb-fg-${c.tone}`}>{c.status}</span>
                <Ref n={c.sourceRef} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

function SourceQuality({ rows, gaps }: { rows: SourceQualityRow[]; gaps: string[] }) {
  return (
    <Section title="Source Quality">
      <ul className="pb-sq">
        {rows.map((r, i) => (
          <li className="pb-sq-item" key={i}>
            <span className={`pb-dot pb-bg-${r.tone}`} />
            <span className="pb-sq-label">{r.label}</span>
            <span className={`pb-sq-count ${r.count === 0 ? "pb-sq-zero" : ""}`}>{r.count}</span>
          </li>
        ))}
      </ul>
      {gaps.length > 0 && (
        <div className="pb-gaps">
          <div className="pb-gaps-label">Research gaps</div>
          <ul className="pb-gaps-list">
            {gaps.map((g, i) => (
              <li key={i}>{g}</li>
            ))}
          </ul>
        </div>
      )}
    </Section>
  );
}

// ── Footer (sources + disclaimer) ────────────────────────────────────────────

function Footer({ brief }: { brief: PrintBrief }) {
  return (
    <footer className="pb-footer">
      <div className="pb-sources-head">
        <span className="pb-head-title">Sources</span>
        {brief.extraSources > 0 && (
          <span className="pb-head-meta">+{brief.extraSources} additional sources available in the dashboard</span>
        )}
      </div>
      <ol className="pb-sources">
        {brief.sources.map((s) => (
          <SourceItem s={s} key={s.ref} />
        ))}
      </ol>
      <div className="pb-disclaimer">{brief.disclaimer}</div>
    </footer>
  );
}

function SourceItem({ s }: { s: SourceRef }) {
  // The whole entry — reference number included — is the clickable link when a
  // URL exists, so citation numbers are live in the exported PDF.
  return (
    <li className="pb-source">
      {s.url ? (
        <a className="pb-source-link" href={s.url} target="_blank" rel="noreferrer">
          <span className="pb-ref">[{s.ref}]</span> {s.label}
        </a>
      ) : (
        <>
          <span className="pb-ref">[{s.ref}]</span> {s.label}
        </>
      )}
    </li>
  );
}
