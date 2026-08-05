"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiUrl } from "./api";
import {
  clearHistory,
  exportHistory,
  hideSubjectFromRecent,
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

/** How long the live record is worth waiting for before the saved copy is used
 *  instead. The free backend cold-starts in tens of seconds; nobody should sit
 *  through that for a brief already on the device. */
const SERVER_WAIT_MS = 2500;

/** What "Open" gave back: a live run if the server still had one, otherwise the
 *  copy saved in this browser. */
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
  /** Delete the run and its saved brief. */
  remove: (id: string) => void;
  /** Take the subject off the front page's short list. It stays in History. */
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
   *
   * The attempt is bounded. The backend sleeps on the free plan and takes tens
   * of seconds to wake, and a saved brief sitting in this browser is not worth
   * making anyone wait that long for a slightly better version of.
   */
  const open = useCallback(
    async (id: string): Promise<OpenedRun | null> => {
      const entry = readHistory().find((e) => e.id === id);
      if (!entry) return null;
      setOpening(id);
      try {
        if (entry.serverId) {
          try {
            const res = await fetch(apiUrl(`/api/research/${entry.serverId}`), {
              signal: AbortSignal.timeout(SERVER_WAIT_MS),
            });
            if (res.ok) {
              const run: Run = await res.json();
              if (run?.brief) return { run, entry, archived: false };
            }
          } catch {
            /* timed out, offline, or no API origin in the static build */
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
   * A download anchor rather than a pre-opened tab. BriefView opens one because
   * its PDF comes back from the server and a popup opened after a round trip is
   * blocked — but `window.open` with `noopener` returns null by specification,
   * so that handle can never be used here, and opening one would only leave a
   * blank tab behind every export.
   */
  const exportJson = useCallback(async () => {
    const payload = await exportHistory();
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `Paragon history — ${payload.exportedAt.slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
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
    hide: hideSubjectFromRecent,
    clear: clearHistory,
    exportJson,
    importJson,
  };
}
