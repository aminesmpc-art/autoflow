import StoreLink from "../StoreLink";
import MotionVideo from "./MotionVideo";
import FaqAccordion from "../FaqAccordion";
import { MOTION_STORE_URL } from "../products";
import "./motion.css";

const DESCRIPTION =
  "Give any video's motion to your own character. AutoFlow Motion cuts your video, writes a prompt for every piece and generates each one in Google Flow. Free: 3 jobs a day. Pro: unlimited.";

export const metadata = {
  title: "AutoFlow Motion — Motion Control for Google Flow",
  description: DESCRIPTION,
  alternates: {
    canonical: "https://www.auto-flow.studio/motion",
  },
  openGraph: {
    title: "AutoFlow Motion — Motion Control for Google Flow",
    description: DESCRIPTION,
    url: "https://www.auto-flow.studio/motion",
    images: [
      {
        url: "/screenshots/motion/og-motion.jpg",
        width: 1280,
        height: 800,
        alt: "AutoFlow Motion side panel: choose what changes in your video",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "AutoFlow Motion — Motion Control for Google Flow",
    description: DESCRIPTION,
    images: ["/screenshots/motion/og-motion.jpg"],
  },
};

const MODES = [
  {
    icon: "🕺",
    title: "Transfer motion",
    text: "Keep the movement, timing and camera of your video, and give it to a new character from your own image.",
  },
  {
    icon: "🎭",
    title: "Replace the subject",
    text: "Swap the person or object while the motion and the dialogue stay as they are.",
  },
  {
    icon: "🎨",
    title: "Restyle the video",
    text: "Keep the movement and change the whole look: material, style or medium.",
  },
  {
    icon: "📍",
    title: "Change the place",
    text: "Add a setting image, and every piece is placed in that same setting.",
  },
];

const STEPS = [
  {
    title: "Add your motion video",
    text: "MP4, MOV or WebM, up to 500 MB. Optionally add a subject image and a place image.",
  },
  {
    title: "Choose what changes",
    text: "Transfer the motion, replace the subject or restyle the video, and pick Gemini, ChatGPT or Claude to watch your video and write the prompts.",
  },
  {
    title: "Press Generate",
    text: "Longer videos are cut into pieces of up to 10 seconds. Each piece gets its own prompt and is generated in your Google Flow project.",
  },
  {
    title: "Review and retry",
    text: "Edit any prompt and retry only the pieces you want. Finished steps are kept.",
  },
];

const RUN_FEATURES = [
  {
    title: "Every movement kept",
    text: "Prompts ask the model to keep each movement in the same order and at the same timing as your video.",
  },
  {
    title: "One subject, one place",
    text: "Prompts ask the model to keep the subject and the setting the same across every piece.",
  },
  {
    title: "Slow uploads don't hold you up",
    text: "Pieces Flow is still processing wait their turn: the ready ones are generated first, and the rest as soon as Flow is done.",
  },
  {
    title: "Knows when Flow says no",
    text: "When Flow refuses a piece, the panel shows Flow's reason, so you can change that piece and retry just that one.",
  },
  {
    title: "Source audio off in one click",
    text: "Remove the original audio for videos where speech causes problems.",
  },
  {
    title: "Saved on your computer",
    text: "Projects stay in your browser, so you can come back later to retry or regenerate.",
  },
];

const MOTION_FAQ = [
  {
    q: "What do I need to use AutoFlow Motion?",
    a: "Chrome, a free AutoFlow account (you can sign up inside the extension), your own Google Flow account with generation credits, and an account with Gemini, ChatGPT or Claude. Generations use your own accounts and credits.",
  },
  {
    q: "How long can my video be?",
    a: "Any length up to 500 MB, in MP4, MOV or WebM. Longer videos are cut into pieces of up to 10 seconds, and each piece is generated on its own in your Google Flow project.",
  },
  {
    q: "What counts as one Motion job?",
    a: "One press of Generate. All the pieces of that video count together as one job, and retrying a job never uses another one. Free accounts get 3 jobs a day, reset at midnight UTC; AutoFlow Pro is unlimited.",
  },
  {
    q: "Can I fix a single piece without starting over?",
    a: "Yes. Edit that piece's prompt and retry only the pieces you want; finished pieces are kept. If Google Flow refuses a piece, the panel shows Flow's reason.",
  },
  {
    q: "Is my video uploaded to AutoFlow?",
    a: "No. Your video, images and prompts go only to Google Flow and the AI assistant you choose, from your own browser. AutoFlow's server only sees your account email and your job records, to check your plan.",
  },
  {
    q: "Why does Chrome say the extension started debugging this browser?",
    a: "When automatic uploads are on, Motion uses Chrome's debugger permission to choose your video file in Google Flow's file picker, which an extension cannot fill in otherwise. It detaches as soon as the upload is done, and it is never attached to any other tab.",
  },
];

export default function MotionPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "SoftwareApplication",
            name: "AutoFlow Motion",
            applicationCategory: "MultimediaApplication",
            applicationSubCategory: "AI video motion transfer",
            operatingSystem: "Chrome",
            browserRequirements: "Google Chrome 116+",
            offers: [
              {
                "@type": "Offer",
                price: "0",
                priceCurrency: "USD",
                name: "Free",
                description: "3 Motion jobs a day",
              },
              {
                "@type": "Offer",
                price: "9.99",
                priceCurrency: "USD",
                name: "AutoFlow Pro",
                description: "Unlimited Motion jobs",
              },
            ],
            description: DESCRIPTION,
            url: "https://www.auto-flow.studio/motion",
            screenshot: "https://www.auto-flow.studio/screenshots/motion/og-motion.jpg",
          }),
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: [
              { "@type": "ListItem", position: 1, name: "Home", item: "https://www.auto-flow.studio" },
              { "@type": "ListItem", position: 2, name: "AutoFlow Motion", item: "https://www.auto-flow.studio/motion" },
            ],
          }),
        }}
      />

      {/* ── HERO ── */}
      <section className="motion-hero">
        <div className="motion-hero-glow" aria-hidden="true" />
        <div className="container motion-hero-grid">
          <div>
            <div className="motion-badge animate-in">
              <span aria-hidden="true">✨</span> New · Motion control for Google Flow
            </div>
            <h1 className="animate-in delay-1">
              Give any video&apos;s motion to{" "}
              <span className="text-gradient">your own character</span>
            </h1>
            <p className="motion-lead animate-in delay-2">
              AutoFlow Motion is a Chrome side panel that turns the movement of
              one video into new clips in Google Flow — with a different person,
              a different look or a different place. It cuts your video, writes
              a prompt for every piece and generates each one beside your
              project.
            </p>
            <div className="motion-ctas animate-in delay-3">
              <InstallMotion>Add to Chrome — Free</InstallMotion>
              <a href="#how-it-works" className="btn btn-secondary btn-lg">
                See how it works ↓
              </a>
            </div>
            <p className="motion-plan-note animate-in delay-3">
              <strong>Free:</strong> 3 Motion jobs a day ·{" "}
              <strong>AutoFlow Pro:</strong> unlimited
            </p>
          </div>

          <div className="motion-panel-frame animate-in delay-4">
            <img
              src="/screenshots/motion/panel-inputs.webp"
              alt="The AutoFlow Motion side panel with a 13-second motion video and a character image added, split into 2 pieces"
              width={434}
              height={716}
            />
          </div>
        </div>
      </section>

      {/* ── SEE IT WORKING ── */}
      <section className="section" id="see-it-working">
        <div className="container">
          <div className="section-header">
            <div className="badge">See it working</div>
            <h2>
              Finished clips,<br />
              <span className="text-gradient">right beside your Flow project</span>
            </h2>
            <p>
              A real run: one motion video and one character image became two
              clips. Each piece lands in your Flow project and plays in the panel.
            </p>
          </div>
          <MotionVideo id="UBslbd9kkT4" title="TikTok Shop in 7 Days or Less? Free AI Videos Without Higgsfield" />
          <figure className="motion-shot">
            <img
              src="/screenshots/motion/working-results.webp"
              alt="Google Flow with the AutoFlow Motion panel open: two finished clips of the character in your Flow project, and piece 1 playing in Your results"
              width={1120}
              height={534}
              loading="lazy"
            />
            <figcaption>Your results: every piece marked Complete, ready to play, regenerate or download.</figcaption>
          </figure>
          <figure className="motion-shot">
            <img
              src="/screenshots/motion/working-flow.webp"
              alt="The motion video and the character image in the AutoFlow Motion panel, next to the clips Motion made in Google Flow"
              width={1120}
              height={534}
              loading="lazy"
            />
            <figcaption>The motion video and the character you added, next to the clips Motion made from them.</figcaption>
          </figure>
        </div>
      </section>

      {/* ── WHAT YOU CAN DO ── */}
      <section className="section motion-band">
        <div className="container">
          <div className="section-header">
            <div className="badge">What you can do</div>
            <h2>
              Same movement.<br />
              <span className="text-gradient">Anything else can change.</span>
            </h2>
            <p>
              Choose what stays and what changes. Motion keeps the movement of
              your video and writes every prompt for you.
            </p>
          </div>
          <div className="motion-modes">
            {MODES.map((mode) => (
              <div className="motion-card" key={mode.title}>
                <div className="motion-card-icon" aria-hidden="true">{mode.icon}</div>
                <h3>{mode.title}</h3>
                <p>{mode.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section className="section" id="how-it-works">
        <div className="container motion-how">
          <div>
            <div className="badge">How it works</div>
            <h2 className="motion-how-title">
              Four steps,<br />
              <span className="text-gradient">right beside Flow</span>
            </h2>
            <ol className="motion-steps">
              {STEPS.map((step, index) => (
                <li className="motion-step" key={step.title}>
                  <span className="motion-step-num" aria-hidden="true">{index + 1}</span>
                  <div>
                    <h3>{step.title}</h3>
                    <p>{step.text}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
          <div className="motion-panel-frame motion-panel-frame--wide">
            <img
              src="/screenshots/motion/panel-choose.webp"
              alt="Choosing what changes in AutoFlow Motion: transfer motion, replace subject or restyle video"
              width={428}
              height={716}
              loading="lazy"
            />
          </div>
        </div>
      </section>

      {/* ── BUILT FOR REAL RUNS ── */}
      <section className="section motion-band">
        <div className="container">
          <div className="section-header">
            <div className="badge">Built for real runs</div>
            <h2>
              Made for long videos<br />
              <span className="text-gradient">and real Flow projects</span>
            </h2>
          </div>
          <div className="motion-features">
            {RUN_FEATURES.map((feature) => (
              <div className="motion-feature" key={feature.title}>
                <h3>{feature.title}</h3>
                <p>{feature.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── PLANS ── */}
      <section className="section" id="plans">
        <div className="container">
          <div className="section-header">
            <div className="badge">Plans</div>
            <h2>
              Start free.<br />
              <span className="text-gradient">Go unlimited with Pro.</span>
            </h2>
          </div>
          <div className="motion-plans">
            <div className="motion-plan">
              <div className="motion-plan-name">Free account</div>
              <div className="motion-plan-price">
                $0 <span>/ forever</span>
              </div>
              <div className="motion-plan-headline">3 Motion jobs a day</div>
              <ul>
                <li>Resets at midnight UTC</li>
                <li>Transfer, replace and restyle: every mode included</li>
                <li>Sign up for free inside the extension</li>
              </ul>
            </div>
            <div className="motion-plan motion-plan--pro">
              <div className="motion-plan-name">AutoFlow Pro</div>
              <div className="motion-plan-price">
                $9.99 <span>/ month</span>
              </div>
              <div className="motion-plan-headline">Unlimited Motion jobs</div>
              <ul>
                <li>Every Motion mode, as often as you like</li>
                <li>Plus everything else in Pro: unlimited Studio runs and prompt automation</li>
                <li>One subscription across AutoFlow&apos;s tools</li>
              </ul>
              <a href="/pricing" className="btn btn-primary">
                Get AutoFlow Pro →
              </a>
            </div>
          </div>
          <p className="motion-plan-fineprint">
            One job is one press of Generate: all pieces of that video count
            together, and retrying a job never uses another one. Accepted jobs
            are not refunded automatically if a provider fails.
          </p>
        </div>
      </section>

      {/* ── WHAT YOU NEED + PRIVACY ── */}
      <section className="section motion-band">
        <div className="container motion-two">
          <div className="motion-info-card">
            <h2>What you need</h2>
            <ul>
              <li>An AutoFlow account — you can sign up for free inside the extension.</li>
              <li>Your own Google Flow account with generation credits.</li>
              <li>An account with Gemini, ChatGPT or Claude.</li>
              <li>Chrome, with the Motion panel open while a job runs.</li>
            </ul>
            <p className="motion-info-note">
              Generations use your own accounts and credits.
            </p>
          </div>
          <div className="motion-info-card">
            <h2>Privacy and permissions</h2>
            <ul>
              <li>
                Your videos, images and prompts go only to the services you
                choose: Google Flow and your AI assistant. AutoFlow&apos;s server
                receives your account email and your job records, to check your
                plan. Nothing is sold or used for advertising.
              </li>
              <li>
                Automated uploads to Flow need your consent in the panel. While
                one runs, Chrome shows a &quot;started debugging this
                browser&quot; banner: the extension is choosing your file in
                Flow, and it detaches when done.
              </li>
              <li>Only upload content you have the rights to use.</li>
            </ul>
            <a href="/privacy#motion" className="motion-link">
              Read the privacy policy →
            </a>
          </div>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section className="section" id="faq">
        <div className="container">
          <div className="section-header">
            <div className="badge">FAQ</div>
            <h2>
              Questions about<br />
              <span className="text-gradient">AutoFlow Motion</span>
            </h2>
          </div>
          <FaqAccordion items={MOTION_FAQ} />
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="section cta-section">
        <div className="container">
          <div className="cta-card">
            <div className="cta-glow" aria-hidden="true" />
            <h2>Make your first motion clip</h2>
            <p className="text-secondary">
              Three Motion jobs a day are free with an AutoFlow account. Pro
              makes them unlimited.
            </p>
            <div className="motion-ctas motion-ctas--center">
              <InstallMotion>Add AutoFlow Motion to Chrome</InstallMotion>
              <a href="/pricing" className="btn btn-secondary btn-lg">
                View pricing
              </a>
            </div>
          </div>
        </div>
      </section>

      <p className="motion-disclaimer">
        AutoFlow Motion is an independent product and is not affiliated with or
        endorsed by Google, OpenAI or Anthropic. Provider websites can change,
        generations can fail, and results are not guaranteed.
      </p>
    </>
  );
}

function InstallMotion({ children }) {
  if (!MOTION_STORE_URL) {
    return (
      <span className="motion-soon">
        <ChromeIcon /> Coming soon to the Chrome Web Store
      </span>
    );
  }
  return (
    <StoreLink product="motion" href={MOTION_STORE_URL} className="btn btn-primary btn-lg">
      <ChromeIcon /> {children}
    </StoreLink>
  );
}

function ChromeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="2" />
      <line x1="12" y1="2" x2="12" y2="8" stroke="currentColor" strokeWidth="2" />
      <line x1="3.5" y1="17" x2="8.5" y2="14" stroke="currentColor" strokeWidth="2" />
      <line x1="20.5" y1="17" x2="15.5" y2="14" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}
