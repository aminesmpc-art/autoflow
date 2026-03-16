import Link from "next/link";
import { getPostBySlug, getRelatedPosts, SITE_URL } from "../content";

const post = getPostBySlug("how-to-batch-generate-ai-videos-google-flow");

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
      {/* ── Article Schema ── */}
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

          {/* ── Table of Contents ── */}
          <nav className="blog-toc">
            <h4>📖 In This Article</h4>
            <ol>
              <li><a href="#what-is-autoflow">What is AutoFlow?</a></li>
              <li><a href="#step-1">Install AutoFlow</a></li>
              <li><a href="#step-2">Open Google Flow + AutoFlow</a></li>
              <li><a href="#step-3">Paste Your Prompts</a></li>
              <li><a href="#step-4">Configure & Run</a></li>
              <li><a href="#step-5">Download Everything</a></li>
              <li><a href="#pro-tips">Pro Tips for Better Results</a></li>
            </ol>
          </nav>

          <div className="blog-article-content">
            <p>
              Google Flow is one of the most powerful AI video generators
              available today, powered by <strong>Veo 3</strong> and the latest Gemini models.
              But if you&apos;ve ever tried to generate more than a few videos,
              you know the pain: paste a prompt, click generate, wait, download,
              repeat. For 50 videos, that&apos;s <strong>hours of clicking</strong>.
            </p>
            <p>
              What if you could paste all 50 prompts at once, hit one button,
              and walk away? That&apos;s exactly what <strong><Link href="/">AutoFlow</Link></strong> does.
            </p>

            <h2 id="what-is-autoflow">What is AutoFlow?</h2>
            <p>
              AutoFlow is a <Link href="/#features">Chrome extension</Link> that sits alongside Google Flow as
              a side panel. Think of it as an <strong>autopilot for video generation</strong> —
              it handles the clicking, waiting, retrying, and downloading so you
              don&apos;t have to.
            </p>

            <h2 id="step-1">Step 1: Install AutoFlow</h2>
            <p>
              Head to the Chrome Web Store and search for &quot;AutoFlow&quot;.
              Click <strong>Add to Chrome</strong> — it&apos;s free and takes 10 seconds.
              Check our <Link href="/pricing">pricing page</Link> for Free vs Pro details.
            </p>

            <h2 id="step-2">Step 2: Open Google Flow + AutoFlow</h2>
            <p>
              Navigate to{" "}
              <a href="https://labs.google.com/fx/tools/video-fx" target="_blank" rel="noopener noreferrer">
                Google Flow (labs.google)
              </a>. Click the AutoFlow icon in your Chrome extensions bar. The side
              panel will open next to Flow.
            </p>

            <h2 id="step-3">Step 3: Paste Your Prompts</h2>
            <p>
              In the AutoFlow <strong>Create</strong> tab, paste all your prompts
              into the text area. Separate each prompt with a blank line. Each
              paragraph becomes a separate generation task.
            </p>
            <p>For example:</p>
            <pre className="blog-code">
{`A cinematic shot of a golden retriever running
through a sunlit meadow in slow motion, 4K

A drone flyover of a futuristic city at sunset,
neon lights reflecting off glass buildings

Close-up of a chef plating an elegant dessert,
shallow depth of field, warm lighting`}
            </pre>
            <p>
              Click <strong>Parse Prompts</strong>. AutoFlow will show you each
              prompt as a separate card — review them, then click{" "}
              <strong>Add to Queue</strong>.
            </p>
            <p>
              Need help writing prompts? Check our guide on{" "}
              <Link href="/blog/best-prompts-ai-video-generation">
                25 best prompts for AI video generation
              </Link>.
            </p>

            <h2 id="step-4">Step 4: Configure & Run</h2>
            <p>
              In the <strong>Queues</strong> tab, you&apos;ll see your queue with
              all settings visible: video model (e.g., Veo 3.1 Fast), aspect
              ratio, generations per prompt, download quality, and timing.
              Adjust anything you want, then hit <strong>Run</strong>.
            </p>
            <p>
              AutoFlow takes over — it types each prompt, clicks generate,
              waits for the video to render, downloads it, and moves to the
              next one. If a generation fails, it <Link href="/blog/google-flow-tips-avoid-failed-generations">auto-retries</Link> (up to 2 times).
            </p>

            <h2 id="step-5">Step 5: Download Everything</h2>
            <p>
              When all prompts are done, go to the <strong>Library</strong> tab.
              Click <strong>Scan</strong> to see all generated videos grouped by
              prompt. Select the ones you want and batch download in your
              preferred quality (720p, 1080p, or 4K).
            </p>

            <h2 id="pro-tips">Pro Tips for Better Results</h2>
            <ul>
              <li>
                <strong>Be specific in your prompts.</strong> Instead of
                &quot;a car driving,&quot; try &quot;a red sports car driving on a mountain road
                at golden hour, cinematic 4K.&quot;
              </li>
              <li>
                <strong>Use reference images.</strong> In AutoFlow&apos;s
                ingredients mode, attach reference images to guide the style.
              </li>
              <li>
                <strong>Start small.</strong> Test with 3-5 prompts first to
                dial in your settings before running a batch of 50+.
              </li>
              <li>
                <strong>Enable auto-download.</strong> In Settings, turn on
                auto-download so videos save automatically as they generate.
              </li>
            </ul>

            <h2>Ready to Try It?</h2>
            <p>
              AutoFlow is free to start with daily prompt limits. Pro users get
              unlimited prompts, image-to-video, character matching, and frame
              chains. <Link href="/pricing">Compare plans →</Link>
            </p>
            <p>
              <a
                href="https://chromewebstore.google.com"
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-primary"
              >
                Install AutoFlow — Free
              </a>
            </p>

            {/* ── Related Articles ── */}
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

            {/* ── FAQ Section for SEO ── */}
            <div className="blog-faq">
              <h3>❓ Frequently Asked</h3>
              <details>
                <summary>Can I batch generate with the free version?</summary>
                <p>Yes! Free users get daily-limited text prompts. <Link href="/pricing">Upgrade to Pro</Link> for unlimited.</p>
              </details>
              <details>
                <summary>Does AutoFlow work with Veo 3?</summary>
                <p>Yes — AutoFlow supports all Google Flow models including Veo 3, Veo 3.1, and Veo 3.1 Fast.</p>
              </details>
              <details>
                <summary>Is my data private?</summary>
                <p>100%. All prompts and videos stay in your browser. <Link href="/faq">Read our full FAQ</Link>.</p>
              </details>
            </div>
          </div>
        </div>
      </article>
    </>
  );
}
