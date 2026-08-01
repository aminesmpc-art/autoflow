import CheckoutClient from "./CheckoutClient";

export const metadata = {
  title: "Upgrade to Pro",
  description: "Complete your AutoFlow Pro upgrade.",
  // A per-user checkout has nothing to index and shouldn't appear in search.
  robots: { index: false, follow: false },
};

export default function CheckoutPage() {
  return <CheckoutClient />;
}
