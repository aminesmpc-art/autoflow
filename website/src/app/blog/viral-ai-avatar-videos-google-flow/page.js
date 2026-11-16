import Link from "next/link";
import Image from "next/image";
import { getPostBySlug, SITE_URL, AUTHOR } from "../content";

export const dynamic = 'force-static';

const post = getPostBySlug("viral-ai-avatar-videos-google-flow");

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
    images: [{ url: `${SITE_URL}${post.image}`, width: 1200, height: 676 }],
  },
};

/* Rendered on the page AND emitted as FAQPage. */
const FAQ = [
  {
    q: "How do you make an AI avatar in Google Flow?",
    a: "Save the avatar once as a Flow character: a name, a face (from a photo or a description) and a voice. Every prompt that says the character's name then gets the same face and the same voice. AutoFlow's Characters tab makes the character for you, and an AI agent can do it through AutoFlow without you opening Flow.",
  },
  {
    q: "How do I keep the same face and voice in every clip?",
    a: "Use a saved character instead of describing the person again in each prompt, and write the character's exact name in every prompt. For a prop that must stay the same, such as the glass stomach model in this video, add a reference image of it to each scene.",
  },
  {
    q: "Can an AI agent make the whole avatar video?",
    a: "Yes. With AutoFlow's agent server connected, an agent like Google Antigravity, Claude Code or Codex can create the character, write the scenes, run them in Google Flow, read why a prompt failed, rewrite it, and download the clips. It asks before anything that spends Flow credits.",
  },
  {
    q: "What do I do when Google Flow refuses a prompt?",
    a: "AutoFlow re-sends a failed prompt up to three times. If Flow refused the words, rewrite the prompt more gently and keep the character's name in it. If one model keeps failing, switch the queue to another model; in this video the agent moved to Omni 1.2 Flash at 360p and the run finished.",
  },
  {
    q: "Why do AI health avatar videos get so many views?",
    a: "They combine a trustworthy presenter, a simple visual (here, juice flowing through a glass stomach model) and a promise in the first second. That format is common on TikTok, Reels and Shorts. If you make health content, keep the claims general, add a note that it is not medical advice, and follow each platform's health rules.",
  },
  {
    q: "Which agent works best?",
    a: "Any app that supports MCP servers works: Antigravity, Claude Code, Codex, Cursor and Claude Desktop use the same tools. In this run Antigravity used Gemini 3.8 Flash and once got stuck making the character; Claude Code and Codex usually follow the steps on the first try.",
  },
];

const Shot = ({ src, alt, caption, width = 1200, height = 684 }) => (
  <div className="blog-img-wrap">
    <Image src={src} alt={alt} width={width} height={height} className="blog-img" />
    <p className="blog-img-caption">{caption}</p>
  </div>
);

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
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "FAQPage",
            mainEntity: FAQ.map(({ q, a }) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })),
          }),
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "HowTo",
            name: "How to make a viral AI avatar video in Google Flow with an AI agent",
            description: post.description,
            step: [
              { "@type": "HowToStep", name: "Switch on AI agents", text: "In AutoFlow's settings, switch on Let AI agents control AutoFlow and give the browser a name." },
              { "@type": "HowToStep", name: "Connect your agent", text: "Copy the setup for Antigravity, Claude Code, Codex or Cursor from AutoFlow's Agent page into your agent." },
              { "@type": "HowToStep", name: "Paste a viral avatar prompt", text: "Give the agent the idea for the video; it plans one character and the scenes with the exact words." },
              { "@type": "HowToStep", name: "Let it create the avatar", text: "The agent saves the character in AutoFlow with a face and a custom voice." },
              { "@type": "HowToStep", name: "Run the scenes", text: "The agent queues the scenes with the character's name in each, shows the cost, and runs them in Google Flow." },
              { "@type": "HowToStep", name: "Fix and download", text: "The agent rewrites refused prompts, adds reference images for props, and downloads every clip in order." },
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
              <span>·</span>
              <span>By <Link href="/about">{AUTHOR.name}</Link></span>
            </div>
          </div>

          {VIDEO_ID ? (
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
          ) : (
            <Shot
              src="/screenshots/avatar/hero.webp"
              alt="An AI avatar, an elderly presenter, pouring green juice into a glowing glass stomach model while a red-haired presenter reacts"
              caption="Arthur and Ruby are both AI characters made in Google Flow."
              height={676}
            />
          )}

          <nav className="blog-toc">
            <h4>📖 In This Article</h4>
            <ol>
              <li><a href="#format">Why this AI avatar format gets millions of views</a></li>
              <li><a href="#setup">Step 1: switch on AI agents in AutoFlow</a></li>
              <li><a href="#connect">Step 2: connect your agent</a></li>
              <li><a href="#prompt">Step 3: give it a viral avatar prompt</a></li>
              <li><a href="#character">Step 4: the agent creates the talking AI avatar</a></li>
              <li><a href="#run">Step 5: run the scenes with the same face and voice</a></li>
              <li><a href="#refused">When Google Flow refuses a prompt</a></li>
              <li><a href="#prop">Fixing a missing prop with a reference image</a></li>
              <li><a href="#download">Step 6: download and edit</a></li>
              <li><a href="#tips">Tips for more views</a></li>
              <li><a href="#faq">FAQ</a></li>
            </ol>
          </nav>

          <div className="blog-article-content">
            <p>
              Talking <strong>AI avatar videos</strong> are one of the fastest-growing formats on TikTok, Instagram Reels and
              YouTube Shorts: a friendly presenter, one strong visual, and a hook in the first second. The hard part has always
              been keeping the same face and voice from clip to clip, and the hours of clicking in Google Flow.
            </p>
            <p>
              In this guide an AI agent does that work. Google Antigravity, connected to AutoFlow, created a talking AI avatar
              called Arthur with a custom voice, wrote four scenes, ran them in Google Flow with the same character in each,
              fixed the prompts Flow refused, and downloaded the clips. This is the full process from one real 23-minute session,
              nothing skipped, including the parts that went wrong.
            </p>

            <h2 id="format">Why this AI avatar format gets millions of views</h2>
            <p>
              The example is a wellness explainer: Arthur, a 70-year-old presenter, pours fresh green kiwi juice into a
              transparent glass stomach model and talks to the camera. It works for three reasons:
            </p>
            <ul>
              <li><strong>A trustworthy face.</strong> An older, calm presenter reads as experience.</li>
              <li><strong>One visual that explains itself.</strong> Liquid flowing through a glass organ needs no words.</li>
              <li><strong>A promise up front.</strong> &quot;If you want more daily energy…&quot; stops the scroll.</li>
            </ul>
            <p>
              The same structure works for any niche: a chef avatar with a glass kettle, a mechanic avatar with a see-through
              engine, a finance avatar with a jar of coins. If you make health content, keep the claims general and add a note that
              it is not medical advice.
            </p>
            <Shot
              src="/screenshots/avatar/arthur-clip.webp"
              alt="AI avatar Arthur pouring green juice into a glass stomach model in Google Flow"
              caption="One of Arthur's four finished clips (Omni 1.2 Flash, 9:16)."
              width={540}
              height={960}
            />

            <h2 id="setup">Step 1: switch on AI agents in AutoFlow</h2>
            <p>
              Open the AutoFlow panel next to Google Flow, click <strong>Settings</strong>, scroll to <strong>AI agents</strong> and
              switch on <strong>Let AI agents control AutoFlow</strong>. It is off until you turn it on. Then give the browser a
              name, such as <code>autoflow1</code>. If you run several Chrome or Multilogin profiles, one per Google account, the
              agent uses that name to know exactly where to work.
            </p>
            <Shot src="/screenshots/avatar/switch-on.webp" alt="AutoFlow settings with the AI agents switch next to Google Flow" caption="Settings → AI agents → switch on." />
            <p>
              The <strong>Agent page</strong> shows every connected agent. Here Claude Code, Antigravity and Codex were all
              connected to the same browser.
            </p>
            <Shot src="/screenshots/avatar/agent-page.webp" alt="AutoFlow Agent page showing Claude Code, Antigravity and Codex connected" caption="The Agent page: connected agents, the settings they use, and every call they make." />

            <h2 id="connect">Step 2: connect your agent</h2>
            <p>
              The Agent page has a ready-made setup for each agent: Antigravity, Claude Code, Codex, Cursor and Claude Desktop.
              Copy the block for yours, paste it into the agent, and tell it which browser to use. For Antigravity, Cursor or
              Claude Desktop it is one MCP entry:
            </p>
            <pre className="blog-code"><code>{`{
  "mcpServers": {
    "autoflow": { "command": "npx", "args": ["-y", "autoflow-agent"] }
  }
}`}</code></pre>
            <p>
              Full setup for every agent, including Windows, is in{" "}
              <Link href="/blog/automate-google-flow-ai-agent">How to automate Google Flow with an AI agent</Link>.
            </p>
            <Shot src="/screenshots/avatar/setup.webp" alt="Copying the AutoFlow agent setup for Antigravity" caption="Copy the setup for your agent, paste it once." />

            <h2 id="prompt">Step 3: give it a viral avatar prompt</h2>
            <p>
              We asked Gemini for a viral avatar video idea, copied the prompt it wrote, and pasted it into Antigravity&apos;s chat.
              The agent read it, checked AutoFlow, and wrote a plan: one character, four scenes, and the exact words the character
              says in each scene, each scene starting from the last frame of the one before.
            </p>
            <Shot src="/screenshots/avatar/plan.webp" alt="Antigravity planning a four-scene AI avatar video with one character" caption="The plan: one character, four connected scenes." />

            <h2 id="character">Step 4: the agent creates the talking AI avatar</h2>
            <p>
              The agent creates the character inside AutoFlow by itself: a name (Arthur Pendleton), a face drawn from a
              description, and a voice. We asked for a custom voice and it chose a warm, grandfatherly one; AutoFlow saved it with
              the character. From then on, every prompt that says &quot;Arthur Pendleton&quot; gets the same face and voice.
            </p>
            <p>
              On the first try the agent got stuck and did not make the character. We stopped it and asked again, and the second
              try worked. The agent here ran on Gemini 3.8 Flash; Claude Code or Codex usually follow these steps on the first try.
            </p>
            <Shot src="/screenshots/avatar/arthur-saved.webp" alt="The AI avatar Arthur Pendleton saved as a character in Google Flow" caption="Arthur, saved once with his face and custom voice." />

            <h2 id="run">Step 5: run the scenes with the same face and voice</h2>
            <p>
              The agent builds a queue of four scenes, puts Arthur&apos;s name in each one, and shows the cost before starting. On
              &quot;run&quot;, AutoFlow opens a fresh Flow project for the queue and submits the scenes one by one, attaching
              Arthur to every clip. Each scene continues from the last frame of the previous clip, so the video flows like one
              continuous shot.
            </p>
            <Shot src="/screenshots/avatar/chain.webp" alt="Google Flow generating chained scenes with the same AI avatar" caption="Every scene starts from the last frame of the one before." />

            <h2 id="refused">When Google Flow refuses a prompt</h2>
            <p>
              Flow refused some of the first prompts. AutoFlow retried them on its own and sent every error back to the agent,
              which read the reasons and rewrote the prompts in gentler words, keeping Arthur&apos;s name in each so the character
              stayed attached. The first model still kept failing, so we stopped the queue and told the agent to use{" "}
              <strong>Omni 1.2 Flash at 360p</strong>. It made a new queue and started again. Failed generations are normal with
              any AI video tool; what matters is that the agent fixes them instead of you.
            </p>
            <Shot src="/screenshots/avatar/refused.webp" alt="AutoFlow reporting refused Google Flow prompts to the AI agent" caption="Refused prompts go back to the agent, which rewrites them." />

            <h2 id="prop">Fixing a missing prop with a reference image</h2>
            <p>
              The first clips came back with Arthur perfect: same face, same voice. But the glass stomach model was missing, so we
              asked the agent: &quot;Where is the stomach?&quot; It saw that Flow had drawn a glass teapot instead. It generated a
              picture of the glass stomach model first, then attached it as a reference image to the scenes. Each prompt now
              carried two references, Arthur and the glass model, so the presenter and the prop both stayed consistent.
            </p>
            <Shot src="/screenshots/avatar/teapot.webp" alt="Google Flow drew a glass teapot instead of the glass stomach model" caption="Flow drew a teapot; the agent fixed it with a reference image." />
            <Shot src="/screenshots/avatar/references.webp" alt="The agent attaching the AI avatar and the glass model as two references" caption="Two references per scene: the avatar and the prop." />
            <Shot src="/screenshots/avatar/done.webp" alt="Four consistent AI avatar clips finished in Google Flow" caption="Done: four clips, Arthur in every one, the glass model on the counter." />

            <h2 id="download">Step 6: download and edit</h2>
            <p>
              Download all the clips at once from AutoFlow&apos;s Library, numbered in order, and hand the folder to the agent. It
              can join the clips, add captions and export the final video. Better prompts give better results, so keep the
              prompt that worked and reuse it for the next video.
            </p>
            <Shot src="/screenshots/avatar/download.webp" alt="Downloading all the AI avatar clips at once from AutoFlow's Library" caption="Download all, then let the agent edit." />

            <h2 id="tips">Tips for more views</h2>
            <ul>
              <li><strong>Hook in the first line.</strong> Write the promise or the surprise into the character&apos;s first sentence.</li>
              <li><strong>One visual idea per video.</strong> A see-through object the audience can follow works better than a busy scene.</li>
              <li><strong>Keep it vertical and short.</strong> 9:16, four 8-second scenes, about 30 seconds in total.</li>
              <li><strong>Reuse the character.</strong> A saved avatar makes a series cheap; viewers come back for the same face.</li>
              <li><strong>Post the same video everywhere.</strong> TikTok, Reels and Shorts on the same day.</li>
            </ul>

            <div className="blog-faq" id="faq">
              <h3>❓ Frequently Asked</h3>
              {FAQ.map(({ q, a }) => (
                <details key={q}>
                  <summary>{q}</summary>
                  <p>{a}</p>
                </details>
              ))}
            </div>

            <p style={{ fontSize: "0.9em", opacity: 0.8 }}>
              Ruby and Arthur are AI-generated characters made in Google Flow. Arthur&apos;s video is an example of the format, not
              medical advice. The Google accounts in the screenshots are blurred.
            </p>

            <h2>Related guides</h2>
            <ul>
              <li><Link href="/blog/automate-google-flow-ai-agent">How to automate Google Flow with an AI agent</Link></li>
              <li><Link href="/blog/autoflow-characters-same-face-voice">AutoFlow characters: the same face and voice in every clip</Link></li>
              <li><Link href="/blog/consistent-characters-google-flow">How Flow&apos;s Characters work</Link></li>
              <li><Link href="/blog/how-to-batch-generate-ai-videos-google-flow">How to batch generate AI videos in Google Flow</Link></li>
            </ul>
          </div>
        </div>
      </article>
    </>
  );
}
