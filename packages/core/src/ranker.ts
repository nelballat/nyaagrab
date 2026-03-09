import type { ReleaseCandidate } from "@nyaagrab/contracts";
import { DEFAULT_PREFERRED_GROUPS, HEVC_CODECS } from "./constants";
import { parseTitle } from "./parser";
import type { TorrentRecord } from "./types";

function getResolutionWeight(resolution: string | null): number {
  if (!resolution) {
    return 0;
  }
  const numeric = Number.parseInt(resolution, 10);
  if (Number.isNaN(numeric)) {
    return 0;
  }
  return numeric / 10;
}

export function scoreRelease(
  torrent: TorrentRecord,
  preferSmall: boolean,
  preferredGroups: string[],
  preferredResolution: string,
  preferredCodec: string,
  options: {
    episodeOverride?: number;
    scorePenalty?: number;
  } = {}
): ReleaseCandidate {
  const parsed = parseTitle(torrent.title);
  let score = 0;
  const groups = preferredGroups.length > 0 ? preferredGroups : DEFAULT_PREFERRED_GROUPS;

  score += parsed.version * 1000;
  score += parsed.isRepack ? 500 : 0;
  score += groups.includes(parsed.group) ? 300 : 0;
  score += Math.min(torrent.seeders * 2, 500);
  score += parsed.resolution === preferredResolution ? 200 : 0;
  score += getResolutionWeight(parsed.resolution);
  if (preferredCodec !== "Any" && parsed.codec === preferredCodec) {
    score += 250;
  }

  if (preferSmall) {
    if (torrent.sizeBytes < 300 * 1024 ** 2) {
      score += 400;
    } else if (torrent.sizeBytes < 500 * 1024 ** 2) {
      score += 200;
    } else if (torrent.sizeBytes < 1024 ** 3) {
      score += 100;
    }
    if (parsed.codec && HEVC_CODECS.has(parsed.codec.toUpperCase())) {
      score += 300;
    }
  } else {
    score += Math.min(torrent.seeders, 200);
  }

  score -= options.scorePenalty ?? 0;

  return {
    episode: options.episodeOverride ?? parsed.episode ?? 0,
    title: torrent.title,
    group: parsed.group,
    resolution: parsed.resolution,
    codec: parsed.codec,
    version: parsed.version,
    seeders: torrent.seeders,
    sizeLabel: torrent.sizeLabel,
    sizeBytes: torrent.sizeBytes,
    magnet: torrent.magnet,
    score,
    isRepack: parsed.isRepack
  };
}
