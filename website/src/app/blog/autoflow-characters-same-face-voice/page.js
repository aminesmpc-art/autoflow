import Link from "next/link";
import { getPostBySlug, SITE_URL, AUTHOR } from "../content";

export const dynamic = 'force-static';

const post = getPostBySlug("autoflow-characters-same-face-voice");

/* The YouTube id of the video made for this post. Empty: no player. */
const VIDEO_ID = "";

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

const Code = ({ children }) => <pre className="blog-code"><code>{children}</code></pre>;

export default function BlogPost() {
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
            author: { "@type": "Person", name: AUTHOR.name, url: AUTHOR.url },
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
              <span>·</span>
              <span>By <Link href="/about">{AUTHOR.name}</Link></span>
            </div>
          </div>

          {VIDEO_ID && (
            <div style={{ position: "relative", paddingTop: "56.25%", margin: "0 0 32px", borderRadius: "12px", overflow: "hidden" }}>
              <iframe
                src={`https://www.youtube-nocookie.com/embed/${VIDEO_ID}`}
                title={post.title}
                style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }}
                allow="accelerometer; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                loading="lazy"
              />
            </div>
          )}

          <nav className="blog-toc">
            <h4>📖 In This Article</h4>
            <ol>
              <li><a href="#why">Why a character, not a description</a></li>
              <li><a href="#make">Make a character in the Characters tab</a></li>
              <li><a href="#voice">Give it a voice</a></li>
              <li><a href="#use">Use it: just write the name</a></li>
              <li><a href="#chains">Scenes that continue</a></li>
              <li><a href="#import">Characters you already made in Flow</a></li>
              <li><a href="#agent">Let the agent cast your video</a></li>
            </ol>
          </nav>

          <div className="blog-article-content">
            <p>
              Meet Ruby, the presenter in the video above: red hair, freckles, green hoodie, a bright fast voice. Every one of
              her ten clips was generated separately, on different prompts, and she looks and sounds the same in all of them.
              That is what an <strong>AutoFlow character</strong> is for. This guide shows how to make one in the Queue Manager
              and use it in every queue.
            </p>

            <h2 id="why">Why a character, not a description</h2>
            <p>
              Describing a person again in each prompt gives you a slightly different person each time: the model reads
              &quot;a woman with red wavy hair&quot; afresh for every clip. A Flow character is saved once — a portrait, a name and a
              voice — and attached to the clip itself, so the face comes from the portrait and the voice from the character.
              AutoFlow makes your characters once, in a Flow project called <strong>AutoFlow Characters</strong>, and every queue
              borrows them from there; nothing has to be copied into each new project.
            </p>

            <h2 id="make">Make a character in the Characters tab</h2>
            <p>Open the Queue Manager&apos;s <strong>Characters</strong> tab and add a character. You need three things:</p>
            <ul>
              <li><strong>A name</strong> — the word you will write in prompts. Keep it unique: &quot;Ruby&quot;, not &quot;the girl&quot;.</li>
              <li><strong>A face</strong>, from a photo or from words:
                <ul>
                  <li><em>From a photo</em> — upload a clear, front-facing, well-lit picture. This is free.</li>
                  <li><em>From a description</em> — age, face, hair, clothes, setting. Flow draws one portrait with the image
                    model you choose (Nano Banana 2 Lite is the cheapest; 2.1 and Pro are sharper).</li>
                </ul>
              </li>
              <li><strong>A voice</strong> — see below.</li>
            </ul>
            <p>
              Optionally add a personality (&quot;fast-talking, optimistic, explains AI like a best friend&quot;) and choose whether the
              description is also written into every prompt that names the character. Making the character takes about a
              minute; its status turns to <strong>ready</strong>.
            </p>
            <p>
              A tip from making Ruby: a small or blurry photo makes a blurry character. Our first portrait was a 160-pixel
              thumbnail, so we drew her from her description instead — one image, and a sharp face for every clip after.
            </p>

            <h2 id="voice">Give it a voice</h2>
            <p>
              Pick one of Flow&apos;s 30 voices, each described in the list — Leda is &quot;female, youthful, mid-high pitch&quot;,
              Sadaltager &quot;male, knowledgeable, mid pitch&quot;. To make it your own, describe the performance: &quot;bright,
              fast-paced, highly enthusiastic, natural conversational cadence, speaks in English&quot;. AutoFlow turns that into a
              custom voice in Flow and gives it to the character. Saying the language in the performance helps keep the accent
              you want.
            </p>

            <h2 id="use">Use it: just write the name</h2>
            <p>
              In any video queue using <strong>Ingredients</strong> (references), write the character&apos;s name in the prompt and
              AutoFlow attaches the character for that clip:
            </p>
            <pre className="blog-code"><code>{`Ruby sits in her LED-lit bedroom studio, leans toward the camera and says:
"What if you could just tell an AI the video you want?" Medium close-up.`}</code></pre>
            <p>
              Put dialogue in quotes after the person who says it. With two characters in a shot, name both and make clear who
              speaks which line — ambiguous dialogue is the usual reason two characters swap voices.
            </p>

            <h2 id="chains">Scenes that continue</h2>
            <p>
              For a scene that flows across clips, put the prompts that continue inside square brackets. Each one starts from
              the last frame of the clip before it, added as a reference, so position, light and framing carry over — and the
              character still comes from its saved face and voice.
            </p>

            <h2 id="import">Characters you already made in Flow</h2>
            <p>
              Made characters by hand in Flow? Open that project in your Flow tab and import them into the Characters tab. They
              keep the face and voice you gave them in Flow, and every queue can use them by name.
            </p>

            <h2 id="agent">Let the agent cast your video</h2>
            <p>
              With the <Link href="/blog/ai-agent-controls-autoflow-claude-code-codex">AutoFlow agent</Link> connected, your AI
              assistant can do all of this from a sentence: &quot;make a presenter called Ruby, red wavy hair, green hoodie, voice
              Leda, bright and fast&quot;, then &quot;queue my script with Ruby presenting&quot;. It lists the characters and voices,
              makes the character (telling you first that the portrait costs one image), and writes her name into every prompt.
            </p>

            <h2>Related guides</h2>
            <ul>
              <li><Link href="/blog/ai-agent-controls-autoflow-claude-code-codex">Let an AI agent run AutoFlow</Link></li>
              <li><Link href="/blog/consistent-characters-google-flow">Keep the same character in every Flow shot, by hand</Link></li>
            </ul>
          </div>
        </div>
      </article>
    </>
  );
}
