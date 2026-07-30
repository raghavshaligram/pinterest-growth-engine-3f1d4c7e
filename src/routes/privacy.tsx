// Public, unauthenticated route -- deliberately no beforeLoad auth guard
// (unlike every other top-level route in src/routes) and no ssr:false,
// so this renders as real server-rendered HTML reachable and fully
// readable with no session and no client-side JS required. Required
// for Pinterest API Standard access review (an inaccurate or
// inaccessible privacy policy is a documented denial reason) and kept
// in sync with what this codebase actually does -- see the comments
// throughout for the exact scopes/providers/behavior this reflects.
import { createFileRoute } from "@tanstack/react-router";
import { LegalPageShell, LegalSection, LegalList, LegalEmail } from "@/components/LegalPageShell";

const LAST_UPDATED = "July 31, 2026";
const CONTACT_EMAIL = "support@pinspider.com";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy — Pinspider" },
      { name: "description", content: "How Pinspider collects, uses, and protects your data, including Pinterest and Google account data." },
    ],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <LegalPageShell
      title="Privacy Policy"
      lastUpdated={LAST_UPDATED}
      intro={
        <p>
          Pinspider ("Pinspider," "we," "us") is a Pinterest growth-automation tool: it crawls websites
          you add, generates pin images and copy from that content, and publishes or schedules pins to
          Pinterest boards on your behalf. This page explains exactly what data we collect, why, and how
          you can get it deleted. It's written to be read, not skimmed past — if anything below is
          unclear, email <LegalEmail address={CONTACT_EMAIL} /> and we'll clarify or fix it.
        </p>
      }
    >
      <LegalSection heading="1. Your Pinterest data">
        <p>
          We connect to your Pinterest account exclusively through Pinterest's own OAuth 2.0 login flow.
          When you click "Connect Pinterest," you're redirected to Pinterest's website to sign in and
          approve access — Pinspider never sees, asks for, collects, or stores your Pinterest password,
          and we never touch your Pinterest session cookies. Pinterest hands us back an access token
          (and, for most connections, a refresh token), and that token is the only credential we ever
          hold for your account.
        </p>
        <p>
          That token is encrypted (AES-256-GCM) before it's written to our database and decrypted only at
          the moment we make an API call on your behalf. It is used solely to read the boards on your
          Pinterest account and to publish the pins you've explicitly scheduled inside Pinspider — never
          for anything else, and never on a schedule or trigger you didn't set up yourself.
        </p>
        <p>
          The token is permanently deleted the moment you disconnect that Pinterest account inside
          Pinspider, or when you delete your Pinspider account entirely. This is a real deletion, not a
          deactivation flag — the row is removed from our database.
        </p>
      </LegalSection>

      <LegalSection heading="2. Exact Pinterest OAuth scopes we request">
        <p>Pinspider requests four scopes when you connect a Pinterest account, and only these four:</p>
        <LegalList>
          <li><strong className="text-foreground">boards:read</strong> — lets us list the boards on your account so you can pick which board each pin publishes to.</li>
          <li><strong className="text-foreground">boards:write</strong> — reserved for a board-creation feature we don't currently expose. Today Pinspider only reads your existing boards; it does not create, rename, or delete boards on your Pinterest account.</li>
          <li><strong className="text-foreground">pins:write</strong> — the scope that actually does the work: it's what lets Pinspider publish a pin (image, title, description, destination link, and board) to your account when a scheduled pin is due, or when you click "Publish now."</li>
          <li><strong className="text-foreground">pins:read</strong> — requested alongside pins:write. Pinspider does not currently read back or display your existing Pinterest pins; this is reserved for a possible future feature (e.g. showing real Pinterest-reported performance for pins we published).</li>
        </LegalList>
        <p>
          We deliberately don't request any scope beyond these four (no messaging, no follower/audience
          data, no ad-account access).
        </p>
      </LegalSection>

      <LegalSection heading="3. Bring-your-own API keys (OpenAI, Replicate, and others)">
        <p>
          Pinspider doesn't run its own AI generation infrastructure — it uses API keys you provide
          ("bring your own key," or BYOK) for the providers you choose to connect: OpenAI, Anthropic,
          Replicate, Fal, Google Gemini, Ideogram, Recraft, Stability AI, and Apify (used for optional
          Pinterest search/keyword research).
        </p>
        <p>Every one of these keys is:</p>
        <LegalList>
          <li>Encrypted (AES-256-GCM) before storage, the same way Pinterest tokens are.</li>
          <li>Used exclusively to fulfill <em>your own</em> generation requests — your key never processes another user's request.</li>
          <li>Never pooled, shared, or reused across accounts under any circumstance.</li>
          <li>Never used for Pinspider's own purposes (we don't use your key for our internal testing, analytics, or anything outside serving your own account's requests).</li>
          <li>Deletable at any time from Settings → Integrations, which permanently removes the stored key.</li>
        </LegalList>
        <p>
          Because these are your own keys, usage is billed by that provider directly to your own account
          with them — see Section 5 of the Terms of Service for cost responsibility.
        </p>
      </LegalSection>

      <LegalSection heading="4. Website crawling">
        <p>
          Pinspider only crawls websites (domains and specific URLs) that you have explicitly added to
          your account. We fetch each site's sitemap and the individual pages listed in it, and extract
          page content and metadata (titles, headings, body text, images) — this is used only to generate
          pin copy and pin images for that page. We don't crawl or fetch anything you haven't added.
        </p>
        <p>
          Pinspider does not currently perform a domain-ownership verification step when you add a site —
          if you can reach a URL, you can add it. Don't add a website you don't have the right to
          represent or generate promotional content for.
        </p>
      </LegalSection>

      <LegalSection heading="5. Google Analytics data">
        <p>
          If you connect a Google account, we request exactly two OAuth scopes:
        </p>
        <LegalList>
          <li><strong className="text-foreground">analytics.readonly</strong> — read access to the GA4 properties you choose to map to your sites, used only to attribute pin performance (sessions/traffic arriving from the pins Pinspider published) on the Insights page.</li>
          <li><strong className="text-foreground">userinfo.email</strong> — read once, immediately after you connect, only to label the connection with the Google account's email address (e.g. "you@company.com") so you can tell multiple connected accounts apart. It is not stored beyond that label and is never used again.</li>
        </LegalList>
        <p>
          We only ever read analytics data for GA4 properties you yourself select and map to a site — we
          never request or receive data for properties you haven't explicitly connected.
        </p>
      </LegalSection>

      <LegalSection heading="6. What we collect about you — and what we don't">
        <p>We collect and store:</p>
        <LegalList>
          <li>Your account email address (used for login and any account-related communication).</li>
          <li>The site records you add (URLs, sitemap URLs, brand settings you configure).</li>
          <li>Pins and pin briefs Pinspider generates for you (titles, descriptions, hashtags, images, and the prompts used to generate them).</li>
          <li>Usage/operational logs (e.g. publish attempts and their outcomes, crawl history) needed to run the product and to help you (and us) debug a failed publish.</li>
          <li>Encrypted OAuth tokens and API keys, as described above.</li>
        </LegalList>
        <p>We do not collect:</p>
        <LegalList>
          <li>Passwords or session cookies for Pinterest, Google, or any third-party service you connect.</li>
          <li>Payment card details (we don't process payments directly inside Pinspider today).</li>
          <li>Any data from a website you haven't explicitly added, or from a Pinterest/Google account you haven't explicitly connected.</li>
          <li>Precise device location, browsing history outside Pinspider, or any data from Pinterest/Google beyond the specific scopes listed above.</li>
        </LegalList>
      </LegalSection>

      <LegalSection heading="7. Sub-processors — who else touches your data">
        <p>We use a small number of third-party services to run Pinspider. Here's exactly what each one receives:</p>
        <LegalList>
          <li><strong className="text-foreground">Supabase</strong> — our database, authentication, and file storage provider. Hosts your account record, encrypted tokens/keys, site and pin data, and generated pin images.</li>
          <li><strong className="text-foreground">Lovable</strong> (running on Cloudflare's infrastructure) — hosts the Pinspider application itself (the server that renders pages and runs scheduled publishing). Requests pass through this infrastructure in transit; it does not separately retain your data.</li>
          <li><strong className="text-foreground">Pinterest</strong> — receives the pin content (image, title, description, link, board) you schedule, at the moment of publishing, per the OAuth scopes in Section 2.</li>
          <li><strong className="text-foreground">Google</strong> — receives OAuth requests if you connect Google Analytics; returns the traffic data described in Section 5.</li>
          <li><strong className="text-foreground">OpenAI, Anthropic, Replicate, Fal, Ideogram, Recraft, Stability AI</strong> — receive generation prompts (built from your site's content) and your own API key, if you've connected that provider, solely to generate copy or images for you.</li>
          <li><strong className="text-foreground">Apify</strong> — if you connect it, receives your API token to run a Pinterest search-scraping actor for optional keyword research; results are stored in your account.</li>
        </LegalList>
      </LegalSection>

      <LegalSection heading="8. Retention and deletion">
        <p>
          We keep your account data for as long as your Pinspider account is active. Disconnecting a
          Pinterest, Google, or BYOK provider connection deletes that connection's stored credential
          immediately and permanently.
        </p>
        <p>
          To delete your account and all associated data (sites, pins, briefs, logs, and any connected
          credentials), email <LegalEmail address={CONTACT_EMAIL} /> from the address on your account. We
          don't currently have a self-service "delete my account" button in the product — this is a
          manual request we process directly — and we aim to complete deletion within 30 days of a
          verified request.
        </p>
      </LegalSection>

      <LegalSection heading="9. Security">
        <p>
          OAuth tokens and API keys are encrypted at rest (AES-256-GCM) at the application layer before
          they're written to the database, in addition to Supabase's own infrastructure-level encryption.
          Access to production data is limited to what's needed to operate the service.
        </p>
      </LegalSection>

      <LegalSection heading="10. Jurisdiction and your rights">
        <p>
          Pinspider is operated from India, and this policy is governed by Indian law. If you're located
          in the European Economic Area or UK, you have rights under the GDPR — including access,
          correction, deletion, and portability of your data — which you can exercise by emailing{" "}
          <LegalEmail address={CONTACT_EMAIL} />. If you're a California resident, you have similar rights
          under the CCPA, including the right to know what personal information we hold and to request its
          deletion. We don't sell personal information, to California residents or anyone else.
        </p>
      </LegalSection>

      <LegalSection heading="11. Changes to this policy">
        <p>
          If we materially change what we collect or how we use it, we'll update the date at the top of
          this page. Continued use of Pinspider after a change means you accept the updated policy.
        </p>
      </LegalSection>

      <LegalSection heading="12. Contact">
        <p>
          Questions, deletion requests, or anything unclear above: <LegalEmail address={CONTACT_EMAIL} />.
        </p>
      </LegalSection>
    </LegalPageShell>
  );
}
