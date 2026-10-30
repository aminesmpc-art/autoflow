import { Fragment } from "react";
import Link from "next/link";
import AdUnit from "../../components/AdUnit";
import { PRODUCTS, RELEASES } from "./releases";
import "./changelog.css";

const SITE = "https://www.auto-flow.studio";

const formatDate = (iso) =>
  new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

/* The switcher between the three extensions' changelogs, and the hub. */
export function ChangelogNav({ current }) {
  return (
    <nav className="changelog-nav" aria-label="Changelogs">
      {Object.values(PRODUCTS).map((p) => (
        <Link
          key={p.key}
          href={p.changelog}
          className={`changelog-nav-item${p.key === current ? " is-current" : ""}`}
          aria-current={p.key === current ? "page" : undefined}
        >
          {p.short}
        </Link>
      ))}
    </nav>
  );
}

/* One extension's changelog page: /queue/changelog and the rest. */
export default function Changelog({ product }) {
  const p = PRODUCTS[product];
  const releases = RELEASES[product];

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: [
              { "@type": "ListItem", position: 1, name: "Home", item: SITE },
              { "@type": "ListItem", position: 2, name: p.name, item: `${SITE}${p.href}` },
              { "@type": "ListItem", position: 3, name: "Changelog", item: `${SITE}${p.changelog}` },
            ],
          }),
        }}
      />

      <section className="faq-hero changelog-hero">
        <div className="container">
          <div className="badge">Changelog</div>
          <h1>
            What&apos;s new in{" "}
            <span className="text-gradient">{p.name}</span>
          </h1>
          <p>
            Every {p.name} release, newest first. You&apos;re up to date with{" "}
            <strong>v{releases[0].version}</strong>.
          </p>
          <ChangelogNav current={product} />
        </div>
      </section>

      <section className="section changelog-section">
        <div className="container changelog-list">
          {releases.map((release, i) => (
            <Fragment key={release.version}>
              {i === 1 && <AdUnit kind="display" />}
              <article className="changelog-release" id={`v${release.version}`}>
                <div className="changelog-meta">
                  <a href={`#v${release.version}`} className={`changelog-version${i === 0 ? " is-latest" : ""}`}>
                    v{release.version}
                  </a>
                  <time dateTime={release.date}>{formatDate(release.date)}</time>
                  {i === 0 && <span className="changelog-latest">Latest</span>}
                </div>
                <h2>{release.title}</h2>

                <h3 className="changelog-group">What&apos;s new</h3>
                <ul>
                  {release.highlights.map((h, j) => (
                    <li key={j}>{h}</li>
                  ))}
                </ul>

                {release.improvements && (
                  <>
                    <h3 className="changelog-group is-quiet">Improvements &amp; fixes</h3>
                    <ul className="is-quiet">
                      {release.improvements.map((imp, j) => (
                        <li key={j}>{imp}</li>
                      ))}
                    </ul>
                  </>
                )}
              </article>
            </Fragment>
          ))}

          <p className="changelog-back">
            <Link href={p.href}>← Back to {p.name}</Link>
          </p>
        </div>
      </section>
    </>
  );
}

/* A small "v9.2 · What's new" link for a product page's hero. */
export function WhatsNew({ product, className = "" }) {
  const p = PRODUCTS[product];
  const r = RELEASES[product][0];
  return (
    <Link href={p.changelog} className={`whats-new ${className}`.trim()}>
      <span className="whats-new-version">v{r.version}</span>
      <span>What&apos;s new: {r.title}</span>
      <span aria-hidden="true">→</span>
    </Link>
  );
}
