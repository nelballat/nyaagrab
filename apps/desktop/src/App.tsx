import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type {
  EpisodeResult,
  NyaaCategory,
  NyaaFilter,
  ResultShape,
  SearchRequest,
  SearchResult
} from "@nyaagrab/contracts";
import { SearchRequestSchema } from "@nyaagrab/contracts";
import { formatSize, parseTitle } from "@nyaagrab/core";
import { exportMagnets, openMagnet, runSearch, copyText } from "./desktop-api";
import { getBaseMascotState, MascotDisplay } from "./mascot";
import type { MascotState } from "./mascot";

const defaultRequest: SearchRequest = {
  anime: "",
  startEpisode: 1,
  endEpisode: 1,
  category: "1_2",
  filter: "0",
  resultShape: "auto",
  preferSmall: false,
  preferredResolution: "1080p",
  preferredCodec: "Any",
  preferredGroups: [],
  manualAltTitles: [],
  disableAutoResolve: false
};

const STORAGE_KEY = "nyaagrab.desktop.searchForm";

const RESULT_SHAPE_OPTIONS: Array<{ value: ResultShape; label: string }> = [
  { value: "auto", label: "Auto" },
  { value: "batchesOnly", label: "Batches only" },
  { value: "episodesOnly", label: "Episodes only" }
];

const NYAA_FILTER_OPTIONS: Array<{ value: NyaaFilter; label: string }> = [
  { value: "0", label: "No filter" },
  { value: "1", label: "No remakes" },
  { value: "2", label: "Trusted only" }
];

const NYAA_CATEGORY_OPTIONS: Array<{ value: NyaaCategory; label: string }> = [
  { value: "0_0", label: "All categories" },
  { value: "1_0", label: "Anime" },
  { value: "1_1", label: "Anime - Anime Music Video" },
  { value: "1_2", label: "Anime - English-translated" },
  { value: "1_3", label: "Anime - Non-English-translated" },
  { value: "1_4", label: "Anime - Raw" },
  { value: "2_0", label: "Audio" },
  { value: "2_1", label: "Audio - Lossless" },
  { value: "2_2", label: "Audio - Lossy" },
  { value: "3_0", label: "Literature" },
  { value: "3_1", label: "Literature - English-translated" },
  { value: "3_2", label: "Literature - Non-English-translated" },
  { value: "3_3", label: "Literature - Raw" },
  { value: "4_0", label: "Live Action" },
  { value: "4_1", label: "Live Action - English-translated" },
  { value: "4_2", label: "Live Action - Idol/Promotional Video" },
  { value: "4_3", label: "Live Action - Non-English-translated" },
  { value: "4_4", label: "Live Action - Raw" },
  { value: "5_0", label: "Pictures" },
  { value: "5_1", label: "Pictures - Graphics" },
  { value: "5_2", label: "Pictures - Photos" },
  { value: "6_0", label: "Software" },
  { value: "6_1", label: "Software - Applications" },
  { value: "6_2", label: "Software - Games" }
];

type StoredFormState = {
  request: SearchRequest;
  groupInput: string;
};

function loadStoredFormState(): StoredFormState {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (!saved) {
      return { request: defaultRequest, groupInput: "" };
    }

    const parsed = JSON.parse(saved) as Partial<StoredFormState>;
    return {
      request: SearchRequestSchema.parse({
        ...defaultRequest,
        ...parsed.request
      }),
      groupInput: parsed.groupInput ?? ""
    };
  } catch {
    return { request: defaultRequest, groupInput: "" };
  }
}



function bestMagnets(result: SearchResult | null): string[] {
  if (!result) {
    return [];
  }

  const magnets: string[] = [];
  const seen = new Set<string>();
  for (const episode of result.episodes) {
    const magnet = episode.best?.magnet;
    if (!magnet || seen.has(magnet)) {
      continue;
    }
    seen.add(magnet);
    magnets.push(magnet);
  }
  return magnets;
}

function cleanReleaseTitle(title: string): string {
  const extensionMatch = title.match(/(\.[a-z0-9]{2,4})$/i);
  let base = extensionMatch ? title.slice(0, -extensionMatch[1].length) : title;
  base = base.replace(/^(?:\[[^\]]+\]\s*)+/, "").trim();
  while (true) {
    const next = base.replace(/\s*(?:\[[^\]]+\]|\([^)]+\))\s*$/g, "").trim();
    if (next === base) {
      break;
    }
    base = next;
  }
  return base;
}

const MIN_LEFT_PANE_WIDTH = 360;
const MAX_LEFT_PANE_WIDTH = 540;
const MIN_RIGHT_PANE_WIDTH = 720;
const SPLIT_GUTTER_WIDTH = 8;
const RESULTS_OUTER_PADDING = 20;

function canUseResizableSplit(containerWidth: number): boolean {
  return containerWidth >= MIN_LEFT_PANE_WIDTH + MIN_RIGHT_PANE_WIDTH + SPLIT_GUTTER_WIDTH + RESULTS_OUTER_PADDING;
}

function clampLeftPaneWidth(nextWidth: number, containerWidth: number): number {
  const upperBound = Math.min(MAX_LEFT_PANE_WIDTH, containerWidth - MIN_RIGHT_PANE_WIDTH);
  return Math.min(Math.max(nextWidth, MIN_LEFT_PANE_WIDTH), Math.max(MIN_LEFT_PANE_WIDTH, upperBound));
}

function getStatusClass(busy: boolean, result: SearchResult | null): string {
  if (busy) return "status status--busy";
  if (result && result.coveragePercent >= 80) return "status status--ok";
  if (result && result.coveragePercent < 80) return "status status--error";
  return "status";
}

/* ── Episode table ── */
function EpisodeTable({
  episodes,
  batchGroups,
  onCopyMagnet,
  onOpenMagnet
}: {
  episodes: EpisodeResult[];
  batchGroups?: Array<{ best: EpisodeResult["best"]; episodes: number[]; batchStart: number | null; batchEnd: number | null }>;
  onCopyMagnet: (magnet: string) => void;
  onOpenMagnet: (magnet: string) => Promise<void>;
}) {
  const [expandedEpisodes, setExpandedEpisodes] = useState<number[]>([]);

  const hasBatches = batchGroups && batchGroups.length > 0;
  if (episodes.length === 0 && !hasBatches) {
    return <p className="empty">No found episodes yet.</p>;
  }

  const toggleExpanded = (episodeNumber: number) => {
    setExpandedEpisodes((current) => (
      current.includes(episodeNumber)
        ? current.filter((value) => value !== episodeNumber)
        : [...current, episodeNumber]
    ));
  };

  return (
    <div className="episode-table-wrap">
      <table>
        <colgroup>
          <col className="col-release" />
          <col className="col-group" />
          <col className="col-size" />
          <col className="col-seeders" />
          <col className="col-actions" />
        </colgroup>
        <thead>
          <tr>
            <th className="col-release">Release</th>
            <th className="col-group">Group</th>
            <th className="col-size">Size</th>
            <th className="col-seeders">Seeders</th>
            <th className="col-actions">Actions</th>
          </tr>
        </thead>
        <tbody>
          {hasBatches ? batchGroups.map((batch) => {
            if (!batch.best) { return null; }
            const eps = batch.episodes;
            const rangeLabel = batch.batchStart !== null && batch.batchEnd !== null
              ? `batch ep ${batch.batchStart}–${batch.batchEnd}`
              : "batch pack";
            const coverLabel = `${rangeLabel} · covers ${eps.length} of your episodes`;
            return (
              <Fragment key={`batch-${batch.best.magnet}`}>
                <tr className="episode-row">
                  <td className="release-cell col-release">
                    <div className="release-primary__title">{cleanReleaseTitle(batch.best.title)}</div>
                  </td>
                  <td className="col-group">{batch.best.group || "-"}</td>
                  <td className="col-size">{batch.best.sizeLabel}</td>
                  <td className="col-seeders">{batch.best.seeders}</td>
                  <td className="col-actions">
                    <div className="actions">
                      <button onClick={async () => onOpenMagnet(batch.best!.magnet)}>Open</button>
                      <button onClick={() => onCopyMagnet(batch.best!.magnet)}>Copy</button>
                    </div>
                  </td>
                </tr>
                <tr className="episode-toggle-row episode-toggle-row--last">
                  <td colSpan={5} className="episode-toggle-row__cell">
                    <span className="release-batch-cover">{coverLabel} ({eps.length} episodes)</span>
                  </td>
                </tr>
              </Fragment>
            );
          }) : null}
          {episodes.map((episode) => {
            const best = episode.best;
            if (!best) {
              return null;
            }
            const visibleAlternatives = episode.alternatives.filter((alternative) => alternative.seeders > 0);
            const expanded = expandedEpisodes.includes(episode.episode);
            return (
              <Fragment key={episode.episode}>
                <tr key={episode.episode} className={`episode-row${visibleAlternatives.length > 0 ? " episode-row--with-toggle" : ""}${expanded ? " episode-row--expanded" : ""}`}>
                  <td className="release-cell col-release">
                    <div className="release-primary__title">{cleanReleaseTitle(best.title)}</div>
                  </td>
                  <td className="col-group">{best.group || "-"}</td>
                  <td className="col-size">{best.sizeLabel}</td>
                  <td className="col-seeders">{best.seeders}</td>
                  <td className="col-actions">
                    <div className="actions">
                      <button onClick={async () => onOpenMagnet(best.magnet)}>Open</button>
                      <button onClick={() => onCopyMagnet(best.magnet)}>Copy</button>
                    </div>
                  </td>
                </tr>
                {visibleAlternatives.length > 0 ? (
                  <tr className={`episode-toggle-row${expanded ? " episode-toggle-row--expanded" : ""}${!expanded ? " episode-toggle-row--last" : ""}`}>
                    <td colSpan={5} className="episode-toggle-row__cell">
                      <button
                        type="button"
                        className={`release-alts-toggle${expanded ? " release-alts-toggle--open" : ""}`}
                        onClick={() => toggleExpanded(episode.episode)}
                      >
                        <span className="release-alts-toggle__count">{visibleAlternatives.length} alt{visibleAlternatives.length === 1 ? "" : "s"}</span>
                        <span className="release-alts-toggle__chevron" aria-hidden="true">▾</span>
                      </button>
                    </td>
                  </tr>
                ) : null}
                {expanded ? (
                  <tr className={`episode-alt-row${visibleAlternatives.length === 1 ? " episode-alt-row--last" : ""}`}>
                    <td className="release-cell release-cell--alt col-release">
                      {visibleAlternatives[0]?.resolution || "Alt"}
                    </td>
                    <td className="alt-cell col-group">{visibleAlternatives[0]?.group || "-"}</td>
                    <td className="alt-cell col-size">{visibleAlternatives[0]?.sizeLabel || "-"}</td>
                    <td className="alt-cell col-seeders">{visibleAlternatives[0]?.seeders ?? "-"}</td>
                    <td className="alt-cell col-actions">
                      {visibleAlternatives[0] ? (
                        <div className="release-alt__actions">
                          <button onClick={async () => onOpenMagnet(visibleAlternatives[0].magnet)}>Open</button>
                          <button onClick={() => onCopyMagnet(visibleAlternatives[0].magnet)}>Copy</button>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ) : null}
                {expanded ? visibleAlternatives.slice(1).map((alternative) => (
                  <tr
                    key={`${episode.episode}-${alternative.title}`}
                    className={`episode-alt-row${alternative === visibleAlternatives[visibleAlternatives.length - 1] ? " episode-alt-row--last" : ""}`}
                  >
                    <td className="release-cell release-cell--alt col-release">{alternative.resolution || "Alt"}</td>
                    <td className="alt-cell col-group">{alternative.group || "-"}</td>
                    <td className="alt-cell col-size">{alternative.sizeLabel}</td>
                    <td className="alt-cell col-seeders">{alternative.seeders}</td>
                    <td className="alt-cell col-actions">
                      <div className="release-alt__actions">
                        <button onClick={async () => onOpenMagnet(alternative.magnet)}>Open</button>
                        <button onClick={() => onCopyMagnet(alternative.magnet)}>Copy</button>
                      </div>
                    </td>
                  </tr>
                )) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ── Main app ── */
export function App() {
  const shellRef = useRef<HTMLElement | null>(null);
  const mascotOverrideTimerRef = useRef<number | null>(null);
  const mascotTapResetTimerRef = useRef<number | null>(null);
  const [storedFormState] = useState(() => loadStoredFormState());
  const [request, setRequest] = useState<SearchRequest>(storedFormState.request);
  const [groupInput, setGroupInput] = useState(storedFormState.groupInput);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [status, setStatus] = useState("Ready");
  const [busy, setBusy] = useState(false);
  const [liveEpisodes, setLiveEpisodes] = useState<EpisodeResult[]>([]);
  const [progressCounts, setProgressCounts] = useState<{ completed: number; total: number } | null>(null);
  const [leftPaneWidth, setLeftPaneWidth] = useState(430);
  const [isResizing, setIsResizing] = useState(false);
  const [canResizeSplit, setCanResizeSplit] = useState(() => typeof window === "undefined" ? true : canUseResizableSplit(window.innerWidth));
  const [mascotOverride, setMascotOverride] = useState<MascotState | null>(null);
  const [mascotTapCount, setMascotTapCount] = useState(0);
  const searchControllerRef = useRef<AbortController | null>(null);

  const visibleEpisodes = useMemo(() => {
    if (busy) {
      return liveEpisodes;
    }
    return result?.episodes ?? [];
  }, [busy, liveEpisodes, result]);

  const foundEpisodes = useMemo(() => visibleEpisodes.filter((episode) => episode.status === "found"), [visibleEpisodes]);
  const groupedResults = useMemo(() => {
    const hashGroups = new Map<string, EpisodeResult[]>();
    const individuals: EpisodeResult[] = [];
    for (const ep of foundEpisodes) {
      if (!ep.best) { continue; }
      const hash = ep.best.magnet;
      if (!hashGroups.has(hash)) { hashGroups.set(hash, []); }
      hashGroups.get(hash)!.push(ep);
    }
    const batches: Array<{ best: EpisodeResult["best"]; alternatives: EpisodeResult["alternatives"]; episodes: number[]; batchStart: number | null; batchEnd: number | null }> = [];
    for (const [, group] of hashGroups) {
      if (group.length >= 2) {
        const eps = group.map((ep) => ep.episode).sort((a, b) => a - b);
        const allAlts = new Map<string, EpisodeResult["alternatives"][number]>();
        for (const ep of group) {
          for (const alt of ep.alternatives) {
            if (!allAlts.has(alt.magnet)) { allAlts.set(alt.magnet, alt); }
          }
        }
        const parsed = group[0].best ? parseTitle(group[0].best.title) : { batchStart: null, batchEnd: null };
        batches.push({ best: group[0].best, alternatives: [...allAlts.values()], episodes: eps, batchStart: parsed.batchStart, batchEnd: parsed.batchEnd });
      } else {
        individuals.push(group[0]);
      }
    }
    batches.sort((a, b) => (b.episodes.length - a.episodes.length));
    individuals.sort((a, b) => a.episode - b.episode);
    return { batches, individuals };
  }, [foundEpisodes]);
  const missingEpisodes = useMemo(() => visibleEpisodes.filter((episode) => episode.status === "missing"), [visibleEpisodes]);
  const failedEpisodes = useMemo(() => visibleEpisodes.filter((episode) => episode.status === "failed"), [visibleEpisodes]);
  const visibleEpisodeTotal = progressCounts?.total ?? visibleEpisodes.length;
  const visibleCoveragePercent = useMemo(() => {
    if (visibleEpisodeTotal === 0) {
      return 0;
    }
    return (foundEpisodes.length / visibleEpisodeTotal) * 100;
  }, [foundEpisodes.length, visibleEpisodeTotal]);
  const visibleTotalBestSizeBytes = useMemo(
    () => {
      const seen = new Set<string>();
      let total = 0;
      for (const episode of visibleEpisodes) {
        if (!episode.best) { continue; }
        if (seen.has(episode.best.magnet)) { continue; }
        seen.add(episode.best.magnet);
        total += episode.best.sizeBytes;
      }
      return total;
    },
    [visibleEpisodes]
  );
  const summaryItems = useMemo(() => {
    const items = [
      { label: "Coverage", value: `${(busy ? visibleCoveragePercent : result?.coveragePercent ?? 0).toFixed(0)}%` },
      {
        label: busy ? "Scanned" : "Found",
        value: busy
          ? `${progressCounts?.completed ?? visibleEpisodes.length}/${progressCounts?.total ?? "?"}`
          : `${foundEpisodes.length}/${visibleEpisodeTotal}`
      },
      { label: "Total size", value: formatSize(visibleTotalBestSizeBytes) }
    ];

    if (missingEpisodes.length > 0) {
      items.push({ label: "Missing", value: String(missingEpisodes.length) });
    }
    if (failedEpisodes.length > 0) {
      items.push({ label: "Failures", value: String(failedEpisodes.length) });
    }
    return items;
  }, [
    busy,
    failedEpisodes.length,
    foundEpisodes.length,
    missingEpisodes.length,
    progressCounts?.completed,
    progressCounts?.total,
    result?.coveragePercent,
    result?.totalBestSizeBytes,
    visibleCoveragePercent,
    visibleEpisodeTotal,
    visibleEpisodes.length,
    visibleTotalBestSizeBytes
  ]);

  const mascotState = mascotOverride ?? getBaseMascotState(busy, result);
  const hasResultsSurface = result !== null || liveEpisodes.length > 0;
  const shellClassName = hasResultsSurface
    ? `app-shell app-shell--results${canResizeSplit ? "" : " app-shell--stacked"}`
    : "app-shell app-shell--idle";
  const showStatus = !busy && status !== "Ready" && !status.startsWith("Completed:");

  useEffect(() => {
    if (!isResizing) {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      if (!shellRef.current) {
        return;
      }
      const rect = shellRef.current.getBoundingClientRect();
      const nextWidth = clampLeftPaneWidth(event.clientX - rect.left, rect.width);
      setLeftPaneWidth(nextWidth);
    };

    const stopResizing = () => {
      setIsResizing(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResizing);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResizing);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing]);

  useEffect(() => {
    if (!hasResultsSurface || !shellRef.current) {
      return;
    }
    const syncPaneWidth = () => {
      if (!shellRef.current) {
        return;
      }
      const rect = shellRef.current.getBoundingClientRect();
      setCanResizeSplit(canUseResizableSplit(rect.width));
      setLeftPaneWidth((current) => clampLeftPaneWidth(current, rect.width));
    };

    syncPaneWidth();
    window.addEventListener("resize", syncPaneWidth);
    return () => window.removeEventListener("resize", syncPaneWidth);
  }, [hasResultsSurface]);

  useEffect(() => {
    const payload: StoredFormState = {
      request,
      groupInput
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }, [groupInput, request]);

  useEffect(() => () => {
    if (mascotOverrideTimerRef.current !== null) {
      window.clearTimeout(mascotOverrideTimerRef.current);
    }
    if (mascotTapResetTimerRef.current !== null) {
      window.clearTimeout(mascotTapResetTimerRef.current);
    }
  }, []);

  const triggerMascotOverride = (state: MascotState, durationMs = 1800) => {
    if (mascotOverrideTimerRef.current !== null) {
      window.clearTimeout(mascotOverrideTimerRef.current);
    }
    setMascotOverride(state);
    mascotOverrideTimerRef.current = window.setTimeout(() => {
      setMascotOverride(null);
      mascotOverrideTimerRef.current = null;
    }, durationMs);
  };

  const handleMascotActivate = () => {
    if (mascotTapResetTimerRef.current !== null) {
      window.clearTimeout(mascotTapResetTimerRef.current);
    }
    const nextTapCount = mascotTapCount + 1;
    if (nextTapCount >= 5) {
      setMascotTapCount(0);
      setStatus("Mascot easter egg unlocked.");
      triggerMascotOverride("easterEgg", 3200);
      return;
    }
    setMascotTapCount(nextTapCount);
    mascotTapResetTimerRef.current = window.setTimeout(() => {
      setMascotTapCount(0);
      mascotTapResetTimerRef.current = null;
    }, 1800);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const controller = new AbortController();
    searchControllerRef.current = controller;
    setBusy(true);
    setMascotOverride(null);
    setStatus("Searching...");
    setResult(null);
    setLiveEpisodes([]);
    setProgressCounts(null);
    try {
      const payload = SearchRequestSchema.parse({
        ...request,
        preferredGroups: groupInput.split(",").map((value) => value.trim()).filter(Boolean),
        manualAltTitles: []
      });
      const searchResult = await runSearch(payload, (update) => {
        setLiveEpisodes((current) => (
          [...current.filter((episode) => episode.episode !== update.episodeResult.episode), update.episodeResult]
            .sort((left, right) => left.episode - right.episode)
        ));
        setProgressCounts({ completed: update.completed, total: update.total });
      }, controller.signal);
      if (controller.signal.aborted) {
        buildPartialResult();
      } else {
        setResult(searchResult);
        setLiveEpisodes(searchResult.episodes);
        setStatus(`Completed: ${searchResult.coveragePercent.toFixed(0)}% coverage`);
      }
    } catch (error) {
      if (controller.signal.aborted) {
        buildPartialResult();
      } else {
        setStatus(error instanceof Error ? error.message : "Search failed");
        triggerMascotOverride("error", 2400);
      }
    } finally {
      setBusy(false);
      searchControllerRef.current = null;
    }
  };

  const buildPartialResult = () => {
    setLiveEpisodes((current) => {
      const foundCount = current.filter((ep) => ep.status === "found").length;
      const totalBestSizeBytes = current.reduce((sum, ep) => sum + (ep.best?.sizeBytes ?? 0), 0);
      setResult({
        anime: request.anime,
        episodes: current,
        coveragePercent: current.length === 0 ? 0 : (foundCount / current.length) * 100,
        totalRequests: 0,
        elapsedMs: 0,
        totalBestSizeBytes
      });
      return current;
    });
    setStatus("Stopped — showing partial results");
  };

  const stopSearch = () => {
    searchControllerRef.current?.abort();
  };

  const exportAll = async () => {
    try {
      const content = bestMagnets(result).join("\n");
      const path = await exportMagnets(`${request.anime || "nyaagrab"}-magnets.txt`, content);
      setStatus(`Exported magnets to ${path.path}`);
      triggerMascotOverride("exporting");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not export magnets");
      triggerMascotOverride("error", 2400);
    }
  };

  const openSingleMagnet = async (magnet: string) => {
    try {
      await openMagnet(magnet);
      setStatus("Sent magnet to the OS. If nothing opened, check your default torrent app / magnet association.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not open magnet");
    }
  };

  const copyMagnetText = async (value: string) => {
    try {
      await copyText(value);
      setStatus(value.includes("\n") ? "Copied all magnets to the clipboard." : "Copied magnet to the clipboard.");
      triggerMascotOverride("copying");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not copy magnet");
      triggerMascotOverride("error", 2400);
    }
  };

  return (
    <main
      ref={shellRef}
      className={shellClassName}
      style={hasResultsSurface && canResizeSplit ? { gridTemplateColumns: `${leftPaneWidth}px ${SPLIT_GUTTER_WIDTH}px minmax(0, 1fr)` } : undefined}
    >
      <section className="panel panel--hero">
        <div className="hero-content">
          <div className="app-header">
            <MascotDisplay state={mascotState} onActivate={handleMascotActivate} />
            <div className="header-text">
              <h1>NyaaGrab</h1>
              <p className="subtle">Batch search Nyaa.</p>
            </div>
          </div>
          <form className="search-form" onSubmit={submit}>
            <label>
              Anime
              <input
                value={request.anime}
                onChange={(event) => setRequest((current) => ({ ...current, anime: event.target.value }))}
                placeholder="One Piece"
              />
            </label>
            <div className="row row--search-source">
              <label>
                Result shape
                <select
                  value={request.resultShape}
                  onChange={(event) => setRequest((current) => ({ ...current, resultShape: event.target.value as ResultShape }))}
                >
                  {RESULT_SHAPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label>
                Filter
                <select
                  value={request.filter}
                  onChange={(event) => setRequest((current) => ({ ...current, filter: event.target.value as NyaaFilter }))}
                >
                  {NYAA_FILTER_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label>
                Category
                <select
                  value={request.category}
                  onChange={(event) => setRequest((current) => ({ ...current, category: event.target.value as NyaaCategory }))}
                >
                  {NYAA_CATEGORY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="row row--primary">
              <label>
                Start
                <input
                  aria-label="Start episode"
                  type="number"
                  value={request.startEpisode}
                  onChange={(event) => setRequest((current) => ({ ...current, startEpisode: Number(event.target.value) }))}
                />
              </label>
              <label>
                End
                <input
                  aria-label="End episode"
                  type="number"
                  value={request.endEpisode}
                  onChange={(event) => setRequest((current) => ({ ...current, endEpisode: Number(event.target.value) }))}
                />
              </label>
              <label>
                Resolution
                <select
                  value={request.preferredResolution}
                  onChange={(event) => setRequest((current) => ({ ...current, preferredResolution: event.target.value }))}
                >
                  <option value="480p">480p</option>
                  <option value="720p">720p</option>
                  <option value="1080p">1080p</option>
                  <option value="1440p">1440p</option>
                  <option value="2160p">2160p</option>
                </select>
              </label>
              <label>
                Preferred encoding
                <select
                  value={request.preferredCodec}
                  onChange={(event) => setRequest((current) => ({ ...current, preferredCodec: event.target.value }))}
                >
                  <option value="Any">Any</option>
                  <option value="HEVC">HEVC / x265</option>
                  <option value="AVC">AVC / x264</option>
                  <option value="AV1">AV1</option>
                  <option value="VP9">VP9</option>
                </select>
              </label>
            </div>
            <div className="row row--secondary-fields">
              <label className="field field--wide field--stacked">
                Preferred groups
                <input value={groupInput} onChange={(event) => setGroupInput(event.target.value)} placeholder="SubsPlease" />
              </label>
            </div>
            <div className="toggle-group" aria-label="Search options">
              <label className="checkbox checkbox--card">
                <input
                  type="checkbox"
                  checked={request.preferSmall}
                  onChange={(event) => setRequest((current) => ({ ...current, preferSmall: event.target.checked }))}
                />
                Prefer smaller files
              </label>
              <label className="checkbox checkbox--card">
                <input
                  type="checkbox"
                  checked={!request.disableAutoResolve}
                  onChange={(event) => setRequest((current) => ({ ...current, disableAutoResolve: !event.target.checked }))}
                />
                Use alternate titles
              </label>
            </div>
            <div className="row">
              {busy ? (
                <button type="button" className="btn--stop" onClick={stopSearch}>Stop</button>
              ) : (
                <button type="submit">Search</button>
              )}
              <button type="button" disabled={!result} onClick={exportAll}>Export magnets</button>
              <button type="button" disabled={!result} onClick={async () => copyMagnetText(bestMagnets(result).join("\n"))}>Copy magnets</button>
            </div>
          </form>
          {showStatus ? (
            <div className={getStatusClass(busy, result)}>
              <div className="status__headline">{status}</div>
            </div>
          ) : null}
        </div>
      </section>

      {hasResultsSurface && canResizeSplit ? (
        <div
          className={`splitter${isResizing ? " splitter--active" : ""}`}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize panels"
          onPointerDown={(event) => {
            event.preventDefault();
            setIsResizing(true);
          }}
        />
      ) : null}

      {(busy && visibleEpisodes.length > 0) || result ? (
        <div className="results-stack">
          <section className="panel panel--summary">
            <h2>Summary</h2>
            <div className="summary-strip">
              {summaryItems.map((item) => (
                <div key={item.label} className="summary-strip__item">
                  <strong>{item.label}</strong>
                  <span>{item.value}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="panel">
            <h2>Found Episodes</h2>
            <EpisodeTable
              episodes={groupedResults.individuals}
              batchGroups={groupedResults.batches}
              onCopyMagnet={(magnet) => { void copyMagnetText(magnet); }}
              onOpenMagnet={openSingleMagnet}
            />
          </section>

          {missingEpisodes.length > 0 ? (
            <section className="panel">
              <h2>Missing Episodes</h2>
              <ul>{missingEpisodes.map((episode) => <li key={episode.episode}>Episode {episode.episode}</li>)}</ul>
            </section>
          ) : null}

          {failedEpisodes.length > 0 ? (
            <section className="panel">
              <h2>Search Failures</h2>
              <ul>
                {failedEpisodes.map((episode) => (
                  <li key={episode.episode}>Episode {episode.episode}: {episode.failureReason ?? "Unknown error"}</li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : null}
    </main>
  );
}
