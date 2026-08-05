// ── Family clusters on a board ──────────────────────────────────────────────
// Three of five directors in one benchmarked governance check share a surname —
// a family board, visible to any human reader and previously invisible to this
// report. Shared surnames are a PROBABLE tie, so the output is worded as one:
// it changes what a partner asks ("who actually controls this?"), never the
// score. Kept free of server-only imports because the brief renders it in the
// browser.

const SURNAME_NOISE = new Set([
  // So common that sharing one says nothing by itself.
  "kumar", "singh", "shah", "patel", "sharma", "gupta", "khan", "das", "devi", "bai", "lal", "ram",
]);

export function familyClusters(
  people: Array<{ name: string }>,
): Array<{ surname: string; members: string[] }> {
  const bySurname = new Map<string, Set<string>>();
  for (const p of people) {
    const words = p.name.trim().split(/\s+/);
    if (words.length < 2) continue;
    const surname = words[words.length - 1].toLowerCase().replace(/[^a-z]/g, "");
    if (surname.length < 3 || SURNAME_NOISE.has(surname)) continue;
    const set = bySurname.get(surname) ?? new Set<string>();
    set.add(p.name);
    bySurname.set(surname, set);
  }
  return [...bySurname.entries()]
    .filter(([, members]) => members.size >= 2)
    .map(([surname, members]) => ({
      surname: surname.charAt(0).toUpperCase() + surname.slice(1),
      members: [...members],
    }))
    .sort((a, b) => b.members.length - a.members.length);
}
