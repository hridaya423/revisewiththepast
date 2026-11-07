import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { M, frac, sqrt, sup } from "../../domain/content";
import { embedShadowFonts } from "./fonts";
import { MATH_RENDERER_VERSION, layoutMath } from "./math-renderer";
import { MATH_SPECIMENS } from "./math-specimens";


describe("vector maths renderer", () => {
  it("lays out every specimen with finite, bounded dimensions", async () => {
    const doc = await PDFDocument.create();
    const fonts = await embedShadowFonts(doc);
    for (const [name, nodes] of Object.entries(MATH_SPECIMENS)) {
      const box = layoutMath(nodes, fonts, 11);
      expect(Number.isFinite(box.width), name).toBe(true);
      expect(box.width, name).toBeGreaterThan(4);
      expect(box.width, name).toBeLessThan(260);
      expect(box.ascent + box.descent, name).toBeLessThan(60);
    }
    expect(MATH_RENDERER_VERSION).toMatch(/^shadow-vector-math-v\d+$/);
  });

  it("stacks fractions above and below the baseline, and radicals cover their body", async () => {
    const doc = await PDFDocument.create();
    const fonts = await embedShadowFonts(doc);
    const plain = layoutMath(M("12"), fonts, 11);
    const fraction = layoutMath(M(frac(113, 12)), fonts, 11);
    expect(fraction.ascent).toBeGreaterThan(plain.ascent);
    expect(fraction.descent).toBeGreaterThan(plain.descent);
    const body = layoutMath(M("63.5 × 101.7"), fonts, 11);
    const root = layoutMath(M(sqrt("63.5 × 101.7")), fonts, 11);
    expect(root.width).toBeGreaterThan(body.width + 5);
    expect(root.ascent).toBeGreaterThan(body.ascent);
    const exponent = layoutMath(M(sup("x", 2)), fonts, 11);
    expect(exponent.ascent).toBeGreaterThan(layoutMath(M("x"), fonts, 11).ascent);
  });

  it("draws complete output without external resources", async () => {
    const doc = await PDFDocument.create();
    const fonts = await embedShadowFonts(doc);
    const page = doc.addPage([400, 600]);
    let y = 570;
    for (const nodes of Object.values(MATH_SPECIMENS)) {
      const box = layoutMath(nodes, fonts, 11);
      box.draw(page, 20, y - box.ascent);
      y -= box.ascent + box.descent + 10;
    }
    const bytes = await doc.save();
    expect(bytes.byteLength).toBeGreaterThan(2000);
    const text = Buffer.from(bytes).toString("latin1");
    expect(text).not.toMatch(/\/URI|\/Launch|\/JavaScript/);
  });

  it("rejects expressions that cannot be printed", async () => {
    const doc = await PDFDocument.create();
    const fonts = await embedShadowFonts(doc);
    expect(() => layoutMath(M("1"), fonts, 100)).toThrow();
    expect(() => layoutMath(M("1234567890 + ".repeat(12), "1"), fonts, 11)).toThrow(/printable/);
  });
});
