import PrivacyPolicy, { PRIVACY_UPDATED } from "./PrivacyPolicy";

export const dynamic = 'force-static';

export const metadata = {
  title: "Privacy Policy",
  description:
    "AutoFlow privacy policy for AutoFlow Studio and AutoFlow Motion. Learn what data we collect, how we handle it, where it is stored, and your rights.",
  alternates: {
    canonical: "https://www.auto-flow.studio/privacy",
  },
  openGraph: {
    title: "Privacy Policy — AutoFlow",
    description:
      "AutoFlow privacy policy for AutoFlow Studio and AutoFlow Motion. Details on data collection, handling, storage, sharing, and user rights.",
    url: "https://www.auto-flow.studio/privacy",
  },
};

export default function PrivacyPage() {
  return (
    <>
      <section className="legal-hero">
        <div className="container">
          <h1>Privacy Policy</h1>
          <p className="text-secondary">Last updated: {PRIVACY_UPDATED}</p>
        </div>
      </section>

      <section className="section">
        <div className="container legal-content">
          <PrivacyPolicy />
        </div>
      </section>
    </>
  );
}
