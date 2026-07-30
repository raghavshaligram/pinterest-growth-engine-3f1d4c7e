// Public, unauthenticated route -- same reasoning as privacy.tsx (no
// auth guard, no ssr:false, real server-rendered HTML).
import { createFileRoute } from "@tanstack/react-router";
import { LegalPageShell, LegalSection, LegalList, LegalEmail } from "@/components/LegalPageShell";

const LAST_UPDATED = "July 31, 2026";
const CONTACT_EMAIL = "support@pinspider.com";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Terms of Service — Pinspider" },
      { name: "description", content: "The terms that govern your use of Pinspider." },
    ],
  }),
  component: TermsPage,
});

function TermsPage() {
  return (
    <LegalPageShell
      title="Terms of Service"
      lastUpdated={LAST_UPDATED}
      intro={
        <p>
          These terms govern your use of Pinspider. By creating an account or connecting a Pinterest,
          Google, or other third-party account, you agree to them. Plain-English version: don't abuse the
          service, you're responsible for your own connected accounts and API costs, and we can't
          guarantee Pinterest's platform behaves the way we'd both like it to.
        </p>
      }
    >
      <LegalSection heading="1. What Pinspider is">
        <p>
          Pinspider is a Pinterest growth-automation tool. It crawls websites you add, generates pin
          images and copy from that content using AI providers you connect your own API keys to, and
          publishes or schedules those pins to Pinterest boards you've connected via OAuth. It's a tool
          you operate on top of your own Pinterest, Google, and AI-provider accounts — it isn't a
          Pinterest-affiliated product, and it doesn't act on your accounts beyond what you configure it
          to do.
        </p>
      </LegalSection>

      <LegalSection heading="2. Acceptable use">
        <p>You agree not to use Pinspider to:</p>
        <LegalList>
          <li>Publish content that violates Pinterest's own policies (see Section 3), including spam, misleading claims, or content promoting prohibited goods/services.</li>
          <li>Crawl or generate content for a website you don't have the right to represent or promote.</li>
          <li>Attempt to circumvent Pinterest's rate limits, API terms, or access controls.</li>
          <li>Use another person's Pinterest, Google, or provider credentials without their permission.</li>
          <li>Interfere with or attempt to disrupt Pinspider's infrastructure.</li>
        </LegalList>
        <p>We can suspend or terminate an account that violates these terms — see Section 8.</p>
      </LegalSection>

      <LegalSection heading="3. Your responsibility for Pinterest's own rules">
        <p>
          Connecting your Pinterest account to Pinspider doesn't change what Pinterest itself allows.
          You're responsible for making sure every pin published through Pinspider — including
          AI-generated images and AI-written copy — complies with Pinterest's{" "}
          <a href="https://policy.pinterest.com/en/community-guidelines" target="_blank" rel="noreferrer" className="text-primary hover:underline">
            Community Guidelines
          </a>{" "}
          and, if applicable to your account, its{" "}
          <a href="https://policy.pinterest.com/en/merchant-guidelines" target="_blank" rel="noreferrer" className="text-primary hover:underline">
            Merchant Guidelines
          </a>. Pinspider gives you the tools to review and edit every pin before it publishes; using
          those review steps is on you. Pinterest, not Pinspider, decides what stays up, what gets
          removed, and what happens to your Pinterest account standing.
        </p>
      </LegalSection>

      <LegalSection heading="4. Bring-your-own API keys and costs">
        <p>
          Image and copy generation runs on API keys you provide for third-party providers (OpenAI,
          Anthropic, Replicate, Fal, Google Gemini, Ideogram, Recraft, Stability AI) and, optionally,
          Apify for keyword research. Every request Pinspider makes with your key is billed by that
          provider directly to <em>your</em> account with them, at their own published rates. Pinspider
          doesn't mark up, resell, or take a cut of that usage, and we aren't responsible for a
          provider's pricing, rate limits, outages, or your own spend. Set your own budget alerts with
          each provider if that matters to you.
        </p>
      </LegalSection>

      <LegalSection heading="5. No guarantee of Pinterest API availability or account standing">
        <p>
          Pinspider depends entirely on Pinterest's own API being available, unchanged, and accessible to
          your connected account. We don't control Pinterest's uptime, rate limits, API changes, review
          decisions, or account enforcement actions (warnings, restrictions, or suspensions), and we make
          no guarantee about any of them. If Pinterest changes its API, revokes Pinspider's app access, or
          takes action on your account, we'll do what we reasonably can to adapt or inform you, but we
          can't promise a specific outcome or timeline.
        </p>
      </LegalSection>

      <LegalSection heading="6. Availability and changes to the service">
        <p>
          We aim to keep Pinspider running reliably but don't guarantee uninterrupted availability. We may
          modify, add, or remove features over time, including in response to changes on Pinterest's,
          Google's, or a generation provider's side that are outside our control.
        </p>
      </LegalSection>

      <LegalSection heading="7. Fees">
        <p>
          Pinspider does not currently offer a lifetime deal. If we introduce one in the future, its
          specific terms — price, what "lifetime" covers, any usage limits, and the refund window — will
          be stated on that offer's own page at the time and will govern that purchase. Any other fees for
          using Pinspider will be presented to you at signup or before an upgrade; continuing to use the
          service after a fee change takes effect means you accept it.
        </p>
      </LegalSection>

      <LegalSection heading="8. Termination">
        <p>
          You can stop using Pinspider and disconnect your accounts at any time; see Section 8 of the
          Privacy Policy for how to request full account deletion. We can suspend or terminate an account
          that violates Section 2 (Acceptable use), with notice where reasonably possible.
        </p>
      </LegalSection>

      <LegalSection heading="9. Limitation of liability">
        <p>
          Pinspider is provided "as is," without warranties of any kind, express or implied. To the
          maximum extent permitted by law, Pinspider and its operator are not liable for indirect,
          incidental, or consequential damages — including lost Pinterest traffic, lost revenue, or
          Pinterest account restrictions — arising from your use of the service. This doesn't limit any
          liability that can't be limited under applicable law.
        </p>
      </LegalSection>

      <LegalSection heading="10. Governing law">
        <p>
          These terms are governed by the laws of India, and any dispute arising from them is subject to
          the exclusive jurisdiction of the courts of India.
        </p>
      </LegalSection>

      <LegalSection heading="11. Changes to these terms">
        <p>
          We'll update the date at the top of this page if these terms materially change. Continued use
          of Pinspider after a change means you accept the updated terms.
        </p>
      </LegalSection>

      <LegalSection heading="12. Contact">
        <p>
          Questions about these terms: <LegalEmail address={CONTACT_EMAIL} />.
        </p>
      </LegalSection>
    </LegalPageShell>
  );
}
