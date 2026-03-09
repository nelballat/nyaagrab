import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { runSearch } from "./desktop-api";

vi.mock("./desktop-api", () => ({
  runSearch: vi.fn().mockResolvedValue({
    anime: "Detective Conan",
    episodes: [
      {
        episode: 1185,
        best: {
          episode: 1185,
          title: "[SubsPlease] Detective Conan - 1185 (1080p)",
          group: "SubsPlease",
          resolution: "1080p",
          codec: null,
          version: 1,
          seeders: 30,
          sizeLabel: "1.4 GiB",
          sizeBytes: 1503238553,
          magnet: "magnet:?xt=urn:btih:test",
          score: 2000,
          isRepack: false
        },
        alternatives: [],
        status: "found"
      },
      { episode: 1186, best: null, alternatives: [], status: "missing" },
      { episode: 1187, best: null, alternatives: [], status: "failed", failureReason: "request failed: timeout" }
    ],
    coveragePercent: 33.33,
    totalRequests: 3,
    elapsedMs: 1500,
    totalBestSizeBytes: 1503238553
  }),
  exportMagnets: vi.fn().mockResolvedValue({ path: "C:/temp/magnets.txt" }),
  openMagnet: vi.fn(),
  copyText: vi.fn()
}));

describe("App", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it("submits a search request and renders found/missing/failed results", async () => {
    render(<App />);
    expect(screen.queryByText("Summary")).not.toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("One Piece"), { target: { value: "Detective Conan" } });
    fireEvent.change(screen.getByLabelText("Start episode"), { target: { value: "1185" } });
    fireEvent.change(screen.getByLabelText("End episode"), { target: { value: "1187" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() => {
      expect(screen.getByText("Found Episodes")).toBeInTheDocument();
      expect(screen.getByText("Summary")).toBeInTheDocument();
      expect(screen.getByText("Episode 1186")).toBeInTheDocument();
      expect(screen.getByText(/request failed: timeout/i)).toBeInTheDocument();
    });
  });

  it("builds an export action from the current result", async () => {
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText("One Piece"), { target: { value: "Detective Conan" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Export magnets" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Export magnets" }));

    await waitFor(() => {
      expect(screen.getByText(/Exported magnets to C:\/temp\/magnets.txt/)).toBeInTheDocument();
    });
  });

  it("passes preferred groups and Nyaa search controls to the search request", async () => {
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText("One Piece"), { target: { value: "Detective Conan" } });
    fireEvent.change(screen.getByPlaceholderText("SubsPlease"), { target: { value: "SubsPlease, ASW" } });
    fireEvent.change(screen.getByLabelText("Result shape"), { target: { value: "batchesOnly" } });
    fireEvent.change(screen.getByLabelText("Filter"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "3_1" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() => {
      expect(runSearch).toHaveBeenCalledWith(
        expect.objectContaining({
          anime: "Detective Conan",
          category: "3_1",
          filter: "2",
          resultShape: "batchesOnly",
          preferredGroups: ["SubsPlease", "ASW"],
          manualAltTitles: []
        }),
        expect.any(Function)
      );
    });
  });
});
