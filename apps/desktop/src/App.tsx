import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { EpisodeResult, SearchRequest, SearchResult } from "@nyaagrab/contracts";
import { SearchRequestSchema } from "@nyaagrab/contracts";
import { exportMagnets, openMagnet, runSearch, copyText } from "./desktop-api";

const defaultRequest: SearchRequest = {
  anime: "",
  startEpisode: 1,
  endEpisode: 1,
  preferSmall: false,
  preferredResolution: "1080p",
  preferredCodec: "Any",
  preferredGroups: [],
  manualAltTitles: [],
  disableAutoResolve: false
};

const STORAGE_KEY = "nyaagrab.desktop.searchForm";

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

function formatSize(bytes: number): string {
  if (bytes >= 1024 ** 3) {
    return `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
  }
  if (bytes >= 1024 ** 2) {
    return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
  }
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

function bestMagnets(result: SearchResult | null): string[] {
  return result?.episodes.filter((episode) => episode.best).map((episode) => episode.best!.magnet) ?? [];
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

const MIN_LEFT_PANE_WIDTH = 400;
const MAX_LEFT_PANE_WIDTH = 560;
const MIN_RIGHT_PANE_WIDTH = 820;
const SPLIT_GUTTER_WIDTH = 8;
const RESULTS_OUTER_PADDING = 28;

function canUseResizableSplit(containerWidth: number): boolean {
  return containerWidth >= MIN_LEFT_PANE_WIDTH + MIN_RIGHT_PANE_WIDTH + SPLIT_GUTTER_WIDTH + RESULTS_OUTER_PADDING;
}

function clampLeftPaneWidth(nextWidth: number, containerWidth: number): number {
  const upperBound = Math.min(MAX_LEFT_PANE_WIDTH, containerWidth - MIN_RIGHT_PANE_WIDTH);
  return Math.min(Math.max(nextWidth, MIN_LEFT_PANE_WIDTH), Math.max(MIN_LEFT_PANE_WIDTH, upperBound));
}

/* ── Mascot state mapping ── */
type MascotState = "idle" | "searching" | "success" | "perfect" | "missing";

const MASCOT_IMAGES: Record<MascotState, { primary: string; fallback: string }> = {
  idle: { primary: "/mascot/idle.jpg", fallback: "/mascot/header.jpg" },
  searching: { primary: "/mascot/searching.jpg", fallback: "/mascot/header.jpg" },
  success: { primary: "/mascot/success.jpg", fallback: "/mascot/header.jpg" },
  perfect: { primary: "/mascot/success.jpg", fallback: "/mascot/header.jpg" },
  missing: { primary: "/mascot/missing.jpg", fallback: "/mascot/header.jpg" }
};

function getMascotState(busy: boolean, result: SearchResult | null): MascotState {
  if (busy) return "searching";
  if (!result) return "idle";
  if (result.coveragePercent >= 100) return "perfect";
  if (result.coveragePercent > 0) return "success";
  return "missing";
}

function getStatusClass(busy: boolean, result: SearchResult | null): string {
  if (busy) return "status status--busy";
  if (result && result.coveragePercent >= 80) return "status status--ok";
  if (result && result.coveragePercent < 80) return "status status--error";
  return "status";
}

/* ── Mascot component ── */
function MascotDisplay({ state }: { state: MascotState }) {
  const [src, setSrc] = useState(MASCOT_IMAGES[state].primary);

  useEffect(() => {
    setSrc(MASCOT_IMAGES[state].primary);
  }, [state]);

  return (
    <div className={`mascot-container${state === "searching" ? " searching" : ""}`}>
      <img
        src={src}
        alt={`NyaaGrab mascot — ${state}`}
        draggable={false}
        onError={() => {
          if (src !== MASCOT_IMAGES[state].fallback) {
            setSrc(MASCOT_IMAGES[state].fallback);
          }
        }}
      />
    </div>
  );
}

/* ── Episode table ── */
function EpisodeTable({
  episodes,
  onCopyMagnet,
  onOpenMagnet
}: {
  episodes: EpisodeResult[];
  onCopyMagnet: (magnet: string) => void;
  onOpenMagnet: (magnet: string) => Promise<void>;
}) {
  const [expandedEpisodes, setExpandedEpisodes] = useState<number[]>([]);

  if (episodes.length === 0) {
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
          {episodes.map((episode) => {
            const best = episode.best!;
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
  const [request, setRequest] = useState<SearchRequest>(() => loadStoredFormState().request);
  const [groupInput, setGroupInput] = useState(() => loadStoredFormState().groupInput);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [status, setStatus] = useState("Ready");
  const [busy, setBusy] = useState(false);
  const [liveEpisodes, setLiveEpisodes] = useState<EpisodeResult[]>([]);
  const [progressCounts, setProgressCounts] = useState<{ completed: number; total: number } | null>(null);
  const [leftPaneWidth, setLeftPaneWidth] = useState(430);
  const [isResizing, setIsResizing] = useState(false);
  const [canResizeSplit, setCanResizeSplit] = useState(() => typeof window === "undefined" ? true : canUseResizableSplit(window.innerWidth));

  const visibleEpisodes = useMemo(() => {
    if (busy) {
      return liveEpisodes;
    }
    return result?.episodes ?? [];
  }, [busy, liveEpisodes, result]);

  const foundEpisodes = useMemo(() => visibleEpisodes.filter((episode) => episode.status === "found"), [visibleEpisodes]);
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
    () => visibleEpisodes.reduce((sum, episode) => sum + (episode.best?.sizeBytes ?? 0), 0),
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
      { label: "Total size", value: formatSize(busy ? visibleTotalBestSizeBytes : result?.totalBestSizeBytes ?? 0) }
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

  const mascotState = getMascotState(busy, result);
  const hasResultsSurface = result !== null || liveEpisodes.length > 0;
  const shellClassName = hasResultsSurface ? "app-shell app-shell--results" : "app-shell app-shell--idle";
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

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
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
      });
      setResult(searchResult);
      setLiveEpisodes(searchResult.episodes);
      setStatus(`Completed: ${searchResult.coveragePercent.toFixed(0)}% coverage`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Search failed");
    } finally {
      setBusy(false);
    }
  };

  const exportAll = async () => {
    const content = bestMagnets(result).join("\n");
    const path = await exportMagnets(`${request.anime || "nyaagrab"}-magnets.txt`, content);
    setStatus(`Exported magnets to ${path.path}`);
  };

  const openSingleMagnet = async (magnet: string) => {
    try {
      await openMagnet(magnet);
      setStatus("Sent magnet to the OS. If nothing opened, check your default torrent app / magnet association.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not open magnet");
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
            <MascotDisplay state={mascotState} />
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
            <div className="row row--secondary">
              <label className="field field--wide field--stacked">
                Preferred groups
                <input value={groupInput} onChange={(event) => setGroupInput(event.target.value)} placeholder="SubsPlease" />
              </label>
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
            </div>
            <div className="row">
              <button type="submit" disabled={busy}>{busy ? "Searching..." : "Search"}</button>
              <button type="button" disabled={!result} onClick={exportAll}>Export magnets</button>
              <button type="button" disabled={!result} onClick={() => copyText(bestMagnets(result).join("\n"))}>Copy magnets</button>
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
            <EpisodeTable episodes={foundEpisodes} onCopyMagnet={(magnet) => copyText(magnet)} onOpenMagnet={openSingleMagnet} />
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
