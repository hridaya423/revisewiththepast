import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export type InventoryQuestionPart = {
  question_number: string | null;
  question_part_number: string | null;
  marks: number | null;
  marks_validated: string | null;
};

export type InventorySourceRecord = {
  directory: string;
  boardCode: string;
  subjectSlug: string;
  tier: "higher" | "foundation";
  paperCode: string;
  year: number | null;
  session: string | null;
  coverText: string;
  sourcePdfSha256: string | null;
  questionParts: InventoryQuestionPart[];
};

export type InventoryObstacle =
  | "duplicate-alias"
  | "unknown-marks"
  | "mark-mismatch"
  | "missing-subpart"
  | "missing-question"
  | "missing-source-pdf"
  | "calculator-conflict"
  | "unknown-calculator"
  | "alias-structure-conflict";

export type InventoryPaper = {
  sourcePaperId: string;
  identity: {
    boardCode: string;
    qualification: "gcse";
    subjectSlug: string;
    tier: string;
    year: number | null;
    session: string | null;
    paperCode: string;
  };
  primaryDirectory: string;
  aliasDirectories: string[];
  sourcePdfSha256: string | null;
  calculator: "allowed" | "not-allowed" | "unknown" | "conflict";
  questionLabels: string[];
  partPaths: string[];
  partMarks: Record<string, number | null>;
  extractedMarks: number;
  missing: string[];
  obstacles: InventoryObstacle[];
  status: "complete" | "incomplete";
};

export type ShadowPaperInventory = {
  generatedFrom: string;
  papers: InventoryPaper[];
};

function sittingKey(record: InventorySourceRecord) {
  return [record.boardCode, "gcse", record.subjectSlug, record.tier, record.year ?? "unknown-year", record.session ?? "unknown-session", record.paperCode].join("-");
}

function calculatorFromCover(coverText: string): InventoryPaper["calculator"] {
  if (/non\W{0,3}calculator/iu.test(coverText)) return "not-allowed";
  if (/\bcalculator\b/i.test(coverText)) return "allowed";
  return "unknown";
}

function partPath(part: InventoryQuestionPart) {
  const question = part.question_number?.trim() ?? "";
  const subpart = part.question_part_number?.trim();
  return subpart ? `${question}(${subpart})` : question;
}

const romanParts = ["i", "ii", "iii", "iv", "v", "vi"];

function partIndex(label: string) {
  const roman = romanParts.indexOf(label);
  if (roman >= 0) return roman;
  if (/^[a-z]$/.test(label)) return label.charCodeAt(0) - 97;
  return -1;
}

function findMissing(parts: InventoryQuestionPart[]) {
  const missing: string[] = [];
  const obstacles = new Set<InventoryObstacle>();
  const numbers = [...new Set(parts.map((part) => Number.parseInt(part.question_number ?? "", 10)).filter(Number.isFinite))].sort((a, b) => a - b);
  const highest = numbers.at(-1) ?? 0;
  for (let number = 1; number <= highest; number += 1) {
    if (!numbers.includes(number)) {
      missing.push(String(number));
      obstacles.add("missing-question");
    }
  }
  for (const number of numbers) {
    const labels = parts
      .filter((part) => Number.parseInt(part.question_number ?? "", 10) === number && part.question_part_number)
      .map((part) => part.question_part_number!.trim());
    const indexes = labels.map(partIndex).filter((index) => index >= 0);
    if (indexes.length === 0) continue;
    const useRoman = labels.some((label) => romanParts.includes(label) && label !== "i") || labels.every((label) => romanParts.includes(label));
    for (let index = 0; index < Math.max(...indexes); index += 1) {
      if (!indexes.includes(index)) {
        missing.push(`${number}(${useRoman ? romanParts[index] : String.fromCharCode(97 + index)})`);
        obstacles.add("missing-subpart");
      }
    }
  }
  return { missing, obstacles };
}

function structureSignature(record: InventorySourceRecord) {
  return record.questionParts.map((part) => `${partPath(part)}:${part.marks ?? "?"}`).join("|");
}

export function buildShadowPaperInventory(records: InventorySourceRecord[], generatedFrom = "records"): ShadowPaperInventory {
  const groups = new Map<string, InventorySourceRecord[]>();
  for (const record of records) {
    const key = sittingKey(record);
    groups.set(key, [...(groups.get(key) ?? []), record]);
  }

  const papers = [...groups.entries()].map(([sourcePaperId, group]): InventoryPaper => {
    const sorted = [...group].sort((left, right) => left.directory.localeCompare(right.directory));
    const primary = sorted[0]!;
    const obstacles = new Set<InventoryObstacle>();
    if (sorted.length > 1) obstacles.add("duplicate-alias");
    if (new Set(sorted.map(structureSignature)).size > 1) obstacles.add("alias-structure-conflict");

    const calculators = new Set(sorted.map((record) => calculatorFromCover(record.coverText)));
    const calculator: InventoryPaper["calculator"] = calculators.size > 1
      ? "conflict"
      : [...calculators][0] ?? "unknown";
    if (calculator === "conflict") obstacles.add("calculator-conflict");
    if (calculator === "unknown") obstacles.add("unknown-calculator");

    const partMarks: Record<string, number | null> = {};
    for (const part of primary.questionParts) {
      const path = partPath(part);
      partMarks[path] = typeof part.marks === "number" && part.marks_validated === "validated" ? part.marks : null;
      if (part.marks_validated === "unknown" || part.marks === null) obstacles.add("unknown-marks");
      if (part.marks_validated === "mismatch") obstacles.add("mark-mismatch");
    }
    const { missing, obstacles: structural } = findMissing(primary.questionParts);
    for (const obstacle of structural) obstacles.add(obstacle);
    if (!primary.sourcePdfSha256) obstacles.add("missing-source-pdf");

    const blocking: InventoryObstacle[] = ["unknown-marks", "mark-mismatch", "missing-subpart", "missing-question", "missing-source-pdf", "calculator-conflict", "unknown-calculator", "alias-structure-conflict"];
    return {
      sourcePaperId,
      identity: {
        boardCode: primary.boardCode,
        qualification: "gcse",
        subjectSlug: primary.subjectSlug,
        tier: primary.tier,
        year: primary.year,
        session: primary.session,
        paperCode: primary.paperCode,
      },
      primaryDirectory: primary.directory,
      aliasDirectories: sorted.slice(1).map((record) => record.directory),
      sourcePdfSha256: primary.sourcePdfSha256,
      calculator,
      questionLabels: [...new Set(primary.questionParts.map((part) => part.question_number?.trim() ?? ""))],
      partPaths: primary.questionParts.map(partPath),
      partMarks,
      extractedMarks: primary.questionParts.reduce((total, part) => total + (part.marks ?? 0), 0),
      missing,
      obstacles: [...obstacles].sort(),
      status: [...obstacles].some((obstacle) => blocking.includes(obstacle)) ? "incomplete" : "complete",
    };
  });

  papers.sort((left, right) => left.sourcePaperId.localeCompare(right.sourcePaperId));
  return { generatedFrom, papers };
}

const subjects: Record<string, { extractedDirectory: string; downloadsDirectory: string; boardCode: string; subjectSlug: string; tier: "higher" | "foundation" }> = {
  "edexcel-mathematics-higher": {
    extractedDirectory: "data/extracted/edexcel/mathematics/higher",
    downloadsDirectory: "data/downloads/edexcel/mathematics/higher",
    boardCode: "edexcel",
    subjectSlug: "mathematics",
    tier: "higher",
  },
};

type ExtractedPaper = {
  paper_code: string;
  year: number | null;
  session: string | null;
  pages?: Array<{ page_text?: string }>;
  question_parts: InventoryQuestionPart[];
};

export function loadInventoryRecords(subjectKey: string, root = process.cwd()): InventorySourceRecord[] {
  const subject = subjects[subjectKey];
  if (!subject) throw new Error(`Unsupported subject ${subjectKey}. Supported: ${Object.keys(subjects).join(", ")}`);
  const extractedRoot = resolve(root, subject.extractedDirectory);
  return readdirSync(extractedRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.includes("question_paper"))
    .map((entry) => {
      const paper = JSON.parse(readFileSync(resolve(extractedRoot, entry.name, "paper.json"), "utf8")) as ExtractedPaper;
      const pdfPath = resolve(root, subject.downloadsDirectory, `${entry.name}.pdf`);
      return {
        directory: entry.name,
        boardCode: subject.boardCode,
        subjectSlug: subject.subjectSlug,
        tier: subject.tier,
        paperCode: paper.paper_code,
        year: paper.year,
        session: paper.session,
        coverText: paper.pages?.[0]?.page_text ?? "",
        sourcePdfSha256: existsSync(pdfPath) ? createHash("sha256").update(readFileSync(pdfPath)).digest("hex") : null,
        questionParts: paper.question_parts,
      };
    });
}

function main() {
  const subjectIndex = process.argv.indexOf("--subject");
  const subjectKey = subjectIndex >= 0 ? process.argv[subjectIndex + 1] : undefined;
  if (!subjectKey) {
    console.error("Usage: tsx scripts/shadow-paper-inventory.ts --subject edexcel-mathematics-higher");
    process.exit(1);
  }
  const inventory = buildShadowPaperInventory(loadInventoryRecords(subjectKey), subjects[subjectKey]!.extractedDirectory);
  console.log(JSON.stringify(inventory, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
