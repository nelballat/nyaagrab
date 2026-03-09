import { z } from "zod";

export const SearchRequestSchema = z.object({
  anime: z.string().min(1),
  startEpisode: z.number().int().positive(),
  endEpisode: z.number().int().positive(),
  preferSmall: z.boolean(),
  preferredResolution: z.string().min(1),
  preferredCodec: z.string().min(1),
  preferredGroups: z.array(z.string()),
  manualAltTitles: z.array(z.string()),
  disableAutoResolve: z.boolean()
}).refine((value) => value.endEpisode >= value.startEpisode, {
  message: "endEpisode must be >= startEpisode",
  path: ["endEpisode"]
});

export const ReleaseCandidateSchema = z.object({
  episode: z.number().int().positive(),
  title: z.string(),
  group: z.string(),
  resolution: z.string().nullable(),
  codec: z.string().nullable(),
  version: z.number().int().positive(),
  seeders: z.number().int().nonnegative(),
  sizeLabel: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  magnet: z.string(),
  score: z.number(),
  isRepack: z.boolean()
});

export const EpisodeStatusSchema = z.enum(["found", "missing", "failed"]);

export const EpisodeResultSchema = z.object({
  episode: z.number().int().positive(),
  best: ReleaseCandidateSchema.nullable(),
  alternatives: z.array(ReleaseCandidateSchema),
  status: EpisodeStatusSchema,
  failureReason: z.string().optional()
});

export const SearchResultSchema = z.object({
  anime: z.string(),
  episodes: z.array(EpisodeResultSchema),
  coveragePercent: z.number(),
  totalRequests: z.number().int().nonnegative(),
  elapsedMs: z.number().nonnegative(),
  totalBestSizeBytes: z.number().int().nonnegative()
});

export type SearchRequest = z.infer<typeof SearchRequestSchema>;
export type ReleaseCandidate = z.infer<typeof ReleaseCandidateSchema>;
export type EpisodeResult = z.infer<typeof EpisodeResultSchema>;
export type SearchResult = z.infer<typeof SearchResultSchema>;
