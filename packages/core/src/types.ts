export type ParsedTitle = {
  episode: number | null;
  version: number;
  batchStart: number | null;
  batchEnd: number | null;
  isBatch: boolean;
  isMovie: boolean;
  isSpecial: boolean;
  group: string;
  resolution: string | null;
  codec: string | null;
  isRepack: boolean;
  rawTitle: string;
};

export type TorrentRecord = {
  title: string;
  link: string;
  infoHash: string;
  seeders: number;
  leechers: number;
  downloads: number;
  sizeLabel: string;
  sizeBytes: number;
  category: string;
  pubDate: string;
  magnet: string;
};

export type RssFetchResponse = {
  items: TorrentRecord[];
  error?: string;
};

export type TitleResolutionResponse = {
  titles: string[];
  error?: string;
};

export type ProviderContext = {
  fetchRss(query: string): Promise<RssFetchResponse>;
  resolveTitles(name: string): Promise<TitleResolutionResponse>;
};
