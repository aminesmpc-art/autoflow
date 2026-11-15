import Link from "next/link";
import { getPostBySlug, SITE_URL } from "../content";

export const dynamic = 'force-static';

const post = getPostBySlug("consistent-characters-google-flow");

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
              <li><a href="#why">Why characters drift, and what a Character is</a></li>
              <li><a href="#create">Create a character: from a description or an image</a></li>
              <li><a href="#voice">Give it a voice</a></li>
              <li><a href="#prompt">Put the character in a prompt</a></li>
              <li><a href="#borrow">Use a character from another project</a></li>
              <li><a href="#tips">Tips that save credits</a></li>
            </ol>
          </nav>

          <div className="blog-article-content">
            <p>
              The fastest way to make an AI video look amateur is a hero whose face changes between shots. Describing the person
              again in every prompt does not fix it: the model reads &quot;a woman with short red hair&quot; slightly differently each
              time. Google Flow&apos;s <strong>Characters</strong> solve this by saving the person once — a face, a name and a voice —
              and attaching them to any prompt. Everything below was done and checked in Flow in November 2026.
            </p>

            <h2 id="why">Why characters drift, and what a Character is</h2>
            <p>
              A text prompt is a description, not an identity. A Character in Flow is a saved asset with four parts:
            </p>
            <ul>
              <li><strong>A name</strong>, which is how you find it and how you refer to it in prompts.</li>
              <li><strong>A portrait</strong>, the reference image the model keeps the face from.</li>
              <li><strong>A voice</strong> (optional), used whenever the character speaks.</li>
              <li><strong>Character info</strong> (optional), a few lines of personality and manner.</li>
            </ul>
            <p>
              When a prompt carries the character, the clip keeps the portrait&apos;s face and speaks in the character&apos;s voice. In
              our test, a 4-second Omni clip at 360p cost 4 credits and came back with both the face and the custom voice.
            </p>

            <h2 id="create">Create a character: from a description or an image</h2>
            <p>Open the <strong>Add media</strong> menu at the top of a project and choose <strong>Create character</strong>. There are two ways in.</p>
            <h3>From a description</h3>
            <ol>
              <li>Describe the person in the box (&quot;Describe your character…&quot;): age, face, hair, clothes.</li>
              <li>Pick the image model: Nano Banana Pro, Nano Banana 2 Lite or Nano Banana 2.1.</li>
              <li>
                Press <strong>Format</strong>. In about ten seconds Flow rewrites your description into a clean studio-portrait
                prompt. This is worth doing: a plain, evenly lit portrait makes a better reference than a dramatic one.
              </li>
              <li>Generate. The character exists straight away and its portrait is ready in a few seconds.</li>
            </ol>
            <h3>From an image you already have</h3>
            <p>
              Choose <strong>Add from project</strong> and pick an image from the project, or upload one. The character is created
              the moment you pick it, without spending credits on a new portrait. Use a front-facing, well-lit picture with the
              face clearly visible; a profile or a busy background gives the model less to hold on to.
            </p>
            <p>Then give it a name — the same name you will write in your prompts — and press Done.</p>

            <h2 id="voice">Give it a voice</h2>
            <p>
              On the character&apos;s page, open the voice button. Flow offers 30 ready-made voices, each with a short description
              such as &quot;Female, soft, high pitch&quot;, and you can preview them before choosing.
            </p>
            <p>
              For something more specific, make your own: describe the performance (accent, pace, mood), add a sample line of
              dialogue, name the voice and save it. Saving takes around twenty seconds. Then select the new voice to assign it. A
              custom voice belongs to the project it was made in, but it travels with the character wherever the character is used.
            </p>

            <h2 id="prompt">Put the character in a prompt</h2>
            <ol>
              <li>In the prompt box, press <strong>+</strong> and open the <strong>Characters</strong> tab.</li>
              <li>Choose the character and press <strong>Add to prompt</strong>. A character chip appears in the prompt.</li>
              <li>
                Write the prompt about the scene and the action, and refer to the character by name: &quot;Maya walks into the café
                and orders a coffee, smiling at the barista.&quot; The face and the voice come from the chip, so you no longer need to
                describe them.
              </li>
            </ol>
            <p>
              Two characters in one shot work the same way: add both chips and name both in the prompt, saying clearly who does
              what and who speaks which line. Ambiguous dialogue is the most common reason two characters swap voices.
            </p>

            <h2 id="borrow">Use a character from another project</h2>
            <p>
              Characters are listed per project, so a brand-new project&apos;s Characters tab says there are no assets. That does not
              mean you have to recreate your cast. The <strong>+</strong> menu has a <strong>project selector</strong> at the top:
              switch it to the project that holds the character, open Characters, and add it. The chip lands in your current prompt
              with the face and the custom voice, and nothing is copied between projects.
            </p>
            <p>
              This makes a simple habit possible: keep one <strong>cast project</strong> that holds every recurring character, and
              borrow from it in each new episode or client project. Edit the portrait or voice once there and every future clip uses
              the change.
            </p>

            <h2 id="tips">Tips that save credits</h2>
            <ul>
              <li><strong>Test at 360p and 4 seconds</strong> before a long run: it is the cheapest way to check face and voice.</li>
              <li><strong>Keep names unique.</strong> Two characters called &quot;Sam&quot; in different projects are hard to tell apart in the selector.</li>
              <li><strong>Name matches prompt.</strong> If the character is &quot;Maya&quot;, write Maya in the prompt, not &quot;the girl&quot;.</li>
              <li><strong>One person per portrait.</strong> A reference with two faces confuses which one to keep.</li>
            </ul>
            <p>
              If you produce many clips with the same cast, <Link href="/">AutoFlow</Link> can find the characters already saved in
              Flow and attach the right one to every prompt that mentions its name, so a batch of fifty shots keeps the same faces
              without you adding chips by hand. <Link href="/studio">AutoFlow Studio</Link> does the same on its canvas.
            </p>

            <h2>Related guides</h2>
            <ul>
              <li><Link href="/blog/google-flow-omni-1-2-model-changes-december-2026">Google Flow&apos;s new models and what leaves on December 5</Link></li>
              <li><Link href="/blog/reverse-engineer-ai-video-shot-by-shot">Reverse-engineering a viral AI video, shot by shot</Link></li>
            </ul>
          </div>
        </div>
      </article>
    </>
  );
}
