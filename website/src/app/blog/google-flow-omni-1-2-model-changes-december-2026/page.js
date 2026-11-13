import Link from "next/link";
import { getPostBySlug, SITE_URL } from "../content";

export const dynamic = 'force-static';

const post = getPostBySlug("google-flow-omni-1-2-model-changes-december-2026");

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
          </div>

          <nav className="blog-toc">
            <h4>📖 In This Article</h4>
            <ol>
              <li><a href="#menu">The video model menu today</a></li>
              <li><a href="#omni-12">What is new in Omni 1.2 Flash</a></li>
              <li><a href="#credits">What it costs in credits</a></li>
              <li><a href="#leaving">What leaves on December 5</a></li>
              <li><a href="#images">The image models changed too</a></li>
              <li><a href="#move">How to move your workflows</a></li>
            </ol>
          </nav>

          <div className="blog-article-content">
            <p>
              Google Flow changed its model menu in early November 2026. A new video model, <strong>Omni 1.2 Flash</strong>,
              arrived with a length slider instead of fixed durations, and three models are marked
              <strong> &quot;Leaving Dec 5&quot;</strong>. If you run batches on Flow, some of your saved settings will stop working
              that day. We read every number below off Flow&apos;s own menus on our account on November 7; Flow changes often and
              accounts differ, so check your own menu before relying on a figure.
            </p>

            <h2 id="menu">The video model menu today</h2>
            <p>Open the settings chip under the prompt box, switch to Video, and the model menu lists five models:</p>
            <table className="blog-table">
              <thead>
                <tr><th>Model</th><th>Length</th><th>Resolution</th><th>Status</th></tr>
              </thead>
              <tbody>
                <tr><td><strong>Omni 1.2 Flash</strong></td><td>3–15 s, any whole second</td><td>360p or 720p</td><td>New</td></tr>
                <tr><td>Omni 1.1 Flash</td><td>4, 6, 8 or 10 s</td><td>360p or 720p</td><td>Leaving Dec 5</td></tr>
                <tr><td><strong>Veo 3.1 - Lite</strong></td><td>Fixed 8 s</td><td>Fixed 720p</td><td>Staying</td></tr>
                <tr><td>Veo 3.1 - Fast</td><td>Fixed 8 s</td><td>Fixed 720p</td><td>Leaving Dec 5</td></tr>
                <tr><td>Veo 3.1 - Quality</td><td>Fixed 8 s</td><td>Fixed 720p</td><td>Leaving Dec 5</td></tr>
              </tbody>
            </table>
            <p>
              Some accounts also see <strong>Veo 3.1 - Lite [Lower Priority]</strong>, a slower queue for the same model. If you have
              it, it is a different menu entry from plain Lite, so a saved workflow that names one will not silently use the other.
            </p>

            <h2 id="omni-12">What is new in Omni 1.2 Flash</h2>
            <p>
              The headline change is length. Omni 1.1 offers four buttons, 4, 6, 8 and 10 seconds. Omni 1.2 replaces them with a
              <strong> Length</strong> slider from 3 to 15 seconds in one-second steps, and the settings chip reads the result back,
              for example &quot;Video · 720p · 12s&quot;. Two practical consequences:
            </p>
            <ul>
              <li>
                <strong>Fewer cuts for dialogue.</strong> A line that needed two 8-second clips stitched together now fits in one
                12- or 15-second clip, which keeps the voice and the framing continuous.
              </li>
              <li>
                <strong>Switching back clamps the length.</strong> If you pick 15 s on Omni 1.2 and then choose Omni 1.1, Flow sets it
                to 10 s, the longest 1.1 allows. Check the chip after changing models.
              </li>
            </ul>
            <p>
              Flow also stopped refusing long reference videos. When a video you attach is longer than the model accepts, Flow now
              generates from its opening seconds and says so: &quot;Only the first N s of your video will be edited&quot;. If you rely on a
              reference that runs long, trim it yourself so you choose which part is used.
            </p>

            <h2 id="credits">What it costs in credits</h2>
            <p>Omni 1.2 is roughly twice the price of Omni 1.1 for the same length at 720p:</p>
            <table className="blog-table">
              <thead>
                <tr><th>Length at 720p</th><th>Omni 1.1 Flash</th><th>Omni 1.2 Flash</th></tr>
              </thead>
              <tbody>
                <tr><td>4 s</td><td>7 credits</td><td>12 credits</td></tr>
                <tr><td>8 s</td><td>12 credits</td><td>24 credits</td></tr>
                <tr><td>10 s</td><td>15 credits</td><td>30 credits</td></tr>
                <tr><td>15 s</td><td>—</td><td>60 credits</td></tr>
              </tbody>
            </table>
            <p>
              Up to 10 seconds Omni 1.2 costs 3 credits a second; the step from 10 to 15 seconds doubles the price of the clip.
              For a long batch, decide per shot: a wide establishing shot rarely needs 15 seconds, a monologue often does.
            </p>

            <h2 id="leaving">What leaves on December 5</h2>
            <p>
              Omni 1.1 Flash, Veo 3.1 - Fast and Veo 3.1 - Quality all carry &quot;Leaving Dec 5&quot; in the menu. After that date a
              workflow, queue or saved preset that names one of them has to be pointed at a model that stays:
            </p>
            <ul>
              <li><strong>From Omni 1.1 Flash</strong> → Omni 1.2 Flash. Pick the length again: 1.2 has no 4/6/8/10 buttons.</li>
              <li><strong>From Veo 3.1 - Fast or Quality</strong> → Veo 3.1 - Lite for the same fixed 8-second, 720p clip, or Omni 1.2 if you want to choose the length.</li>
            </ul>
            <p>
              Test a handful of your usual prompts on the new model before December 5 rather than after, while you can still compare
              against the old one side by side.
            </p>

            <h2 id="images">The image models changed too</h2>
            <p>
              In Image mode the menu now lists <strong>Nano Banana Pro</strong>, <strong>Nano Banana 2 Lite</strong> and
              <strong> Nano Banana 2.1</strong>. Imagen 4 and the plain Nano Banana 2 are gone. Older guides, including some of ours,
              mention ImageFX or Nano Banana 2; in today&apos;s Flow the equivalent is Image mode with Nano Banana 2.1 or Pro.
            </p>

            <h2 id="move">How to move your workflows</h2>
            <ol>
              <li>List every place a model name is saved: Flow presets, AutoFlow queues, Studio workflows.</li>
              <li>Run three of your typical prompts on the replacement model and compare cost and look.</li>
              <li>For Omni 1.2, set a length per shot instead of one length for the whole batch.</li>
              <li>Keep one test project in Flow for this, so experiments do not mix with client work.</li>
            </ol>
            <p>
              If you batch with <Link href="/">AutoFlow</Link>, it sets the duration and resolution only on models that have them,
              compares Flow&apos;s settings chip with your settings before each prompt, and lets you pick Omni 1.2 lengths per run. The{" "}
              <Link href="/changelog">changelog</Link> lists each update as Flow changes.
            </p>

            <h2>Related guides</h2>
            <ul>
              <li><Link href="/blog/consistent-characters-google-flow">Keep the same character in every Flow shot</Link></li>
              <li><Link href="/blog/google-flow-tips-avoid-failed-generations">Google Flow tips to avoid failed generations</Link></li>
              <li><Link href="/blog/how-to-batch-generate-ai-videos-google-flow">How to batch generate AI videos with Google Flow</Link></li>
            </ul>
          </div>
        </div>
      </article>
    </>
  );
}
