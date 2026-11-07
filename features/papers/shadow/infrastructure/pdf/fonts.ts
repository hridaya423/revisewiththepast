import { StandardFonts, rgb, type PDFDocument, type PDFFont, type PDFPage } from "pdf-lib";

export type ShadowFonts = {
  roman: PDFFont;
  italic: PDFFont;
  bold: PDFFont;
  boldItalic: PDFFont;
  symbol: PDFFont;
  sans: PDFFont;
  sansBold: PDFFont;
};

export const INK = rgb(0.08, 0.08, 0.08);
export const GREY = rgb(0.45, 0.45, 0.45);
export const GRID = rgb(0.62, 0.62, 0.62);
export const GRID_MAJOR = rgb(0.38, 0.38, 0.38);
export const SHADE = rgb(0.8, 0.8, 0.8);
export const LIGHT = rgb(0.93, 0.93, 0.93);
export const WHITE = rgb(1, 1, 1);

export async function embedShadowFonts(doc: PDFDocument): Promise<ShadowFonts> {
  const [roman, italic, bold, boldItalic, symbol, sans, sansBold] = await Promise.all([
    doc.embedFont(StandardFonts.TimesRoman),
    doc.embedFont(StandardFonts.TimesRomanItalic),
    doc.embedFont(StandardFonts.TimesRomanBold),
    doc.embedFont(StandardFonts.TimesRomanBoldItalic),
    doc.embedFont(StandardFonts.Symbol),
    doc.embedFont(StandardFonts.Helvetica),
    doc.embedFont(StandardFonts.HelveticaBold),
  ]);
  return { roman, italic, bold, boldItalic, symbol, sans, sansBold };
}

const encodable = new WeakMap<PDFFont, Map<string, boolean>>();

function canEncode(font: PDFFont, char: string) {
  let cache = encodable.get(font);
  if (!cache) {
    cache = new Map();
    encodable.set(font, cache);
  }
  const cached = cache.get(char);
  if (cached !== undefined) return cached;
  let ok = true;
  try {
    font.encodeText(char);
  } catch {
    ok = false;
  }
  cache.set(char, ok);
  return ok;
}

export type TextSegment = { text: string; font: PDFFont };

/** Splits text into runs the primary font can encode, falling back to Symbol for maths glyphs such as − ≤ ≥ π. */
export function segmentText(value: string, primary: PDFFont, symbol: PDFFont): TextSegment[] {
  const segments: TextSegment[] = [];
  for (const char of value) {
    const font = canEncode(primary, char) ? primary : canEncode(symbol, char) ? symbol : null;
    if (!font) throw new Error(`No standard font can encode "${char}" (U+${char.codePointAt(0)!.toString(16).toUpperCase()}).`);
    const last = segments.at(-1);
    if (last && last.font === font) last.text += char;
    else segments.push({ text: char, font });
  }
  return segments;
}

export function measureText(value: string, primary: PDFFont, symbol: PDFFont, size: number) {
  return segmentText(value, primary, symbol).reduce((width, segment) => width + segment.font.widthOfTextAtSize(segment.text, size), 0);
}

export function drawText(page: PDFPage, value: string, options: { x: number; y: number; size: number; font: PDFFont; symbol: PDFFont; color?: ReturnType<typeof rgb> }) {
  let x = options.x;
  for (const segment of segmentText(value, options.font, options.symbol)) {
    page.drawText(segment.text, { x, y: options.y, size: options.size, font: segment.font, color: options.color ?? INK });
    x += segment.font.widthOfTextAtSize(segment.text, options.size);
  }
  return x - options.x;
}
