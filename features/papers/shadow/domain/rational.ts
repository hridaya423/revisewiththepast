function gcd(a: bigint, b: bigint): bigint {
  let x = a < BigInt(0) ? -a : a;
  let y = b < BigInt(0) ? -b : b;
  while (y !== BigInt(0)) [x, y] = [y, x % y];
  return x;
}

function toBigInt(value: number | bigint, label: string): bigint {
  if (typeof value === "bigint") return value;
  if (!Number.isFinite(value)) throw new Error(`Rational ${label} must be finite.`);
  if (!Number.isInteger(value)) throw new Error(`Rational ${label} must be an integer; parse decimal strings instead of passing floats.`);
  if (!Number.isSafeInteger(value)) throw new Error(`Rational ${label} exceeds the safe integer range.`);
  return BigInt(value);
}

const TEN = BigInt(10);

function pow10(exponent: number): bigint {
  return TEN ** BigInt(exponent);
}

/** An exact, normalised rational number. Denominators are always positive. */
export class Rational {
  readonly n: bigint;
  readonly d: bigint;

  private constructor(numerator: bigint, denominator: bigint) {
    if (denominator === BigInt(0)) throw new Error("Rational denominator cannot be zero.");
    const sign = denominator < BigInt(0) ? -BigInt(1) : BigInt(1);
    const divisor = gcd(numerator, denominator) || BigInt(1);
    this.n = (sign * numerator) / divisor;
    this.d = (sign * denominator) / divisor;
  }

  static of(numerator: number | bigint, denominator: number | bigint = BigInt(1)) {
    return new Rational(toBigInt(numerator, "numerator"), toBigInt(denominator, "denominator"));
  }

  static parse(text: string) {
    const trimmed = text.trim();
    const fraction = /^(-?\d+)\/(\d+)$/u.exec(trimmed);
    if (fraction) return new Rational(BigInt(fraction[1]!), BigInt(fraction[2]!));
    const decimal = /^(-?)(\d+)(?:\.(\d+))?$/u.exec(trimmed);
    if (!decimal) throw new Error(`Cannot parse exact value "${text}".`);
    const digits = decimal[3] ?? "";
    const magnitude = BigInt(`${decimal[2]}${digits}`);
    return new Rational(decimal[1] ? -magnitude : magnitude, pow10(digits.length));
  }

  add(other: Rational) { return new Rational(this.n * other.d + other.n * this.d, this.d * other.d); }
  sub(other: Rational) { return new Rational(this.n * other.d - other.n * this.d, this.d * other.d); }
  mul(other: Rational) { return new Rational(this.n * other.n, this.d * other.d); }
  div(other: Rational) {
    if (other.n === BigInt(0)) throw new Error("Cannot divide by zero.");
    return new Rational(this.n * other.d, this.d * other.n);
  }
  neg() { return new Rational(-this.n, this.d); }
  abs() { return this.n < BigInt(0) ? this.neg() : this; }
  pow(exponent: number): Rational {
    if (!Number.isInteger(exponent)) throw new Error("Rational powers must be integers.");
    if (exponent < 0) return Rational.of(1).div(this.pow(-exponent));
    return new Rational(this.n ** BigInt(exponent), this.d ** BigInt(exponent));
  }

  cmp(other: Rational) {
    const left = this.n * other.d;
    const right = other.n * this.d;
    return left === right ? 0 : left < right ? -1 : 1;
  }
  eq(other: Rational) { return this.n === other.n && this.d === other.d; }
  lt(other: Rational) { return this.cmp(other) < 0; }
  gt(other: Rational) { return this.cmp(other) > 0; }
  sign() { return this.n === BigInt(0) ? 0 : this.n < BigInt(0) ? -1 : 1; }
  isZero() { return this.n === BigInt(0); }
  isInteger() { return this.d === BigInt(1); }

  floor() {
    const quotient = this.n / this.d;
    return this.n < BigInt(0) && quotient * this.d !== this.n ? quotient - BigInt(1) : quotient;
  }
  ceil() {
    const quotient = this.n / this.d;
    return this.n > BigInt(0) && quotient * this.d !== this.n ? quotient + BigInt(1) : quotient;
  }

  toExact() { return this.d === BigInt(1) ? this.n.toString() : `${this.n}/${this.d}`; }
  toNumber() { return Number(this.n) / Number(this.d); }
  toJSON() { return this.toExact(); }
  toString() { return this.toExact(); }
}

export function R(numerator: number | bigint | string, denominator: number | bigint = 1) {
  if (typeof numerator === "string") return Rational.parse(numerator).div(Rational.of(denominator));
  return Rational.of(numerator, denominator);
}

/** A rational terminates in decimal when its reduced denominator has no prime factors other than 2 and 5. */
export function isTerminatingDecimal(value: Rational) {
  let denominator = value.d;
  while (denominator % BigInt(2) === BigInt(0)) denominator /= BigInt(2);
  while (denominator % BigInt(5) === BigInt(0)) denominator /= BigInt(5);
  return denominator === BigInt(1);
}

function scaleBy(value: Rational, places: number) {
  return places >= 0 ? value.mul(Rational.of(pow10(places))) : value.div(Rational.of(pow10(-places)));
}

/** Rounds ties away from zero, the convention used in exam mark schemes. Negative places round to tens, hundreds, … */
export function roundToDecimalPlaces(value: Rational, places: number) {
  if (!Number.isInteger(places) || Math.abs(places) > 30) throw new Error("Decimal places must be a small integer.");
  const scaled = scaleBy(value.abs(), places);
  const whole = scaled.floor();
  const remainder = scaled.sub(Rational.of(whole));
  const rounded = remainder.cmp(Rational.of(1, 2)) >= 0 ? whole + BigInt(1) : whole;
  const magnitude = scaleBy(Rational.of(rounded), -places);
  return value.sign() < 0 ? magnitude.neg() : magnitude;
}

export function truncateToDecimalPlaces(value: Rational, places: number) {
  const scaled = scaleBy(value.abs(), places);
  const magnitude = scaleBy(Rational.of(scaled.floor()), -places);
  return value.sign() < 0 ? magnitude.neg() : magnitude;
}

/** The exponent e with 10^e <= |value| < 10^(e+1), computed exactly. */
export function decimalExponent(value: Rational) {
  if (value.isZero()) throw new Error("Zero has no decimal exponent.");
  const magnitude = value.abs();
  let exponent = magnitude.n.toString().length - magnitude.d.toString().length;
  while (magnitude.lt(scaleBy(Rational.of(1), exponent))) exponent -= 1;
  while (!magnitude.lt(scaleBy(Rational.of(1), exponent + 1))) exponent += 1;
  return exponent;
}

export function roundToSignificantFigures(value: Rational, figures: number) {
  if (!Number.isInteger(figures) || figures < 1 || figures > 20) throw new Error("Significant figures must be between 1 and 20.");
  if (value.isZero()) return value;
  return roundToDecimalPlaces(value, figures - 1 - decimalExponent(value));
}

/** Prints a terminating rational exactly. Pass `places` to pad with trailing zeroes. */
export function formatDecimal(value: Rational, places?: number) {
  if (!isTerminatingDecimal(value)) throw new Error(`${value.toExact()} is not a terminating decimal; round it first.`);
  let digits = 0;
  while (!scaleBy(value, digits).isInteger()) digits += 1;
  const width = Math.max(digits, places ?? 0);
  const scaled = scaleBy(value.abs(), width).n.toString().padStart(width + 1, "0");
  const integer = scaled.slice(0, scaled.length - width);
  const fraction = width > 0 ? `.${scaled.slice(scaled.length - width)}` : "";
  return `${value.sign() < 0 ? "-" : ""}${integer}${fraction}`;
}

export function gcdInt(a: number, b: number) {
  return Number(gcd(BigInt(a), BigInt(b)));
}

export function lcmInt(a: number, b: number) {
  return (a / gcdInt(a, b)) * b;
}
