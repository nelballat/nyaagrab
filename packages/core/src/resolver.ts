import type { TitleResolutionResponse } from "./types";

const JAPANESE_RE = /[\u3040-\u309F\u30A0-\u30FF]/;
const NON_LATIN_RE = /[^\x00-\x7F\u00C0-\u024F]/;

function isUsefulAlt(title: string): boolean {
  if (JAPANESE_RE.test(title)) {
    return true;
  }
  if (NON_LATIN_RE.test(title)) {
    return false;
  }
  const words = title.trim().split(/\s+/);
  return words.length >= 3 && title.length >= 20;
}

export function normalizeResolvedTitles(name: string, response: TitleResolutionResponse): string[] {
  const sourceTitles = response.titles ?? [];
  if (response.error || sourceTitles.length === 0) {
    return [name];
  }

  const titles: string[] = [name];
  const seen = new Set([name.toLocaleLowerCase()]);
  for (const title of sourceTitles) {
    const lowered = title.toLocaleLowerCase();
    if (seen.has(lowered) || title === name) {
      continue;
    }
    if (isUsefulAlt(title)) {
      titles.push(title);
      seen.add(lowered);
    }
  }
  return titles;
}
