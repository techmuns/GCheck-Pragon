#!/usr/bin/env node
// ── Registry parser check ───────────────────────────────────────────────────
// The MCA registry source reads third-party HTML, and third-party HTML changes
// without telling anyone. A fixture would only ever prove we can still parse
// yesterday's markup, so this checks the live pages — which is the only check
// that means anything for a scraper.
//
// Keyless and dependency-free, so it runs in CI and on a laptop alike:
//
//   node scripts/check-indiafilings.mjs
//
// It deliberately does not import the collector: that is TypeScript inside a
// Next.js app, and pulling a build step into a reachability check would make it
// the first thing to be skipped. It re-implements the two parses it asserts on,
// so a drift between this and lib/collectors/indiafilings.ts is itself a signal
// worth having.

const BASE = "https://www.indiafilings.com";
const DIN = "07013291";
const CIN = "U72900DL2019PTC358371";

let failures = 0;

function check(label, actual, expected) {
  const ok = typeof expected === "function" ? expected(actual) : actual === expected;
  if (ok) {
    console.log(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.log(`  ✗ ${label}\n      expected ${typeof expected === "function" ? "(predicate)" : JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

async function fetchHtml(url) {
  const res = await fetch(url, { headers: { accept: "text/html" } });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.text();
}

function jsonLd(html, type) {
  for (const m of html.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(m[1]);
      if (parsed?.["@type"] === type) return parsed;
    } catch {
      /* an unreadable block is simply not used */
    }
  }
  return undefined;
}

function props(ld) {
  const out = {};
  for (const p of ld?.additionalProperty ?? []) if (p?.name) out[p.name] = String(p.value);
  return out;
}

function rows(html) {
  const out = [];
  for (const tr of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [];
    const hrefs = [];
    for (const td of tr[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)) {
      cells.push(td[1].replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim());
      hrefs.push(td[1].match(/href="([^"]+)"/i)?.[1]);
    }
    if (cells.length) out.push({ cells, hrefs });
  }
  return out;
}

async function main() {
  console.log(`Director page — ${BASE}/search/director-din-${DIN}`);
  const personHtml = await fetchHtml(`${BASE}/search/director-din-${DIN}`);
  const person = jsonLd(personHtml, "Person");
  const personProps = props(person);

  check("JSON-LD Person block present", Boolean(person), true);
  check("name", person?.name, "CHIRAAG KAPIL");
  check("DIN", person?.identifier?.value, DIN);
  check("DIN status", personProps["DIN Status"], "Approved");
  check("not flagged non-compliant", personProps["Non Compliant Company"], "No");

  const entities = rows(personHtml)
    .filter((r) => r.cells.length >= 3 && /-cin-[A-Z0-9]{21}$|-[A-Z]{3}-\d+$/i.test(r.hrefs[0] ?? ""))
    .map((r) => ({ name: r.cells[1], status: r.cells[2] }));

  check("six linked entities", entities.length, 6);
  check(
    "Saarthi Techpro listed as Active",
    entities.find((e) => /SAARTHI TECHPRO/i.test(e.name))?.status,
    "Active",
  );
  check(
    "Chiraag Entertainment listed as Strike Off",
    entities.find((e) => /CHIRAAG ENTERTAINMENT/i.test(e.name))?.status,
    "Strike Off",
  );
  check("the LLP is picked up too", entities.some((e) => /ANCHI VENTURES LLP/i.test(e.name)), true);

  console.log(`\nCompany page — ${BASE}/search/company-cin-${CIN}`);
  const companyHtml = await fetchHtml(`${BASE}/search/company-cin-${CIN}`);
  const company = jsonLd(companyHtml, "Corporation");

  check("JSON-LD Corporation block present", Boolean(company), true);
  check("name", company?.name, "SAARTHI TECHPRO PRIVATE LIMITED");
  check("CIN", company?.identifier?.value, CIN);

  const directors = rows(companyHtml)
    .filter((r) => /-din-\d{6,8}$/i.test(r.hrefs[0] ?? ""))
    .map((r) => ({ din: r.cells[0], name: r.cells[1] }));

  check("board read off the page", directors.length >= 2, true);
  check("the subject is on it", directors.some((d) => d.din === DIN), true);
  check(
    "co-director Manik Mehta picked up",
    directors.some((d) => d.din === "07054532" && /MANIK MEHTA/i.test(d.name)),
    true,
  );

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(`\nCould not complete the check: ${err.message}`);
  process.exit(1);
});
