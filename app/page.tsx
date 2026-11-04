import type { Metadata } from "next";

import { LandingPage } from "./_components/landing-page";
import { PAPER_MAKER_SUBJECTS } from "@/features/papers/server";

const SITE_URL = "https://revise.hridya.tech";
const CASE_STUDY_URL = "https://www.hridya.tech/projects/revise";
const REPO_URL = "https://github.com/hridaya423/revisewiththepast";
const OG_IMAGE = { url: "/landing/aqa-geography-paper-page.png", width: 1272, height: 1800, alt: "A generated AQA Geography practice paper page" };

const BOARDS = Array.from(new Set(PAPER_MAKER_SUBJECTS.filter((subject) => subject.generationEnabled).map((subject) => subject.boardLabel)));
const BOARD_LIST = BOARDS.length > 1 ? `${BOARDS.slice(0, -1).join(", ")} and ${BOARDS.at(-1)}` : BOARDS[0] ?? "";

const TITLE = "Revise with the Past: GCSE practice papers from past exams";
const DESCRIPTION = `Build GCSE practice papers from real past exam questions for ${BOARD_LIST}. Upload your answers and check them against the mark scheme.`;

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: SITE_URL },
  authors: [{ name: "Hridya Agrawal", url: "https://www.hridya.tech" }],
  openGraph: { type: "website", url: SITE_URL, siteName: "Revise with the Past", title: TITLE, description: DESCRIPTION, images: [OG_IMAGE] },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION, images: [OG_IMAGE.url] },
};

const PERSON = { "@type": "Person", "@id": "https://www.hridya.tech/#person", name: "Hridya Agrawal", url: "https://www.hridya.tech" };

const JSON_LD = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebApplication",
      "@id": `${SITE_URL}/#app`,
      name: "Revise with the Past",
      url: SITE_URL,
      description: DESCRIPTION,
      applicationCategory: "EducationalApplication",
      operatingSystem: "Any",
      browserRequirements: "Requires a modern web browser",
      inLanguage: "en-GB",
      audience: { "@type": "EducationalAudience", educationalRole: "student", audienceType: "GCSE students" },
      educationalLevel: "GCSE",
      author: PERSON,
      sameAs: [REPO_URL, CASE_STUDY_URL],
      subjectOf: { "@type": "WebPage", "@id": CASE_STUDY_URL, url: CASE_STUDY_URL, name: "Revise with the Past case study" },
    },
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      name: "Revise with the Past",
      url: SITE_URL,
      inLanguage: "en-GB",
      publisher: PERSON,
    },
  ],
};

export default function Home() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD).replace(/</g, "\\u003c") }} />
      <LandingPage />
    </>
  );
}
