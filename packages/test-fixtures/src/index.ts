export const rssItem = (overrides: Partial<Record<string, string>> = {}) => `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:nyaa="https://nyaa.si/xmlns/nyaa" version="2.0">
  <channel>
    <item>
      <title>${overrides.title ?? "[SubsPlease] Detective Conan - 1185 (1080p) [ABC12345].mkv"}</title>
      <link>${overrides.link ?? "https://nyaa.si/download/100.torrent"}</link>
      <pubDate>Sun, 08 Mar 2026 00:00:00 GMT</pubDate>
      <nyaa:infoHash>${overrides.infoHash ?? "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}</nyaa:infoHash>
      <nyaa:seeders>${overrides.seeders ?? "31"}</nyaa:seeders>
      <nyaa:leechers>0</nyaa:leechers>
      <nyaa:downloads>1000</nyaa:downloads>
      <nyaa:size>${overrides.size ?? "1.4 GiB"}</nyaa:size>
      <nyaa:category>${overrides.category ?? "Anime - English-translated"}</nyaa:category>
    </item>
  </channel>
</rss>`;

export const anilistPayload = (overrides?: Partial<{
  romaji: string;
  english: string;
  native: string;
  synonyms: string[];
}>) => ({
  data: {
    Media: {
      title: {
        romaji: overrides?.romaji ?? "Meitantei Conan",
        english: overrides?.english ?? "Detective Conan",
        native: overrides?.native ?? "名探偵コナン"
      },
      synonyms: overrides?.synonyms ?? ["Case Closed", "Detective Conan: Zero's Tea Time", "DC"]
    }
  }
});
