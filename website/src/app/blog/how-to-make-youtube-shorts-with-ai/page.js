import Link from "next/link";
import { getPostBySlug, getRelatedPosts, SITE_URL } from "../content";

export const dynamic = 'force-static';

const post = getPostBySlug("how-to-make-youtube-shorts-with-ai");

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
            <div className="blog-card-tags" style={{ justifyContent: "center", marginTop: "12px" }}>
              {post.tags.map((tag) => (
                <span key={tag} className="blog-tag">#{tag}</span>
              ))}
            </div>
          </div>

          <nav className="blog-toc">
            <h4>📖 In This Article</h4>
            <ol>
              <li><a href="#why-shorts">Why YouTube Shorts?</a></li>
              <li><a href="#setup">Setup: Google Flow + AutoFlow</a></li>
              <li><a href="#writing-prompts">Writing Shorts-Optimized Prompts</a></li>
              <li><a href="#batch-generate">Batch Generate 50+ Videos</a></li>
              <li><a href="#optimize">Optimize for the Algorithm</a></li>
              <li><a href="#monetization">Monetization Path</a></li>
              <li><a href="#prompt-templates">10 Ready-to-Use Prompt Templates</a></li>
            </ol>
          </nav>

          <div className="blog-article-content">
            <p>
              YouTube Shorts has exploded to <strong>70 billion daily views</strong>. Unlike TikTok,
              Shorts offers a clear <strong>monetization path</strong> — the YouTube Partner Program
              now pays creators for Shorts views. AI-generated content channels are earning
              thousands per month with zero filming.
            </p>
            <p>
              This guide shows you how to build a full AI Shorts pipeline using{" "}
              <strong><Link href="/">AutoFlow</Link></strong> and Google Flow — from prompt writing
              to batch generation to upload-ready content.
            </p>

            <h2 id="why-shorts">Why YouTube Shorts for AI Content?</h2>
            <ul>
              <li><strong>Monetization.</strong> Unlike TikTok, YouTube shares ad revenue on Shorts (RPM $0.05-$0.07 per 1K views)</li>
              <li><strong>Discoverability.</strong> Shorts feed pulls from the entire YouTube audience — 2.7 billion monthly users</li>
              <li><strong>Evergreen.</strong> Shorts can resurface months later, unlike TikTok&apos;s 48-hour spike</li>
              <li><strong>Channel growth.</strong> Shorts feed subscribers into your long-form content</li>
            </ul>

            <h2 id="setup">Setup: Google Flow + AutoFlow</h2>
            <p>You need two free tools:</p>
            <ol>
              <li>
                <strong>Google Flow</strong> — Google&apos;s AI video generator at{" "}
                <a href="https://labs.google.com/fx/tools/video-fx" target="_blank" rel="noopener noreferrer">labs.google.com</a>.
                Uses Veo 3, one of the best AI video models available.
              </li>
              <li>
                <strong>AutoFlow</strong> — A{" "}
                <a href="https://chromewebstore.google.com/detail/autoflow-video-task-man/egplmjhmcicjkojopeoaohofckgeoipc" target="_blank" rel="noopener noreferrer">free Chrome extension</a>{" "}
                that automates batch generation. Instead of generating videos one by one,
                you paste 50 prompts and AutoFlow does everything automatically.
              </li>
            </ol>

            <h2 id="writing-prompts">Writing Shorts-Optimized Prompts</h2>
            <p>YouTube Shorts have specific requirements that affect your prompts:</p>
            <ul>
              <li><strong>Vertical (9:16)</strong> — always specify &quot;vertical&quot; in your prompt</li>
              <li><strong>Under 60 seconds</strong> — Google Flow generates ~8s clips, perfect for Shorts</li>
              <li><strong>Visual hook in frame 1</strong> — the thumbnail IS the first frame</li>
              <li><strong>High contrast and color</strong> — small mobile screens need bold visuals</li>
            </ul>
            <pre className="blog-code">
{`Extreme close-up of a diamond being laser-cut,
sparks and rainbow refractions, black background,
satisfying precision, vertical 9:16, 4K

Aerial drone shot flying through a neon-lit
Tokyo alley at night during rain, reflections
on wet ground, cinematic, vertical

A massive iceberg slowly calving into the ocean,
dramatic scale with tiny boat for reference,
slow motion, vertical, cinematic 4K`}
            </pre>

            <h2 id="batch-generate">Batch Generate 50+ Videos at Once</h2>
            <p>
              This is where <Link href="/">AutoFlow</Link> saves you hours. Instead of copy-pasting
              prompts one at a time:
            </p>
            <ol>
              <li>Open Google Flow → click AutoFlow icon → side panel opens</li>
              <li>Go to <strong>Create</strong> tab → paste all prompts (one per paragraph)</li>
              <li>Click <strong>Parse</strong> → review prompt cards → <strong>Add to Queue</strong></li>
              <li>In <strong>Queues</strong>, set: Veo 3, 9:16 aspect, 2 generations per prompt</li>
              <li>Hit <strong>Run</strong> → AutoFlow automates everything</li>
            </ol>
            <p>
              For 50 prompts with 2 generations each, you get <strong>100 video clips</strong> —
              enough content for weeks of daily posting. See the full{" "}
              <Link href="/blog/how-to-batch-generate-ai-videos-google-flow">batch generation walkthrough</Link>{" "}
              for detailed instructions.
            </p>

            <h2 id="optimize">Optimize for the YouTube Algorithm</h2>
            <p>YouTube&apos;s Shorts algorithm prioritizes:</p>
            <ul>
              <li>
                <strong>Watch completion rate.</strong> Shorter = better. 8-15 seconds is ideal.
                AI-generated clips from Flow are naturally in this range.
              </li>
              <li>
                <strong>Re-watches (looping).</strong> Create seamless loops where the end connects
                to the beginning. This tricks the algorithm into counting multiple views.
              </li>
              <li>
                <strong>Title + hashtags.</strong> Use searchable titles like &quot;Satisfying gold
                pouring 🔥&quot; and hashtags like #shorts #satisfying #ai.
              </li>
              <li>
                <strong>Posting schedule.</strong> Upload 2-3 Shorts daily at consistent times.
                Use YouTube Studio&apos;s scheduled upload feature.
              </li>
            </ul>

            <h2 id="monetization">Monetization Path</h2>
            <p>YouTube Shorts monetization requires:</p>
            <ul>
              <li>1,000 subscribers</li>
              <li>10 million Shorts views in the last 90 days</li>
            </ul>
            <p>
              With AI content, reaching 10M views is realistic within 2-3 months if you
              post 3x daily with good prompts. At $0.05-$0.07 RPM, 10M monthly views =
              <strong> $500-$700/month</strong> passive income.
            </p>

            <h2 id="prompt-templates">10 Ready-to-Use Prompt Templates</h2>
            <p>Copy these directly into AutoFlow. Each one is optimized for Shorts:</p>
            <ol>
              <li><strong>Satisfying Process:</strong> <em>&quot;Extreme close-up of [material] being [process], satisfying texture, ASMR, vertical 9:16&quot;</em></li>
              <li><strong>Nature Wonder:</strong> <em>&quot;[Natural phenomenon] in [location], dramatic scale, slow motion, vertical, cinematic 4K&quot;</em></li>
              <li><strong>Time-lapse City:</strong> <em>&quot;Hyper-lapse of [city] transitioning from [time A] to [time B], vertical, smooth motion&quot;</em></li>
              <li><strong>Tiny World:</strong> <em>&quot;Tilt-shift miniature view of [scene], toy-like people and vehicles, vertical&quot;</em></li>
              <li><strong>Future Tech:</strong> <em>&quot;Futuristic [technology] in action, holographic interface, sci-fi, vertical 9:16&quot;</em></li>
              <li><strong>Historical:</strong> <em>&quot;What [historical place] would look like in [year], photorealistic, vertical&quot;</em></li>
              <li><strong>Food Art:</strong> <em>&quot;Slow motion of [food/drink] being [action], beautiful colors, macro lens, vertical&quot;</em></li>
              <li><strong>Space:</strong> <em>&quot;Cinematic flyover of [celestial body], detailed surface, dramatic lighting, vertical 4K&quot;</em></li>
              <li><strong>Architecture:</strong> <em>&quot;Impossible architecture — [description], physically surreal, vertical, golden hour&quot;</em></li>
              <li><strong>Underwater:</strong> <em>&quot;Deep ocean scene with [creature/structure], bioluminescent glow, vertical, cinematic&quot;</em></li>
            </ol>
            <p>
              Want more? Browse our <Link href="/prompts">Prompt Gallery</Link> for hundreds of
              community-created prompts, or check the{" "}
              <Link href="/blog/best-prompts-ai-video-generation">25 best prompts guide</Link>.
            </p>

            <h2>Start Your Shorts Channel Today</h2>
            <p>
              The AI video wave on YouTube is still early. Creators who start now will have
              a massive advantage as the niche grows. With AutoFlow, you can generate a
              month&apos;s worth of Shorts content in a single afternoon.
            </p>
            <p>
              <a
                href="https://chromewebstore.google.com/detail/autoflow-video-task-man/egplmjhmcicjkojopeoaohofckgeoipc"
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-primary"
              >
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

            <div className="blog-faq">
              <h3>❓ Frequently Asked</h3>
              <details>
                <summary>Can AI videos be monetized on YouTube Shorts?</summary>
                <p>Yes — YouTube allows AI-generated content in its Partner Program. You must disclose AI-generated content in your video details.</p>
              </details>
              <details>
                <summary>What resolution should I use for Shorts?</summary>
                <p>1080×1920 (9:16 vertical) is the standard. AutoFlow can download in 1080p or 4K from Google Flow.</p>
              </details>
              <details>
                <summary>How many Shorts should I post per day?</summary>
                <p>2-3 per day is the sweet spot. With AutoFlow batch generation, you can create a week&apos;s content in one session.</p>
              </details>
            </div>
          </div>
        </div>
      </article>
    </>
  );
}
