


export const metadata = {
  title: "Pricing",
  description:
    "AutoFlow pricing plans. Free tier with daily limits or Pro for unlimited AI video generation with Google Flow.",
};

export default function PricingPage() {
  return (
    <>
      <section className="pricing-hero">
        <div className="container">
          <div className="badge">Pricing</div>
          <h1>Simple, Transparent <span className="text-gradient">Pricing</span></h1>
          <p>Start free. Upgrade when you need unlimited power.</p>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="pricing-grid">
            {/* Free Tier */}
            <div className="pricing-card">
              <div className="pricing-name">Free</div>
              <div className="pricing-price">$0 <span>/ forever</span></div>
              <div className="pricing-desc">Perfect for getting started and light usage.</div>
              <ul className="pricing-features">
                <li>Text-to-Video generation</li>
                <li>Image-to-Video generation</li>
                <li>Daily text prompt limit</li>
                <li>Daily full-feature prompt limit</li>
                <li>Smart queue management</li>
                <li>Auto-download results</li>
                <li>Batch prompt processing</li>
              </ul>
              <a
                href="https://chromewebstore.google.com"
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-secondary"
              >
                Install Free
              </a>
            </div>

            {/* Pro Tier */}
            <div className="pricing-card featured">
              <div className="pricing-name">Pro</div>
              <div className="pricing-price">$9.99 <span>/ month</span></div>
              <div className="pricing-desc">Unlimited everything. For serious creators.</div>
              <ul className="pricing-features">
                <li>Everything in Free</li>
                <li>Unlimited text prompts</li>
                <li>Unlimited full-feature prompts</li>
                <li>Priority generation queue</li>
                <li>Bulk upscale & download</li>
                <li>Character image library</li>
                <li>Frame chain mode</li>
                <li>Priority support</li>
              </ul>
              <a
                href="https://whop.com/checkout/plan_fxMVMOmbFPcp4"
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-primary"
              >
                Upgrade to Pro
              </a>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
