import type { EpisodeResult, SearchRequest, SearchResult } from "@nyaagrab/contracts";
import { SearchRequestSchema, SearchResultSchema } from "@nyaagrab/contracts";
import { extractSeriesTitle, parseTitle } from "./parser";
import { scoreRelease } from "./ranker";
import { DEFAULT_PREFERRED_GROUPS, HEVC_CODECS } from "./constants";
import { normalizeResolvedTitles } from "./resolver";
import type { ProviderContext, RssFetchRequest, TorrentRecord } from "./types";

const EPISODE_SEARCH_CONCURRENCY = 3;
const ALT_TITLE_SEARCH_CONCURRENCY = 2;
const RSS_FETCH_CONCURRENCY = 2;
const QUERY_VARIANT_CONCURRENCY = 3;
const AUTO_COLLECTION_SCORE_PENALTY = 400;
const COLLECTION_SCORE_PENALTY = 3000;
const BATCH_SKIP_SEEDER_THRESHOLD = 5;
const BATCH_PRESCAN_KEYWORDS = ["batch", "collection"];
const COLLECTION_SUFFIX_TOKENS = new Set([
  "batch",
  "complete",
  "collection",
  "series",
  "season",
  "tv",
  "part",
  "cour",
  "arc",
  "vol",
  "volume",
  "remux",
  "bd",
  "bdrip",
  "bluray",
  "dvd",
  "全集",
  "全話"
]);
const ORDINAL_SEASON_RE = /\b(\d{1,2})(?:st|nd|rd|th)\s+season\b/gi;
const ORDINAL_PART_RE = /\b(\d{1,2})(?:st|nd|rd|th)\s+part\b/gi;
const SEASON_RE = /\bseason\s*0*(\d{1,2})\b/gi;
const PART_RE = /\bpart\s*0*(\d{1,2})\b/gi;
const COUR_RE = /\bcour\s*0*(\d{1,2})\b/gi;
const STANDALONE_SEASON_RE = /\bs0*(\d{1,2})(?!e\d)\b/gi;
const SEASON_EPISODE_RE = /\bs0*(\d{1,2})e\d{1,4}(?:v\d+)?\b/gi;
const ROMAN_NUMERAL_RE = /\b(ii|iii|iv|v|vi|vii|viii|ix|x)\b/gi;
const TITLE_TAG_PREFIX_RE = /^(?:\[[^\]]+\]\s*)+/;
const TITLE_FILE_EXTENSION_RE = /\.[a-z0-9]{2,4}$/i;
const TITLE_HASH_TAG_RE = /\[[0-9A-Fa-f]{6,}\]/g;
const RSS_FETCH_DELAY_MS = 200;

export type SearchProgressUpdate = {
  episodeResult: EpisodeResult;
  completed: number;
  total: number;
};

type SearchOptions = {
  onEpisodeProcessed?: (update: SearchProgressUpdate) => void;
  signal?: AbortSignal;
};

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/^(?:\[[^\]]+\]\s*)+/, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function splitTokens(value: string): string[] {
  return value.length > 0 ? value.split(" ") : [];
}

function containsTokenSequence(haystack: string[], needle: string[]): boolean {
  if (needle.length === 0 || needle.length > haystack.length) {
    return false;
  }

  for (let index = 0; index <= haystack.length - needle.length; index += 1) {
    let matches = true;
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (haystack[index + offset] !== needle[offset]) {
        matches = false;
        break;
      }
    }
    if (matches) {
      return true;
    }
  }

  return false;
}

function uniqueNonEmpty(values: string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    const trimmed = value.trim().replace(/\s+/g, " ");
    if (!trimmed) {
      continue;
    }

    const lowered = trimmed.toLocaleLowerCase();
    if (seen.has(lowered)) {
      continue;
    }

    seen.add(lowered);
    result.push(trimmed);
  }

  return result;
}

function buildTitleQueryVariants(title: string): string[] {
  const normalized = title.normalize("NFKC").trim().replace(/\s+/g, " ");
  const slashSpace = normalized.replace(/[／/]+/g, " ");
  const slashHyphen = normalized.replace(/[／/]+/g, "-");
  const punctuationLight = normalized
    .replace(/[／/]+/g, " ")
    .replace(/[:：()[\]{}☆★!！?？]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return uniqueNonEmpty([
    title,
    normalized,
    slashSpace,
    slashHyphen,
    punctuationLight
  ]);
}

function buildEpisodeQueries(title: string, episode: number): string[] {
  return buildTitleQueryVariants(title).map((variant) => `${variant} ${episode}`);
}

function extractSeriesTitleVariants(title: string): string[] {
  return extractSeriesTitleVariantPairs(title).map((variant) => variant.cleaned);
}

function extractSeriesTitleVariantPairs(title: string): Array<{ raw: string; cleaned: string }> {
  const rawBase = title
    .replace(TITLE_FILE_EXTENSION_RE, "")
    .replace(TITLE_TAG_PREFIX_RE, "")
    .replace(TITLE_HASH_TAG_RE, "")
    .trim();
  const rawVariants = uniqueNonEmpty([
    rawBase,
    ...rawBase.split("|").map((segment) => segment.trim())
  ]);

  return rawVariants.map((raw) => ({
    raw,
    cleaned: extractSeriesTitle(raw)
  }));
}

type TitleQualifiers = {
  seasons: number[];
  parts: number[];
};

function readNumberMatches(value: string, pattern: RegExp): number[] {
  const matches = new Set<number>();
  for (const match of value.matchAll(pattern)) {
    const parsed = Number.parseInt(match[1], 10);
    if (!Number.isNaN(parsed)) {
      matches.add(parsed);
    }
  }
  return [...matches];
}

function extractTitleQualifiers(title: string): TitleQualifiers {
  const normalized = title.normalize("NFKC").toLowerCase();
  const seasons = new Set<number>([
    ...readNumberMatches(normalized, ORDINAL_SEASON_RE),
    ...readNumberMatches(normalized, SEASON_RE),
    ...readNumberMatches(normalized, STANDALONE_SEASON_RE),
    ...readNumberMatches(normalized, SEASON_EPISODE_RE)
  ]);
  for (const match of normalized.matchAll(ROMAN_NUMERAL_RE)) {
    const roman = match[1];
    const value = {
      ii: 2,
      iii: 3,
      iv: 4,
      v: 5,
      vi: 6,
      vii: 7,
      viii: 8,
      ix: 9,
      x: 10
    }[roman];
    if (value !== undefined) {
      seasons.add(value);
    }
  }
  const parts = new Set<number>([
    ...readNumberMatches(normalized, ORDINAL_PART_RE),
    ...readNumberMatches(normalized, PART_RE),
    ...readNumberMatches(normalized, COUR_RE)
  ]);

  return {
    seasons: [...seasons],
    parts: [...parts]
  };
}

function qualifiersCompatible(queryTitle: string, candidateTitle: string): boolean {
  const query = extractTitleQualifiers(queryTitle);
  const candidate = extractTitleQualifiers(candidateTitle);

  if (candidate.seasons.length > 0) {
    if (query.seasons.length === 0) {
      if (candidate.seasons.some((season) => season > 1)) {
        return false;
      }
    } else if (!candidate.seasons.some((season) => query.seasons.includes(season))) {
      return false;
    }
  }

  if (candidate.parts.length > 0) {
    if (query.parts.length === 0) {
      if (candidate.parts.some((part) => part > 1)) {
        return false;
      }
    } else if (!candidate.parts.some((part) => query.parts.includes(part))) {
      return false;
    }
  }

  return true;
}

function canUseCollectionFallbackTitle(title: string, options: { primary?: boolean } = {}): boolean {
  if (options.primary) {
    return true;
  }

  return splitTokens(normalizeSearchText(title)).length > 1;
}

function titleMatchesQuery(title: string, queryTitle: string): boolean {
  const normalizedQuery = normalizeSearchText(queryTitle);
  if (!normalizedQuery) {
    return true;
  }
  if (!qualifiersCompatible(queryTitle, title)) {
    return false;
  }

  const queryTokens = splitTokens(normalizedQuery);
  for (const variant of extractSeriesTitleVariantPairs(title)) {
    if (!qualifiersCompatible(queryTitle, variant.raw)) {
      continue;
    }
    const normalizedSeriesTitle = normalizeSearchText(variant.cleaned);
    if (!normalizedSeriesTitle) {
      continue;
    }
    if (normalizedSeriesTitle === normalizedQuery) {
      return true;
    }

    const seriesTokens = splitTokens(normalizedSeriesTitle);
    if (queryTokens.length === 1) {
      const [queryToken] = queryTokens;
      if (seriesTokens.length === 1) {
        if (seriesTokens[0] === queryToken) {
          return true;
        }
        continue;
      }

      const firstToken = seriesTokens[0];
      const lastToken = seriesTokens[seriesTokens.length - 1];
      if (queryToken.length >= 6 && (firstToken === queryToken || lastToken === queryToken)) {
        return true;
      }
      continue;
    }

    if (
      containsTokenSequence(seriesTokens, queryTokens)
      && seriesTokens[0] === queryTokens[0]
      && seriesTokens[seriesTokens.length - 1] === queryTokens[queryTokens.length - 1]
    ) {
      return true;
    }
  }

  return false;
}

function titleMatchesCollectionQuery(title: string, queryTitle: string): boolean {
  const normalizedQuery = normalizeSearchText(queryTitle);
  if (!normalizedQuery) {
    return true;
  }

  const queryTokens = splitTokens(normalizedQuery);
  for (const variant of extractSeriesTitleVariantPairs(title)) {
    if (!qualifiersCompatible(queryTitle, variant.raw)) {
      continue;
    }
    const normalizedSeriesTitle = normalizeSearchText(variant.cleaned);
    if (!normalizedSeriesTitle) {
      continue;
    }
    if (normalizedSeriesTitle === normalizedQuery) {
      return true;
    }

    const seriesTokens = splitTokens(normalizedSeriesTitle);
    if (queryTokens.length === 0 || seriesTokens.length < queryTokens.length) {
      continue;
    }
    if (!containsTokenSequence(seriesTokens, queryTokens)) {
      continue;
    }

    const startIndex = seriesTokens.findIndex((_, index) =>
      index + queryTokens.length <= seriesTokens.length
      && queryTokens.every((token, offset) => seriesTokens[index + offset] === token)
    );
    if (startIndex !== 0) {
      continue;
    }

    const suffixTokens = seriesTokens.slice(queryTokens.length);
    if (suffixTokens.length === 0) {
      return true;
    }

    if (suffixTokens.every((token, index) => {
      if (/^\d+$/.test(token)) {
        return index > 0 && COLLECTION_SUFFIX_TOKENS.has(suffixTokens[index - 1]);
      }
      return COLLECTION_SUFFIX_TOKENS.has(token);
    })) {
      return true;
    }
  }

  return false;
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

function matchCollections(
  torrents: TorrentRecord[],
  queryTitle: string,
  seen: Set<string>
): TorrentRecord[] {
  const matches: TorrentRecord[] = [];
  const queryLower = normalizeSearchText(queryTitle);
  for (const torrent of torrents) {
    const parsed = parseTitle(torrent.title);
    if (parsed.isMovie || parsed.isSpecial || seen.has(torrent.infoHash)) { continue; }
    if (!parsed.isBatch && parsed.episode !== null) { continue; }
    const titleOk = parsed.isBatch
      ? queryLower.length > 0 && normalizeSearchText(torrent.title).includes(queryLower)
      : titleMatchesCollectionQuery(torrent.title, queryTitle);
    if (titleOk) {
      seen.add(torrent.infoHash);
      matches.push(torrent);
    }
  }
  return matches;
}

function filterDeadCandidates(matches: TorrentRecord[]): TorrentRecord[] {
  return matches.filter((match) => match.seeders > 0);
}

// The shared `nextIndex` looks like a data race but is safe: JavaScript is
// single-threaded, so the read-increment-assign sequence between `nextIndex`
// and `currentIndex` runs atomically before each `await` yields to the
// microtask queue.  Do not "fix" this by adding locks or atomics.
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
  signal?: AbortSignal
): Promise<(R | undefined)[]> {
  if (items.length === 0) {
    return [];
  }

  const limit = Math.max(1, Math.min(concurrency, items.length));
  const results = new Array<R | undefined>(items.length);
  let nextIndex = 0;

  await Promise.all(Array.from({ length: limit }, async () => {
    while (nextIndex < items.length) {
      if (signal?.aborted) {
        break;
      }
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }));

  return results;
}

function createConcurrencyLimiter(limit: number, delayMs = 0) {
  let activeCount = 0;
  const queue: Array<() => void> = [];

  const resumeNext = () => {
    activeCount -= 1;
    const next = queue.shift();
    if (next) {
      if (delayMs > 0) {
        setTimeout(() => {
          activeCount += 1;
          next();
        }, delayMs);
      } else {
        activeCount += 1;
        next();
      }
    }
  };

  return async function runLimited<T>(task: () => Promise<T>): Promise<T> {
    if (activeCount >= limit) {
      await new Promise<void>((resolve) => queue.push(resolve));
    } else {
      activeCount += 1;
    }

    try {
      return await task();
    } finally {
      resumeNext();
    }
  };
}

function createLimitedProviders(providers: ProviderContext): ProviderContext {
  const runLimitedFetch = createConcurrencyLimiter(RSS_FETCH_CONCURRENCY, RSS_FETCH_DELAY_MS);

  return {
    fetchRss(request: RssFetchRequest) {
      return runLimitedFetch(() => providers.fetchRss(request));
    },
    resolveTitles(name: string) {
      return providers.resolveTitles(name);
    }
  };
}

type EpisodeSearchOutcome = {
  episodeResult: EpisodeResult;
  requestCount: number;
};

async function discoverBatchPacks(
  titles: string[],
  request: SearchRequest,
  providers: ProviderContext,
  signal?: AbortSignal
): Promise<{ packs: TorrentRecord[]; requestCount: number }> {
  const queries = uniqueNonEmpty(
    titles.flatMap((title) => BATCH_PRESCAN_KEYWORDS.map((kw) => `${title} ${kw}`))
  );
  const seen = new Set<string>();
  const packs: TorrentRecord[] = [];
  let requestCount = 0;
  const responses = await fetchQueries(queries, request, providers);
  requestCount += responses.length;
  for (const entry of responses) {
    if (signal?.aborted) { break; }
    if (!entry.response || entry.response.error) { continue; }
    for (const title of titles) {
      packs.push(...matchCollections(entry.response.items, title, seen));
    }
  }
  return { packs: filterDeadCandidates(packs), requestCount };
}

function batchCoversEpisode(pack: TorrentRecord, episode: number): boolean {
  const parsed = parseTitle(pack.title);
  if (parsed.batchStart !== null && parsed.batchEnd !== null) {
    return episode >= parsed.batchStart && episode <= parsed.batchEnd;
  }
  return false;
}

async function fetchQueries(
  queries: string[],
  request: SearchRequest,
  providers: ProviderContext
): Promise<Array<{ query: string; response: Awaited<ReturnType<ProviderContext["fetchRss"]>> }>> {
  const raw = await mapWithConcurrency(
    uniqueNonEmpty(queries),
    QUERY_VARIANT_CONCURRENCY,
    async (query) => ({
      query,
      response: await providers.fetchRss({
        query,
        category: request.category,
        filter: request.filter
      })
    })
  );
  return raw.filter(<T>(v: T | undefined): v is T => v !== undefined && (v as any).response !== undefined);
}

async function searchEpisode(
  episode: number,
  request: SearchRequest,
  altTitlesPromise: Promise<string[]>,
  providers: ProviderContext,
  signal?: AbortSignal,
  preMatchedBatches?: TorrentRecord[]
): Promise<EpisodeSearchOutcome> {
  const collectionMatches = preMatchedBatches ? [...preMatchedBatches] : [];
  const bestConfirmedSeeders = collectionMatches.reduce((max, t) => {
    const p = parseTitle(t.title);
    return (p.batchStart !== null && p.batchEnd !== null) ? Math.max(max, t.seeders) : max;
  }, 0);
  if (request.resultShape === "batchesOnly") {
    return buildEpisodeSearchOutcome(episode, request, [], [], collectionMatches, 0);
  }
  if (request.resultShape === "auto" && bestConfirmedSeeders >= BATCH_SKIP_SEEDER_THRESHOLD) {
    return buildEpisodeSearchOutcome(episode, request, [], [], collectionMatches, 0);
  }

  const seenInfoHashes = new Set<string>();
  const errors: string[] = [];
  let requestCount = 0;

  const primaryResponses = await fetchQueries(buildEpisodeQueries(request.anime, episode), request, providers);
  requestCount += primaryResponses.length;
  let primaryMatches: TorrentRecord[] = [];
  for (const { response } of primaryResponses) {
    if (response.error) {
      errors.push(response.error);
      continue;
    }
    primaryMatches = primaryMatches.concat(matchEpisode(response.items, request.anime, episode, seenInfoHashes));
    collectionMatches.push(...matchCollections(response.items, request.anime, seenInfoHashes));
  }

  let matches = [...primaryMatches];
  if (!signal?.aborted && needsAltSearch(primaryMatches, request)) {
    const altTitles = await altTitlesPromise;
    if (altTitles.length > 0) {
      const altResults = await mapWithConcurrency(
        altTitles,
        ALT_TITLE_SEARCH_CONCURRENCY,
        async (altTitle) => {
          const responses = await fetchQueries(buildEpisodeQueries(altTitle, episode), request, providers);
          return { altTitle, responses };
        },
        signal
      );

      for (const entry of altResults) {
        if (!entry) { continue; }
        const { altTitle, responses } = entry;
        requestCount += responses.length;
        for (const { response } of responses) {
          if (response.error) {
            errors.push(response.error);
            continue;
          }
          matches = matches.concat(matchEpisode(response.items, altTitle, episode, seenInfoHashes));
          if (canUseCollectionFallbackTitle(altTitle)) {
            collectionMatches.push(...matchCollections(response.items, altTitle, seenInfoHashes));
          }
        }
      }
    }
  }

  return buildEpisodeSearchOutcome(episode, request, errors, matches, collectionMatches, requestCount);
}

function buildEpisodeSearchOutcome(
  episode: number,
  request: SearchRequest,
  errors: string[],
  matches: TorrentRecord[],
  collectionMatches: TorrentRecord[],
  requestCount: number
): EpisodeSearchOutcome {
  const viableMatches = filterDeadCandidates(matches);
  const viableCollections = filterDeadCandidates(collectionMatches);
  const rankSingles = () => viableMatches
    .map((match) => scoreRelease(
      match,
      request.preferSmall,
      request.preferredGroups,
      request.preferredResolution,
      request.preferredCodec
    ))
    .sort((a, b) => b.score - a.score);
  const rankCollections = () => viableCollections
    .map((match) => scoreRelease(
      match,
      request.preferSmall,
      request.preferredGroups,
      request.preferredResolution,
      request.preferredCodec,
      {
        episodeOverride: episode,
        scorePenalty: request.resultShape === "auto" ? AUTO_COLLECTION_SCORE_PENALTY : COLLECTION_SCORE_PENALTY
      }
    ))
    .sort((a, b) => b.score - a.score);

  if (request.resultShape === "episodesOnly") {
    if (viableMatches.length === 0) {
      return {
        requestCount,
        episodeResult: {
          episode,
          best: null,
          alternatives: [],
          status: errors.length > 0 ? "failed" : "missing",
          ...(errors.length > 0 ? { failureReason: Array.from(new Set(errors)).join("; ") } : {})
        }
      };
    }

    const rankedSingles = rankSingles();
    return {
      requestCount,
      episodeResult: {
        episode,
        best: rankedSingles[0],
        alternatives: rankedSingles.slice(1),
        status: "found"
      }
    };
  }

  if (request.resultShape === "batchesOnly") {
    if (viableCollections.length === 0) {
      return {
        requestCount,
        episodeResult: {
          episode,
          best: null,
          alternatives: [],
          status: errors.length > 0 ? "failed" : "missing",
          ...(errors.length > 0 ? { failureReason: Array.from(new Set(errors)).join("; ") } : {})
        }
      };
    }

    const rankedCollections = rankCollections();
    return {
      requestCount,
      episodeResult: {
        episode,
        best: rankedCollections[0],
        alternatives: rankedCollections.slice(1),
        status: "found"
      }
    };
  }

  const rankedSingles = rankSingles();
  const rankedCollections = rankCollections();

  if (rankedSingles.length === 0 && rankedCollections.length === 0) {
    return {
      requestCount,
      episodeResult: {
        episode,
        best: null,
        alternatives: [],
        status: errors.length > 0 ? "failed" : "missing",
        ...(errors.length > 0 ? { failureReason: Array.from(new Set(errors)).join("; ") } : {})
      }
    };
  }

  const ranked = [...rankedSingles, ...rankedCollections].sort((a, b) => b.score - a.score);

  return {
    requestCount,
    episodeResult: {
      episode,
      best: ranked[0],
      alternatives: ranked.slice(1),
      status: "found"
    }
  };
}

export async function searchEpisodes(input: SearchRequest, providers: ProviderContext, options: SearchOptions = {}): Promise<SearchResult> {
  const request = SearchRequestSchema.parse(input);
  const limitedProviders = createLimitedProviders(providers);
  const startTime = performance.now();
  const totalEpisodes = request.endEpisode - request.startEpisode + 1;
  const manualAltTitles = request.manualAltTitles.filter((value) => value.trim().length > 0);
  const altTitlesPromise = (
    request.disableAutoResolve
      ? Promise.resolve([request.anime])
      : limitedProviders.resolveTitles(request.anime).then((response) => normalizeResolvedTitles(request.anime, response))
  ).then((resolvedTitles) => Array.from(new Set([...resolvedTitles.slice(1), ...manualAltTitles])));
  const episodeNumbers = Array.from(
    { length: totalEpisodes },
    (_, index) => request.startEpisode + index
  );
  let completedCount = 0;

  const allTitles = await altTitlesPromise.then((alts) => [request.anime, ...alts]);
  const batchPrescan = request.resultShape !== "episodesOnly"
    ? await discoverBatchPacks(allTitles, request, limitedProviders, options.signal)
    : { packs: [] as TorrentRecord[], requestCount: 0 };
  let prescanRequests = batchPrescan.requestCount;

  const outcomes = await mapWithConcurrency(
    episodeNumbers,
    EPISODE_SEARCH_CONCURRENCY,
    async (episode) => {
      const episodeBatches = batchPrescan.packs.filter((pack) => batchCoversEpisode(pack, episode));
      const outcome = await searchEpisode(episode, request, altTitlesPromise, limitedProviders, options.signal, episodeBatches);
      completedCount += 1;
      options.onEpisodeProcessed?.({
        episodeResult: outcome.episodeResult,
        completed: completedCount,
        total: totalEpisodes
      });
      return outcome;
    },
    options.signal
  );

  const completedOutcomes = outcomes.filter(<T>(v: T | undefined): v is T => v !== undefined);
  const episodes = completedOutcomes.map((outcome) => outcome.episodeResult);
  const totalRequests = prescanRequests + completedOutcomes.reduce((sum, outcome) => sum + outcome.requestCount, 0);
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
