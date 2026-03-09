import { describe, expect, it, vi } from "vitest";
import { rssItem } from "@nyaagrab/test-fixtures";
import { parseRss } from "../src/rss";
import { parseTitle } from "../src/parser";
import { scoreRelease } from "../src/ranker";
import { searchEpisodes } from "../src/search";

describe("parseTitle", () => {
  it("parses dash and version formats", () => {
    const parsed = parseTitle("[SubsPlease] Show - 12v2 [1080p]");
    expect(parsed.episode).toBe(12);
    expect(parsed.version).toBe(2);
    expect(parsed.resolution).toBe("1080p");
  });

  it("parses SxxExx and filters batch/movie/special flags", () => {
    expect(parseTitle("[Group] Show S01E12 [1080p]").episode).toBe(12);
    expect(parseTitle("[Group] Show 01-12 [1080p]").isBatch).toBe(true);
    expect(parseTitle("[Group] Show Movie [1080p]").isMovie).toBe(true);
    expect(parseTitle("[Group] Show OVA [1080p]").isSpecial).toBe(true);
  });

  it("rejects year and resolution false positives", () => {
    expect(parseTitle("[Group] Show - 2024 [1080p]").episode).toBeNull();
    expect(parseTitle("[Group] Show - 1080 [1080p]").episode).toBeNull();
  });
});

describe("scoreRelease", () => {
  it("prefers higher version and small HEVC in small mode", () => {
    const v1 = scoreRelease(parseRss(rssItem({ title: "[ASW] Show - 12 [HEVC][1080p]", size: "280 MiB", infoHash: "a".repeat(40) }))[0], true, [], "1080p", "Any");
    const v2 = scoreRelease(parseRss(rssItem({ title: "[ASW] Show - 12v2 [HEVC][1080p]", size: "280 MiB", infoHash: "b".repeat(40) }))[0], true, [], "1080p", "Any");
    expect(v2.score).toBeGreaterThan(v1.score);
  });

  it("changes ordering with preferred group and resolution", () => {
    const candidate = scoreRelease(parseRss(rssItem({ title: "[SubsPlease] Show - 12 [720p]", infoHash: "c".repeat(40) }))[0], false, ["SubsPlease"], "720p", "Any");
    expect(candidate.group).toBe("SubsPlease");
    expect(candidate.resolution).toBe("720p");
  });
});

describe("searchEpisodes", () => {
  it("drops zero-seeder releases when seeded options exist and keeps higher resolution alts first", async () => {
    const providers = {
      fetchRss: vi.fn().mockResolvedValue({
        items: parseRss(
          rssItem({
            title: "[Erai-raws] One Piece - 873 [1080p]",
            seeders: "0",
            size: "1.1 GiB",
            infoHash: "f".repeat(40)
          }) +
          rssItem({
            title: "[HorribleSubs] One Piece - 873 [1080p]",
            seeders: "15",
            size: "1.1 GiB",
            infoHash: "1".repeat(40)
          }) +
          rssItem({
            title: "[HorribleSubs] One Piece - 873 [720p]",
            seeders: "1",
            size: "525.6 MiB",
            infoHash: "2".repeat(40)
          }) +
          rssItem({
            title: "[HorribleSubs] One Piece - 873 [480p]",
            seeders: "2",
            size: "235.5 MiB",
            infoHash: "3".repeat(40)
          })
        )
      }),
      resolveTitles: vi.fn().mockResolvedValue({ titles: ["One Piece"] })
    };

    const result = await searchEpisodes({
      anime: "One Piece",
      startEpisode: 873,
      endEpisode: 873,
      preferSmall: false,
      preferredResolution: "1080p",
      preferredCodec: "Any",
      preferredGroups: [],
      manualAltTitles: [],
      disableAutoResolve: true
    }, providers);

    expect(result.episodes[0].best?.group).toBe("HorribleSubs");
    expect(result.episodes[0].best?.seeders).toBe(15);
    expect(result.episodes[0].alternatives.map((item) => item.resolution)).toEqual(["720p", "480p"]);
    expect(result.episodes[0].alternatives.every((item) => item.seeders > 0)).toBe(true);
  });

  it("treats all-zero result sets as missing instead of found", async () => {
    const providers = {
      fetchRss: vi.fn().mockResolvedValue({
        items: parseRss(
          rssItem({
            title: "[MNF] One Piece - 500 [720p]",
            seeders: "0",
            size: "322.5 MiB",
            infoHash: "6".repeat(40)
          }) +
          rssItem({
            title: "[HorribleSubs] One Piece - 500 [480p]",
            seeders: "0",
            size: "235.5 MiB",
            infoHash: "7".repeat(40)
          })
        )
      }),
      resolveTitles: vi.fn().mockResolvedValue({ titles: ["One Piece"] })
    };

    const result = await searchEpisodes({
      anime: "One Piece",
      startEpisode: 500,
      endEpisode: 500,
      preferSmall: false,
      preferredResolution: "1080p",
      preferredCodec: "Any",
      preferredGroups: [],
      manualAltTitles: [],
      disableAutoResolve: true
    }, providers);

    expect(result.episodes[0].status).toBe("missing");
    expect(result.episodes[0].best).toBeNull();
    expect(result.episodes[0].alternatives).toEqual([]);
  });

  it("rejects cross-show episode matches even when the episode number fits", async () => {
    const providers = {
      fetchRss: vi.fn().mockResolvedValue({
        items: parseRss(
          rssItem({
            title: "[SubsPlease] One Piece - 990 [1080p]",
            seeders: "20",
            size: "1.4 GiB",
            infoHash: "4".repeat(40)
          }) +
          rssItem({
            title: "[YakuboEncodes] Detective Conan - 990 [1080p]",
            seeders: "4",
            size: "128.1 MiB",
            infoHash: "5".repeat(40)
          })
        )
      }),
      resolveTitles: vi.fn().mockResolvedValue({ titles: ["One Piece"] })
    };

    const result = await searchEpisodes({
      anime: "One Piece",
      startEpisode: 990,
      endEpisode: 990,
      preferSmall: false,
      preferredResolution: "1080p",
      preferredCodec: "Any",
      preferredGroups: [],
      manualAltTitles: [],
      disableAutoResolve: true
    }, providers);

    expect(result.episodes[0].best?.title).toContain("One Piece - 990");
    expect(result.episodes[0].best?.title).not.toContain("Detective Conan");
  });

  it("returns found, missing, and failed episodes distinctly", async () => {
    const providers = {
      fetchRss: vi
        .fn()
        .mockResolvedValueOnce({ items: parseRss(rssItem({ title: "[SubsPlease] Show - 1 [1080p]", infoHash: "d".repeat(40) })) })
        .mockResolvedValueOnce({ items: [] })
        .mockResolvedValueOnce({ items: [], error: "request failed: timeout" }),
      resolveTitles: vi.fn().mockResolvedValue({ titles: ["Show", "Alt Show"] })
    };

    const result = await searchEpisodes({
      anime: "Show",
      startEpisode: 1,
      endEpisode: 3,
      preferSmall: false,
      preferredResolution: "1080p",
      preferredCodec: "Any",
      preferredGroups: [],
      manualAltTitles: [],
      disableAutoResolve: true
    }, providers);

    expect(result.episodes[0].status).toBe("found");
    expect(result.episodes[1].status).toBe("missing");
    expect(result.episodes[2].status).toBe("failed");
  });

  it("uses alternate-title fallback only when primary results are strong enough", async () => {
    const providers = {
      fetchRss: vi
        .fn()
        .mockResolvedValueOnce({ items: parseRss(rssItem({ title: "[SubsPlease] Show - 12 [1080p]", infoHash: "e".repeat(40) })) }),
      resolveTitles: vi.fn().mockResolvedValue({ titles: ["Show", "Alt Show", "Another Show"] })
    };

    await searchEpisodes({
      anime: "Show",
      startEpisode: 12,
      endEpisode: 12,
      preferSmall: false,
      preferredResolution: "1080p",
      preferredCodec: "Any",
      preferredGroups: [],
      manualAltTitles: [],
      disableAutoResolve: false
    }, providers);

    expect(providers.fetchRss).toHaveBeenCalledTimes(1);
  });

  it("falls back to original title when resolver fails", async () => {
    const providers = {
      fetchRss: vi.fn().mockResolvedValue({ items: [] }),
      resolveTitles: vi.fn().mockResolvedValue({ titles: [], error: "network" })
    };

    await searchEpisodes({
      anime: "Detective Conan",
      startEpisode: 1185,
      endEpisode: 1185,
      preferSmall: false,
      preferredResolution: "1080p",
      preferredCodec: "Any",
      preferredGroups: [],
      manualAltTitles: [],
      disableAutoResolve: false
    }, providers);

    expect(providers.fetchRss).toHaveBeenCalledWith("Detective Conan 1185");
  });
});
