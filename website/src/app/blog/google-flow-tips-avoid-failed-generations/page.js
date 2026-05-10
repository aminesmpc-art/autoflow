import Link from "next/link";
import { getPostBySlug, getRelatedPosts, SITE_URL } from "../content";

export const dynamic = 'force-static';

const post = getPostBySlug("google-flow-tips-avoid-failed-generations");

export const metadata = {
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
    images: [{ url: `${SITE_URL}${post.image}`, width: 1200, height: 630 }],
  },
};

export default function BlogPost() {
  const related = getRelatedPosts(post.slug);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Article",
            headline: post.title,
            description: post.description,
            author: { "@type": "Organization", name: "AutoFlow" },
            publisher: {
              "@type": "Organization",
              name: "AutoFlow",
              logo: { "@type": "ImageObject", url: `${SITE_URL}/og-image.png` },
            },
            datePublished: post.date,
            dateModified: post.updated,
            mainEntityOfPage: `${SITE_URL}/blog/${post.slug}`,
            image: `${SITE_URL}${post.image}`,
            keywords: post.tags.join(", "),
          }),
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: [
              { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
              { "@type": "ListItem", position: 2, name: "Blog", item: `${SITE_URL}/blog` },
              { "@type": "ListItem", position: 3, name: post.title, item: `${SITE_URL}/blog/${post.slug}` },
            ],
          }),
        }}
      />

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
            </div>
          </div>

          <nav className="blog-toc">
            <h4>📖 In This Article</h4>
            <ol>
              <li><a href="#tip-1">Write Cleaner Prompts</a></li>
              <li><a href="#tip-2">Avoid Restricted Content</a></li>
              <li><a href="#tip-3">Use the Right Model</a></li>
              <li><a href="#tip-4">Leverage Auto-Retry</a></li>
              <li><a href="#tip-5">Optimize Your Timing</a></li>
            </ol>
          </nav>

          <div className="blog-article-content">
            <p>
              If you&apos;ve used Google Flow for any amount of time, you&apos;ve seen the
              dreaded &quot;Generation failed&quot; message. It&apos;s frustrating — especially
              when it happens on prompt 47 of a 50-prompt batch.
            </p>
            <p>
              After running thousands of generations with{" "}
              <Link href="/">AutoFlow</Link>, we&apos;ve identified the most
              common causes of failures and how to avoid them.
            </p>

            <h2 id="tip-1">Tip 1: Write Cleaner Prompts</h2>
            <p>
              The #1 cause of failed generations is <strong>poorly structured prompts</strong>.
              Google Flow&apos;s AI works best with clear, descriptive language.
            </p>
            <p><strong>❌ Bad prompt:</strong></p>
            <pre className="blog-code">{`cool video of stuff happening with explosions and
things flying around everywhere make it epic`}</pre>
            <p><strong>✅ Good prompt:</strong></p>
            <pre className="blog-code">{`A cinematic wide-angle shot of a meteor shower over
a mountain range at night, trails of fire streaking
across the star-filled sky, camera slowly panning
upward, dramatic and awe-inspiring, 4K`}</pre>
            <p>
              Key differences: specific camera angle, clear subject, lighting details,
              defined mood, quality indicator. Need more examples?{" "}
              <Link href="/blog/best-prompts-ai-video-generation">
                Check our 25 best prompts guide →
              </Link>
            </p>

            <h2 id="tip-2">Tip 2: Avoid Restricted Content</h2>
            <p>
              Google Flow has content policies. Prompts that touch on violence,
              real public figures, branded content, or sensitive topics will
              often fail silently. The most common triggers:
            </p>
            <ul>
              <li><strong>Real people&apos;s names</strong> — Use descriptions instead (&quot;a tall man with dark hair&quot;)</li>
              <li><strong>Brand names</strong> — Say &quot;luxury sports car&quot; instead of a specific brand</li>
              <li><strong>Weapons in detail</strong> — Keep action scenes general</li>
              <li><strong>Medical/surgical imagery</strong> — Use abstract descriptions</li>
            </ul>
            <p>
              If a prompt keeps failing, try softening the language. Often just
              removing one triggering word fixes it.
            </p>

            <h2 id="tip-3">Tip 3: Use the Right Model</h2>
            <p>
              Not all models handle all prompts equally. Here&apos;s when to use each:
            </p>
            <ul>
              <li><strong>Veo 3.1 Fast</strong> — Best for simple scenes, text-to-video, quick iterations. Lowest failure rate.</li>
              <li><strong>Veo 3</strong> — Best for complex scenes with multiple subjects, detailed environments. Higher quality but slightly more failures.</li>
              <li><strong>Image-to-video</strong> — Use when you have a reference image. More reliable because the AI has a visual anchor.</li>
            </ul>
            <p>
              <strong>Pro tip:</strong> If a batch keeps failing on Veo 3,
              try switching to Veo 3.1 Fast. You can always re-run failed
              prompts on the higher-quality model later.
            </p>

            <h2 id="tip-4">Tip 4: Leverage Auto-Retry</h2>
            <p>
              Some failures are random — server load, temporary issues, or quota limits.
              That&apos;s why <Link href="/#features">AutoFlow has auto-retry built in</Link>.
            </p>
            <p>
              By default, AutoFlow retries failed prompts up to 2 times before marking
              them as permanently failed. This alone catches ~60% of random failures.
            </p>
            <p>
              In your queue settings, you can also:
            </p>
            <ul>
              <li>Adjust retry count (0-3 retries)</li>
              <li>Set custom wait times between retries</li>
              <li>Copy failed prompts to a new queue for manual review</li>
            </ul>

            <h2 id="tip-5">Tip 5: Optimize Your Timing</h2>
            <p>
              Google Flow has usage quotas and server load varies throughout the day.
            </p>
            <ul>
              <li><strong>Best times:</strong> Early morning (UTC) and late evening — lowest server load</li>
              <li><strong>Worst times:</strong> US business hours (3-8 PM UTC) — highest demand</li>
              <li><strong>Wait between prompts:</strong> Don&apos;t fire prompts too fast. AutoFlow&apos;s default timing is optimized, but if you&apos;re getting rate-limited, increase the wait time in Settings.</li>
            </ul>
            <p>
              With AutoFlow&apos;s{" "}
              <Link href="/blog/how-to-batch-generate-ai-videos-google-flow">
                batch processing
              </Link>, you can queue up everything and let it run overnight
              during low-traffic hours.
            </p>

            <h2>Summary</h2>
            <table className="blog-table">
              <thead>
                <tr><th>Tip</th><th>What to Do</th><th>Impact</th></tr>
              </thead>
              <tbody>
                <tr><td>Clean prompts</td><td>Be specific, structured, quality-tagged</td><td>🟢 High</td></tr>
                <tr><td>Avoid restricted</td><td>No real names, brands, sensitive content</td><td>🟢 High</td></tr>
                <tr><td>Right model</td><td>Use Fast for simple, Veo 3 for complex</td><td>🟡 Medium</td></tr>
                <tr><td>Auto-retry</td><td>Enable in AutoFlow (default: 2 retries)</td><td>🟡 Medium</td></tr>
                <tr><td>Timing</td><td>Run batches during off-peak hours</td><td>🟡 Medium</td></tr>
              </tbody>
            </table>

            <p>
              <a href="https://chromewebstore.google.com/detail/autoflow-video-task-man/egplmjhmcicjkojopeoaohofckgeoipc" target="_blank" rel="noopener noreferrer" className="btn btn-primary">
                Install AutoFlow — Free
              </a>
            </p>

            {related.length > 0 && (
              <div className="blog-related">
                <h3>📚 Related Articles</h3>
                <div className="blog-related-grid">
                  {related.map((r) => (
                    <Link key={r.slug} href={`/blog/${r.slug}`} className="blog-related-card">
                      <span className="blog-card-category">{r.category}</span>
                      <strong>{r.title}</strong>
                      <span className="blog-card-meta"><span>{r.readTime}</span></span>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </article>
    </>
  );
}
