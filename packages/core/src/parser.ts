import type { ParsedTitle } from "./types";

const HASH_BRACKET_RE = /\[[0-9A-Fa-f]{6,}\]/g;
const RESOLUTION_NUMS = new Set([1080, 1280, 1920]);
const EP_PATTERNS = [
  /[-–—]\s*(\d{1,4})(?:v(\d+))?(?:\s|[(\[.]|$)/i,
  /\b(?:EP|Episode)\s*(\d{1,4})(?:v(\d+))?(?:\s|[(\[.]|$)/i,
  /\bS\d+E(\d{1,4})(?:v(\d+))?(?:\s|[(\[.]|$)/i,
  /(?:^|\D)#(\d{1,4})(?:v(\d+))?(?:\s|[(\[.]|$)/i,
  /(?:^|\D)第?(\d{1,4})[話弾](?:\s|[(\[.]|$)/u
];
const BATCH_RANGE_RE = /(\d{1,4})\s*[-–~]\s*(\d{1,4})/;
const BATCH_KEYWORD_RE = /\b(?:batch|complete\s*series)\b/i;
const MOVIE_RE = /\bMovie\b/i;
const SPECIAL_RE = /\b(?:Special|OVA|OAD|ONA|Recap|Preview|Fan\s*Letter)\b/i;
const GROUP_RE = /^\[([^\]]+)\]/;
const RES_RE = /(\d{3,4})p\b/i;
const CODEC_RE = /\b(HEVC|H\.?265|x265|AVC|H\.?264|x264|VP9|AV1)\b/i;
const REPACK_RE = /\bREPACK\b/i;
const FILE_EXTENSION_RE = /\.[a-z0-9]{2,4}$/i;
const LEADING_TAGS_RE = /^(?:\[[^\]]+\]\s*)+/;
const TRAILING_METADATA_RE = /\s*(?:\[[^\]]+\]|\([^)]+\))\s*$/;
const SERIES_TITLE_PATTERNS = [
  /^(.*?)(?:\s*[-–—]\s*\d{1,4}(?:v\d+)?(?:\s|[(\[.]|$))/i,
  /^(.*?)(?:\s+\b(?:EP|Episode)\s*\d{1,4}(?:v\d+)?(?:\s|[(\[.]|$))/i,
  /^(.*?)(?:\s+\bS\d+E\d{1,4}(?:v\d+)?(?:\s|[(\[.]|$))/i,
  /^(.*?)(?:\s+#\d{1,4}(?:v\d+)?(?:\s|[(\[.]|$))/i,
  /^(.*?)(?:\s+第?\d{1,4}[話弾](?:\s|[(\[.]|$))/u
];

function trimTrailingMetadata(value: string): string {
  let current = value.trim();
  while (true) {
    const next = current.replace(TRAILING_METADATA_RE, "").trim();
    if (next === current) {
      return current;
    }
    current = next;
  }
}

function cleanupSeriesTitle(value: string): string {
  return trimTrailingMetadata(
    value
      .replace(FILE_EXTENSION_RE, "")
      .replace(LEADING_TAGS_RE, "")
      .replace(HASH_BRACKET_RE, "")
      .replace(/\s*[-–—:]+\s*$/, "")
      .trim()
  );
}

export function extractSeriesTitle(title: string): string {
  const cleaned = title
    .replace(FILE_EXTENSION_RE, "")
    .replace(LEADING_TAGS_RE, "")
    .replace(HASH_BRACKET_RE, "")
    .trim();

  for (const pattern of SERIES_TITLE_PATTERNS) {
    const match = pattern.exec(cleaned);
    if (match?.[1]) {
      return cleanupSeriesTitle(match[1]);
    }
  }

  return cleanupSeriesTitle(cleaned);
}

export function parseTitle(title: string): ParsedTitle {
  const group = GROUP_RE.exec(title)?.[1] ?? "";
  const resolutionValue = RES_RE.exec(title)?.[1];
  const codecMatch = CODEC_RE.exec(title)?.[1]?.toUpperCase().replace(".", "") ?? null;
  const codec =
    codecMatch === null
      ? null
      : ["HEVC", "H265", "X265"].includes(codecMatch)
        ? "HEVC"
        : ["AVC", "H264", "X264"].includes(codecMatch)
          ? "AVC"
          : codecMatch;

  const result: ParsedTitle = {
    episode: null,
    version: 1,
    batchStart: null,
    batchEnd: null,
    isBatch: false,
    isMovie: MOVIE_RE.test(title),
    isSpecial: SPECIAL_RE.test(title),
    group,
    resolution: resolutionValue ? `${resolutionValue}p` : null,
    codec,
    isRepack: REPACK_RE.test(title),
    rawTitle: title
  };

  const batch = BATCH_RANGE_RE.exec(title);
  if (batch) {
    const start = Number.parseInt(batch[1], 10);
    const end = Number.parseInt(batch[2], 10);
    if (end > start && !RESOLUTION_NUMS.has(start) && !RESOLUTION_NUMS.has(end) && !(start >= 1990 && end >= 1990)) {
      result.isBatch = true;
      result.batchStart = start;
      result.batchEnd = end;
      return result;
    }
  }
  if (!result.isBatch && BATCH_KEYWORD_RE.test(title)) {
    result.isBatch = true;
  }

  const cleaned = title.replace(HASH_BRACKET_RE, "");
  for (const pattern of EP_PATTERNS) {
    const match = pattern.exec(cleaned);
    if (!match) {
      continue;
    }
    const episode = Number.parseInt(match[1], 10);
    if (RESOLUTION_NUMS.has(episode) || (episode >= 1990 && episode <= 2030)) {
      continue;
    }
    result.episode = episode;
    if (match[2]) {
      result.version = Number.parseInt(match[2], 10);
    }
    break;
  }

  return result;
}
