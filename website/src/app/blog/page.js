import Link from "next/link";
import { getAllPosts, getCategories, SITE_URL } from "./content";

export const dynamic = 'force-static';

export const metadata = {
  title: "Blog — AI Video Generation Tips & Tutorials | AutoFlow",
  description:
    "Tips, tutorials, and guides for AI video generation with Google Flow and AutoFlow. Learn how to batch process prompts, write better prompts, optimize workflows, and create stunning AI videos.",
  alternates: {
    canonical: `${SITE_URL}/blog`,
  },
  openGraph: {
    title: "AutoFlow Blog — AI Video Generation Tips & Tutorials",
    description:
      "Learn how to batch generate AI videos, write better prompts, and automate your Google Flow workflow.",
    url: `${SITE_URL}/blog`,
  },
};

export default function BlogPage() {
  const posts = getAllPosts();
  const categories = getCategories();

  return (
    <>
      {/* ── Blog CollectionPage Schema ── */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "CollectionPage",
            name: "AutoFlow Blog",
            description: metadata.description,
            url: `${SITE_URL}/blog`,
            mainEntity: {
              "@type": "ItemList",
              itemListElement: posts.map((post, i) => ({
                "@type": "ListItem",
                position: i + 1,
                url: `${SITE_URL}/blog/${post.slug}`,
                name: post.title,
              })),
            },
          }),
        }}
      />

      {/* ── BreadcrumbList ── */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: [
              { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
              { "@type": "ListItem", position: 2, name: "Blog", item: `${SITE_URL}/blog` },
            ],
          }),
        }}
      />

      <section className="faq-hero">
        <div className="container">
          <div className="badge">Blog</div>
          <h1>
            AutoFlow <span className="text-gradient">Blog</span>
          </h1>
          <p>
            Tips, tutorials, and guides for AI video generation with Google Flow.
          </p>
        </div>
      </section>

      <section className="section">
        <div className="container">
          {/* Category Filter */}
          <div className="blog-categories">
            <span className="blog-category-tag active">All</span>
            {categories.map((cat) => (
              <span key={cat} className="blog-category-tag">{cat}</span>
            ))}
          </div>

          <div className="blog-grid">
            {posts.map((post) => (
              <Link
                key={post.slug}
                href={`/blog/${post.slug}`}
                className="blog-card"
              >
                {post.featured && <div className="blog-card-featured">★ Featured</div>}
                <div className="blog-card-category">{post.category}</div>
                <h2 className="blog-card-title">{post.title}</h2>
                <p className="blog-card-desc text-secondary">
                  {post.description}
                </p>
                <div className="blog-card-footer">
                  <div className="blog-card-meta">
                    <span>{new Date(post.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
                    <span>·</span>
                    <span>{post.readTime}</span>
                  </div>
                  <div className="blog-card-tags">
                    {post.tags.slice(0, 2).map((tag) => (
                      <span key={tag} className="blog-tag">#{tag}</span>
                    ))}
                  </div>
                </div>
              </Link>
            ))}
          </div>

          {/* SEO Internal Links */}
          <div className="blog-internal-links">
            <h3>Explore AutoFlow</h3>
            <div className="blog-links-grid">
              <Link href="/#features" className="blog-link-card">
                <span>⚡</span>
                <div>
                  <strong>Features</strong>
                  <p>See what AutoFlow can do</p>
                </div>
              </Link>
              <Link href="/pricing" className="blog-link-card">
                <span>💎</span>
                <div>
                  <strong>Pricing</strong>
                  <p>Free & Pro plans</p>
                </div>
              </Link>
              <Link href="/faq" className="blog-link-card">
                <span>❓</span>
                <div>
                  <strong>FAQ</strong>
                  <p>Common questions answered</p>
                </div>
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
