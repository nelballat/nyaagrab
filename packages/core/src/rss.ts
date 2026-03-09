import { buildMagnet, parseSizeBytes } from "./utils";
import type { TorrentRecord } from "./types";

const CONTROL_CHAR_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;
const ITEM_RE = /<item\b[\s\S]*?<\/item>/gi;
const CDATA_RE = /^<!\[CDATA\[([\s\S]*?)\]\]>$/;
const ENTITY_RE = /&#(\d+);|&#x([0-9a-f]+);|&quot;|&apos;|&lt;|&gt;|&amp;/gi;

function decodeXml(value: string): string {
  return value.replace(ENTITY_RE, (match, decimal, hex) => {
    if (decimal) {
      return String.fromCodePoint(Number.parseInt(decimal, 10));
    }
    if (hex) {
      return String.fromCodePoint(Number.parseInt(hex, 16));
    }

    switch (match) {
      case "&quot;":
        return "\"";
      case "&apos;":
        return "'";
      case "&lt;":
        return "<";
      case "&gt;":
        return ">";
      case "&amp;":
        return "&";
      default:
        return match;
    }
  });
}

function extractTag(block: string, tagName: string): string {
  const matcher = new RegExp(`<(?:(?:\\w+):)?${tagName}\\b[^>]*>([\\s\\S]*?)<\\/(?:(?:\\w+):)?${tagName}>`, "i");
  const match = block.match(matcher);
  if (!match) {
    return "";
  }

  const cdata = match[1].trim().match(CDATA_RE);
  return decodeXml((cdata?.[1] ?? match[1]).trim());
}

function extractNumber(block: string, tagName: string): number {
  return Number.parseInt(extractTag(block, tagName), 10) || 0;
}

export function parseRss(xmlText: string): TorrentRecord[] {
  const cleaned = xmlText.replace(CONTROL_CHAR_RE, "");
  if (!/<rss\b/i.test(cleaned) || !/<channel\b/i.test(cleaned)) {
    throw new Error("invalid rss response");
  }

  const items = cleaned.match(ITEM_RE) ?? [];
  return items.map((item) => {
    const title = extractTag(item, "title");
    const infoHash = extractTag(item, "infoHash");
    const sizeLabel = extractTag(item, "size");

    return {
      title,
      link: extractTag(item, "link"),
      infoHash,
      seeders: extractNumber(item, "seeders"),
      leechers: extractNumber(item, "leechers"),
      downloads: extractNumber(item, "downloads"),
      sizeLabel,
      sizeBytes: parseSizeBytes(sizeLabel),
      category: extractTag(item, "category"),
      pubDate: extractTag(item, "pubDate"),
      magnet: buildMagnet(infoHash, title)
    };
  });
}
