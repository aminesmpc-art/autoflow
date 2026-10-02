import Link from "next/link";
import { getPostBySlug, getRelatedPosts, SITE_URL } from "../content";

export const dynamic = 'force-static';

const post = getPostBySlug("how-to-make-money-clipping-videos");

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

/* Rendered on the page AND emitted as FAQPage. These are the questions this
   topic's results actually compete on — how much, is it legal, do I need to
   show my face — so answering them in the body is what earns the click, not
   just the rich result. */
const FAQ = [
  {
    q: "How much do clippers actually make?",
    a: "Campaigns advertise $1-5 per 1,000 views, but independent tracking of $2.58M in payouts puts the blended rate actually paid at about $0.39 per 1,000. The gap is caps, view minimums and pools that run dry mid-month. A first month is realistically $0-80. A clipper posting 10-20 times a day on live campaigns lands $400-$1,500 a month.",
  },
  {
    q: "Do I need to show my face?",
    a: "No. Most clipping is faceless by definition, because you are cutting a stream or podcast someone else recorded. On-camera UGC pays more per view (around $3.50 per 1,000 against $1 for a basic clip) but it is a different job with a different workload.",
  },
  {
    q: "Is clipping someone else's stream legal?",
    a: "When you clip for a campaign the creator has posted, you have their permission by definition — that is the arrangement. Clipping someone who has not invited it is a different matter and depends on their terms and on fair use where you live. Stick to open campaigns and the question does not arise.",
  },
  {
    q: "How many clips do I need to post?",
    a: "Volume is the entire job. At a realistic $0.39 per 1,000 views, $500 a month means roughly 1.3 million views. Spread over 30 days at 20,000 views a clip, that is about two clips a day that land, which in practice means posting considerably more than two.",
  },
  {
    q: "What do I need to start?",
    a: "A phone or laptop, an account on the platform you are posting to, and a source of long footage. Most people start by joining an open campaign on a rewards platform, because the brief and the payment terms are already defined for you.",
  },
  {
    q: "Can AI cut the clips for me?",
    a: "The finding and cutting, yes. A tool can read a long recording, rank the moments, cut on the spoken line, reframe to 9:16 and caption it. What it cannot do is choose a campaign worth entering or judge whether a moment is actually funny. That part stays yours.",
  },
];

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
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "FAQPage",
            mainEntity: FAQ.map(({ q, a }) => ({
              "@type": "Question",
              name: q,
              acceptedAnswer: { "@type": "Answer", text: a },
            })),
          }),
        }}
      />

      <article className="blog-post">
        <div className="container">
          <div className="blog-post-header">
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
              <li><a href="#what-it-is">What Clipping Actually Is</a></li>
              <li><a href="#how-paid">The 4 Ways Clippers Get Paid</a></li>
              <li><a href="#real-rates">What the Rates Really Are</a></li>
              <li><a href="#the-math">The Honest Math</a></li>
              <li><a href="#bottleneck">Where the Time Actually Goes</a></li>
              <li><a href="#start">How to Start This Week</a></li>
              <li><a href="#mistakes">Mistakes That Cost People Months</a></li>
              <li><a href="#faq">FAQ</a></li>
            </ol>
          </nav>

          <div className="blog-article-content">
            <p>
              Clipping became a real job somewhere around 2024, and by 2026 it has
              its own economy. Creators put up a pool of money, clippers cut their
              long streams into vertical clips, post them, and get paid on the views
              they deliver.
            </p>
            <p>
              Most guides quote the advertised rates and stop there. This one starts
              with the number that matters — <strong>what actually lands in the
              account</strong> — because the two are not close, and knowing the
              difference is what separates the people who stick with this from the
              people who quit in week three feeling cheated.
            </p>

            <h2 id="what-it-is">What Clipping Actually Is</h2>
            <p>
              A creator streams for six hours. Somewhere in there are fifteen moments
              worth watching on their own. Your job is to find them, cut them, make
              them work vertically with captions, and post them where they will be
              seen — usually TikTok, Reels or Shorts.
            </p>
            <p>
              You are not making the content. You are finding the good parts of
              content that already exists. That is why it is accessible: no camera,
              no on-screen presence, and no audience of your own to begin with.
            </p>

            <h2 id="how-paid">The 4 Ways Clippers Get Paid</h2>

            <h3>1. Per-view campaigns</h3>
            <p>
              A creator or brand funds a pool and publishes a brief. You post clips
              tagged to the campaign and are paid per 1,000 verified views. Rates run{" "}
              <strong>$0.20 to $6 per 1,000</strong> depending on platform and
              campaign, clustering around $1. Gambling-stream campaigns pay the most
              and carry the obvious caveats.
            </p>

            <h3>2. Flat fee per clip</h3>
            <p>
              <strong>$5 to $500 per clip</strong>, depending on how much editing the
              creator wants and how good you are. It does not scale on its own, but
              it is far better when you are starting, because you are paid whether or
              not the clip performs.
            </p>

            <h3>3. Retainer</h3>
            <p>
              <strong>$500 to $3,000 a month</strong> from one creator or agency to be
              their clipper. This is where consistent people end up, and it is
              usually earned by doing one of the two above well enough that someone
              wants to lock you in.
            </p>

            <h3>4. Your own channel</h3>
            <p>
              Clip with permission, build a faceless channel, monetise it yourself.
              Slowest to start, and the only one of the four where you own the asset
              at the end of it.
            </p>

            <h2 id="real-rates">What the Rates Really Are</h2>
            <p>
              Here is the part campaign pages do not lead with. Advertised rates sit
              at <strong>$1-5 per 1,000 views</strong>. Independent tracking across{" "}
              <strong>$2.58M of real payouts</strong> puts the blended rate actually
              paid at about <strong>$0.39 per 1,000</strong>.
            </p>
            <p>Three things eat the difference:</p>
            <ul>
              <li><strong>Per-clip caps.</strong> A clip doing 4M views may be capped at $1,000, or far less.</li>
              <li><strong>View minimums.</strong> Clips under a threshold pay nothing at all, and most clips are under it.</li>
              <li><strong>Pools running dry.</strong> Budgets are finite. Post into an exhausted campaign and you worked for free.</li>
            </ul>
            <p>
              None of that makes clipping a scam. It makes the advertised CPM a
              ceiling rather than a rate, and you should plan against the floor.
            </p>

            <h2 id="the-math">The Honest Math</h2>
            <p>Working backwards from the blended $0.39 per 1,000:</p>
            <ul>
              <li><strong>$100/month</strong> ≈ 256,000 views ≈ 8,500 views a day</li>
              <li><strong>$500/month</strong> ≈ 1.3M views ≈ 43,000 views a day</li>
              <li><strong>$1,500/month</strong> ≈ 3.8M views ≈ 128,000 views a day</li>
            </ul>
            <p>And what people actually report earning:</p>
            <ul>
              <li><strong>Month one:</strong> $0 to $80. This is normal. Do not read it as failure.</li>
              <li><strong>Posting 10-20 clips a day on live campaigns:</strong> $400 to $1,500 a month.</li>
              <li><strong>Top faceless operators:</strong> $3,000 to $8,000 — full-time, systematised, several accounts.</li>
            </ul>
            <p>
              The pattern is hard to miss. The people earning are the people posting
              ten to twenty times a day, not the people making the prettiest clip.
            </p>

            <h2 id="bottleneck">Where the Time Actually Goes</h2>
            <p>
              If volume is the job, the constraint is how long one clip takes. By
              hand, a single clip means scrubbing a six-hour recording for a moment,
              trimming it, cropping to 9:16 without cutting the speaker&apos;s head
              off, captioning it and exporting. Fifteen to forty minutes, honestly.
            </p>
            <p>
              At thirty minutes each, twenty clips a day is a ten-hour shift before
              you have posted anything. That is the wall almost everyone hits, and it
              is why most people plateau at two or three clips a day and conclude the
              rates are the problem.
            </p>
            <p>
              This is the part worth automating, because it is mechanical. The{" "}
              <Link href="/clipping">free AI clip maker</Link> reads the whole
              recording, ranks the moments worth posting, cuts on the spoken line
              rather than mid-word, reframes to 9:16 from a measured face track,
              captions it, and hands back an edit sheet timed to the second. One
              recording becomes a batch instead of an evening.
            </p>
            <p>
              What it will not do is choose your campaign or tell you what is funny.
              The judgement stays yours. The scrubbing does not have to.
            </p>

            <h2 id="start">How to Start This Week</h2>
            <ol>
              <li><strong>Pick one platform.</strong> TikTok or Shorts. Not both, not yet.</li>
              <li><strong>Join one open campaign</strong> with a brief you can follow, and read the caps and view minimums before you cut anything.</li>
              <li><strong>Cut ten clips from one long recording.</strong> One source, ten outputs — that is the rhythm the whole job runs on.</li>
              <li><strong>Post daily for 14 days.</strong> Nothing before two weeks tells you anything useful.</li>
              <li><strong>Keep only what worked.</strong> Find which clips crossed the view minimum, and cut more that look like those.</li>
            </ol>

            <h2 id="mistakes">Mistakes That Cost People Months</h2>
            <ul>
              <li><strong>Polishing.</strong> A clip that takes an hour has to earn twenty times what a three-minute clip earns. It will not.</li>
              <li><strong>Ignoring the caps.</strong> Read the payment terms before the brief. A generous CPM with a low cap pays worse than a modest CPM without one.</li>
              <li><strong>Posting into a dead pool.</strong> Check the budget is still live on the day you post, not the day you joined.</li>
              <li><strong>Quitting in month one.</strong> $0-80 is the normal first month for almost everyone who later does well.</li>
              <li><strong>One account, one campaign.</strong> The people clearing four figures run several, because pools dry up without warning.</li>
            </ul>

            <h2 id="faq">Frequently Asked Questions</h2>
            {FAQ.map(({ q, a }) => (
              <div key={q}>
                <h3>{q}</h3>
                <p>{a}</p>
              </div>
            ))}

            <h2>The Short Version</h2>
            <p>
              Clipping pays, but not at the advertised rate. Plan against{" "}
              <strong>$0.39 per 1,000 views</strong>, not $5. Earnings track volume
              almost perfectly, volume is capped by how long one clip takes, and how
              long one clip takes is the one part of this you can actually change.
            </p>
            <p>
              <Link href="/clipping" className="btn btn-primary">
                Try the free AI clip maker
              </Link>
            </p>
          </div>

          {related.length > 0 && (
            <div className="blog-related">
              <h3>Related Reading</h3>
              <ul>
                {related.map((r) => (
                  <li key={r.slug}>
                    <Link href={`/blog/${r.slug}`}>{r.title}</Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </article>
    </>
  );
}
