import StoreLink from "../StoreLink";

export const dynamic = 'force-static';

export const metadata = {
  title: "Pricing — AutoFlow Free & Pro Plans",
  description:
    "AutoFlow pricing. Free gives you 10 Studio workflow runs a month and 50 daily prompts; Pro ($9.99/mo) is unlimited across the node workflow builder and Google Flow automation.",
  alternates: {
    canonical: "https://www.auto-flow.studio/pricing",
  },
  openGraph: {
    title: "AutoFlow Pricing — Free & Pro Plans",
    description: "One subscription for both: AutoFlow Studio's node workflow builder and AutoFlow's Google Flow automation. Start free, upgrade for unlimited.",
    url: "https://www.auto-flow.studio/pricing",
  },
};

export default function PricingPage() {
  return (
    <>
      <section className="pricing-hero">
        <div className="container">
          <div className="badge">Pricing</div>
          <h1>Simple, Transparent <span className="text-gradient">Pricing</span></h1>
          {/* Says up front that one price covers two products. Somebody
              arriving from Studio's upgrade button used to land on a page
              that described the Flow extension and never mentioned the thing
              they had just run out of. */}
          <p>One subscription, both tools — the Studio workflow builder and Flow automation. Start free, upgrade when you outgrow it.</p>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="pricing-grid">
            {/* Free Tier */}
            <div className="pricing-card">
              <div className="pricing-name">Free</div>
              <div className="pricing-price">$0 <span>/ forever</span></div>
              <div className="pricing-desc">Enough to build something real and watch it run.</div>
              {/* Real numbers rather than "daily limit". They are the ones
                  the products actually enforce — FREE_STUDIO_MONTHLY_LIMIT,
                  FREE_TEXT_DAILY_LIMIT and FREE_FULL_DAILY_LIMIT — so anyone
                  comparing the page with the app finds them the same. */}
              <ul className="pricing-features">
                <li className="pricing-group">Studio — visual workflow builder</li>
                <li>10 workflow runs a month</li>
                <li>Workflows of any size, no node limit</li>
                <li>Describe an idea, the AI builds the workflow</li>
                <li>Story director writes every shot in one pass</li>
                <li>Clips chained on the last frame</li>
                <li className="pricing-group">AutoFlow — Google Flow automation</li>
                <li>50 text prompts a day</li>
                <li>20 full-feature prompts a day</li>
                <li>Text-to-Video and Image-to-Video</li>
                <li>Smart queue management</li>
                <li>Auto-download results</li>
              </ul>
              <StoreLink className="btn btn-secondary">
                Install Free
              </StoreLink>
            </div>

            {/* Pro Tier */}
            <div className="pricing-card featured">
              <div className="pricing-name">Pro</div>
              <div className="pricing-price">$9.99 <span>/ month</span></div>
              <div className="pricing-desc">Unlimited on both. For anyone shipping regularly.</div>
              <ul className="pricing-features">
                <li>Everything in Free, without the counters</li>
                <li className="pricing-group">Studio — visual workflow builder</li>
                <li>Unlimited workflow runs</li>
                <li>Every template in the library, including Pro-only</li>
                <li>Voice casting across chained clips</li>
                <li className="pricing-group">AutoFlow — Google Flow automation</li>
                <li>Unlimited text and full-feature prompts</li>
                <li>Priority generation queue</li>
                <li>Bulk upscale &amp; download</li>
                <li>Character image library</li>
                <li>Frame chain mode</li>
                <li className="pricing-group">Both</li>
                <li>Priority support</li>
              </ul>
              {/*
                Goes to our own checkout, not straight to Whop: Whop's hosted
                page leaves the email editable, and an address that isn't the
                buyer's AutoFlow one leaves the payment unmatchable. Visitors
                with no session land on the sign-in prompt, which is the point
                — an account has to exist for the webhook to attach to.
              */}
              <a href="/checkout" className="btn btn-primary">
                Upgrade to Pro
              </a>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
