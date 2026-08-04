import taxonomy from "@/config/aqa-geography/taxonomy.json";
import paperTemplate from "@/config/aqa-geography/paper-template.json";

export type AqaGeographyTopic = {
  id: string;
  parentId: string | null;
  label: string;
  kind: "branch" | "leaf";
  paperCodes?: string[];
  sectionCodes?: string[];
  aliases?: string[];
};

export type AqaGeographyTaxonomy = {
  metadata: {
    boardCode: "aqa";
    subjectSlug: "geography";
    specCode: string;
    version: string;
    scope: string;
    taggingRule: string;
  };
  topics: AqaGeographyTopic[];
};

export type AqaGeographyOptionGroup = {
  id: string;
  choose: number;
  options: Array<{
    id: string;
    allowedPrimaryTopicIds: string[];
  }>;
};

export type AqaGeographySection = {
  code: string;
  name: string;
  mode: string;
  requiredQuestionCount: string;
  allowedPrimaryTopicIds?: string[];
  coreTopicIds?: string[];
  optionGroups?: AqaGeographyOptionGroup[];
  defaultFacets: {
    assessmentContext: "content" | "issue-evaluation" | "fieldwork";
    resourceBookletExpected: boolean;
  };
};

export type AqaGeographyPaperTemplate = {
  metadata: {
    boardCode: "aqa";
    subjectSlug: "geography";
    specCode: string;
    version: string;
  };
  papers: Array<{
    code: string;
    name: string;
    durationMinutes: number;
    totalMarks: number;
    contexts: string[];
    sections: AqaGeographySection[];
  }>;
};

export const aqaGeographyTaxonomy = taxonomy as AqaGeographyTaxonomy;
export const aqaGeographyPaperTemplate = paperTemplate as AqaGeographyPaperTemplate;

export function getAqaGeographyLeafTopics() {
  return aqaGeographyTaxonomy.topics.filter((topic) => topic.kind === "leaf");
}

export function getAqaGeographyTopicMap() {
  return new Map(aqaGeographyTaxonomy.topics.map((topic) => [topic.id, topic]));
}
