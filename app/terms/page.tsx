import type { Metadata } from "next";
import Link from "next/link";

import { ContactLink, LegalPage, LegalSection, OPERATOR_NAME } from "@/app/_components/legal-page";

export const metadata: Metadata = {
  title: "Terms of use · Revise with the Past",
  description: "The rules for using Revise with the Past, its practice papers and its AI mark suggestions.",
};

export default function TermsPage() {
  return (
    <LegalPage
      current="/terms"
      title="Terms of use"
      updated="1 November 2026"
      intro={<p>These terms apply when you use Revise with the Past. {OPERATOR_NAME} runs the service as an individual. When you use the service, you agree to these terms.</p>}
    >
      <LegalSection id="age" title="Who can use the service">
        <p>You can build papers without an account. You must be 13 or older to create an account.</p>
      </LegalSection>

      <LegalSection id="account" title="Your account">
        <ul>
          <li>Give your real email address, so that we can help you if you lose access.</li>
          <li>Keep your password secret. You are responsible for what happens in your account.</li>
          <li>Tell us at <ContactLink /> if you think that another person has used your account.</li>
        </ul>
      </LegalSection>

      <LegalSection id="papers" title="Practice papers and exam content">
        <p>The papers use questions and mark schemes from past exam papers. The exam boards (for example AQA, Pearson Edexcel and OCR) own this content. Revise with the Past is not part of any exam board, and no exam board approves it.</p>
        <p>Use the papers only for your own study, or for teaching your own students. Do not sell the papers or publish them again.</p>
      </LegalSection>

      <LegalSection id="marking" title="AI mark suggestions">
        <p>The service can read your handwriting and suggest a mark for each answer. These suggestions can be wrong. They are not official marks, and they do not predict your grade.</p>
        <p>Check each suggestion against the mark scheme before you confirm it. The confirmed mark is your decision.</p>
      </LegalSection>

      <LegalSection id="uploads" title="Your uploads">
        <p>You keep the ownership of the answers that you upload. You give us permission to store them and to process them, so that we can show them to you and suggest marks.</p>
        <p>Upload only your own work, or work that you have permission to upload. Do not upload other personal information.</p>
      </LegalSection>

      <LegalSection id="use" title="Acceptable use">
        <p>Do not:</p>
        <ul>
          <li>try to get into accounts, papers or answers that are not yours;</li>
          <li>send automated requests in a way that avoids the limits on paper building or marking;</li>
          <li>try to damage, overload or interrupt the service;</li>
          <li>use the service to break the law.</li>
        </ul>
        <p>If you break these terms, we can stop your access and delete your account.</p>
      </LegalSection>

      <LegalSection id="service" title="Changes to the service">
        <p>We provide the service as it is. We can change, pause or stop any part of it. Download any paper that you want to keep.</p>
      </LegalSection>

      <LegalSection id="privacy" title="Your information">
        <p>The <Link href="/privacy" className="font-semibold text-accent underline underline-offset-4">privacy policy</Link> explains what information we keep and how you can delete it.</p>
      </LegalSection>

      <LegalSection id="contact" title="Changes and contact">
        <p>If we change these terms, we will update the date at the top of this page. For questions about these terms, email <ContactLink />.</p>
      </LegalSection>
    </LegalPage>
  );
}
