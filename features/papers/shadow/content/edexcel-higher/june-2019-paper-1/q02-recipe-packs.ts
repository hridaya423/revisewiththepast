import { answerLine, display, frac, math, p, pIndent, unit } from "../../../domain/content";
import { R, formatDecimal } from "../../../domain/rational";
import { check } from "../../../domain/types";
import { PILOT_REVIEW, capitalise, criterion, defineTemplate, numberWord, people, pilotUnitKey, questionDocument, questionPart, schemePart } from "./common";

type Params = { person: number; sugar: number; batch: number; factor: number; flourMultiple: number; butterMultiple: number; pack: number };

function derive(parameters: Params) {
  const biscuits = parameters.batch * parameters.factor;
  const flour = parameters.sugar * parameters.flourMultiple * parameters.factor;
  const butter = parameters.sugar * parameters.butterMultiple * parameters.factor;
  return { biscuits, flour, butter, packs: Math.ceil(butter / parameters.pack), sugarNeeded: parameters.sugar * parameters.factor, person: people[parameters.person]! };
}

export const q02RecipePacks = defineTemplate<Params, ReturnType<typeof derive>>({
  templateId: "edexcel-1ma1h-2019-06-q02-recipe-packs",
  revision: 1,
  sourceUnitKey: pilotUnitKey(2),
  sourceQuestionNumber: 2,
  topics: ["ratio and proportion", "problem solving"],
  structure: [{ partId: "a", marks: 3 }, { partId: "b", marks: 2 }],
  sourceParameters: { person: 0, sugar: 50, batch: 15, factor: 4, flourMultiple: 3, butterMultiple: 2, pack: 250 },
  review: PILOT_REVIEW,
  sample: (rng) => ({
    person: rng.int(0, people.length - 1),
    sugar: rng.pick([40, 45, 50, 60, 70, 75, 80]),
    batch: rng.pick([10, 12, 15, 18, 20, 24]),
    factor: rng.int(3, 5),
    flourMultiple: rng.int(2, 4),
    butterMultiple: rng.int(2, 3),
    pack: rng.pick([200, 250, 500]),
  }),
  constraints: (parameters) => {
    const { butter, packs } = derive(parameters);
    const violations: string[] = [];
    if (parameters.flourMultiple === parameters.butterMultiple) violations.push("distinct-multiples");
    if (butter % parameters.pack === 0) violations.push("packs-must-round-up");
    if (packs < 2 || packs > 6) violations.push("pack-count-range");
    if (butter - (packs - 1) * parameters.pack < 30) violations.push("remainder-too-small");
    return violations;
  },
  derive,
  buildQuestion: (parameters, derived, context) => {
    const { name, subject } = derived.person;
    return questionDocument(context.questionNumber, [
      p(`${name} needs ${parameters.sugar} g of sugar to make ${parameters.batch} biscuits.`),
      p(`${capitalise(subject)} also needs`),
      pIndent(4, `${numberWord(parameters.flourMultiple)} times as much flour as sugar`),
      pIndent(4, `${numberWord(parameters.butterMultiple)} times as much butter as sugar`),
      p(`${name} is going to make ${derived.biscuits} biscuits.`),
    ], [
      questionPart("a", { prompt: [p("Work out the amount of flour she needs.".replace("she", subject))], marks: 3, working: 190, answer: answerLine(undefined, ["g"]) }),
      questionPart("b", {
        lead: [
          p(`${name} has to buy all the butter ${subject} needs to make ${derived.biscuits} biscuits.`),
          p(`${capitalise(subject)} buys the butter in ${parameters.pack} g packs.`),
        ],
        prompt: [p(`How many packs of butter does ${name} need to buy?`)],
        marks: 2,
        working: 170,
        answer: answerLine(),
      }),
    ]);
  },
  solve: (parameters, derived) => {
    const { sugar, batch, factor, flourMultiple, butterMultiple, pack } = parameters;
    return { parts: [
      schemePart({
        partId: "a",
        marks: 3,
        answer: [`${derived.flour} g`],
        criteria: [
          criterion("p1", "P1", [`for starting process to calculate amount of flour, eg ${derived.biscuits} ÷ ${batch} (= ${factor}) or ${flourMultiple} × ${sugar} (= ${flourMultiple * sugar})`]),
          criterion("p2", "P1", ["for complete process, eg ", math(frac(derived.biscuits, batch), ` × ${flourMultiple * sugar}`)], { dependsOn: ["p1"] }),
          criterion("a1", "A1", ["cao"], { dependsOn: ["p2"] }),
        ],
        accepted: [[`${factor} is implied by ${derived.sugarNeeded} g of sugar`]],
        working: [
          display(`${derived.biscuits} ÷ ${batch} = ${factor}`),
          display(`${flourMultiple} × ${sugar} = ${flourMultiple * sugar}`, unit("g")),
          display(`${factor} × ${flourMultiple * sugar} = ${derived.flour}`),
        ],
      }),
      schemePart({
        partId: "b",
        marks: 2,
        answer: [String(derived.packs)],
        criteria: [
          criterion("p1", "P1", [
            "for process to calculate amount of butter, eg ",
            math(frac(derived.biscuits, batch), ` × ${butterMultiple} × ${sugar} (= ${derived.butter})`),
            ` OR for process to calculate the number of packs of butter needed, eg [butter] ÷ ${pack}`,
          ]),
          criterion("a1", "A1", ["cao"], { dependsOn: ["p1"] }),
        ],
        accepted: [["[butter] must be clearly stated or calculated; it may be seen in part (a)."], [`${derived.packs} must not come from incorrect working.`]],
        working: [
          display(`${factor} × ${butterMultiple} × ${sugar} = ${derived.butter}`),
          display(`${derived.butter} ÷ ${pack} = ${formatDecimal(R(derived.butter, pack))}`),
          p(`${derived.packs - 1} packs are not enough, so ${derived.person.name} needs ${derived.packs} packs.`),
        ],
      }),
    ] };
  },
  verify: (parameters, derived) => [
    check("flour-scales-back-to-sugar", (derived.flour / parameters.flourMultiple) * (parameters.batch / derived.biscuits) === parameters.sugar),
    check("packs-cover-butter", derived.packs * parameters.pack >= derived.butter && (derived.packs - 1) * parameters.pack < derived.butter),
    check("rounding-trap-differs", Math.floor(derived.butter / parameters.pack) !== derived.packs),
  ],
  reveals: (parameters) => [{ partId: "b", tokens: [String(parameters.pack)] }],
});
