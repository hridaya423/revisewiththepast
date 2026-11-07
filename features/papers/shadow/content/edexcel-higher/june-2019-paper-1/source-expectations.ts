/**
 * Facts transcribed from the June 2019 1MA1/1H question paper and official mark scheme.
 * Template tests reproduce the source instance from `sourceParameters` and compare against these.
 */
export type SourceExpectation = {
  prompt: string[];
  answers: string[];
  invalid: Array<Record<string, unknown>>;
  minimumVariety?: number;
  answerMustNotAppear?: (answers: string[]) => string[];
};

export const SOURCE_EXPECTATIONS: Record<number, SourceExpectation> = {
  1: {
    prompt: ["probability of taking at random a blue cube", "0.2", "There are 12 blue cubes in the box.", "Work out the total number of cubes in the box."],
    answers: ["red 0.4, yellow 0.4", "60"],
    invalid: [{ blueTenths: 2, total: 62 }, { blueTenths: 1, total: 15 }],
  },
  2: {
    prompt: ["Deon needs 50 g of sugar to make 15 biscuits.", "three times as much flour as sugar", "two times as much butter as sugar", "make 60 biscuits", "250 g packs"],
    answers: ["600 g", "2"],
    invalid: [{ pack: 200 }, { butterMultiple: 3 }, { factor: 5, pack: 500 }],
  },
  3: {
    prompt: ["highest common factor (HCF) of 72 and 90"],
    answers: ["18"],
    invalid: [{ m: 4, n: 6 }, { hcf: 15 }, { hcf: 40 }],
    minimumVariety: 15,
  },
  4: {
    prompt: ["plan, front elevation and side elevation", "centimetre grid", "draw a sketch of the solid shape", "Give the dimensions"],
    answers: ["Sketch of a cylinder, radius 2 cm (diameter 4 cm), height 5 cm"],
    invalid: [{ diameter: 5 }, { diameter: 4, height: 4 }],
    minimumVariety: 8,
  },
  5: {
    prompt: ["reflection in the x-axis followed by a translation", "Find the value of c and the value of d."],
    answers: ["c=−6, d=−1"],
    invalid: [{ c: 0 }, { c: -1, d: -1 }, { x: 6, across: 3 }],
  },
  6: {
    prompt: ["2 pens in each pack of black pens", "5 pens in each pack of red pens", "6 pens in each pack of green pens", "On Monday,", "A total of 212 pens were sold.", "Work out the number of green pens sold."],
    answers: ["96"],
    invalid: [{ ratio: [2, 4, 6] }, { ratio: [3, 3, 4] }],
  },
  7: {
    prompt: ["QR = 10 cm", "BC=PQ", "The perimeter of ABCD is 26 cm", "The area of PQRS is 45 cm^(2)", "Find the length of AB."],
    answers: ["8.5"],
    invalid: [{ pqHalves: 8 }, { perimeter: 12 }, { qr: 6 }],
  },
  8: {
    prompt: ["sqrt(63.5×101.7)", "(2.3)^(6) = 148 correct to 3 significant figures.", "(0.23)^(6) correct to 3 significant figures", "5^(-2)"],
    answers: ["75 to 81", "0.000148", "(1)/(25)"],
    invalid: [{ mantissaTenths: 20 }, { mantissaTenths: 11, power: 3 }, { base: 1 }],
  },
  9: {
    prompt: ["Work out", "3(1)/(2)×1(3)/(5)", "Give your answer as a mixed number in its simplest form."],
    answers: ["5(3)/(5)"],
    invalid: [{ n1: 2, d1: 4 }, { d2: 2 }, { w1: 4, n1: 1, d1: 2, w2: 2, n2: 1, d2: 2 }],
  },
  10: {
    prompt: ["3y+2x=(1)/(2)", "2y-3x=-(113)/(12)", "Using the graphs, find estimates of the solutions of the simultaneous equations"],
    answers: ["x = 2.2 to 2.3, y = −1.3 to −1.4"],
    invalid: [{ xNumerator: 10, xDenominator: 4 }, { yNumerator: -3, yDenominator: 3 }, { xNumerator: 23, xDenominator: 8 }],
  },
  11: {
    prompt: ["Here are the ages of the 23 people on coach A.", "41 | 42 | 44", "Richard says that the people on coach A are younger than the people on coach B.", "Richard says that the people on coach A vary more in age than the people on coach B."],
    answers: ["59, 53, 66", "Yes, with reason", "No, with reason"],
    invalid: [{ median: 60 }, { lower: 75 }, { ages: [41, 42] }],
  },
  12: {
    prompt: ["The volume of sphere Q is 50% more than the volume of sphere P.", "The volume of sphere R is 50% more than the volume of sphere Q.", "Find the volume of sphere P as a fraction of the volume of sphere R."],
    answers: ["(4)/(9)"],
    invalid: [{ first: 100 }, { second: 0 }, { first: 15 }],
    minimumVariety: 60,
  },
  13: {
    prompt: ["can be any integer such that n>1", "prove that n^(2)-n is never an odd number."],
    answers: ["Proof shown"],
    invalid: [{ k: 2 }, { k: 11 }, { lowerBound: 0 }],
    minimumVariety: 24,
  },
  14: {
    prompt: ["Find the exact value of tan 30°×sin 60°", "Give your answer in its simplest form."],
    answers: ["(1)/(2)"],
    invalid: [{ first: "tan", firstAngle: 45 }, { first: "sin", firstAngle: 30, second: "cos", secondAngle: 60 }, { first: "tan", firstAngle: 60, second: "tan", secondAngle: 60 }, { first: "tan", firstAngle: 30, second: "tan", secondAngle: 60 }],
    minimumVariety: 10,
  },
  15: {
    prompt: ["The shape is a cone on top of a hemisphere.", "The height of the cone is 10 cm.", "The base of the cone has a diameter of 6 cm.", "The hemisphere has a diameter of 6 cm.", "Work out the value of k."],
    answers: ["48"],
    invalid: [{ radius: 2, height: 3 }, { radius: 6, height: 6 }, { radius: 6, height: 15 }],
    minimumVariety: 15,
  },
  16: {
    prompt: ["There are three dials on a combination lock.", "1, 2, 3, 4, 5", "The three digit number 553 is one way", "three different digits"],
    answers: ["125", "60"],
    invalid: [{ example: [1, 2, 3] }, { highest: 3 }, { dials: 4, highest: 10, example: [1, 1, 2, 3] }],
  },
  17: {
    prompt: ["x^(2):(3x+5)=1:2", "find the possible values of"],
    answers: ["−1, 2.5"],
    invalid: [{ p: 4 }, { p: 2, q: 1 }, { k: 2, p: 21, q: 3 }],
  },
  18: {
    prompt: ["sqrt(3)+sqrt(12)", "asqrt(3)", "((1)/(sqrt(3)))^(7)", "(sqrt(b))/(c)"],
    answers: ["3sqrt(3)", "(sqrt(3))/(81)"],
    invalid: [{ first: 2, second: 2 }, { base: 7, second: 4 }, { base: 7, power: 7 }],
  },
  19: {
    prompt: ["x^(2)-6x+1=(x-a)^(2)-b", "find the value of a and the value of b.", "Hence write down the coordinates of the turning point on the graph of y=x^(2)-6x+1"],
    answers: ["3, 8", "(3, −8)"],
    invalid: [{ a: 3, c: 9 }, { a: 2, c: 2 }],
  },
  20: {
    prompt: ["is inversely proportional to", "is directly proportional to sqrt(t)", "h=10", "t=144", "p=6", "find a formula for h in terms of t"],
    answers: ["h=(120)/(sqrt(t))"],
    invalid: [{ p: 12 }, { p: 7 }, { h: 20, p: 15 }],
  },
  21: {
    prompt: ["f(x)=3x-1", "g(x)=x^(2)+4", "Find f^(-1)(x)", "fg(x)=2gf(x)", "show that  15x^(2)-12x-1=0"],
    answers: ["(x+1)/(3)", "Shown"],
    invalid: [{ b: 0 }, { a: 2, b: -2, c: 2 }, { a: 5, b: 5, c: 9, m: 3 }],
  },
  22: {
    prompt: ["There are only r red counters and g green counters in a bag.", "(3)/(7)", "2 more red counters and 3 more green counters are put in the bag.", "(6)/(13)"],
    answers: ["12 red, 9 green"],
    invalid: [{ greenShare: 2, parts: 4 }, { addRed: 3, addGreen: 3 }, { greenShare: 7 }],
  },
};
