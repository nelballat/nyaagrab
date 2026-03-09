import { z } from "zod";

export const NyaaCategorySchema = z.enum([
  "0_0",
  "1_0",
  "1_1",
  "1_2",
  "1_3",
  "1_4",
  "2_0",
  "2_1",
  "2_2",
  "3_0",
  "3_1",
  "3_2",
  "3_3",
  "4_0",
  "4_1",
  "4_2",
  "4_3",
  "4_4",
  "5_0",
  "5_1",
  "5_2",
  "6_0",
  "6_1",
  "6_2"
]);

export const NyaaFilterSchema = z.enum(["0", "1", "2"]);
export const ResultShapeSchema = z.enum(["auto", "batchesOnly", "episodesOnly"]);

export const SearchRequestSchema = z.object({
  anime: z.string().min(1),
  startEpisode: z.number().int().positive(),
  endEpisode: z.number().int().positive(),
  category: NyaaCategorySchema,
  filter: NyaaFilterSchema,
  resultShape: ResultShapeSchema,
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
export type NyaaCategory = z.infer<typeof NyaaCategorySchema>;
export type NyaaFilter = z.infer<typeof NyaaFilterSchema>;
export type ResultShape = z.infer<typeof ResultShapeSchema>;
