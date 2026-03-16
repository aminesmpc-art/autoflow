import Image from "next/image";
import Link from "next/link";
import { getPostBySlug, getRelatedPosts, SITE_URL } from "../content";

export const dynamic = 'force-static';

const post = getPostBySlug("construction-asmr-ai-video-complete-guide");

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
            "@type": "HowTo",
            name: "How to Create Construction ASMR Videos with AI",
            description: "Complete guide to generating construction ASMR time-lapse videos using ChatGPT, Google Flow, and AutoFlow.",
            step: [
              { "@type": "HowToStep", name: "Generate prompts with ChatGPT", text: "Use a structured system prompt to generate 6 image prompts and 5 video animation prompts for a construction sequence." },
              { "@type": "HowToStep", name: "Generate images with Google Flow", text: "Paste the 6 image prompts into Google Flow ImageFX to generate photorealistic construction stage images." },
              { "@type": "HowToStep", name: "Upload frames to AutoFlow", text: "Use AutoFlow's Frame Chain feature to upload the 6 images as start/end frames for each video transition." },
              { "@type": "HowToStep", name: "Paste video prompts", text: "Paste the 5 animation prompts into AutoFlow, which auto-pairs them with the uploaded frames." },
              { "@type": "HowToStep", name: "Run the queue", text: "Add to queue and hit Run. AutoFlow automates the entire frame-to-video generation process." },
              { "@type": "HowToStep", name: "Download from Library", text: "Scan results in the Library tab, select all, and batch download your construction ASMR sequence." },
            ],
            tool: [
              { "@type": "HowToTool", name: "ChatGPT" },
              { "@type": "HowToTool", name: "Google Flow (ImageFX)" },
              { "@type": "HowToTool", name: "AutoFlow Chrome Extension" },
            ],
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
            <h4>📖 In This Guide</h4>
            <ol>
              <li><a href="#what-youll-create">What You&apos;ll Create</a></li>
              <li><a href="#tools">Tools You Need</a></li>
              <li><a href="#step-1">Step 1: Generate Prompts with ChatGPT</a></li>
              <li><a href="#step-2">Step 2: Generate Construction Images</a></li>
              <li><a href="#step-3">Step 3: Set Up Frame-to-Video in AutoFlow</a></li>
              <li><a href="#step-4">Step 4: Run & Monitor</a></li>
              <li><a href="#step-5">Step 5: Download from Library</a></li>
              <li><a href="#pro-tips">Pro Tips for Viral Content</a></li>
            </ol>
          </nav>

          <div className="blog-article-content">
            <p>
              Construction ASMR is one of the fastest-growing content niches
              right now — satisfying time-lapse videos showing buildings rise
              from raw land to completion. But creating these videos traditionally
              requires months of real footage and expensive drone equipment.
            </p>
            <p>
              <strong>What if you could create the entire sequence in under an hour
              using AI?</strong> This guide shows you exactly how — using ChatGPT
              for intelligent prompt generation, Google Flow for photorealistic images,
              and <Link href="/">AutoFlow</Link> to automate the frame-to-video
              animation pipeline.
            </p>

            <h2 id="what-youll-create">🏗️ What You&apos;ll Create</h2>
            <p>
              By the end of this guide, you&apos;ll have a complete construction
              sequence: <strong>6 photorealistic images</strong> (raw land → clearing
              → foundation → construction → finished → activated) and{" "}
              <strong>5 animation videos</strong> that smoothly transition between each stage.
              The result is a cinematic, drone-view construction time-lapse — entirely AI-generated.
            </p>

            <h2 id="tools">🛠️ Tools You Need (All Free)</h2>
            <ul>
              <li><strong>ChatGPT</strong> — to generate structured image + video prompts</li>
              <li><strong>Google Flow (ImageFX)</strong> — to generate photorealistic images</li>
              <li><strong>AutoFlow</strong> — to automate frame-to-video generation (<Link href="/pricing">free plan available</Link>)</li>
            </ul>

            {/* ═══════ STEP 1 ═══════ */}
            <h2 id="step-1">Step 1: Generate Prompts with ChatGPT</h2>
            <p>
              The secret sauce is a <strong>structured system prompt</strong> that
              turns ChatGPT into a cinematic workflow generator. Instead of writing
              prompts manually, you give ChatGPT a blueprint that tells it exactly
              what to output.
            </p>

            <div className="blog-img-wrap">
              <Image
                src="/screenshots/blog/01-chatgpt-prompt.png"
                alt="ChatGPT system prompt for cinematic construction workflow generation"
                width={800}
                height={450}
                className="blog-img"
              />
              <p className="blog-img-caption">
                Paste the system prompt into ChatGPT — it becomes a structured prompt generator
              </p>
            </div>

            <p>The system prompt defines:</p>
            <ul>
              <li><strong>6 image stages</strong> — raw land, clearing, foundation, mid-construction, completed, activated</li>
              <li><strong>5 video transitions</strong> — smooth frame-to-frame animations between each stage</li>
              <li><strong>Camera rules</strong> — fixed drone position, same angle, same lens throughout</li>
              <li><strong>Realism constraints</strong> — no teleporting, no instant transitions, no stylistic drift</li>
            </ul>

            <p>
              When you type <strong>&quot;start&quot;</strong>, ChatGPT presents you with
              building options. You pick one (or type your own custom building):
            </p>

            <div className="blog-img-wrap">
              <Image
                src="/screenshots/blog/03-building-selection.png"
                alt="ChatGPT showing 15 building types to choose from"
                width={800}
                height={450}
                className="blog-img"
              />
              <p className="blog-img-caption">
                15 building types to choose from — or type anything custom like &quot;underground airport in a mountain&quot;
              </p>
            </div>

            <p>
              ChatGPT then generates all 11 prompts (6 images + 5 videos) instantly,
              each with detailed descriptions, camera specs, and platform notes:
            </p>

            <div className="blog-img-wrap">
              <Image
                src="/screenshots/blog/05-image-prompts.png"
                alt="ChatGPT output showing detailed image prompts for each construction stage"
                width={800}
                height={450}
                className="blog-img"
              />
              <p className="blog-img-caption">
                Each prompt includes camera angle, lighting, materials, and realism constraints
              </p>
            </div>

            {/* ═══════ STEP 2 ═══════ */}
            <h2 id="step-2">Step 2: Generate Construction Images with Google Flow</h2>
            <p>
              Copy each of the 6 image prompts from ChatGPT and paste them into{" "}
              <a href="https://labs.google.com/fx/tools/image-fx" target="_blank" rel="noopener noreferrer">
                Google Flow ImageFX
              </a>. Set the model to <strong>Nano Banana 2</strong> (best for photorealism)
              and generate x4 variations for each stage.
            </p>

            <div className="blog-img-wrap">
              <Image
                src="/screenshots/blog/06-paste-imagefx.png"
                alt="Pasting the image prompt into Google Flow ImageFX with Nano Banana 2 model"
                width={800}
                height={450}
                className="blog-img"
              />
              <p className="blog-img-caption">
                Paste the prompt into ImageFX — select Image, Landscape, x4, Nano Banana 2
              </p>
            </div>

            <p>
              After generating all 6 stages, you&apos;ll have photorealistic drone shots
              of the same mountain plot at each construction phase. Pick the best image
              from each x4 batch:
            </p>

            <div className="blog-img-wrap">
              <Image
                src="/screenshots/blog/07-generated-images.png"
                alt="4 generated variations of a mountain slope — raw land with grassy terrain"
                width={800}
                height={450}
                className="blog-img"
              />
              <p className="blog-img-caption">
                Stage 1: Raw land — 4 photorealistic variations of the untouched mountain slope
              </p>
            </div>

            <p>
              Download your 6 best images (one per stage). Name them 1 through 6 for easy ordering:
            </p>

            <div className="blog-img-wrap">
              <Image
                src="/screenshots/blog/10-downloaded-files.png"
                alt="6 downloaded JPEG files named 1 through 6 in the Downloads folder"
                width={600}
                height={200}
                className="blog-img"
              />
              <p className="blog-img-caption">
                6 files = 6 construction stages. These become the start and end frames for each video.
              </p>
            </div>

            {/* ═══════ STEP 3 ═══════ */}
            <h2 id="step-3">Step 3: Set Up Frame-to-Video in AutoFlow</h2>
            <p>
              Now the magic happens. Open{" "}
              <a href="https://labs.google.com/fx/tools/video-fx" target="_blank" rel="noopener noreferrer">
                Google Flow
              </a>{" "}
              and click the <strong>AutoFlow</strong> icon to open the side panel.
              Switch to <strong>Frame-to-Video</strong> mode.
            </p>

            <h3>3a. Paste the 5 video prompts</h3>
            <p>
              Copy all 5 animation prompts from ChatGPT and paste them into AutoFlow&apos;s
              text area. Click <strong>Parse Prompts</strong> — AutoFlow splits them
              into 5 separate cards:
            </p>

            <div className="blog-img-wrap">
              <Image
                src="/screenshots/blog/12-video-prompts-pasted.png"
                alt="AutoFlow side panel showing Frame-to-Video mode with 5 parsed video prompts"
                width={800}
                height={450}
                className="blog-img"
              />
              <p className="blog-img-caption">
                5 animation prompts parsed — each one transitions between two construction stages
              </p>
            </div>

            <h3>3b. Upload your 6 images as Frame Chains</h3>
            <p>
              Scroll down to <strong>Frame Chain</strong> and click{" "}
              <strong>Upload & Chain Frames</strong>. Select all 6 images in order
              (1 through 6). AutoFlow automatically pairs them:
            </p>
            <ul>
              <li>Video 1: Image 1 (start) → Image 2 (end)</li>
              <li>Video 2: Image 2 (start) → Image 3 (end)</li>
              <li>Video 3: Image 3 (start) → Image 4 (end)</li>
              <li>Video 4: Image 4 (start) → Image 5 (end)</li>
              <li>Video 5: Image 5 (start) → Image 6 (end)</li>
            </ul>

            <div className="blog-img-wrap">
              <Image
                src="/screenshots/blog/13-frame-chain-upload.png"
                alt="File picker showing 6 JPEG images being selected for Frame Chain upload"
                width={800}
                height={450}
                className="blog-img"
              />
              <p className="blog-img-caption">
                Select all 6 images from your Downloads — AutoFlow chains them automatically
              </p>
            </div>

            <div className="blog-img-wrap">
              <Image
                src="/screenshots/blog/14-frame-chain-cards.png"
                alt="AutoFlow showing 5 frame chain pairs with start and end thumbnails"
                width={500}
                height={500}
                className="blog-img"
              />
              <p className="blog-img-caption">
                5 frame chain pairs created — each video transitions between two consecutive stages
              </p>
            </div>

            <p>
              Click <strong>Add to Queue</strong>:
            </p>

            <div className="blog-img-wrap">
              <Image
                src="/screenshots/blog/15-frame-chain-add-queue.png"
                alt="AutoFlow frame chain cards with Add to Queue button"
                width={500}
                height={500}
                className="blog-img"
              />
            </div>

            {/* ═══════ STEP 4 ═══════ */}
            <h2 id="step-4">Step 4: Run & Monitor</h2>
            <p>
              Switch to the <strong>Queues</strong> tab. You&apos;ll see your queue with all
              5 frame-to-video prompts ready. Check the settings (Veo 3.1 Fast, landscape,
              720p) and hit <strong>Run</strong>:
            </p>

            <div className="blog-img-wrap">
              <Image
                src="/screenshots/blog/16-queue-settings.png"
                alt="AutoFlow Queues tab showing 5 prompts pending with generation settings"
                width={800}
                height={450}
                className="blog-img"
              />
              <p className="blog-img-caption">
                Queue ready: 5 prompts, Veo 3.1 Fast, landscape, auto-download off
              </p>
            </div>

            <p>
              AutoFlow takes over completely. It uploads each start/end frame,
              pastes the animation prompt, clicks generate, waits for the video, and
              moves to the next one. You can watch everything happen in real-time:
            </p>

            <div className="blog-img-wrap">
              <Image
                src="/screenshots/blog/17-autoflow-running.png"
                alt="AutoFlow Run Monitor showing live progress: uploading frames, filling prompts"
                width={800}
                height={450}
                className="blog-img"
              />
              <p className="blog-img-caption">
                Live Run Monitor — AutoFlow uploading Start/End frames and filling prompt automatically
              </p>
            </div>

            <div className="blog-img-wrap">
              <Image
                src="/screenshots/blog/18-queue-complete.png"
                alt="AutoFlow showing queue complete: 5/5 done, 0 failed, all construction videos generated"
                width={800}
                height={450}
                className="blog-img"
              />
              <p className="blog-img-caption">
                ✅ Queue finished — 5/5 done, 0 failed. All construction transition videos generated!
              </p>
            </div>

            {/* ═══════ STEP 5 ═══════ */}
            <h2 id="step-5">Step 5: Download from Library</h2>
            <p>
              Switch to the <strong>Library</strong> tab and click <strong>Scan Project</strong>.
              AutoFlow finds all 5 generated videos grouped by prompt. Select all and batch download:
            </p>

            <div className="blog-img-wrap">
              <Image
                src="/screenshots/blog/19-library-videos.png"
                alt="AutoFlow Library showing 5 generated construction ASMR videos with Scan Project results"
                width={800}
                height={450}
                className="blog-img"
              />
              <p className="blog-img-caption">
                Library scan: 5 videos ready for download — each showing a construction stage transition
              </p>
            </div>

            <p>
              That&apos;s it! You now have 5 smooth construction time-lapse videos.
              Stitch them together in any video editor (CapCut, DaVinci, Premiere)
              for a complete raw-land-to-finished-building sequence.
            </p>

            {/* ═══════ PRO TIPS ═══════ */}
            <h2 id="pro-tips">💡 Pro Tips for Viral Content</h2>
            <ul>
              <li>
                <strong>Try unique buildings.</strong> An &quot;underground airport in a mountain&quot;
                is way more interesting than a generic house. Think bold — floating hotel,
                underwater research lab, cliff-edge mansion.
              </li>
              <li>
                <strong>Use the same prompt style.</strong> The system prompt ensures camera
                consistency. Every image has the same drone angle, lens, and altitude — this
                makes the transitions seamless.
              </li>
              <li>
                <strong>Post as Shorts/Reels.</strong> Construction ASMR performs best as
                15-60 second vertical videos. Crop and speed up as needed.
              </li>
              <li>
                <strong>Add ASMR audio.</strong> Layer construction sounds (concrete pouring,
                hammering, crane movements) for the full ASMR experience.
              </li>
              <li>
                <strong>Batch create.</strong> Use this workflow to create 5-10 different
                building types in one evening. More content = more chances to go viral.
              </li>
            </ul>

            <p>
              Want to learn more about{" "}
              <Link href="/blog/how-to-batch-generate-ai-videos-google-flow">
                batch processing with AutoFlow
              </Link>
              ? Or check our{" "}
              <Link href="/blog/best-prompts-ai-video-generation">
                25 best prompts for AI video
              </Link>
              .
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

            {/* ── FAQ ── */}
            <div className="blog-faq">
              <h3>❓ Frequently Asked</h3>
              <details>
                <summary>How long does the whole process take?</summary>
                <p>About 30-60 minutes. ~5 min for ChatGPT prompts, ~15 min for image generation, ~10 min to set up AutoFlow, and ~15-30 min for video generation (automated).</p>
              </details>
              <details>
                <summary>Does it cost anything?</summary>
                <p>ChatGPT and Google Flow are free to use. AutoFlow has a <Link href="/pricing">free plan</Link> with daily limits. For unlimited frame-to-video, use Pro.</p>
              </details>
              <details>
                <summary>Can I use different AI models?</summary>
                <p>Yes! Use Nano Banana 2 for images (best photorealism) and Veo 3.1 Fast for videos (most reliable). You can also try Veo 3 for higher quality.</p>
              </details>
              <details>
                <summary>What buildings work best?</summary>
                <p>Unique, dramatic structures get the most views: mountain airports, cliff mansions, underwater hotels, futuristic skyscrapers. Generic houses are less engaging.</p>
              </details>
            </div>

            {/* ── Related ── */}
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
