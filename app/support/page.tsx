import type { Metadata } from "next";
import Link from "next/link";

import { CONTACT_EMAIL, ContactLink, LegalPage, LegalSection } from "@/app/_components/legal-page";

export const metadata: Metadata = {
  title: "Support · Revise with the Past",
  description: "Get help with building papers, uploading answers and checking marks.",
};

const linkClass = "font-semibold text-accent underline underline-offset-4 hover:text-accent-deep";

export default function SupportPage() {
  return (
    <LegalPage
      current="/support"
      title="Support"
      intro={<p>Find answers to common problems below. If your problem is not here, email <ContactLink />.</p>}
    >
      <LegalSection id="contact" title="Contact us">
        <p>Email <ContactLink />. Include the following information, so that we can help you faster:</p>
        <ul>
          <li>the email address of your account, if you have one;</li>
          <li>the course and the paper, or the link to the page;</li>
          <li>what you did, what you expected, and what happened.</li>
        </ul>
        <p>Do not send passwords or photos of your answers by email.</p>
        <p><a href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent("Revise with the Past support")}`} className="inline-flex min-h-11 items-center rounded-md bg-accent px-4 text-base font-semibold text-white no-underline hover:bg-accent-deep">Email support</a></p>
      </LegalSection>

      <LegalSection id="building" title="Building a paper">
        <ul>
          <li><strong>The paper takes a long time.</strong> You can leave the page while the paper builds. To return, open the builder and select <strong>Continue recent paper</strong>, or use the link of the paper page. We keep each build for 24 hours.</li>
          <li><strong>A course or topic is not in the list.</strong> The <Link href="/#subjects" className={linkClass}>course list</Link> shows every course that is available now.</li>
          <li><strong>A question or mark scheme looks wrong.</strong> Email us the course, the paper and the question number.</li>
        </ul>
      </LegalSection>

      <LegalSection id="uploading" title="Uploading your answers">
        <ul>
          <li>Upload JPG, PNG, WebP or GIF images. Each image must be smaller than 10 MB. You can choose up to 40 images at a time.</li>
          <li>For each image, choose the questions that it shows. One image can show more than one question, and one question can use more than one image.</li>
          <li>If one upload fails, select <strong>Retry upload</strong> for that image. The other images stay uploaded.</li>
          <li>To upload a scanned PDF of a full paper, open <strong>More tools</strong> on the paper and select <strong>Import a scanned PDF</strong>.</li>
        </ul>
      </LegalSection>

      <LegalSection id="marking" title="Checking marks">
        <ul>
          <li>An <strong>AI suggestion</strong> is not a confirmed mark. Compare it with the mark scheme, change it if necessary, then select <strong>Confirm mark</strong>.</li>
          <li>If the text that we read from your handwriting is wrong, take a clearer photo and upload it again. Good light and a flat page help.</li>
          <li>If the page says that the mark changed somewhere else, the mark was changed in another tab or by a new AI suggestion. Choose the mark that you want to keep.</li>
        </ul>
      </LegalSection>

      <LegalSection id="account" title="Your account and data">
        <ul>
          <li>To delete your account and your data, email <ContactLink /> from the email address on your account.</li>
          <li>The <Link href="/privacy" className={linkClass}>privacy policy</Link> explains what we keep. The <Link href="/terms" className={linkClass}>terms of use</Link> explain the rules for the service.</li>
        </ul>
      </LegalSection>
    </LegalPage>
  );
}
