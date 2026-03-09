import { describe, expect, it, vi } from "vitest";
import type { SearchRequest } from "@nyaagrab/contracts";
import { rssItem } from "@nyaagrab/test-fixtures";
import { parseRss } from "../src/rss";
import { extractSeriesTitle, parseTitle } from "../src/parser";
import { scoreRelease } from "../src/ranker";
import { searchEpisodes } from "../src/search";

function getQuery(input: unknown): string {
  if (typeof input === "string") {
    return input;
  }
  if (typeof input === "object" && input !== null && "query" in input) {
    const value = (input as { query: unknown }).query;
    return typeof value === "string" ? value : "";
  }
  return "";
}

function makeRequest(overrides: Partial<SearchRequest>): SearchRequest {
  return {
    anime: "Show",
    startEpisode: 1,
    endEpisode: 1,
    category: "1_2",
    filter: "0",
    resultShape: "auto",
    preferSmall: false,
    preferredResolution: "1080p",
    preferredCodec: "Any",
    preferredGroups: [],
    manualAltTitles: [],
    disableAutoResolve: false,
    ...overrides
  };
}

describe("parseTitle", () => {
  it("parses dash and version formats", () => {
    const parsed = parseTitle("[SubsPlease] Show - 12v2 [1080p]");
    expect(parsed.episode).toBe(12);
    expect(parsed.version).toBe(2);
    expect(parsed.resolution).toBe("1080p");
  });

  it("parses SxxExx and filters batch/movie/special flags", () => {
    expect(parseTitle("[Group] Show S01E12 [1080p]").episode).toBe(12);
    expect(parseTitle("[Group] Show Episode 12 [1080p]").episode).toBe(12);
    expect(parseTitle("[Group] Show 第12話 [1080p]").episode).toBe(12);
    expect(parseTitle("[Group] Show 01-12 [1080p]").isBatch).toBe(true);
    expect(parseTitle("[Group] Show Movie [1080p]").isMovie).toBe(true);
    expect(parseTitle("[Group] Show OVA [1080p]").isSpecial).toBe(true);
  });

  it("rejects year and resolution false positives", () => {
    expect(parseTitle("[Group] Show - 2024 [1080p]").episode).toBeNull();
    expect(parseTitle("[Group] Show - 1080 [1080p]").episode).toBeNull();
  });
});

describe("extractSeriesTitle", () => {
  it("removes release metadata and leaves the series name", () => {
    expect(extractSeriesTitle("[SubsPlease] Detective Conan - 1185 (1080p) [ABC12345].mkv")).toBe("Detective Conan");
    expect(extractSeriesTitle("[Erai-raws] Show S01E12 [1080p][HEVC]")).toBe("Show");
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

    const result = await searchEpisodes(makeRequest({
      anime: "One Piece",
      startEpisode: 873,
      endEpisode: 873,
      disableAutoResolve: true
    }), providers);

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

    const result = await searchEpisodes(makeRequest({
      anime: "One Piece",
      startEpisode: 500,
      endEpisode: 500,
      disableAutoResolve: true
    }), providers);

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

    const result = await searchEpisodes(makeRequest({
      anime: "One Piece",
      startEpisode: 990,
      endEpisode: 990,
      disableAutoResolve: true
    }), providers);

    expect(result.episodes[0].best?.title).toContain("One Piece - 990");
    expect(result.episodes[0].best?.title).not.toContain("Detective Conan");
  });

  it("rejects later-season single episodes when the query is a seasonless base series", async () => {
    const providers = {
      fetchRss: vi.fn().mockResolvedValue({
        items: parseRss(rssItem({
          title: "[SubsPlus+] Is It Wrong to Try to Pick Up Girls in a Dungeon - S05E01v2 [1080p] | Dungeon ni Deai wo Motomeru no wa Machigatteiru Darou ka | DanMachi",
          seeders: "29",
          size: "1.3 GiB",
          infoHash: "7f".padEnd(40, "f")
        }))
      }),
      resolveTitles: vi.fn().mockResolvedValue({
        titles: [
          "Is It Wrong to Try to Pick Up Girls in a Dungeon?",
          "Dungeon ni Deai wo Motomeru no wa Machigatteiru Darou ka",
          "DanMachi"
        ]
      })
    };

    const result = await searchEpisodes(makeRequest({
      anime: "Is It Wrong to Try to Pick Up Girls in a Dungeon?",
      disableAutoResolve: false
    }), providers);

    expect(result.episodes[0].status).toBe("missing");
    expect(result.episodes[0].best).toBeNull();
  });

  it("rejects sequel single episodes that only mention the base title in an alternate segment", async () => {
    const providers = {
      fetchRss: vi.fn().mockResolvedValue({
        items: parseRss(rssItem({
          title: "[Subeteka] Rascal Does Not Dream of Santa Claus - S02E01 [WEB 1080p HEVC EAC3] | Seishun Buta Yarou wa Santa Claus no Yume o Minai | AoButa | Rascal Does Not Dream of Bunny Girl Senpai - Season 2",
          seeders: "5",
          size: "1.1 GiB",
          infoHash: "8f".padEnd(40, "f")
        }))
      }),
      resolveTitles: vi.fn().mockResolvedValue({
        titles: [
          "Rascal Does Not Dream of Bunny Girl Senpai",
          "Seishun Buta Yarou wa Bunny Girl Senpai no Yume wo Minai",
          "AoButa"
        ]
      })
    };

    const result = await searchEpisodes(makeRequest({
      anime: "Rascal Does Not Dream of Bunny Girl Senpai",
      disableAutoResolve: false
    }), providers);

    expect(result.episodes[0].status).toBe("missing");
    expect(result.episodes[0].best).toBeNull();
  });

  it("rejects generic single-word collisions against longer unrelated show titles", async () => {
    const providers = {
      fetchRss: vi.fn().mockResolvedValue({
        items: parseRss(
          rssItem({
            title: "[SubsPlease] Show - 12 [1080p]",
            seeders: "20",
            size: "900 MiB",
            infoHash: "8".repeat(40)
          }) +
          rssItem({
            title: "[SubsPlease] Another Show - 12 [1080p]",
            seeders: "30",
            size: "1.0 GiB",
            infoHash: "9".repeat(40)
          })
        )
      }),
      resolveTitles: vi.fn().mockResolvedValue({ titles: ["Show"] })
    };

    const result = await searchEpisodes(makeRequest({
      anime: "Show",
      startEpisode: 12,
      endEpisode: 12,
      disableAutoResolve: true
    }), providers);

    expect(result.episodes[0].best?.title).toContain("[SubsPlease] Show - 12");
    expect(result.episodes[0].alternatives).toEqual([]);
  });

  it("rejects shorter franchise titles when the query names a more specific sequel or variant", async () => {
    const providers = {
      fetchRss: vi.fn().mockResolvedValue({
        items: parseRss(
          rssItem({
            title: "[SubsPlease] Fullmetal Alchemist - 12 [1080p]",
            seeders: "25",
            size: "1.0 GiB",
            infoHash: "c".repeat(40)
          })
        )
      }),
      resolveTitles: vi.fn().mockResolvedValue({ titles: ["Fullmetal Alchemist Brotherhood"] })
    };

    const result = await searchEpisodes(makeRequest({
      anime: "Fullmetal Alchemist Brotherhood",
      startEpisode: 12,
      endEpisode: 12,
      disableAutoResolve: true
    }), providers);

    expect(result.episodes[0].status).toBe("missing");
    expect(result.episodes[0].best).toBeNull();
  });

  it("rejects arc or saga variants when the query asks for the base series title", async () => {
    const providers = {
      fetchRss: vi.fn().mockResolvedValue({
        items: parseRss(
          rssItem({
            title: "[Erai-raws] One Piece: Gyojin Tou-hen - 14 [1080p]",
            seeders: "18",
            size: "1.1 GiB",
            infoHash: "d".repeat(40)
          })
        )
      }),
      resolveTitles: vi.fn().mockResolvedValue({ titles: ["One Piece"] })
    };

    const result = await searchEpisodes(makeRequest({
      anime: "One Piece",
      startEpisode: 14,
      endEpisode: 14,
      disableAutoResolve: true
    }), providers);

    expect(result.episodes[0].status).toBe("missing");
    expect(result.episodes[0].best).toBeNull();
  });

  it("matches non-latin titles after normalization", async () => {
    const providers = {
      fetchRss: vi.fn().mockResolvedValue({
        items: parseRss(
          rssItem({
            title: "[SubsPlease] 名探偵コナン - 1185 [1080p]",
            seeders: "12",
            size: "1.2 GiB",
            infoHash: "a".repeat(40)
          })
        )
      }),
      resolveTitles: vi.fn().mockResolvedValue({ titles: ["名探偵コナン"] })
    };

    const result = await searchEpisodes(makeRequest({
      anime: "名探偵コナン",
      startEpisode: 1185,
      endEpisode: 1185,
      disableAutoResolve: true
    }), providers);

    expect(result.episodes[0].status).toBe("found");
    expect(result.episodes[0].best?.title).toContain("名探偵コナン");
  });

  it("tries punctuation variants for fetches so slash-heavy titles can still resolve", async () => {
    const providers = {
      fetchRss: vi.fn().mockImplementation(async (input: unknown) => ({
        items: getQuery(input) === "Fate-stay night 1"
          ? parseRss(rssItem({
              title: "[Hamlon] Fate-stay night - 01 [1080p]",
              seeders: "4",
              size: "1.2 GiB",
              infoHash: "e".repeat(40)
            }))
          : []
      })),
      resolveTitles: vi.fn().mockResolvedValue({ titles: ["Fate/stay night"] })
    };

    const result = await searchEpisodes(makeRequest({
      anime: "Fate/stay night",
      disableAutoResolve: true
    }), providers);

    expect(providers.fetchRss).toHaveBeenCalledWith(expect.objectContaining({ query: "Fate-stay night 1" }));
    expect(result.episodes[0].status).toBe("found");
    expect(result.episodes[0].best?.title).toContain("Fate-stay night - 01");
  });

  it("falls back to seeded collection packs when episode-specific releases are unavailable", async () => {
    const providers = {
      fetchRss: vi.fn().mockImplementation(async (input: unknown) => ({
        items: getQuery(input) === "Fate/stay night: Unlimited Blade Works"
          ? parseRss(rssItem({
              title: "[Exiled-Destiny] Fate Stay Night Unlimited Blade Works [Dual Audio]",
              seeders: "6",
              size: "18.2 GiB",
              infoHash: "f".repeat(40)
            }))
          : []
      })),
      resolveTitles: vi.fn().mockResolvedValue({ titles: ["Fate/stay night: Unlimited Blade Works"] })
    };

    const result = await searchEpisodes(makeRequest({
      anime: "Fate/stay night: Unlimited Blade Works",
      disableAutoResolve: true
    }), providers);

    expect(providers.fetchRss).toHaveBeenCalledWith(expect.objectContaining({ query: "Fate/stay night: Unlimited Blade Works" }));
    expect(result.episodes[0].status).toBe("found");
    expect(result.episodes[0].best?.title).toContain("Unlimited Blade Works");
    expect(result.episodes[0].best?.episode).toBe(1);
  });

  it("does not treat sequel or route packs as fallback hits for the base series", async () => {
    const providers = {
      fetchRss: vi.fn().mockImplementation(async (input: unknown) => ({
        items: getQuery(input) === "Fate/stay night"
          ? parseRss(rssItem({
              title: "[Exiled-Destiny] Fate Stay Night Unlimited Blade Works [Dual Audio]",
              seeders: "6",
              size: "18.2 GiB",
              infoHash: "1f".padEnd(40, "f")
            }))
          : []
      })),
      resolveTitles: vi.fn().mockResolvedValue({ titles: ["Fate/stay night"] })
    };

    const result = await searchEpisodes(makeRequest({
      anime: "Fate/stay night",
      disableAutoResolve: true
    }), providers);

    expect(result.episodes[0].status).toBe("missing");
    expect(result.episodes[0].best).toBeNull();
  });

  it("rejects later-season packs when the query is for a seasonless base series", async () => {
    const providers = {
      fetchRss: vi.fn().mockImplementation(async (input: unknown) => ({
        items: getQuery(input) === "Dungeon ni Deai wo Motomeru no wa Machigatteiru Darou ka"
          ? parseRss(rssItem({
              title: "[EMBER] Dungeon ni Deai wo Motomeru no wa Machigatteiru Darou ka (DanMachi) (2024) (Season 5) [1080p] (Is It Wrong to Try to Pick Up Girls in a Dungeon? V) (Batch)",
              seeders: "71",
              size: "11.0 GiB",
              infoHash: "2f".padEnd(40, "f")
            }))
          : []
      })),
      resolveTitles: vi.fn().mockResolvedValue({
        titles: [
          "Is It Wrong to Try to Pick Up Girls in a Dungeon?",
          "Dungeon ni Deai wo Motomeru no wa Machigatteiru Darou ka",
          "Danmachi"
        ]
      })
    };

    const result = await searchEpisodes(makeRequest({
      anime: "Is It Wrong to Try to Pick Up Girls in a Dungeon?",
      disableAutoResolve: false
    }), providers);

    expect(result.episodes[0].status).toBe("missing");
    expect(result.episodes[0].best).toBeNull();
  });

  it("rejects season metadata that only appears in collection labels", async () => {
    const providers = {
      fetchRss: vi.fn().mockImplementation(async (input: unknown) => ({
        items: getQuery(input) === "JoJo no Kimyou na Bouken: Stardust Crusaders"
          ? parseRss(rssItem({
              title: "[Erai-raws] JoJo no Kimyou na Bouken - Stardust Crusaders (2nd Season) - 25 ~ 48 [1080p][Multiple Subtitle]",
              seeders: "15",
              size: "14.0 GiB",
              infoHash: "5f".padEnd(40, "f")
            }))
          : []
      })),
      resolveTitles: vi.fn().mockResolvedValue({
        titles: ["JoJo no Kimyou na Bouken: Stardust Crusaders"]
      })
    };

    const result = await searchEpisodes(makeRequest({
      anime: "JoJo no Kimyou na Bouken: Stardust Crusaders",
      disableAutoResolve: true
    }), providers);

    expect(result.episodes[0].status).toBe("missing");
    expect(result.episodes[0].best).toBeNull();
  });

  it("rejects later parts when the query names a season but not a later split cour", async () => {
    const providers = {
      fetchRss: vi.fn().mockImplementation(async (input: unknown) => ({
        items: getQuery(input) === "Re:ZERO -Starting Life in Another World- Season 2"
          ? parseRss(rssItem({
              title: "[Erai-raws] Re.Zero kara Hajimeru Isekai Seikatsu 2nd Season Part 2 - 01 ~ 12 [1080p][HEVC][BATCH]",
              seeders: "22",
              size: "13.0 GiB",
              infoHash: "3f".padEnd(40, "f")
            }))
          : []
      })),
      resolveTitles: vi.fn().mockResolvedValue({
        titles: [
          "Re:ZERO -Starting Life in Another World- Season 2",
          "Re:Zero kara Hajimeru Isekai Seikatsu 2nd Season"
        ]
      })
    };

    const result = await searchEpisodes(makeRequest({
      anime: "Re:ZERO -Starting Life in Another World- Season 2",
      disableAutoResolve: false
    }), providers);

    expect(result.episodes[0].status).toBe("missing");
    expect(result.episodes[0].best).toBeNull();
  });

  it("uses alternate titles for title-only collection fallback", async () => {
    const providers = {
      fetchRss: vi.fn().mockImplementation(async (input: unknown) => ({
        items: getQuery(input) === "Seishun Buta Yarou wa Bunny Girl Senpai no Yume wo Minai"
          ? parseRss(rssItem({
              title: "[DB] Seishun Buta Yarou wa Bunny Girl Senpai no Yume wo Minai | Rascal Does Not Dream of Bunny Girl Senpai [Dual Audio 10bit BD1080p][HEVC-x265]",
              seeders: "20",
              size: "16.0 GiB",
              infoHash: "4f".padEnd(40, "f")
            }))
          : []
      })),
      resolveTitles: vi.fn().mockResolvedValue({
        titles: [
          "Rascal Does Not Dream of Bunny Girl Senpai",
          "Seishun Buta Yarou wa Bunny Girl Senpai no Yume wo Minai"
        ]
      })
    };

    const result = await searchEpisodes(makeRequest({
      anime: "Rascal Does Not Dream of Bunny Girl Senpai",
      disableAutoResolve: false
    }), providers);

    expect(providers.fetchRss).toHaveBeenCalledWith(expect.objectContaining({ query: "Seishun Buta Yarou wa Bunny Girl Senpai no Yume wo Minai" }));
    expect(result.episodes[0].status).toBe("found");
    expect(result.episodes[0].best?.title).toContain("Seishun Buta Yarou");
  });

  it("ignores one-token franchise aliases for title-only collection fallback", async () => {
    const providers = {
      fetchRss: vi.fn().mockImplementation(async (input: unknown) => ({
        items: getQuery(input) === "AoButa"
          ? parseRss(rssItem({
              title: "[Pyon] Rascal Does Not Dream of Dreaming Girl (2019) [Dual-Audio] | Seishun Buta Yarou wa Yumemiru Shoujo no Yume wo Minai | AoButa",
              seeders: "50",
              size: "8.0 GiB",
              infoHash: "6f".padEnd(40, "f")
            }))
          : []
      })),
      resolveTitles: vi.fn().mockResolvedValue({
        titles: [
          "Rascal Does Not Dream of Bunny Girl Senpai",
          "Seishun Buta Yarou wa Bunny Girl Senpai no Yume wo Minai",
          "AoButa"
        ]
      })
    };

    const result = await searchEpisodes(makeRequest({
      anime: "Rascal Does Not Dream of Bunny Girl Senpai",
      disableAutoResolve: false
    }), providers);

    expect(result.episodes[0].status).toBe("missing");
    expect(result.episodes[0].best).toBeNull();
  });

  it("returns found, missing, and failed episodes distinctly", async () => {
    const fetchRss = vi.fn().mockImplementation(async (input: unknown) => {
      const query = getQuery(input);
      if (query === "Show 1") {
        return { items: parseRss(rssItem({ title: "[SubsPlease] Show - 1 [1080p]", infoHash: "d".repeat(40) })) };
      }
      if (query === "Show 2") {
        return { items: [] };
      }
      if (query === "Show 3") {
        return { items: [], error: "request failed: timeout" };
      }
      return { items: [] };
    });

    const providers = {
      fetchRss,
      resolveTitles: vi.fn().mockResolvedValue({ titles: ["Show", "Alt Show"] })
    };

    const result = await searchEpisodes(makeRequest({
      anime: "Show",
      startEpisode: 1,
      endEpisode: 3,
      disableAutoResolve: true
    }), providers);

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

    await searchEpisodes(makeRequest({
      anime: "Show",
      startEpisode: 12,
      endEpisode: 12,
      disableAutoResolve: false
    }), providers);

    expect(providers.fetchRss).toHaveBeenCalledTimes(1);
  });

  it("falls back to original title when resolver fails", async () => {
    const providers = {
      fetchRss: vi.fn().mockResolvedValue({ items: [] }),
      resolveTitles: vi.fn().mockResolvedValue({ titles: [], error: "network" })
    };

    await searchEpisodes(makeRequest({
      anime: "Detective Conan",
      startEpisode: 1185,
      endEpisode: 1185,
      disableAutoResolve: false
    }), providers);

    expect(providers.fetchRss).toHaveBeenCalledWith(expect.objectContaining({ query: "Detective Conan 1185" }));
  });

  it("searches multiple episodes concurrently", async () => {
    let activeRequests = 0;
    let maxActiveRequests = 0;
    const providers = {
      fetchRss: vi.fn().mockImplementation(async (input: unknown) => {
        const query = getQuery(input);
        activeRequests += 1;
        maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
        const episode = query.match(/(\d+)$/)?.[1] ?? "1";
        await new Promise((resolve) => setTimeout(resolve, 20));
        activeRequests -= 1;
        return {
          items: parseRss(rssItem({
            title: `[SubsPlease] Show - ${episode} [1080p]`,
            infoHash: episode.padStart(40, "b").slice(0, 40)
          }))
        };
      }),
      resolveTitles: vi.fn().mockResolvedValue({ titles: ["Show"] })
    };

    const result = await searchEpisodes(makeRequest({
      anime: "Show",
      startEpisode: 1,
      endEpisode: 4,
      disableAutoResolve: true
    }), providers);

    expect(result.episodes).toHaveLength(4);
    expect(maxActiveRequests).toBeGreaterThan(1);
    expect(maxActiveRequests).toBeLessThanOrEqual(4);
  });

  it("caps total RSS fan-out across episodes and alternate titles", async () => {
    let activeRequests = 0;
    let maxActiveRequests = 0;
    const providers = {
      fetchRss: vi.fn().mockImplementation(async (input: unknown) => {
        const query = getQuery(input);
        activeRequests += 1;
        maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
        const episode = query.match(/(\d+)$/)?.[1] ?? "1";
        await new Promise((resolve) => setTimeout(resolve, 20));
        activeRequests -= 1;
        return {
          items: query.startsWith("Show ")
            ? []
            : parseRss(rssItem({
                title: `[SubsPlease] Alt Show - ${episode} [1080p]`,
                infoHash: `${query}-${episode}`.replace(/[^a-z0-9]/gi, "a").slice(0, 40).padEnd(40, "a")
              }))
        };
      }),
      resolveTitles: vi.fn().mockResolvedValue({ titles: ["Show", "Alt Show", "Another Alt", "Third Alt"] })
    };

    await searchEpisodes(makeRequest({
      anime: "Show",
      startEpisode: 1,
      endEpisode: 6,
      manualAltTitles: ["Fourth Alt"],
      disableAutoResolve: false
    }), providers);

    expect(maxActiveRequests).toBeLessThanOrEqual(6);
  });

  it("uses selected category and filter for RSS fetches", async () => {
    const providers = {
      fetchRss: vi.fn().mockResolvedValue({ items: [] }),
      resolveTitles: vi.fn().mockResolvedValue({ titles: [] })
    };

    await searchEpisodes(makeRequest({
      anime: "Sample OST",
      category: "2_1",
      filter: "2",
      disableAutoResolve: true
    }), providers);

    expect(providers.fetchRss).toHaveBeenCalledWith(expect.objectContaining({
      query: "Sample OST 1",
      category: "2_1",
      filter: "2"
    }));
  });

  it("prefers the better overall shape in auto mode", async () => {
    const providers = {
      fetchRss: vi.fn().mockResolvedValue({
        items: parseRss(
          rssItem({
            title: "[Unknown] Show - 1 [480p]",
            seeders: "1",
            size: "180 MiB",
            infoHash: "a1".padEnd(40, "a")
          }) +
          rssItem({
            title: "[SubsPlease] Show Season 1 Batch [1080p]",
            seeders: "80",
            size: "12.0 GiB",
            infoHash: "b2".padEnd(40, "b")
          })
        )
      }),
      resolveTitles: vi.fn().mockResolvedValue({ titles: ["Show"] })
    };

    const result = await searchEpisodes(makeRequest({
      anime: "Show",
      resultShape: "auto",
      disableAutoResolve: true
    }), providers);

    expect(result.episodes[0].status).toBe("found");
    expect(result.episodes[0].best?.title).toContain("Season 1 Batch");
  });

  it("blocks collection fallback in episodes-only mode", async () => {
    const providers = {
      fetchRss: vi.fn().mockResolvedValue({
        items: parseRss(rssItem({
          title: "[SubsPlease] Show Season 1 Batch [1080p]",
          seeders: "60",
          size: "10.0 GiB",
          infoHash: "c3".padEnd(40, "c")
        }))
      }),
      resolveTitles: vi.fn().mockResolvedValue({ titles: ["Show"] })
    };

    const result = await searchEpisodes(makeRequest({
      anime: "Show",
      resultShape: "episodesOnly",
      disableAutoResolve: true
    }), providers);

    expect(result.episodes[0].status).toBe("missing");
    expect(result.episodes[0].best).toBeNull();
  });

  it("blocks single-episode results in batches-only mode", async () => {
    const providers = {
      fetchRss: vi.fn().mockResolvedValue({
        items: parseRss(rssItem({
          title: "[SubsPlease] Show - 1 [1080p]",
          seeders: "60",
          size: "1.1 GiB",
          infoHash: "d4".padEnd(40, "d")
        }))
      }),
      resolveTitles: vi.fn().mockResolvedValue({ titles: ["Show"] })
    };

    const result = await searchEpisodes(makeRequest({
      anime: "Show",
      resultShape: "batchesOnly",
      disableAutoResolve: true
    }), providers);

    expect(result.episodes[0].status).toBe("missing");
    expect(result.episodes[0].best).toBeNull();
  });
});
