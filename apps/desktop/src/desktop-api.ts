import { invoke } from "@tauri-apps/api/core";
import type { SearchRequest } from "@nyaagrab/contracts";
import { SearchRequestSchema } from "@nyaagrab/contracts";
import { parseRss, searchEpisodes } from "@nyaagrab/core";
import type { SearchProgressUpdate } from "@nyaagrab/core";
import type { RssFetchRequest } from "@nyaagrab/core";

type DesktopSearchProvider = {
  fetchRss(request: RssFetchRequest): Promise<{ items: ReturnType<typeof parseRss>; error?: string }>;
  resolveTitles(name: string): Promise<{ titles: string[]; error?: string }>;
};

function createProvider(): DesktopSearchProvider {
  return {
    async fetchRss(request: RssFetchRequest) {
      const response = await invoke<{ text?: string; error?: string }>("fetch_nyaa_rss", request);
      if (response.error || !response.text) {
        return { items: [], error: response.error ?? "empty response" };
      }
      try {
        return { items: parseRss(response.text) };
      } catch (error) {
        return { items: [], error: error instanceof Error ? error.message : "invalid rss response" };
      }
    },
    async resolveTitles(name: string) {
      return invoke<{ titles: string[]; error?: string }>("resolve_anilist_titles", { name });
    }
  };
}

export async function runSearch(
  input: SearchRequest,
  onEpisodeProcessed?: (update: SearchProgressUpdate) => void,
  signal?: AbortSignal
) {
  const request = SearchRequestSchema.parse(input);
  return searchEpisodes(request, createProvider(), { onEpisodeProcessed, signal });
}

export async function exportMagnets(filenameHint: string, content: string) {
  return invoke<{ path: string }>("save_magnet_file", { filenameHint, content });
}

export async function openMagnet(target: string) {
  return invoke("open_target", { target });
}

export async function copyText(value: string) {
  await navigator.clipboard.writeText(value);
}
