import type { TitleResolutionResponse } from "./types";

function isUsefulSynonym(text: string): boolean {
  const cleaned = text.trim();
  if (!cleaned || !/^[\x00-\x7F]+$/.test(cleaned)) {
    return false;
  }
  if (cleaned.length < 6) {
    return false;
  }
  const letters = Array.from(cleaned).filter((char) => /[A-Za-z]/.test(char)).length;
  return letters >= 4;
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
    if (seen.has(lowered)) {
      continue;
    }
    if (title !== name && (!title.includes(" ") || isUsefulSynonym(title) || /[^\x00-\x7F]/.test(title))) {
      titles.push(title);
      seen.add(lowered);
    }
  }
  return titles;
}
