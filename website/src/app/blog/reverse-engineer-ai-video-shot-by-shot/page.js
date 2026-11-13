import Link from "next/link";
import { getPostBySlug, SITE_URL } from "../content";

export const dynamic = 'force-static';

const post = getPostBySlug("reverse-engineer-ai-video-shot-by-shot");

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
              <li><a href="#video">The video we used</a></li>
              <li><a href="#options">Choosing the options</a></li>
              <li><a href="#shots">What came back: the shots</a></li>
              <li><a href="#characters">Character sheets and the master prompt</a></li>
              <li><a href="#check">What to check before you use it</a></li>
              <li><a href="#remake">Remaking it</a></li>
            </ol>
          </nav>

          <div className="blog-article-content">
            <p>
              Every few days a short AI video goes viral and the comments fill with the same question: &quot;what prompts did you
              use?&quot; The honest answer is usually dozens of them, one per shot. This is a walkthrough of what the{" "}
              <Link href="/extractor">Video Prompt Extractor</Link> recovers from a real video, with the actual numbers from our
              run, and the two things we learned to check every time.
            </p>

            <h2 id="video">The video we used</h2>
            <p>
              A 42-second vertical (9:16) comedy skit: two toddlers in streetwear sit in lawn chairs in a backyard, decide to dig a
              pool to impress girls, strike oil instead, and celebrate. It is a good test because it has everything that makes
              extraction hard: fast cuts, two recurring characters, dialogue going back and forth, and a change of location
              halfway through.
            </p>

            <h2 id="options">Choosing the options</h2>
            <p>
              You can upload the file or paste a link. Before running, a row of options sets what you get back. We left most of
              them alone; these are the ones that matter:
            </p>
            <ul>
              <li><strong>Shots:</strong> Auto lets the engine follow the real cuts. Pick a number only if you want to merge or split.</li>
              <li><strong>Style:</strong> &quot;Match the video&quot; describes what is on screen. Choose Cinematic, Anime or another style to restyle every prompt instead.</li>
              <li><strong>Frame:</strong> rewrites the prompts for another aspect ratio, useful when turning a vertical video into a 16:9 one.</li>
              <li><strong>Part:</strong> analyse one section of a long video instead of all of it.</li>
              <li><strong>Brief:</strong> a sentence of creative direction, such as &quot;same story, set in Tokyo at night&quot;. It changes what the prompts describe while keeping the shots, timing and camera work.</li>
            </ul>

            <h2 id="shots">What came back: the shots</h2>
            <p>
              The run took under a minute. It found <strong>28 shots</strong>, lined up with the real cuts in the video, and each
              shot came back with:
            </p>
            <ul>
              <li>a frame from the shot and its exact start and end time;</li>
              <li>the camera: shot size, lens and movement, for example &quot;close-up · 50mm, shallow depth of field · slight handheld push-in&quot;;</li>
              <li>who is in it, by character name;</li>
              <li>an <strong>image prompt</strong> for the still and a <strong>motion prompt</strong> for the clip;</li>
              <li>the dialogue, attributed to the character who says it, and the sound.</li>
            </ul>
            <p>
              The split into image and motion prompts follows how most people work today: generate a still you are happy with,
              then animate it. The first shot&apos;s motion prompt was a single line — a handheld push-in on the boy finishing a sip
              from a tiny bottle, outdoor daylight — which is about the right length for a 1–2 second shot.
            </p>

            <h2 id="characters">Character sheets and the master prompt</h2>
            <p>
              Alongside the shots came a <strong>character design sheet</strong> for each of the two boys: a turnaround prompt
              (front, three-quarter, side, back) describing age, face, hair and clothes, written to produce a clean reference image.
              Each sheet also lists the shots the character appears in. These sheets are what keep the faces consistent when you
              remake the video; in Google Flow they become the portraits of saved <Link href="/blog/consistent-characters-google-flow">Characters</Link>.
            </p>
            <p>
              Finally a <strong>master prompt</strong> describes the whole video in one paragraph, and again as structured JSON for
              tools that take fields. It is the quickest way to make &quot;a video like this one&quot; without going shot by shot. The
              voiceover and dialogue also come back as one script you can copy.
            </p>

            <h2 id="check">What to check before you use it</h2>
            <p>Two things are worth thirty seconds every time.</p>
            <h3>1. Who is who</h3>
            <p>
              In one of our early runs the model gave the two boys&apos; names the wrong way round: the line &quot;Yo Benny, this stuff
              hitting&quot; was given to Benny himself. Names drive everything downstream — the character sheets and which reference
              goes into which shot — so one swap mislabels the whole video. The extractor now checks for a character addressing
              themselves by name and adds a note when it happens, but read the cast against the frames before you generate.
            </p>
            <h3>2. The notes</h3>
            <p>
              When the engine merges or repairs anything — shots too short to keep, timings that overlapped — it says so in a Notes
              list rather than silently returning fewer shots. If a note is there, read it.
            </p>
            <p>
              Anything you want to change can be asked for in plain words: &quot;make every shot golden hour&quot;, &quot;split shot 2 into a
              wide and a close-up&quot;. For the first hour after extracting, a change that needs another look at the video can use it.
            </p>

            <h2 id="remake">Remaking it</h2>
            <ol>
              <li>Generate a reference image from each character sheet and save it as a Character in Flow, named exactly as in the extraction.</li>
              <li>Generate the stills from the image prompts, attaching the right characters to each shot.</li>
              <li>Animate each still with its motion prompt; keep clip lengths close to the original shot lengths.</li>
              <li>Cut them together on the timings from the shot list. The cut-list download (EDL) opens in Premiere or DaVinci.</li>
            </ol>
            <p>
              Doing twenty-eight shots by hand is an afternoon. With <Link href="/studio">AutoFlow Studio</Link> the extraction
              opens as a canvas with every shot&apos;s prompts already wired in, and <Link href="/">AutoFlow</Link> queues the whole
              batch on Flow. Either way, the point of reverse-engineering is not to copy someone&apos;s video frame for frame, but to
              learn its structure — the pacing, the shot choices, the way the joke lands — and use it for your own story.
            </p>
            <p>
              Want the &quot;why&quot; instead of the &quot;how&quot;? <Link href="/breakdown">Why it works</Link> runs the same video through a
              different question: the hook, the pacing measured from the cuts, and where viewers are likely to leave.
            </p>

            <h2>Related guides</h2>
            <ul>
              <li><Link href="/blog/consistent-characters-google-flow">Keep the same character in every Flow shot</Link></li>
              <li><Link href="/blog/how-to-recreate-ai-videos-with-extractor-and-autoflow">Batch-generate an extracted video with AutoFlow</Link></li>
            </ul>
          </div>
        </div>
      </article>
    </>
  );
}
