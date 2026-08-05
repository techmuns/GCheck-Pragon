"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Toggle from "@/components/Toggle";
import { apiUrl, authHeaders, jsonAuthHeaders } from "@/lib/api";
import { useHostContext } from "@/hooks/useHostContext";
import type { AppConfig, Keyword, Source } from "@/lib/types";

type SaveState = "idle" | "saving" | "saved" | "error";

export default function AdminPage() {
  const { session } = useHostContext();
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [save, setSave] = useState<SaveState>("idle");
  const [newKeyword, setNewKeyword] = useState("");

  useEffect(() => {
    fetch(apiUrl("/api/config"), { headers: authHeaders(session.token) })
      .then((r) => r.json())
      .then(setConfig)
      .catch(() => setLoadError("Could not load config."));
  }, [session.token]);

  function patch(p: Partial<AppConfig>) {
    setConfig((c) => (c ? { ...c, ...p } : c));
    setSave("idle");
  }

  // ── Sources ──────────────────────────────────────────────────────────────
  function toggleSource(id: string, enabled: boolean) {
    if (!config) return;
    patch({ sources: config.sources.map((s) => (s.id === id ? { ...s, enabled } : s)) });
  }

  // ── Keywords ─────────────────────────────────────────────────────────────
  function toggleKeyword(id: string, enabled: boolean) {
    if (!config) return;
    patch({ keywords: config.keywords.map((k) => (k.id === id ? { ...k, enabled } : k)) });
  }
  function removeKeyword(id: string) {
    if (!config) return;
    patch({ keywords: config.keywords.filter((k) => k.id !== id) });
  }
  function addKeyword() {
    if (!config) return;
    const term = newKeyword.trim();
    if (!term) return;
    if (config.keywords.some((k) => k.term.toLowerCase() === term.toLowerCase())) {
      setNewKeyword("");
      return;
    }
    const id = `kw-${Date.now().toString(36)}`;
    patch({ keywords: [...config.keywords, { id, term, enabled: true }] });
    setNewKeyword("");
  }

  // ── Persist ──────────────────────────────────────────────────────────────
  async function persist() {
    if (!config) return;
    setSave("saving");
    try {
      const res = await fetch(apiUrl("/api/config"), {
        method: "PUT",
        headers: jsonAuthHeaders(session.token),
        body: JSON.stringify(config),
      });
      if (!res.ok) throw new Error();
      setConfig(await res.json());
      setSave("saved");
    } catch {
      setSave("error");
    }
  }

  async function resetDefaults() {
    if (!confirm("Reset everything back to the default settings?")) return;
    setSave("saving");
    try {
      const res = await fetch(apiUrl("/api/config?reset=1"), {
        method: "POST",
        headers: authHeaders(session.token),
      });
      setConfig(await res.json());
      setSave("saved");
    } catch {
      setSave("error");
    }
  }

  if (loadError) return <Centered>{loadError}</Centered>;
  if (!config) return <Centered>Loading admin…</Centered>;

  return (
    <main className="mx-auto min-h-screen w-full max-w-2xl px-4 py-10">
      {/* Header */}
      <div className="mb-6 flex items-end justify-between">
        <div>
          <div className="eyebrow mb-1">Settings</div>
          <h1 className="font-display text-[26px] leading-tight text-navy-deep">Report settings</h1>
          <p className="mt-1 text-[13px] text-ink-secondary">
            Changes apply to your next report.
          </p>
        </div>
        <Link href="/" className="rounded-lg border border-[rgba(23,43,77,0.12)] bg-white/70 px-3.5 py-2 text-[13px] font-medium text-navy-primary transition hover:bg-white">
          ← Back
        </Link>
      </div>

      <div className="space-y-4">
        {/* Where we check */}
        <Card title="Where we check" note="Choose which places we look into for each report.">
          <ul className="space-y-2.5">
            {config.sources.map((s: Source) => (
              <li key={s.id} className="surface-soft flex items-start justify-between gap-3 px-3.5 py-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[14px] font-medium text-ink-primary">{s.name}</span>
                    {s.locked && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-[rgba(182,139,58,0.4)] bg-gold-soft px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#8A5D14]">
                        🔒 Upgrade
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-[12px] leading-snug text-ink-secondary">{s.description}</p>
                  {s.locked && s.lockReason && (
                    <p className="mt-1 text-[11px] leading-snug text-[#8A5D14]">{s.lockReason}</p>
                  )}
                </div>
                <div className="flex shrink-0 flex-col items-center gap-1">
                  {s.locked ? (
                    <span className="whitespace-nowrap rounded-lg bg-gold-soft px-2.5 py-1 text-[11px] font-semibold text-[#8A5D14]">
                      Upgrade
                    </span>
                  ) : (
                    <>
                      <Toggle checked={s.enabled} onChange={(v) => toggleSource(s.id, v)} label={s.name} />
                      <span className={`text-[10.5px] font-medium ${s.enabled ? "text-signal-positive" : "text-ink-secondary"}`}>
                        {s.enabled ? "Included" : "Skipped"}
                      </span>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Card>

        {/* Words we watch for */}
        <Card title="Words we watch for" note="We flag these words in news and search — like “fraud” or “court”. Tap a word to turn it off, or × to remove it.">
          <div className="flex flex-wrap gap-1.5">
            {config.keywords.map((k: Keyword) => (
              <span
                key={k.id}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12.5px] transition ${
                  k.enabled
                    ? "border-[rgba(39,69,126,0.2)] bg-navy-primary/8 text-navy-deep"
                    : "border-soft-border bg-ice text-ink-secondary line-through"
                }`}
              >
                <button type="button" onClick={() => toggleKeyword(k.id, !k.enabled)} title={k.enabled ? "Turn off" : "Turn on"}>
                  {k.term}
                </button>
                <button type="button" onClick={() => removeKeyword(k.id)} className="text-navy-primary/50 hover:text-coral" aria-label={`Remove ${k.term}`}>
                  ×
                </button>
              </span>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <input
              value={newKeyword}
              onChange={(e) => setNewKeyword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addKeyword())}
              placeholder="Add a word…"
              className="flex-1 rounded-lg border border-[rgba(23,43,77,0.14)] bg-white/90 px-3 py-2 text-[13.5px] outline-none focus:border-navy-primary/40"
            />
            <button type="button" onClick={addKeyword} className="rounded-lg border border-[rgba(23,43,77,0.14)] bg-white px-3.5 py-2 text-[13px] font-medium text-navy-primary hover:bg-ice">
              Add
            </button>
          </div>
        </Card>

        {/* The writing rules used to be editable here. They are not any more:
            the narrative prompt lives in lib/synthesize.ts, where it is version
            controlled and reviewed alongside the guardrails that validate the
            model's output. A free-text box in the admin panel could only ever
            drift out of step with those — and this one already had, editing a
            value the AI path never read. */}
      </div>

      {/* Sticky action bar */}
      <div className="sticky bottom-4 mt-5 flex items-center justify-between rounded-xl border border-[rgba(23,43,77,0.1)] bg-white/85 px-4 py-3 shadow-card backdrop-blur">
        <button type="button" onClick={resetDefaults} className="text-[12.5px] font-medium text-ink-secondary hover:text-coral">
          Reset to defaults
        </button>
        <div className="flex items-center gap-3">
          <span className="text-[12.5px] text-ink-secondary">
            {save === "saving" && "Saving…"}
            {save === "saved" && <span className="text-signal-positive">Saved ✓</span>}
            {save === "error" && <span className="text-coral">Save failed</span>}
          </span>
          <button type="button" onClick={persist} disabled={save === "saving"} className="blob-btn rounded-lg px-5 py-2.5 text-[13px] font-semibold">
            Save changes
          </button>
        </div>
      </div>
    </main>
  );
}

function Card({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  return (
    <section className="card-surface p-5">
      <div className="mb-3">
        <h2 className="font-display text-[16px] text-navy-deep">{title}</h2>
        <p className="text-[12px] text-ink-secondary">{note}</p>
      </div>
      {children}
    </section>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="card-surface fade-in px-6 py-5 text-[14px] text-ink-secondary">{children}</div>
    </main>
  );
}
