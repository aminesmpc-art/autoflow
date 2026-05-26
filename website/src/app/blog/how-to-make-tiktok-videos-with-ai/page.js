import Link from "next/link";
import { getPostBySlug, getRelatedPosts, SITE_URL } from "../content";

export const dynamic = 'force-static';

const post = getPostBySlug("how-to-make-tiktok-videos-with-ai");

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
              <li><a href="#why-ai-tiktok">Why AI Videos on TikTok?</a></li>
              <li><a href="#what-you-need">What You Need</a></li>
              <li><a href="#step-1">Step 1: Write Your Prompts</a></li>
              <li><a href="#step-2">Step 2: Batch Generate with AutoFlow</a></li>
              <li><a href="#step-3">Step 3: Download in the Right Format</a></li>
              <li><a href="#step-4">Step 4: Edit for TikTok</a></li>
              <li><a href="#prompt-formulas">5 Proven TikTok Prompt Formulas</a></li>
              <li><a href="#best-niches">Best TikTok Niches for AI Videos</a></li>
              <li><a href="#tips">Tips for Going Viral</a></li>
            </ol>
          </nav>

          <div className="blog-article-content">
            <p>
              TikTok is the fastest-growing platform for short-form video — and AI-generated
              content is <strong>exploding</strong> on it. Channels posting AI videos are getting
              millions of views with zero filming equipment. The secret? Batch-generating
              dozens of videos at once and posting consistently.
            </p>
            <p>
              In this guide, you&apos;ll learn how to go from zero to a full content pipeline
              using <strong>Google Flow</strong> (powered by Veo 3) and{" "}
              <strong><Link href="/">AutoFlow</Link></strong> to automate the entire process.
            </p>

            <h2 id="why-ai-tiktok">Why AI Videos Are Dominating TikTok</h2>
            <p>
              AI-generated videos have unique advantages on TikTok:
            </p>
            <ul>
              <li><strong>No camera needed.</strong> You can create cinematic content from your desk.</li>
              <li><strong>Infinite variety.</strong> Generate 50 different scenes in the time it takes to film one.</li>
              <li><strong>Trend-friendly.</strong> Quickly create videos matching trending sounds and topics.</li>
              <li><strong>Scale.</strong> Post 3-5 videos per day without burning out.</li>
            </ul>
            <p>
              Popular AI niches on TikTok include satisfying loops, nature scenes, futuristic cities,
              ASMR content, and historical &quot;what if&quot; scenarios. Check our{" "}
              <Link href="/blog/construction-asmr-ai-video-complete-guide">ASMR video guide</Link>{" "}
              for a deep dive into one of the hottest niches.
            </p>

            <h2 id="what-you-need">What You Need</h2>
            <ol>
              <li><strong>Google Flow account</strong> — free at{" "}
                <a href="https://labs.google.com/fx/tools/video-fx" target="_blank" rel="noopener noreferrer">labs.google.com</a>
              </li>
              <li><strong>AutoFlow Chrome extension</strong> — free to install from the{" "}
                <a href="https://chromewebstore.google.com/detail/autoflow-video-task-man/egplmjhmcicjkojopeoaohofckgeoipc" target="_blank" rel="noopener noreferrer">Chrome Web Store</a>
              </li>
              <li><strong>A simple video editor</strong> — CapCut (free), or any editor that supports vertical crops</li>
            </ol>

            <h2 id="step-1">Step 1: Write Your Prompts</h2>
            <p>
              The key to TikTok is <strong>vertical video (9:16)</strong> and <strong>visual hooks</strong>
              in the first 1-2 seconds. Write prompts that create instant visual impact:
            </p>
            <pre className="blog-code">
{`Close-up of molten gold pouring into a detailed
mold of an ancient crown, sparks flying,
dramatic lighting, satisfying ASMR, 9:16 vertical

A massive wave crashing in slow motion against
a lighthouse at sunset, cinematic 4K, vertical

Time-lapse of a city transforming from ancient
Roman architecture to a futuristic cyberpunk
metropolis, seamless morph, vertical video`}
            </pre>
            <p>
              Need inspiration? Browse our{" "}
              <Link href="/blog/best-prompts-ai-video-generation">25 best AI video prompts</Link>{" "}
              or explore the <Link href="/prompts">Prompt Gallery</Link> for community examples.
            </p>

            <h2 id="step-2">Step 2: Batch Generate with AutoFlow</h2>
            <p>
              Instead of generating one video at a time (painful!), use AutoFlow to batch
              process all your prompts:
            </p>
            <ol>
              <li>Open Google Flow and click the AutoFlow icon to open the side panel</li>
              <li>Paste all your prompts into the <strong>Create</strong> tab (one per paragraph)</li>
              <li>Click <strong>Parse Prompts</strong> → review your prompt cards</li>
              <li>In <strong>Queues</strong>, set your model to <strong>Veo 3</strong> and aspect ratio to <strong>9:16</strong></li>
              <li>Hit <strong>Run</strong> and walk away</li>
            </ol>
            <p>
              AutoFlow handles everything — typing, clicking generate, waiting for renders,
              retrying failures, and downloading. For a detailed walkthrough, see our{" "}
              <Link href="/blog/how-to-batch-generate-ai-videos-google-flow">batch generation guide</Link>.
            </p>

            <h2 id="step-3">Step 3: Download in the Right Format</h2>
            <p>
              When AutoFlow finishes, go to the <strong>Library</strong> tab. Click <strong>Scan</strong>{" "}
              to see all your generated videos grouped by prompt. Select the best takes and
              batch download in <strong>1080p or 4K</strong>.
            </p>
            <p>
              TikTok supports up to 4K, but <strong>1080p is the sweet spot</strong> — fast uploads,
              no quality loss on mobile screens.
            </p>

            <h2 id="step-4">Step 4: Edit for TikTok</h2>
            <p>
              Before posting, add these elements in your editor:
            </p>
            <ul>
              <li><strong>Trending sound/music</strong> — this is the #1 factor for TikTok reach</li>
              <li><strong>Text overlay</strong> — add context or a hook (&quot;Wait for it...&quot;)</li>
              <li><strong>Caption</strong> — use relevant hashtags (#ai #satisfying #asmr)</li>
              <li><strong>Loop-friendly ending</strong> — make the video loop seamlessly for more watch time</li>
            </ul>

            <h2 id="prompt-formulas">5 Proven TikTok Prompt Formulas</h2>
            <p>These formula patterns consistently perform well on TikTok:</p>
            <ol>
              <li>
                <strong>Satisfying Process:</strong>{" "}
                <em>&quot;Close-up of [material] being [action], satisfying ASMR, slow motion, vertical&quot;</em>
              </li>
              <li>
                <strong>Time-lapse Transformation:</strong>{" "}
                <em>&quot;Time-lapse of [object] transforming from [state A] to [state B], seamless, vertical&quot;</em>
              </li>
              <li>
                <strong>Nature Cinematic:</strong>{" "}
                <em>&quot;Drone shot of [landscape] at [time of day], cinematic 4K, vertical, slow pan&quot;</em>
              </li>
              <li>
                <strong>Historical What-If:</strong>{" "}
                <em>&quot;What if [historical place] existed in [modern/future era], photorealistic, vertical&quot;</em>
              </li>
              <li>
                <strong>Miniature World:</strong>{" "}
                <em>&quot;Tilt-shift miniature view of [scene], tiny people, toy-like, vertical&quot;</em>
              </li>
            </ol>

            <h2 id="best-niches">Best TikTok Niches for AI Videos (2026)</h2>
            <ul>
              <li>🏗️ <strong>Construction/Building ASMR</strong> — molten metal, 3D printing, crafting</li>
              <li>🌊 <strong>Nature Satisfying</strong> — waves, lava, northern lights</li>
              <li>🏙️ <strong>Futuristic Cities</strong> — cyberpunk, sci-fi architecture</li>
              <li>🍳 <strong>Food/Cooking</strong> — satisfying food prep, impossible recipes</li>
              <li>⏳ <strong>Historical</strong> — ancient civilizations reimagined</li>
              <li>🔬 <strong>Miniature Worlds</strong> — tilt-shift, tiny people scenarios</li>
            </ul>

            <h2 id="tips">Tips for Going Viral</h2>
            <ul>
              <li>
                <strong>Post 3-5 times per day.</strong> Consistency beats quality on TikTok.
                With AutoFlow, you can generate a week&apos;s worth of content in one session.
              </li>
              <li>
                <strong>Use trending audio.</strong> Check TikTok&apos;s creative center for trending sounds.
              </li>
              <li>
                <strong>Hook in 0.5 seconds.</strong> Start with the most visually striking frame.
              </li>
              <li>
                <strong>Engage in comments.</strong> Reply to comments with new AI videos.
              </li>
              <li>
                <strong>Cross-post.</strong> Also post on YouTube Shorts and Instagram Reels
                to maximize reach from the same content.
              </li>
            </ul>

            <h2>Start Creating Today</h2>
            <p>
              You don&apos;t need a camera, studio, or editing skills to build a TikTok
              presence. With Google Flow + AutoFlow, you can generate professional-quality
              AI videos at scale and post consistently — the two things that matter most
              on TikTok.
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

            {/* ── FAQ Section ── */}
            <div className="blog-faq">
              <h3>❓ Frequently Asked</h3>
              <details>
                <summary>Can I use AI videos on TikTok commercially?</summary>
                <p>Yes — videos generated with Google Flow are yours to use. Always check the latest Google Flow terms for commercial use specifics.</p>
              </details>
              <details>
                <summary>What&apos;s the best video length for TikTok?</summary>
                <p>7-15 seconds is the sweet spot. Google Flow generates ~8 second clips which is perfect. For longer content, chain multiple clips.</p>
              </details>
              <details>
                <summary>Do I need AutoFlow Pro for TikTok content?</summary>
                <p>Free works for getting started (limited daily prompts). For serious posting (3-5/day), <Link href="/pricing">Pro gives you unlimited generation</Link>.</p>
              </details>
            </div>
          </div>
        </div>
      </article>
    </>
  );
}
