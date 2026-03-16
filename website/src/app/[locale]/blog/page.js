import Link from 'next/link';
import { getDictionary, locales, defaultLocale } from '../../dictionaries';
import { getAllPosts } from '../../blog/content';

export async function generateStaticParams() {
  return locales.filter(l => l !== defaultLocale).map(locale => ({ locale }));
}

export async function generateMetadata({ params }) {
  const { locale } = await params;
  const t = getDictionary(locale);
  return {
    title: t.blog.title + ' ' + t.blog.titleGradient + ' — AutoFlow',
    description: t.blog.subtitle,
    alternates: {
      canonical: `https://auto-flow.studio/${locale}/blog`,
    },
  };
}

export default async function LocaleBlogPage({ params }) {
  const { locale } = await params;
  const t = getDictionary(locale);
  const posts = getAllPosts();

  return (
    <>
      <section className="blog-hero">
        <div className="container">
          <div className="badge">{t.blog.badge}</div>
          <h1>
            {t.blog.title}{" "}
            <span className="text-gradient">{t.blog.titleGradient}</span>
          </h1>
          <p>{t.blog.subtitle}</p>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="blog-grid">
            {posts.map((post) => (
              <Link
                key={post.slug}
                href={`/blog/${post.slug}`}
                className="blog-card"
              >
                {post.image && (
                  <div className="blog-card-image">
                    <img src={post.image} alt={post.title} />
                  </div>
                )}
                <div className="blog-card-body">
                  <div className="blog-card-meta">
                    <span className="blog-card-category">{post.category}</span>
                    <span>{post.readTime} {t.blog.minRead}</span>
                  </div>
                  <h3>{post.title}</h3>
                  <p>{post.excerpt}</p>
                  <span className="blog-card-link">{t.blog.readMore}</span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
