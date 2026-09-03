import PricingCalculator from "../PricingCalculator";

export const dynamic = 'force-static';

export const metadata = {
  title: "Pricing — AutoFlow Free & Pro Plans",
  description:
    "AutoFlow pricing. Free gives you 10 Studio workflow runs a month, 3 video extractions daily, and 50 daily prompts; Pro ($9.99/mo) is unlimited across the node workflow builder and Google Flow automation.",
  alternates: {
    canonical: "https://www.auto-flow.studio/pricing",
  },
  openGraph: {
    title: "AutoFlow Pricing — Free & Pro Plans",
    description: "One subscription for all three: AutoFlow Studio canvas, AI Video Prompt Extractor, and Google Flow batch automation. Start free, upgrade for unlimited.",
    url: "https://www.auto-flow.studio/pricing",
  },
};

export default function PricingPage() {
  return (
    <>
      <section className="pricing-hero" style={{ paddingTop: "160px", paddingBottom: "60px", textAlign: "center" }}>
        <div className="container">
          <div className="badge" style={{ marginBottom: "20px" }}>Transparent Pricing</div>
          <h1 style={{ fontSize: "2.8rem", marginBottom: "16px" }}>
            Three Flagship Tools.<br /><span className="text-gradient">One Unified Subscription.</span>
          </h1>
          <p style={{ maxWidth: "680px", margin: "0 auto", fontSize: "1.15rem", color: "var(--text-secondary)" }}>
            Unlock AutoFlow Studio (Visual Node Canvas), AI Video Prompt Extractor, and the Google Flow Queue Manager. Start free, scale when ready.
          </p>
        </div>
      </section>

      <section className="section" style={{ paddingTop: "20px", paddingBottom: "120px" }}>
        <div className="container">
          <PricingCalculator />
        </div>
      </section>
    </>
  );
}
