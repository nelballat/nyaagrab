import { TRACKERS } from "./constants";

export function parseSizeBytes(label: string): number {
  const parts = label.trim().split(/\s+/);
  if (parts.length !== 2) {
    return 0;
  }
  const value = Number.parseFloat(parts[0]);
  if (!Number.isFinite(value)) {
    return 0;
  }
  const unit = parts[1].toUpperCase();
  const multipliers: Record<string, number> = {
    B: 1,
    KIB: 1024,
    MIB: 1024 ** 2,
    GIB: 1024 ** 3,
    TIB: 1024 ** 4
  };
  return Math.trunc(value * (multipliers[unit] ?? 1));
}

export function formatSize(bytes: number): string {
  if (bytes >= 1024 ** 3) {
    return `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
  }
  if (bytes >= 1024 ** 2) {
    return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
  }
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

export function buildMagnet(infoHash: string, title: string): string {
  const dn = encodeURIComponent(title);
  const trackerParams = TRACKERS.map((tracker) => `tr=${encodeURIComponent(tracker)}`).join("&");
  return `magnet:?xt=urn:btih:${infoHash}&dn=${dn}&${trackerParams}`;
}
