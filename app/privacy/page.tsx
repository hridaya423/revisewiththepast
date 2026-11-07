import type { Metadata } from "next";

import { ContactLink, LegalPage, LegalSection, OPERATOR_NAME } from "@/app/_components/legal-page";

export const metadata: Metadata = {
  title: "Privacy policy · Revise with the Past",
  description: "What Revise with the Past collects, why, who processes it and how to delete it.",
};

export default function PrivacyPage() {
  return (
    <LegalPage
      current="/privacy"
      title="Privacy policy"
      updated="1 November 2026"
      intro={<p>This policy explains what information Revise with the Past keeps, why it keeps that information, and how you can see or delete it.</p>}
    >
      <LegalSection id="who" title="Who is responsible">
        <p>{OPERATOR_NAME} runs Revise with the Past as an individual. {OPERATOR_NAME} is the data controller for the information in this policy.</p>
        <p>For any question about your data, email <ContactLink />.</p>
      </LegalSection>

      <LegalSection id="collect" title="What we collect">
        <ul>
          <li><strong>Your account.</strong> When you create an account, we keep your name, your email address and your password. We store the password only in a scrambled (hashed) form.</li>
          <li><strong>Papers you build.</strong> We keep the course, topics and settings that you choose, and the papers that you save.</li>
          <li><strong>Answers you upload.</strong> We keep the photos and scanned PDFs of your answers, the text that we read from them, and the marks and notes that you confirm.</li>
          <li><strong>Papers built without an account.</strong> A cookie connects your browser to the papers that you build. If you sign in later, those papers move to your account.</li>
          <li><strong>Your network address.</strong> We use your IP address to limit how many papers one person can build each hour. We store only a scrambled code made from the address, not the address itself.</li>
        </ul>
        <p>We do not use analytics or advertising trackers.</p>
      </LegalSection>

      <LegalSection id="device" title="What stays on your device">
        <p>Your browser keeps two items in local storage: your most recent builder choices and the reference to your most recent paper. These items help you continue where you stopped. They contain no answers. You can remove them when you clear your browser data.</p>
        <p>We also use cookies that are necessary to keep you signed in and to connect you to your papers.</p>
      </LegalSection>

      <LegalSection id="use" title="How we use your information">
        <ul>
          <li>To build, save and download your papers.</li>
          <li>To read the handwriting in your answer pages and to suggest marks against the mark scheme.</li>
          <li>To keep you signed in and to show you only your own papers and answers.</li>
          <li>To prevent misuse and to keep the service available for everyone.</li>
        </ul>
        <p>We use this information because you ask us to provide the service. We use the network-address code because we have a legitimate interest in preventing misuse.</p>
      </LegalSection>

      <LegalSection id="processors" title="Services that process your information">
        <p>Other companies run parts of the service for us. They receive only the information that their part needs.</p>
        <ul>
          <li><strong>Convex</strong> stores accounts, papers, marks and the answer pages that you upload.</li>
          <li><strong>Vercel</strong> hosts the website and receives each request that your browser sends.</li>
          <li><strong>Hack Club AI</strong> passes your answer pages and answer text to <strong>Replicate</strong>, which reads handwriting, and to AI models that suggest marks. If Hack Club AI is not available, we send the answer text to <strong>OpenRouter</strong> to suggest marks.</li>
          <li><strong>Hack Club CDN</strong> stores the PDF files of papers that you save. Anyone with the exact link to one of these files can open it. Answer pages that were uploaded before 1 November 2026 are also stored there.</li>
        </ul>
      </LegalSection>

      <LegalSection id="keep" title="How long we keep it">
        <ul>
          <li>We delete each paper build, and its files, 24 hours after the build starts. Papers that you save stay in your account.</li>
          <li>We delete rate-limit records regularly.</li>
          <li>We keep your account, saved papers, answers and marks until you ask us to delete them.</li>
        </ul>
      </LegalSection>

      <LegalSection id="children" title="Children">
        <p>You must be 13 or older to create an account. If you are under 18, we suggest that you tell a parent, carer or teacher before you upload your work.</p>
        <p>If you think that a child under 13 has created an account, email <ContactLink /> so that we can delete it.</p>
      </LegalSection>

      <LegalSection id="rights" title="Your rights">
        <p>If you are in the UK, data protection law gives you the right to:</p>
        <ul>
          <li>get a copy of the information that we hold about you;</li>
          <li>correct information that is wrong;</li>
          <li>ask us to delete your information;</li>
          <li>object to how we use your information.</li>
        </ul>
        <p>To use one of these rights, email <ContactLink /> from the email address on your account. We will reply within one month.</p>
        <p>If you are not satisfied with our reply, you can complain to the Information Commissioner’s Office at <a href="https://ico.org.uk/make-a-complaint/" className="font-semibold text-accent underline underline-offset-4">ico.org.uk</a>.</p>
      </LegalSection>

      <LegalSection id="changes" title="Changes to this policy">
        <p>If we change this policy, we will update the date at the top of this page.</p>
      </LegalSection>
    </LegalPage>
  );
}
