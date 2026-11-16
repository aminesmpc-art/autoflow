import Link from "next/link";
import Image from "next/image";
import { SITE_URL, AUTHOR } from "./content";

/* The frame shared by the tutorial posts made from Ruby's videos: Article, FAQPage and HowTo data, the header, an
   optional YouTube player (or a hero image until the video is up), the contents list, the FAQ and related links. */

export const metadataFor = (post, height = 676) => ({
  title: post.title,
  description: post.description,
  alternates: { canonical: `${SITE_URL}/blog/${post.slug}` },
  openGraph: {
    title: post.title,
    description: post.description,
    type: "article",
    publishedTime: post.date,
    modifiedTime: post.updated,
    tags: post.tags,
    images: [{ url: `${SITE_URL}${post.image}`, width: 1200, height }],
  },
});

export const Shot = ({ src, alt, caption, width = 1200, height = 676 }) => (
  <div className="blog-img-wrap">
    <Image src={src} alt={alt} width={width} height={height} className="blog-img" />
    {caption && <p className="blog-img-caption">{caption}</p>}
  </div>
);

const Ld = ({ data }) => <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }} />;

export default function PostShell({ post, videoId = "", hero, toc, faq, howto, related = [], note, children }) {
  return (
    <>
      <Ld
        data={{
          "@context": "https://schema.org",
          "@type": "Article",
          headline: post.title,
          description: post.description,
          author: { "@type": "Person", name: AUTHOR.name, url: AUTHOR.url },
          publisher: { "@type": "Organization", name: "AutoFlow", logo: { "@type": "ImageObject", url: `${SITE_URL}/og-image.png` } },
          datePublished: post.date,
          dateModified: post.updated,
          mainEntityOfPage: `${SITE_URL}/blog/${post.slug}`,
          image: `${SITE_URL}${post.image}`,
          keywords: post.tags.join(", "),
        }}
      />
      <Ld
        data={{
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: faq.map(({ q, a }) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })),
        }}
      />
      {howto && (
        <Ld
          data={{
            "@context": "https://schema.org",
            "@type": "HowTo",
            name: howto.name,
            description: post.description,
            step: howto.steps.map(([name, text]) => ({ "@type": "HowToStep", name, text })),
          }}
        />
      )}

      <article className="blog-article">
        <div className="container">
          <div className="blog-article-header">
            <Link href="/blog" className="blog-back">← Back to Blog</Link>
            <div className="blog-card-category">{post.category}</div>
            <h1>{post.title}</h1>
            <div className="blog-card-meta">
              <span>{new Date(post.date).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</span>
              <span>·</span>
              <span>{post.readTime}</span>
              <span>·</span>
              <span>By <Link href="/about">{AUTHOR.name}</Link></span>
            </div>
          </div>

          {videoId ? (
            <div style={{ position: "relative", paddingTop: "56.25%", margin: "0 0 32px", borderRadius: "12px", overflow: "hidden" }}>
              <iframe
                src={`https://www.youtube-nocookie.com/embed/${videoId}`}
                title={post.title}
                style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }}
                allow="accelerometer; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                loading="lazy"
              />
            </div>
          ) : (
            hero && <Shot {...hero} />
          )}

          <nav className="blog-toc">
            <h4>📖 In This Article</h4>
            <ol>
              {toc.map(([id, label]) => (
                <li key={id}><a href={`#${id}`}>{label}</a></li>
              ))}
              <li><a href="#faq">FAQ</a></li>
            </ol>
          </nav>

          <div className="blog-article-content">
            {children}

            <div className="blog-faq" id="faq">
              <h3>❓ Frequently Asked</h3>
              {faq.map(({ q, a }) => (
                <details key={q}>
                  <summary>{q}</summary>
                  <p>{a}</p>
                </details>
              ))}
            </div>

            {note && <p style={{ fontSize: "0.9em", opacity: 0.8 }}>{note}</p>}

            {related.length > 0 && (
              <>
                <h2>Related guides</h2>
                <ul>
                  {related.map(([href, label]) => (
                    <li key={href}><Link href={href}>{label}</Link></li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
      </article>
    </>
  );
}
