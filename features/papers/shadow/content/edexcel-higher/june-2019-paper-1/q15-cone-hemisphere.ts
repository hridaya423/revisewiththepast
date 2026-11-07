import { answerLine, figure, frac, fracR, italic, M, math, p, space, sup, upright } from "../../../domain/content";
import { DiagramBuilder, validateDiagram } from "../../../domain/diagram";
import { R } from "../../../domain/rational";
import { check } from "../../../domain/types";
import { PILOT_REVIEW, criterion, defineTemplate, pilotUnitKey, questionDocument, questionPart, schemePart } from "./common";

type Params = { radius: number; height: number };

function derive({ radius, height }: Params) {
  const cone = R(radius * radius * height, 3);
  const hemisphere = R(2 * radius ** 3, 3);
  const total = cone.add(hemisphere);
  const diameterAsRadius = R((2 * radius) ** 2 * height, 3).add(R(2 * (2 * radius) ** 3, 3));
  const fullSphere = cone.add(R(4 * radius ** 3, 3));

  const drawRadius = 52;
  const drawHeight = Math.max(70, Math.min(150, (drawRadius * height) / radius));
  const builder = new DiagramBuilder(470, Math.max(184, 14 + drawHeight + drawRadius + 6));
  const cx = 110;
  const baseY = 14 + drawHeight;
  const ry = 9;
  builder.line(cx, baseY - drawHeight, cx - drawRadius, baseY, { w: 0.9 });
  builder.line(cx, baseY - drawHeight, cx + drawRadius, baseY, { w: 0.9 });
  builder.ellipse(cx, baseY, drawRadius, ry, { half: "upper", dash: true, w: 0.7 });
  builder.ellipse(cx, baseY, drawRadius, ry, { half: "lower", w: 0.9 });
  builder.ellipse(cx, baseY, drawRadius, drawRadius, { half: "lower", w: 0.9 });
  builder.line(cx - drawRadius + 2, baseY, cx + drawRadius - 2, baseY, { w: 0.6, arrow: "both" });
  builder.label(cx, baseY - 14, [math(`${2 * radius}`, space, upright("cm"))], { size: 10, anchor: "middle" });
  const arrowX = cx + drawRadius + 14;
  builder.line(arrowX, baseY - drawHeight, arrowX, baseY, { w: 0.6, arrow: "both" });
  builder.label(arrowX + 6, baseY - drawHeight / 2 + 4, [math(`${height}`, space, upright("cm"))], { size: 10 });

  const boxLeft = 236;
  builder.rect(boxLeft, 8, 230, 168, { lineWidth: 0.8 });
  builder.label(boxLeft + 10, 50, [{ t: "text", v: "Volume of a cone = " }, math(frac(1, 3), "π", sup("r", 2), "h")], { size: 10 });
  builder.label(boxLeft + 10, 132, [{ t: "text", v: "Volume of a sphere = " }, math(frac(4, 3), "π", sup("r", 3))], { size: 10 });
  const iconX = boxLeft + 188;
  builder.line(iconX, 18, iconX - 24, 70, { w: 0.7 });
  builder.line(iconX, 18, iconX + 24, 70, { w: 0.7 });
  builder.ellipse(iconX, 70, 24, 5, { half: "upper", dash: true, w: 0.5 });
  builder.ellipse(iconX, 70, 24, 5, { half: "lower", w: 0.7 });
  builder.label(iconX + 4, 66, [math("r")], { size: 8 });
  builder.label(iconX - 5, 48, [math("h")], { size: 8 });
  builder.circle(iconX, 130, 26, { w: 0.7 });
  builder.ellipse(iconX, 130, 26, 6, { half: "upper", dash: true, w: 0.5 });
  builder.ellipse(iconX, 130, 26, 6, { half: "lower", w: 0.5 });
  builder.line(iconX, 130, iconX + 14, 108, { w: 0.6 });
  builder.label(iconX + 15, 118, [math("r")], { size: 8 });

  const diagram = builder.build("not-to-scale", `A cone of height ${height} cm on top of a hemisphere; both have diameter ${2 * radius} cm. A box gives the volume formulae for a cone and a sphere.`);
  return { cone, hemisphere, total, diameterAsRadius, fullSphere, diagram, drawHeight };
}

export const q15ConeHemisphere = defineTemplate<Params, ReturnType<typeof derive>>({
  templateId: "edexcel-1ma1h-2019-06-q15-cone-hemisphere",
  revision: 1,
  sourceUnitKey: pilotUnitKey(15),
  sourceQuestionNumber: 15,
  topics: ["geometry", "volume", "π"],
  structure: [{ partId: "", marks: 4 }],
  sourceParameters: { radius: 3, height: 10 },
  review: PILOT_REVIEW,
  sample: (rng) => ({ radius: rng.int(2, 6), height: rng.int(4, 15) }),
  enumerate: () => [2, 3, 4, 5, 6].flatMap((radius) => Array.from({ length: 12 }, (_, index) => ({ radius, height: index + 4 }))),
  constraints: (parameters) => {
    const { total, fullSphere, diameterAsRadius } = derive(parameters);
    const violations: string[] = [];
    if (!total.isInteger()) violations.push("k-integer");
    if (parameters.height <= parameters.radius + 1) violations.push("cone-taller-than-radius");
    if (total.toNumber() > 320) violations.push("k-size");
    if (fullSphere.eq(total) || diameterAsRadius.eq(total)) violations.push("error-traps-distinct");
    return violations;
  },
  derive,
  buildQuestion: ({ radius, height }, derived, context) => questionDocument(context.questionNumber, [
    p("The diagram shows a solid shape."),
    p("The shape is a cone on top of a hemisphere."),
    figure(derived.diagram),
    p(`The height of the cone is ${height} cm.`),
    p(`The base of the cone has a diameter of ${2 * radius} cm.`),
    p(`The hemisphere has a diameter of ${2 * radius} cm.`),
    p("The total volume of the shape is ", math("kπ", space, sup(upright("cm"), 3)), ", where ", italic("k"), " is an integer."),
  ], [questionPart("", { prompt: [p("Work out the value of ", italic("k"), ".")], marks: 4, working: 220, answer: answerLine([math("k ="), " "]) })]),
  solve: ({ radius, height }, derived) => {
    const cone = M(frac(1, 3), " × π × ", sup(radius, 2), ` × ${height}`);
    const sphere = M(frac(4, 3), " × π × ", sup(radius, 3));
    const hemisphere = M(frac(2, 3), " × π × ", sup(radius, 3));
    const piTerm = (value: ReturnType<typeof R>) => M(fracR(value), "π");
    return { parts: [schemePart({
      partId: "",
      marks: 4,
      answer: [String(derived.total.toExact())],
      criteria: [
        criterion("m1", "M1", ["for method to use a volume formula with correct substitution for the cone, sphere or hemisphere, eg ", math(cone), " or ", math(sphere), " or ", math(hemisphere), " oe"]),
        criterion("m2", "M1", ["for complete method to find total volume, eg ", math(cone, " + ", hemisphere)], { dependsOn: ["m1"] }),
        criterion("m3", "M1", ["(dep first M1) for correct partial simplification, eg ", math(piTerm(derived.cone)), " or ", math(piTerm(derived.hemisphere))], { dependsOn: ["m1"] }),
        criterion("a1", "A1", ["cao"], { dependsOn: ["m2", "m3"] }),
      ],
      accepted: [[`May work without π or with an approximation of π; must use the correct radius of ${radius} (and ${height}) in substitution.`], ["Partial simplification must be for the cone or the hemisphere."], ["Accept ", math(`${derived.total.toExact()}π`)]],
      specialCases: [{ code: "SC B2", text: [`for answer of ${derived.diameterAsRadius.toExact()} or ${derived.diameterAsRadius.toExact()}π`] }],
      working: [
        p(`The radius is ${2 * radius} ÷ 2 = ${radius} cm.`),
        p("Cone: ", math(cone, " = ", piTerm(derived.cone))),
        p("Hemisphere: ", math(hemisphere, " = ", piTerm(derived.hemisphere))),
        p("Total: ", math(piTerm(derived.cone), " + ", piTerm(derived.hemisphere), " = ", piTerm(derived.total))),
        p(`So k = ${derived.total.toExact()}.`),
      ],
    })] };
  },
  verify: ({ radius, height }, derived) => {
    const numeric = (Math.PI * radius * radius * height) / 3 + (2 * Math.PI * radius ** 3) / 3;
    return [
      ...validateDiagram(derived.diagram),
      check("numeric-volume-agrees", Math.abs(numeric - derived.total.toNumber() * Math.PI) < 1e-9),
      check("diagram-proportion", Math.abs(derived.drawHeight / 52 - Math.max(70, Math.min(150, (52 * height) / radius)) / 52) < 1e-9),
    ];
  },
});
