import Link from "next/link";
import { getPostBySlug, getRelatedPosts, SITE_URL } from "../content";

export const dynamic = 'force-static';

const post = getPostBySlug("how-to-recreate-ai-videos-with-extractor-and-autoflow");

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
              <li><a href="#intro">The Power of Reverse-Engineering</a></li>
              <li><a href="#one-click">The Fast Way: One Button to Studio</a></li>
              <li><a href="#manual">The Manual Route (Queue Manager)</a></li>
              <li><a href="#step-1">Step 1: Generate Characters (Nano Banana 2)</a></li>
              <li><a href="#step-2">Step 2: Batch Generate Images</a></li>
              <li><a href="#step-3">Step 3: Auto Character Mapping</a></li>
              <li><a href="#step-4">Step 4: Image to Video & Auto-Queue</a></li>
            </ol>
          </nav>

          <div className="blog-article-content">
            <p>
              Ever seen a viral AI-generated video and wondered exactly what prompts the creator used? 
              With the <strong>Video Prompt Extractor</strong>, you can reverse-engineer any MP4 or WebM video to reveal its hidden Image Prompts (Midjourney) and Video Motion Prompts (Runway/Sora).
            </p>
            <p>
              But extracting the prompts is only half the battle — they still have to become a video.
              This tutorial covers both routes: the one-button hand-off into{" "}
              <strong><Link href="/studio">AutoFlow Studio</Link></strong>, which builds the whole wired
              workflow for you, and the manual copy-and-paste route through the{" "}
              <strong><Link href="/">AutoFlow Queue Manager</Link></strong> for batch generation.
            </p>

            <h2 id="one-click">The Fast Way: One Button to Studio</h2>
            <p>
              Everything below this section still works, and for a long time it was the only route.
              It is no longer the fastest one. If you have <strong><Link href="/studio">AutoFlow Studio</Link></strong> installed,
              the Extractor now builds the whole workflow for you and opens it on the canvas.
            </p>
            <p>
              Run your extraction as usual, scroll to <strong>Build an AutoFlow Studio Workflow</strong>,
              choose what you want built, and press <strong>Open in Studio</strong>. That is the whole
              procedure. What arrives on the canvas is not a list of prompts to sort out — it is a
              wired graph:
            </p>
            <ul>
              <li>Every <strong>character sheet</strong> becomes its own node, shot square so a turnaround keeps its outer poses.</li>
              <li>Every shot becomes a <strong>still</strong>, with all of the character sheets connected into it. That is what holds a face still across a dozen shots, and it is the wiring people skip by hand because it is tedious.</li>
              <li>Every still feeds <strong>its own clip</strong> — never a neighbouring one, which is how continuity breaks with no explanation.</li>
            </ul>
            <p>
              The count under the button is what Studio itself says it will generate, not an estimate
              the website worked out separately — so the number you read is the number you pay for.
              Change the build mode to <em>Stills only</em> to see the look before committing to video.
            </p>
            <p>
              Don&apos;t have the extension? The button becomes <strong>Download Workflow</strong> and you
              get the same graph as a file to import. Nothing is lost either way.
            </p>

            <h2 id="manual">The Manual Route (Queue Manager)</h2>
            <p>
              The rest of this guide covers the copy-and-paste route through the{" "}
              <strong>AutoFlow Queue Manager</strong> extension. It is worth reading if you use Queue
              Manager rather than Studio, if you want the images on your own disk between the two
              stages, or if you simply want to see what the one-click route is doing on your behalf.
            </p>

            <h2 id="step-1">Step 1: Generate Characters (Example: Nano Banana 2)</h2>
            <p>
              First things first: when the Extractor analyzes a video, it generates Character Design Sheets. 
              You need to generate your character reference images first.
            </p>
            <img src="/screenshots/blog/extractor-tutorial/01.png" alt="Nano Banana 2 Generation" className="blog-image" />
            <img src="/screenshots/blog/extractor-tutorial/02.png" alt="Nano Banana 2 Image Result" className="blog-image" />
            
            <p>
              Copy the character prompt from the Extractor and generate your reference image. 
              <strong>CRITICAL STEP:</strong> Once generated, you must name the character and the image with the exact same name (e.g., <em>Nano Banana 2</em>). This is required for the Auto Character Mapping feature to work later!
            </p>

            <h2 id="step-2">Step 2: Batch Generate Images</h2>
            <p>
              After generating your character, scroll down to the new <strong>Export for AutoFlow Extension</strong> section on the Extractor page. Click <strong>Copy All Image Prompts</strong>.
            </p>
            <img src="/screenshots/blog/extractor-tutorial/03.png" alt="Batch copy image prompts" className="blog-image" />
            
            <p>
              Open the AutoFlow extension, go to the <strong>Create</strong> tab, and paste the entire list of prompts. Click <strong>Parse Prompts</strong>.
            </p>
            <img src="/screenshots/blog/extractor-tutorial/04.png" alt="Paste prompts into AutoFlow" className="blog-image" />
            <img src="/screenshots/blog/extractor-tutorial/05.png" alt="Parsed prompts in AutoFlow" className="blog-image" />
            <img src="/screenshots/blog/extractor-tutorial/06.png" alt="Running batch generation" className="blog-image" />
            
            <p>
              Let AutoFlow generate all the Midjourney/ImageFX images automatically. Once they are done, batch download them to your computer.
            </p>
            <img src="/screenshots/blog/extractor-tutorial/07.png" alt="Batch downloading generated images" className="blog-image" />
            <img src="/screenshots/blog/extractor-tutorial/08.png" alt="Downloaded images" className="blog-image" />

            <h2 id="step-3">Step 3: Auto Character Mapping</h2>
            <p>
              Now it&apos;s time to turn those static images into a video timeline. In the AutoFlow extension, click on <strong>Ingredients</strong> and then <strong>Settings</strong> to open your video configuration.
            </p>
            <img src="/screenshots/blog/extractor-tutorial/09.png" alt="AutoFlow Ingredients Tab" className="blog-image" />
            <img src="/screenshots/blog/extractor-tutorial/10.png" alt="AutoFlow Settings Tab" className="blog-image" />

            <p>
              Go back to the Extractor website and click <strong>Copy All Video Prompts</strong>. Paste these into the extension&apos;s Video Prompts section.
            </p>
            <img src="/screenshots/blog/extractor-tutorial/11.png" alt="Copying video prompts" className="blog-image" />
            
            <p>
              Here is where the magic happens: click on the <strong>Mapping</strong> button in the extension. Because you named your reference images exactly the same as the characters in the prompts, AutoFlow will automatically assign every reference image to the correct video prompt!
            </p>
            <img src="/screenshots/blog/extractor-tutorial/12.png" alt="Auto Character Mapping feature" className="blog-image" />
            <img src="/screenshots/blog/extractor-tutorial/13.png" alt="Mapped characters in AutoFlow" className="blog-image" />

            <h2 id="step-4">Step 4: Image to Video & Auto-Queue</h2>
            <p>
              With your images mapped to your video prompts, simply click <strong>Add to Queue</strong>.
            </p>
            <img src="/screenshots/blog/extractor-tutorial/14.png" alt="Adding tasks to queue" className="blog-image" />
            <img src="/screenshots/blog/extractor-tutorial/15.png" alt="Queue processing" className="blog-image" />
            <img src="/screenshots/blog/extractor-tutorial/16.png" alt="Final video batch" className="blog-image" />

            <p>
              AutoFlow will now take over your browser, automatically uploading the reference images to Google Flow / Runway, pasting the motion prompts, and generating the final videos one by one. 
            </p>

            <p>
              <strong>Congratulations!</strong> You have just successfully reverse-engineered a viral AI video and recreated the entire timeline on autopilot.
            </p>

            <h2>Ready to Try It?</h2>
            <p>
              <Link href="/extractor" className="btn btn-primary" style={{ marginRight: "12px" }}>
                Try the Extractor
              </Link>
              <a
                href="https://chromewebstore.google.com/detail/autoflow-video-task-man/egplmjhmcicjkojopeoaohofckgeoipc"
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-secondary"
              >
                Install AutoFlow
              </a>
            </p>
          </div>
        </div>
      </article>
    </>
  );
}
