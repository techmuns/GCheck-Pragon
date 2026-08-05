"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import type {
  CaseRow,
  Concern,
  Development,
  Person,
  PositiveRow,
  PrintBrief,
  PrintDiligencePerson,
  PrintNetwork,
  PrintProfile,
  PrintRisk,
  PrintScope,
  SourceQualityRow,
  SourceRef,
} from "@/lib/printBrief";

// ── A4-portrait pre-meeting brief (print / PDF) ──────────────────────────────
// A purpose-built institutional report, not a print of the on-screen dashboard.
// Fixed structure, dynamic content: every section caps its rows, collapses when
// empty, and the executive brief is engineered to land on exactly one page. When
// a profile was read, a second detail page follows it — the answer to "who is
// this?" wants room the first page does not have. All the ranking/capping/
// claim-typing is done upstream in buildPrintBrief — this file is layout only.
//
// It is portalled to <body> so a single print rule can isolate it: the app is
// hidden and only this one page is rendered to PDF. Hidden on screen (it appears
// only when printing, or in the /print-preview harness).

/**
 * Which document to print.
 *
 * "detailed" is the whole record — the executive sheet, the profile, and the
 * continuation carrying the risk read, the board, the network, the scope and
 * what was set aside. "onepager" is the executive sheet alone: the same
 * analysis, on one side of A4, for the reader who is about to walk into the
 * meeting and wants the answer rather than the file behind it.
 *
 * Deliberately a cut rather than a second layout. Both are the same component
 * over the same data, so the short one can never say something the long one
 * does not — which is the failure mode any "summary version" invites.
 */
export type PrintVariant = "detailed" | "onepager";

export default function BriefPrint({
  brief,
  variant = "detailed",
}: {
  brief: PrintBrief;
  variant?: PrintVariant;
}) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setHost(document.body);
  }, []);
  if (!host) return null;
  return createPortal(<PrintDoc brief={brief} variant={variant} />, host);
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

function PrintDoc({ brief, variant }: { brief: PrintBrief; variant: PrintVariant }) {
  const full = variant !== "onepager";
  return (
    <SourceUrls.Provider value={brief.sourceUrls}>
    <div className="pb-root">
      <div className="pb-page">
        <Header brief={brief} />
        <VerdictRow brief={brief} />
        <SummaryStrip brief={brief} />
        {/* Portrait is ~90mm narrower than landscape, so the key–value snapshot
            runs full width as a band rather than crowding a column. */}
        <Snapshot fields={brief.snapshot} isDirector={brief.isDirector} />

        <div className="pb-body">
          {/* Left: the analysis. Right: the record it rests on. The itemised
              concerns carry their own facts now, so the timeline moves across
              to keep the two columns near the same depth. */}
          <div className="pb-col pb-col-left">
            <ExecutiveVerdict text={brief.executive} />
            <KeyConcerns concerns={brief.concerns} extra={brief.extraConcerns} emptyText={brief.concernsEmptyText} />
          </div>

          <div className="pb-col pb-col-right">
            {/* On a director screen the first thing a reader wants is where
                this person actually sits. The slot used to carry a board list,
                which on a director run is a roster of other people's
                colleagues — and, worse, was fed from rows stamped with the
                subject's own name, so it listed the subject as their own
                associate. Their directorships are the answer to the question
                the search asked. */}
            {brief.isDirector ? (
              <DirectorIn rows={brief.directorships} />
            ) : (
              <KeyPeople people={brief.people} extra={brief.extraPeople} isDirector={false} />
            )}
            <Cases cases={brief.cases} extra={brief.extraCases} />
            <RecentDevelopments items={brief.developments} extra={brief.extraDevelopments} />
            <PositiveSignals items={brief.positives} extra={brief.extraPositives} />
            <SourceQuality rows={brief.sourceQuality} gaps={brief.researchGaps} />
          </div>
        </div>

        <Footer brief={brief} />
      </div>

      {/* Second page: the full profile. Prints only when one was read, and only
          for the detailed record — the one-pager stops at the sheet above. */}
      {full && brief.profile && <ProfilePage brief={brief} profile={brief.profile} />}

      {/* Continuation: the scored risk read, the board diligence, the network
          and the scope — everything the dashboard shows that the one-page
          executive brief has no room for. Flows across as many pages as needed,
          so no director is ever dropped. */}
      {full && <ReportContinuation brief={brief} />}
    </div>
    </SourceUrls.Provider>
  );
}

// ── Continuation (flowing pages) ─────────────────────────────────────────────
// Unlike the fixed executive/profile sheets, this section flows: a named print
// page gives it margins, and break-inside rules keep a card or a row from
// splitting across the fold. This is what lets the whole board appear without
// being clipped to fit one sheet.

function ReportContinuation({ brief }: { brief: PrintBrief }) {
  return (
    <div className="pb-flow">
      <RiskBlock risk={brief.risk} />
      {brief.diligence.length > 0 && <DiligenceBlock people={brief.diligence} />}
      {brief.network && <NetworkBlock network={brief.network} />}
      <RelatedBlock rows={brief.related} />
      <DirectorshipsBlock rows={brief.directorships} />
      <ScopeBlock scope={brief.scope} generatedAt={brief.generatedAt} />
      <ClarificationsBlock rows={brief.clarifications} />
      <MethodologyBlock risk={brief.risk} />
    </div>
  );
}

// The registry footprint, in full. Lives in the continuation rather than the
// executive sheet: eight entities is a table, and the sheet's job is the answer,
// not the file behind it. The one-pager drops the continuation entirely, which
// is the right cut — a reader who asked for one page did not ask for this.
function DirectorshipsBlock({ rows }: { rows: PrintBrief["directorships"] }) {
  if (rows.length === 0) return null;
  const flagged = rows.filter((r) => r.tone === "amber").length;
  return (
    <section className="pb-flow-section">
      <div className="pb-flow-head">
        Registry Footprint
        <span className="pb-flow-head-meta">
          {rows.length} {rows.length === 1 ? "entity" : "entities"}
          {flagged > 0 ? ` · ${flagged} not in good standing` : ""}
        </span>
      </div>
      <table className="pb-dir-table">
        <thead>
          <tr>
            <th>Identifier</th>
            <th>Entity</th>
            <th>Type</th>
            <th>Joined</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${r.id}-${i}`}>
              <td className="pb-dir-id">{r.id || "—"}</td>
              <td>
                {r.name}
                <Ref n={r.sourceRef} />
              </td>
              <td>{r.kind === "llp" ? "LLP" : "Company"}</td>
              {/* Blank where the run had no budget to open that company's page.
                  The register publishes the joining date on the company's board
                  table, not on the person's — so this is genuinely unknown here
                  rather than missing, and is left blank instead of guessed. */}
              <td className="pb-dir-date">{r.joinedOn || "—"}</td>
              <td className={`pb-dir-status pb-fg-${r.tone}`}>{r.status || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

// What the run looked at and did not count. Sits after Scope because it answers
// the question Scope raises: a source listed as "Covered" that produced nothing
// on the page is otherwise indistinguishable from one that was never reached.
function ClarificationsBlock({ rows }: { rows: PrintBrief["clarifications"] }) {
  if (rows.length === 0) return null;
  return (
    <section className="pb-flow-section">
      <div className="pb-flow-head">Considered &amp; Not Counted</div>
      <p className="pb-scope-statement">
        Searches that returned nothing, and material that surfaced under the subject&apos;s name and was
        set aside — so a quiet section reads as checked rather than skipped.
      </p>
      <ul className="pb-clar-list">
        {rows.map((r, i) => (
          <li key={i} className="pb-clar-row">
            <div className="pb-clar-head">
              <span className="pb-scope-name">{r.source}</span>
              <span className="pb-clar-text">{r.text}</span>
            </div>
            {r.items.length > 0 && (
              <ul className="pb-clar-items">
                {r.items.map((it, j) => (
                  <li key={j}>
                    <span className="pb-clar-title">{it.title}</span>
                    <span className="pb-clar-reason">{it.reason}</span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function RiskBlock({ risk }: { risk: PrintRisk }) {
  return (
    <section className="pb-flow-section pb-flow-lead">
      <div className="pb-flow-head">Governance Risk Score</div>
      <div className="pb-risk-top">
        <div className="pb-risk-scorewrap">
          <span className={`pb-risk-score pb-fg-${risk.tone}`}>{risk.score}</span>
          <span className="pb-risk-outof">/ 100</span>
          <span className={`pb-pill pb-tone-${risk.tone}`}>{risk.bandLabel}</span>
        </div>
        <div className="pb-risk-meter">
          <div className={`pb-risk-meter-fill pb-bg-${risk.tone}`} style={{ width: `${risk.score}%` }} />
        </div>
        <div className="pb-risk-scale">
          <span>Low</span>
          <span>Moderate</span>
          <span>Elevated</span>
          <span>High</span>
        </div>
      </div>

      {risk.contributions.length > 0 && (
        <ul className="pb-risk-contribs">
          {risk.contributions.map((c, i) => (
            <li key={i} className="pb-risk-contrib">
              <span className="pb-risk-contrib-label">
                {c.label}
                {c.detail && <span className="pb-risk-contrib-detail"> — {c.detail}</span>}
              </span>
              <span className={`pb-risk-contrib-pts ${c.points > 0 ? `pb-fg-${risk.tone}` : "pb-fg-neutral"}`}>
                {c.points > 0 ? `+${c.points}` : "note"}
              </span>
            </li>
          ))}
        </ul>
      )}

      {(risk.coveragePartial || risk.uncorroborated) && (
        <p className="pb-risk-caveat">
          {risk.coveragePartial && "Rests on partial coverage — a low score here is not a clean bill of health. "}
          {risk.uncorroborated && "The sharpest finding is single-source (press), with no official or court record behind it."}
        </p>
      )}

    </section>
  );
}

/**
 * How the score was arrived at — weights, bands, corroboration rules.
 *
 * Deliberately the last thing in the document. It used to sit inside the score
 * block, which put a wall of scoring rules between the score and the board it
 * was scoring: the reader met the method before they had met the findings. The
 * report now runs highest-value first — verdict, score, board, network, the
 * register — and the workings are where workings belong, at the back, for the
 * reader who wants to audit the number rather than read it.
 */
function MethodologyBlock({ risk }: { risk: PrintRisk }) {
  if (risk.methodology.length === 0) return null;
  return (
    <section className="pb-flow-section">
      <div className="pb-method">
        <div className="pb-method-label">Methodology</div>
        <ol>
          {risk.methodology.map((m, i) => (
            <li key={i}>{m}</li>
          ))}
        </ol>
      </div>
    </section>
  );
}

const DILIGENCE_TONE_LABEL: Record<PrintDiligencePerson["tone"], string> = {
  red: "pb-edge-red",
  amber: "pb-edge-amber",
  green: "pb-edge-green",
  neutral: "pb-edge-neutral",
};

function DiligenceBlock({ people }: { people: PrintDiligencePerson[] }) {
  const flaggedRed = people.filter((p) => p.verdict === "red").length;
  const flaggedAmber = people.filter((p) => p.verdict === "amber").length;
  return (
    <section className="pb-flow-section">
      <div className="pb-flow-head">
        Board Diligence
        <span className="pb-flow-head-meta">
          {people.length} director(s){flaggedRed > 0 ? ` · ${flaggedRed} red` : ""}
          {flaggedAmber > 0 ? ` · ${flaggedAmber} to review` : ""} — each screened by DIN
        </span>
      </div>
      <ul className="pb-dili">
        {people.map((p, i) => (
          <li key={i} className={`pb-dili-card ${DILIGENCE_TONE_LABEL[p.tone]}`}>
            <div className="pb-dili-top">
              <span className="pb-dili-name">{p.name}</span>
              <span className={`pb-claim pb-tone-${p.tone}`}>{p.verdictLabel}</span>
            </div>
            <div className="pb-dili-meta">
              {[p.role, p.din ? `DIN ${p.din}` : null, p.tenure ? `${p.tenure} tenure` : null].filter(Boolean).join(" · ")}
            </div>
            {p.headline && <div className="pb-dili-headline">{p.headline}</div>}
            {p.concerns.length > 0 && (
              <ul className="pb-dili-concerns">
                {p.concerns.map((c, j) => (
                  <li key={j} className="pb-dili-concern">
                    <span className={`pb-dot pb-bg-${c.tone}`} />
                    <span>
                      {c.text}
                      <Ref n={c.sourceRef} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {p.companies.length > 0 && (
              <div className="pb-dili-cos">
                <span className="pb-dili-cos-label">Also linked to</span> {p.companies.join(" · ")}
              </div>
            )}
            {p.note && <div className="pb-dili-note">{p.note}</div>}
          </li>
        ))}
      </ul>
    </section>
  );
}

function NetworkBlock({ network }: { network: PrintNetwork }) {
  return (
    <section className="pb-flow-section">
      <div className="pb-flow-head">
        Related-Party Network
        <span className="pb-flow-head-meta">Companies two or more directors share</span>
      </div>
      <ul className="pb-net">
        {network.interlocks.map((it, i) => (
          <li key={i} className="pb-net-row">
            <span className={`pb-dot ${it.flagged ? "pb-bg-red" : "pb-bg-neutral"}`} />
            <div>
              <span className="pb-net-co">{it.company}</span>
              {it.flagged && <span className="pb-net-flag">{it.status ?? "not in good standing"}</span>}
              <span className="pb-net-count">{it.directors.length} directors</span>
              <div className="pb-net-dirs">{it.directors.join(" · ")}</div>
            </div>
          </li>
        ))}
      </ul>
      <p className="pb-net-note">
        Interlocks only — shareholding and ultimate beneficial ownership require the upgraded registry (PrivateCircle).
      </p>
    </section>
  );
}

/** Adverse material at companies linked through the board — one hop out. The
 *  `via` line is the point: it names the person the risk travels through. */
function RelatedBlock({ rows }: { rows: PrintBrief["related"] }) {
  if (rows.length === 0) return null;
  return (
    <section className="pb-flow-section">
      <div className="pb-flow-head">Related Entities — Adverse Material</div>
      <ul className="pb-net">
        {rows.map((r, i) => (
          <li key={i} className="pb-net-row">
            <span className="pb-dot pb-bg-amber" />
            <div>
              <span className="pb-net-co">{r.entity}</span>
              {r.status && /strike|liquidat|dissolv|defunct|dormant/i.test(r.status) && (
                <span className="pb-net-flag">{r.status}</span>
              )}
              <div className="pb-net-dirs">{r.title}</div>
              <div className="pb-net-dirs">Linked via {r.via}</div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ScopeBlock({ scope, generatedAt }: { scope: PrintScope; generatedAt: string }) {
  return (
    <section className="pb-flow-section">
      <div className="pb-flow-head">
        Scope &amp; Limitations
        <span className="pb-flow-head-meta">As of {generatedAt}</span>
      </div>
      <p className="pb-scope-statement">{scope.statement}</p>
      {scope.clearance && <p className="pb-scope-statement">{scope.clearance}</p>}
      <ul className="pb-scope-list">
        {scope.lines.map((l, i) => (
          <li key={i} className="pb-scope-row">
            <span className="pb-scope-name">
              {l.name}
              <span className="pb-scope-tier">{l.tierLabel}</span>
            </span>
            <span className={`pb-scope-status pb-fg-${l.tone}`}>{l.statusLabel}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ── Profile & Background (second page) ───────────────────────────────────────
// Its own A4 sheet, so the detail the question deserves does not have to be
// squeezed into the executive page's margins: the role and the business behind
// it, the headline figures as tiles, the placing facts, and the full career
// history — every line linking back to the page it was read from.

function ProfilePage({ brief, profile }: { brief: PrintBrief; profile: PrintProfile }) {
  return (
    <div className="pb-page pb-page-next">
      <header className="pb-header">
        <div className="pb-header-top">
          <div className="pb-brand">
            <span className="pb-brand-mark">Paragon</span>
            <span className="pb-brand-sep">|</span>
            <span className="pb-brand-sub">Profile &amp; Background</span>
          </div>
          <div className="pb-gen">
            <span className="pb-gen-label">Subject</span>
            <span className="pb-gen-val">{brief.company}</span>
          </div>
        </div>
        {(profile.role || profile.employer) && (
          <p className="pb-profile-lead">
            {profile.role}
            {profile.employer && (
              <span className="pb-profile-employer">
                {profile.role ? " · " : ""}
                {profile.employer}
              </span>
            )}
          </p>
        )}
      </header>

      {profile.bio && <p className="pb-profile-bio">{profile.bio}</p>}

      {profile.metrics.length > 0 && (
        <div className="pb-profile-metrics">
          {profile.metrics.map((m, i) => (
            <div className="pb-pm" key={i}>
              <div className="pb-pm-val">
                {m.value}
                <Ref n={m.sourceRef} />
              </div>
              <div className="pb-pm-label">{m.label}</div>
            </div>
          ))}
        </div>
      )}

      {profile.attributes.length > 0 && (
        <dl className="pb-snap pb-profile-attrs">
          {profile.attributes.map((a, i) => (
            <div className="pb-snap-item" key={i}>
              <dt className="pb-snap-label">{a.label}</dt>
              <dd className="pb-snap-val">
                {a.value}
                <Ref n={a.sourceRef} />
              </dd>
            </div>
          ))}
        </dl>
      )}

      {profile.highlights.length > 0 && (
        <Section
          title="Career & Background"
          className="pb-profile-career"
          meta={profile.extraHighlights > 0 ? `+${profile.extraHighlights} more in dashboard` : undefined}
        >
          <ul className="pb-hl">
            {profile.highlights.map((h, i) => (
              <li className="pb-hl-item" key={i}>
                <span className="pb-dot pb-bg-neutral" />
                <span className="pb-hl-text">
                  {h.text}
                  <Ref n={h.sourceRef} />
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <div className="pb-profile-foot">
        <div className="pb-disclaimer">{brief.disclaimer}</div>
      </div>
    </div>
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

function KeyConcerns({ concerns, extra, emptyText }: { concerns: Concern[]; extra: number; emptyText?: string }) {
  if (concerns.length === 0) {
    // Green says "checked, and clean". Where the run could not settle who the
    // subject is, it has not earned that, and the assembler says so instead.
    return (
      <Section title="Key Concerns">
        <div className="pb-clear">
          <span className={`pb-dot ${emptyText ? "pb-bg-neutral" : "pb-bg-green"}`} />
          {emptyText ?? "No red-flag or review-level concerns surfaced across the sources that completed."}
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

/**
 * Good news, kept where good news belongs.
 *
 * Returns null when there is none, like every other optional block — a page
 * that prints an empty "Positive Signals" heading is quietly saying it looked
 * and found nothing, which is a different claim from not having looked.
 */
function PositiveSignals({ items, extra }: { items: PositiveRow[]; extra: number }) {
  if (items.length === 0) return null;
  return (
    <Section title="Positive Signals" meta={extra > 0 ? `+${extra} more` : undefined}>
      <ul className="pb-devs">
        {items.map((p, i) => (
          <li className="pb-dev" key={i}>
            <span className="pb-dev-head">{p.text}</span>
            <span className="pb-dev-status pb-fg-green">
              <Ref n={p.sourceRef} />
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

// ── Right column ───────────────────────────────────────────────────────────────

// A person has no CIN, an incorporation date or a share structure, so on a
// director run this panel carries the registry identity instead — and must say
// so, because a person's name over the words "Company Snapshot" reads as a
// claim that the registration below belongs to them.
function Snapshot({ fields, isDirector }: { fields: PrintBrief["snapshot"]; isDirector: boolean }) {
  if (fields.length === 0) return null;
  return (
    <Section title={isDirector ? "Registry Identity" : "Company Snapshot"} className="pb-band">
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

/**
 * Where the subject is on the register — the headline answer of a director
 * screen, on the executive sheet rather than buried in the continuation.
 *
 * Capped so it cannot crowd the concerns beside it; the full list, with CINs
 * and joining dates, is the Registry Footprint table further on.
 */
function DirectorIn({ rows }: { rows: PrintBrief["directorships"] }) {
  if (rows.length === 0) return null;
  const shown = rows.slice(0, 6);
  const extra = rows.length - shown.length;
  const flagged = rows.filter((r) => r.tone === "amber").length;
  return (
    <Section
      title="Director In"
      meta={
        flagged > 0
          ? `${rows.length} · ${flagged} not in good standing`
          : `${rows.length} ${rows.length === 1 ? "entity" : "entities"}`
      }
    >
      <table className="pb-table">
        <colgroup>
          <col style={{ width: "62%" }} />
          <col style={{ width: "16%" }} />
          <col style={{ width: "22%" }} />
        </colgroup>
        <tbody>
          {shown.map((r, i) => (
            <tr key={`${r.id}-${i}`}>
              <td className="pb-clip">
                <span className="pb-person-name">{r.name}</span>
                <Ref n={r.sourceRef} />
              </td>
              <td className="pb-clip">{r.kind === "llp" ? "LLP" : "Company"}</td>
              <td className={`pb-clip pb-fg-${r.tone}`}>{r.status ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {extra > 0 && <p className="pb-more">+{extra} more in the registry footprint below</p>}
    </Section>
  );
}

function KeyPeople({ people, extra, isDirector }: { people: Person[]; extra: number; isDirector: boolean }) {
  if (people.length === 0) return null;
  return (
    <Section title={isDirector ? "Associated People" : "Key People"} meta={extra > 0 ? `+${extra} more` : undefined}>
      <table className="pb-table">
        <colgroup>
          <col style={{ width: "46%" }} />
          <col style={{ width: "30%" }} />
          {/* Tenure and its citation share the right-hand rail: the board rows
              are read off a source like every other claim in the brief, so each
              one carries the number that links back to it. Two refs and the
              longest tenure ("23y 5m") are what this width has to hold. */}
          <col style={{ width: "24%" }} />
        </colgroup>
        <tbody>
          {people.map((p, i) => (
            <tr key={i}>
              <td className="pb-clip">
                <span className="pb-person-name">{p.name}</span>
              </td>
              <td className="pb-clip">{p.role ?? "—"}</td>
              <td className="pb-num pb-clip">
                <span className={p.flag ? "pb-fg-amber" : undefined} title={p.flag}>
                  {p.tenure ?? "—"}
                </span>
                {(p.sourceRefs ?? []).slice(0, 2).map((n) => (
                  <Ref n={n} key={n} />
                ))}
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
                {/* Read off the judgment: which side the subject is on, against
                    whom, under which number, before whom. The side is the fact
                    that changes how the row reads — a company that filed an
                    appeal has not been sued. */}
                {(c.side || c.caseNumber) && (
                  <span className="pb-case-auth pb-clip-b">
                    {c.side && (
                      <>
                        Subject is <strong>{c.side}</strong>
                        {c.against && <> v. {c.against}</>}
                      </>
                    )}
                    {c.side && c.caseNumber && " · "}
                    {c.caseNumber}
                  </span>
                )}
                {c.authority && (
                  <span className="pb-case-auth pb-clip-b">
                    {c.authority}
                    {c.bench && <> · {c.bench}</>}
                  </span>
                )}
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
  const body = (
    <>
      <span className="pb-ref">[{s.ref}]</span> {s.label}
      {s.tier && <span className="pb-source-tier">{s.tier}</span>}
    </>
  );
  return (
    <li className="pb-source">
      {s.url ? (
        <a className="pb-source-link" href={s.url} target="_blank" rel="noreferrer">
          {body}
        </a>
      ) : (
        body
      )}
    </li>
  );
}
