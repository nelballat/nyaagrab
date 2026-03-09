import type { ParsedTitle } from "./types";

const HASH_BRACKET_RE = /\[[0-9A-Fa-f]{6,}\]/g;
const RESOLUTION_NUMS = new Set([1080, 1280, 1920]);
const EP_PATTERNS = [
  /[-–—]\s*(\d{1,4})(?:v(\d+))?(?:\s|[(\[.]|$)/i,
  /\bEP\s*(\d{1,4})(?:v(\d+))?(?:\s|[(\[.]|$)/i,
  /\bS\d+E(\d{1,4})(?:v(\d+))?(?:\s|[(\[.]|$)/i
];
const BATCH_RANGE_RE = /(\d{2,4})\s*[-–~]\s*(\d{2,4})/;
const MOVIE_RE = /\bMovie\b/i;
const SPECIAL_RE = /\b(?:Special|OVA|OAD|ONA|Recap|Preview|Fan\s*Letter)\b/i;
const GROUP_RE = /^\[([^\]]+)\]/;
const RES_RE = /(\d{3,4})p\b/i;
const CODEC_RE = /\b(HEVC|H\.?265|x265|AVC|H\.?264|x264|VP9|AV1)\b/i;
const REPACK_RE = /\bREPACK\b/i;

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
    if (end > start && !RESOLUTION_NUMS.has(start) && !RESOLUTION_NUMS.has(end)) {
      result.isBatch = true;
      result.batchStart = start;
      result.batchEnd = end;
      return result;
    }
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
