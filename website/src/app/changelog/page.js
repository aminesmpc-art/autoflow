import Link from "next/link";
import AdUnit from "../../components/AdUnit";
import { ChangelogNav } from "./Changelog";
import { PRODUCTS, RELEASES } from "./releases";
import "./changelog.css";

export const dynamic = 'force-static';

export const metadata = {
  title: "Changelog — What's New in AutoFlow Queue, Studio & Motion",
  description:
    "Release notes for every AutoFlow extension: the Queue Manager, Studio and Motion. Latest features, improvements and fixes.",
  alternates: {
    canonical: "https://www.auto-flow.studio/changelog",
  },
};

const formatDate = (iso) =>
  new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

/* Each extension has its own changelog page; this one points at all three. */
export default function ChangelogPage() {
  return (
    <>
      {/* ── BreadcrumbList Schema ── */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: [
              {
                "@type": "ListItem",
                position: 1,
                name: "Home",
                item: "https://www.auto-flow.studio",
              },
              {
                "@type": "ListItem",
                position: 2,
                name: "Changelog",
                item: "https://www.auto-flow.studio/changelog",
              },
            ],
          }),
        }}
      />

      <section className="faq-hero changelog-hero">
        <div className="container">
          <div className="badge">Changelog</div>
          <h1>
            What&apos;s new in{" "}
            <span className="text-gradient">AutoFlow</span>
          </h1>
          <p>Each extension has its own release notes. Pick one to see every update.</p>
          <ChangelogNav />
        </div>
      </section>

      <section className="section changelog-section">
        <div className="container">
          <div className="changelog-hub">
            {Object.values(PRODUCTS).map((p) => {
              const releases = RELEASES[p.key];
              const r = releases[0];
              return (
                <Link key={p.key} href={p.changelog} className="changelog-card">
                  <div className="changelog-meta">
                    <span className="changelog-version is-latest">v{r.version}</span>
                    <time dateTime={r.date}>{formatDate(r.date)}</time>
                  </div>
                  <h2>{p.name}</h2>
                  <p>{p.blurb}</p>
                  <p>
                    Latest: <span className="changelog-card-latest">{r.title}</span>
                  </p>
                  <span className="changelog-card-link">
                    See all {releases.length} releases →
                  </span>
                </Link>
              );
            })}
          </div>

          <AdUnit kind="display" />
        </div>
      </section>
    </>
  );
}
