"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiUrl } from "./api";
import {
  clearHistory,
  exportHistory,
  hideFromRecent,
  importHistory,
  loadArchived,
  readHistory,
  removeEntry,
  subscribeHistory,
  type ImportResult,
} from "./archiveStore";
import { listRecent, type ArchiveEntry, type ArchivedRun } from "./archive";
import type { Run } from "./types";

// ── History, as the screens see it ───────────────────────────────────────────
// Storage is read after mount, never during render: localStorage does not exist
// on the server, and seeding state from it directly is the classic App Router
// hydration mismatch. Both the front page and the search form call this hook,
// and the store's subscription keeps them in step — which also fixes the old
// behaviour where the recent list was read once and then never noticed a run
// finishing.

/** What "Open" gave back: a live run if the server still had one, otherwise the
 *  copy saved in this browser. The distinction is shown, not hidden — the
 *  archived path has no server-rendered PDF behind it. */
export interface OpenedRun {
  run: Run;
  entry: ArchiveEntry;
  /** True when this came from the saved copy rather than from the server. */
  archived: boolean;
}

export interface UseArchive {
  entries: ArchiveEntry[];
  recent: ArchiveEntry[];
  /** The id currently being opened, so its row can say so. */
  opening: string | null;
  open: (id: string) => Promise<OpenedRun | null>;
  remove: (id: string) => void;
  hide: (id: string) => void;
  clear: () => void;
  exportJson: () => Promise<void>;
  importJson: (raw: string) => Promise<ImportResult>;
}

export function useArchive(): UseArchive {
  const [entries, setEntries] = useState<ArchiveEntry[]>([]);
  const [opening, setOpening] = useState<string | null>(null);

  useEffect(() => {
    setEntries(readHistory());
    return subscribeHistory(setEntries);
  }, []);

  const recent = useMemo(() => listRecent(entries), [entries]);

  /**
   * Open a past run.
   *
   * The server is asked first when the run has an id there. Its in-memory store
   * holds the last hundred finished runs for the life of the process, so for
   * anything run today the live record is usually still there — and that record
   * comes with working PDF downloads, which the saved copy cannot have. A 404
   * or an unreachable backend falls back to the snapshot, which is the whole
   * reason the snapshot exists.
   */
  const open = useCallback(
    async (id: string): Promise<OpenedRun | null> => {
      const entry = readHistory().find((e) => e.id === id);
      if (!entry) return null;
      setOpening(id);
      try {
        if (entry.serverId) {
          try {
            const res = await fetch(apiUrl(`/api/research/${entry.serverId}`));
            if (res.ok) {
              const run: Run = await res.json();
              if (run?.brief) return { run, entry, archived: false };
            }
          } catch {
            /* offline, or no API origin in the static build — use the copy */
          }
        }
        const saved = await loadArchived(id);
        return saved ? { run: saved.run, entry, archived: true } : null;
      } finally {
        setOpening(null);
      }
    },
    [],
  );

  /**
   * Hand the record over as a file.
   *
   * The tab is opened before the await, for the reason spelled out in
   * BriefView's download: this dashboard runs framed, a popup opened after a
   * round trip is blocked, and a synthetic download click is discarded unless
   * the frame allows downloads.
   */
  const exportJson = useCallback(async () => {
    const tab = typeof window !== "undefined" ? window.open("", "_blank", "noopener,noreferrer") : null;
    try {
      const payload = await exportHistory();
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }),
      );
      if (tab && !tab.closed) {
        tab.location.href = url;
      } else {
        const a = document.createElement("a");
        a.href = url;
        a.download = `Paragon history — ${payload.exportedAt.slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      tab?.close();
      throw e;
    }
  }, []);

  const importJson = useCallback(async (raw: string) => {
    const result = await importHistory(raw);
    setEntries(readHistory());
    return result;
  }, []);

  return {
    entries,
    recent,
    opening,
    open,
    remove: removeEntry,
    hide: hideFromRecent,
    clear: clearHistory,
    exportJson,
    importJson,
  };
}
