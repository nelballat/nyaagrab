import type { EpisodeResult, SearchRequest, SearchResult } from "@nyaagrab/contracts";
import { SearchRequestSchema, SearchResultSchema } from "@nyaagrab/contracts";
import { parseRss } from "./rss";
import { parseTitle } from "./parser";
import { scoreRelease } from "./ranker";
import { DEFAULT_PREFERRED_GROUPS, HEVC_CODECS } from "./constants";
import { normalizeResolvedTitles } from "./resolver";
import type { ProviderContext, TorrentRecord } from "./types";

export type SearchProgressUpdate = {
  episodeResult: EpisodeResult;
  completed: number;
  total: number;
};

type SearchOptions = {
  onEpisodeProcessed?: (update: SearchProgressUpdate) => void;
};

function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/^(?:\[[^\]]+\]\s*)+/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function titleMatchesQuery(title: string, queryTitle: string): boolean {
  const normalizedQuery = normalizeSearchText(queryTitle);
  if (!normalizedQuery) {
    return true;
  }
  const normalizedTitle = normalizeSearchText(title);
  return normalizedTitle.includes(normalizedQuery);
}

function needsAltSearch(
  candidates: TorrentRecord[],
  request: SearchRequest
): boolean {
  if (candidates.length === 0) {
    return true;
  }

  const parsed = candidates.map((candidate) => parseTitle(candidate.title));
  const trustedGroups = request.preferredGroups.length > 0 ? request.preferredGroups : DEFAULT_PREFERRED_GROUPS;
  if (request.preferSmall && !parsed.some((item) => item.codec && HEVC_CODECS.has(item.codec))) {
    return true;
  }
  if (!parsed.some((item) => item.resolution === request.preferredResolution)) {
    return true;
  }
  if (request.preferredCodec !== "Any" && !parsed.some((item) => item.codec === request.preferredCodec)) {
    return true;
  }
  if (!parsed.some((item) => trustedGroups.includes(item.group))) {
    return true;
  }
  return false;
}

function matchEpisode(torrents: TorrentRecord[], queryTitle: string, episode: number, seen: Set<string>): TorrentRecord[] {
  const matches: TorrentRecord[] = [];
  for (const torrent of torrents) {
    const parsed = parseTitle(torrent.title);
    if (
      parsed.episode === episode &&
      titleMatchesQuery(torrent.title, queryTitle) &&
      !parsed.isMovie &&
      !parsed.isSpecial &&
      !parsed.isBatch &&
      !seen.has(torrent.infoHash)
    ) {
      seen.add(torrent.infoHash);
      matches.push(torrent);
    }
  }
  return matches;
}

function filterDeadCandidates(matches: TorrentRecord[]): TorrentRecord[] {
  return matches.filter((match) => match.seeders > 0);
}

export async function searchEpisodes(input: SearchRequest, providers: ProviderContext, options: SearchOptions = {}): Promise<SearchResult> {
  const request = SearchRequestSchema.parse(input);
  const startTime = performance.now();
  const totalEpisodes = request.endEpisode - request.startEpisode + 1;
  const manualAltTitles = request.manualAltTitles.filter((value) => value.trim().length > 0);
  const resolvedTitles = request.disableAutoResolve
    ? [request.anime]
    : normalizeResolvedTitles(request.anime, await providers.resolveTitles(request.anime));
  const altTitles = Array.from(new Set([...resolvedTitles.slice(1), ...manualAltTitles]));
  const episodes: EpisodeResult[] = [];
  let totalRequests = 0;

  for (let episode = request.startEpisode; episode <= request.endEpisode; episode += 1) {
    const seenInfoHashes = new Set<string>();
    const errors: string[] = [];
    const primaryResponse = await providers.fetchRss(`${request.anime} ${episode}`);
    totalRequests += 1;
    let primaryMatches: TorrentRecord[] = [];
    if (primaryResponse.error) {
      errors.push(primaryResponse.error);
    } else {
      primaryMatches = matchEpisode(primaryResponse.items, request.anime, episode, seenInfoHashes);
    }

    let matches = [...primaryMatches];
    if (altTitles.length > 0 && needsAltSearch(primaryMatches, request)) {
      for (const altTitle of altTitles) {
        const altResponse = await providers.fetchRss(`${altTitle} ${episode}`);
        totalRequests += 1;
        if (altResponse.error) {
          errors.push(altResponse.error);
          continue;
        }
        matches = matches.concat(matchEpisode(altResponse.items, altTitle, episode, seenInfoHashes));
      }
    }

    const viableMatches = filterDeadCandidates(matches);

    if (viableMatches.length === 0) {
      const episodeResult: EpisodeResult = {
        episode,
        best: null,
        alternatives: [],
        status: errors.length > 0 ? "failed" : "missing",
        ...(errors.length > 0 ? { failureReason: Array.from(new Set(errors)).join("; ") } : {})
      };
      episodes.push(episodeResult);
      options.onEpisodeProcessed?.({
        episodeResult,
        completed: episodes.length,
        total: totalEpisodes
      });
      continue;
    }

    const ranked = viableMatches
      .map((match) => scoreRelease(
        match,
        request.preferSmall,
        request.preferredGroups,
        request.preferredResolution,
        request.preferredCodec
      ))
      .sort((a, b) => b.score - a.score);

    const episodeResult: EpisodeResult = {
      episode,
      best: ranked[0],
      alternatives: ranked.slice(1),
      status: "found"
    };
    episodes.push(episodeResult);
    options.onEpisodeProcessed?.({
      episodeResult,
      completed: episodes.length,
      total: totalEpisodes
    });
  }

  const foundCount = episodes.filter((episode) => episode.status === "found").length;
  const totalBestSizeBytes = episodes.reduce((sum, episode) => sum + (episode.best?.sizeBytes ?? 0), 0);
  const result = {
    anime: request.anime,
    episodes,
    coveragePercent: episodes.length === 0 ? 0 : (foundCount / episodes.length) * 100,
    totalRequests,
    elapsedMs: performance.now() - startTime,
    totalBestSizeBytes
  };

  return SearchResultSchema.parse(result);
}
