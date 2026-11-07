import { M, fn, frac, paren, sqrt, sup, unit, upright, vec } from "../../domain/content";

export const MATH_SPECIMENS = {
  stackedFraction: M("3y + 2x = ", frac(1, 2)),
  negativeFraction: M("2y − 3x = −", frac(113, 12)),
  nestedFraction: M(frac(M("g + 3"), M("r + 2 + g + 3")), " = ", frac(6, 13)),
  mixedNumbers: M("3", frac(1, 2), " × 1", frac(3, 5)),
  surdSum: M(sqrt(3), " + ", sqrt(12)),
  surdPower: M(sup(paren(frac(1, sqrt(3))), 7)),
  surdFraction: M(frac(sqrt("b"), "c")),
  rootProduct: M(sqrt("63.5 × 101.7")),
  powers: M(sup("x", 2), " − 6x + 1 = ", sup(paren("x − a"), 2), " − b"),
  negativePower: M(sup(5, M("−2"))),
  inequality: M("n > 1, ", sup("n", 2), " − n ≤ 0 ≥ 1"),
  units: M("45", sup(unit("cm"), 2), ", 10", unit("cm")),
  trig: M(fn("tan"), "30°", " × ", fn("sin"), "60°"),
  vector: M(vec("c", "d")),
  piVolume: M(frac(1, 3), "π", sup("r", 2), "h"),
  inverse: M(sup(upright("f"), M("−1")), "(x) = ", frac("x + 1", 3)),
};
