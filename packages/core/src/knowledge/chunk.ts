/** Split text into overlapping chunks of roughly `size` characters on paragraph/sentence boundaries. */
export function chunkText(text: string, size = 1500, overlap = 200): string[] {
  const clean = text.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').trim();
  if (!clean) return [];
  if (clean.length <= size) return [clean];
  const paragraphs = clean.split(/\n{2,}/);
  const chunks: string[] = [];
  let current = '';
  const push = () => {
    if (current.trim()) chunks.push(current.trim());
    current = '';
  };
  for (const p of paragraphs) {
    if (p.length > size) {
      // split long paragraph by sentences
      const sentences = p.split(/(?<=[.!?])\s+/);
      for (const s of sentences) {
        if ((current + ' ' + s).length > size) {
          push();
          current = s;
        } else current = current ? `${current} ${s}` : s;
      }
      continue;
    }
    if ((current + '\n\n' + p).length > size) {
      push();
      // carry overlap from the previous chunk
      const prev = chunks[chunks.length - 1] ?? '';
      current = prev.slice(Math.max(0, prev.length - overlap)) + '\n\n' + p;
    } else current = current ? `${current}\n\n${p}` : p;
  }
  push();
  return chunks;
}

export function estimateChunkTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Very small HTML -> text extraction (no external dependency). */
export function htmlToText(html: string): { title: string | null; text: string } {
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  let body = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(br|p|div|li|h[1-6]|tr|section|article|header|footer)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n');
  body = body.trim();
  return { title: titleMatch?.[1]?.trim() || null, text: body };
}
