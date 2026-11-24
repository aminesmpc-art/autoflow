import Link from "next/link";
import Image from "next/image";
import { getPostBySlug, SITE_URL, AUTHOR } from "../content";

export const dynamic = 'force-static';

const post = getPostBySlug("automate-google-flow-ai-agent");

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
    images: [{ url: `${SITE_URL}${post.image}`, width: 1200, height: 683 }],
  },
};

/* Rendered on the page AND emitted as FAQPage. */
const FAQ = [
  {
    q: "Can an AI agent use Google Flow?",
    a: "Yes, through AutoFlow. Google Flow has no public API for its video tools, so the agent does not talk to Flow directly. It talks to the AutoFlow Chrome extension through the autoflow-agent MCP server, and AutoFlow types the prompts into Flow in your own browser, on your own account.",
  },
  {
    q: "Which AI agents work with AutoFlow?",
    a: "Any app that supports MCP servers: Google Antigravity, Claude Code, Codex, Cursor and Claude Desktop all use the same server and the same tools. The video in this post uses Antigravity.",
  },
  {
    q: "Does it cost anything extra?",
    a: "The agent server is free. The clips cost the same Google Flow credits they would if you clicked Run yourself, and AutoFlow's own daily limits for your plan still apply. The agent is told to show you the prompts and ask before anything that spends credits.",
  },
  {
    q: "Can the agent keep the same character in every clip?",
    a: "Yes. Save the character once in AutoFlow (a face, a name and a voice), and every prompt that says the character's name gets it attached. In our run, all five clips of Ruby have the same face and the same voice.",
  },
  {
    q: "Is it safe to let an agent control my browser?",
    a: "Agent control is off until you switch it on. The server only listens on your own computer and only accepts AutoFlow's extensions, every call is logged on the Agent page, and one click on Stop switches the agent off.",
  },
  {
    q: "What happens if Google Flow refuses a prompt?",
    a: "AutoFlow re-sends it up to three times. After that the agent reads the reason, rewrites the prompt more gently in the same prompt number, keeps the character's name in it, and can show you the new words before re-running. If Flow says it is limiting the account, the agent stops and tells you instead.",
  },
];

const Code = ({ children }) => <pre className="blog-code"><code>{children}</code></pre>;

const Shot = ({ src, alt, caption, width = 1200, height = 683 }) => (
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
            name: "How to automate Google Flow with an AI agent",
            description: post.description,
            step: [
              { "@type": "HowToStep", name: "Switch on AI agents in AutoFlow", text: "In AutoFlow's Queue Manager, open Settings, scroll to AI agents and switch on Let AI agents control AutoFlow." },
              { "@type": "HowToStep", name: "Connect your AI agent", text: "Add the autoflow-agent MCP server to Antigravity, Claude Code, Codex, Cursor or Claude Desktop." },
              { "@type": "HowToStep", name: "Ask for the video", text: "Tell the agent what clips you want, which character, the model and resolution, and to show the cost before running." },
              { "@type": "HowToStep", name: "Approve the prompts", text: "The agent checks the character, builds the queue and waits for your yes before spending credits." },
              { "@type": "HowToStep", name: "Let it run", text: "AutoFlow runs every prompt in a new Google Flow project and downloads the clips in order." },
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
              <li><a href="#what">What a Google Flow AI agent does</a></li>
              <li><a href="#switch-on">Step 1: switch on AI agents in AutoFlow</a></li>
              <li><a href="#connect">Step 2: connect Antigravity, Claude Code or Codex</a></li>
              <li><a href="#ask">Step 3: ask for the video</a></li>
              <li><a href="#run">The real run: 5 clips, one character</a></li>
              <li><a href="#money">Credits: the agent asks first</a></li>
              <li><a href="#failures">When Google Flow refuses a prompt</a></li>
              <li><a href="#accounts">Several Google accounts</a></li>
              <li><a href="#control">Staying in control</a></li>
              <li><a href="#faq">FAQ</a></li>
            </ol>
          </nav>

          <div className="blog-article-content">
            <p>
              You can now <strong>automate Google Flow with an AI agent</strong>. Instead of typing prompts into Flow one by one,
              you tell an AI assistant — Google Antigravity, Claude Code, Codex, Cursor or Claude Desktop — what video you want.
              The agent writes the prompts, builds the queue in AutoFlow, runs every clip in Google Flow in your own browser,
              downloads them in order and reports back.
            </p>
            <p>
              Everything in this guide comes from one real run. Antigravity made a five-clip promo starring Ruby, our presenter,
              who is a saved AutoFlow character (see <Link href="/blog/autoflow-characters-same-face-voice">the character guide</Link>).
              Five clips, five lines, the same face and voice in each, and nobody opened Google Flow by hand.
            </p>

            <h2 id="what">What a Google Flow AI agent does</h2>
            <p>
              Google Flow has no public API for its video tools, so an agent cannot call Flow directly. AutoFlow fills that gap:
              it is the Chrome extension that already types prompts into Flow, waits for each clip, retries failures and
              downloads the results. The <strong>autoflow-agent</strong> MCP server gives an AI agent AutoFlow&apos;s buttons as
              tools. Every run is checked against your plan, charged exactly as if you had clicked Run, and shows up in the panel
              while it happens. The agent can:
            </p>
            <ul>
              <li>add queues of prompts, with reference images, characters and clips that continue each other;</li>
              <li>set the model, orientation, length and resolution for one queue without touching your saved settings;</li>
              <li>run, pause, stop, skip and retry, and wait until a queue finishes;</li>
              <li>read each prompt&apos;s result, and the reason Flow refused one;</li>
              <li>make and manage characters with a face and a voice;</li>
              <li>download a queue&apos;s finished videos, numbered by prompt;</li>
              <li>build and run node workflows in AutoFlow Studio.</li>
            </ul>

            <h2 id="switch-on">Step 1: switch on AI agents in AutoFlow</h2>
            <p>
              Agent control is off until you turn it on. Open the AutoFlow panel next to Google Flow, click{" "}
              <strong>Settings</strong>, scroll to <strong>AI agents</strong> and switch on{" "}
              <strong>Let AI agents control AutoFlow</strong>. Studio has the same switch in its side panel. The line under the
              switch says &quot;Waiting for the agent server&quot; until step 2 is done, then &quot;Connected&quot;.
            </p>
            <Shot
              src="/screenshots/agent/switch-on.webp"
              alt="AutoFlow settings panel with the Let AI agents control AutoFlow switch"
              caption="Settings → AI agents → Let AI agents control AutoFlow. It is off by default."
              width={530}
              height={640}
            />

            <h2 id="connect">Step 2: connect Antigravity, Claude Code or Codex</h2>
            <p>The server runs with <code>npx</code>, so there is nothing to install by hand. Add it to your agent once:</p>
            <p><strong>Google Antigravity, Cursor or Claude Desktop</strong>: add this entry to the app&apos;s MCP configuration
              (in Antigravity: Agent panel → ⋯ → MCP Servers → Manage MCP Servers → View raw config):</p>
            <Code>{`{
  "mcpServers": {
    "autoflow": { "command": "npx", "args": ["-y", "autoflow-agent@latest"] }
  }
}`}</Code>
            <p>
              On Windows, if the app cannot start <code>npx</code>, use <code>&quot;command&quot;: &quot;cmd&quot;</code> with{" "}
              <code>&quot;args&quot;: [&quot;/c&quot;, &quot;npx&quot;, &quot;-y&quot;, &quot;autoflow-agent@latest&quot;]</code>.
            </p>
            <p><strong>Claude Code</strong></p>
            <Code>claude mcp add autoflow -s user -- npx -y autoflow-agent@latest</Code>
            <p><strong>Codex</strong></p>
            <Code>codex mcp add autoflow -- npx -y autoflow-agent@latest</Code>
            <p>
              Optionally, install the AutoFlow skill so Claude Code, Codex and Antigravity load the full guide whenever AutoFlow
              comes up: what costs credits, how characters and chained clips work, and what to do with a refused prompt.
            </p>
            <Code>npx -y autoflow-agent@latest install-skill</Code>
            <p>
              The server only listens on your own computer (<code>127.0.0.1</code>) and only accepts AutoFlow&apos;s extensions, so no
              website can use it. If you run AutoFlow in Multilogin or another proxied profile, add <code>127.0.0.1</code> to the
              profile&apos;s proxy bypass list.
            </p>

            <h2 id="ask">Step 3: ask for the video</h2>
            <p>
              Paste what you want into the agent&apos;s chat in plain words. Ours asked for five clips of Ruby with the exact line
              she says in each, the settings, and a cost check before running:
            </p>
            <Code>{`Use the AutoFlow tools to make a short promo video with my character Ruby.
1. Call autoflow_status and confirm Ruby is ready.
2. Write 5 prompts, one clip each. Ruby sits in her LED-lit bedroom studio,
   talks to the camera in a medium close-up, and says one of these lines: ...
3. Add them as one queue: video, ingredients, Omni 1.2 Flash, landscape,
   360p, 1 generation, full mode. Do not change my saved settings.
4. Before running, show me the 5 prompts and the cost. Wait for my yes.
5. After I say yes, run it and tell me how many clips were made.`}</Code>
            <Shot
              src="/screenshots/agent/ask.webp"
              alt="The request pasted into Google Antigravity's chat, asking for five clips of the character Ruby"
              caption="One request in Antigravity. The account name is blurred."
            />

            <h2 id="run">The real run: 5 clips, one character</h2>
            <p>Here is what the agent did with that request, in order.</p>
            <ol>
              <li>
                <strong>Checked the setup.</strong> It confirmed AutoFlow was connected and that Ruby was ready in the character
                list, saved with her face and voice.
              </li>
              <li>
                <strong>Built the queue.</strong> It wrote one prompt per clip, put Ruby&apos;s name in each (that is how the
                character gets attached) and added the queue with the settings for this queue only.
              </li>
              <li>
                <strong>Waited for a yes.</strong> Before spending a credit, it showed all five prompts and stopped.
              </li>
              <li>
                <strong>Ran it.</strong> AutoFlow made a new Google Flow project for the queue and submitted the prompts one by
                one.
              </li>
              <li>
                <strong>Reported back.</strong> Five of five clips, no refusals, all downloaded and numbered in order.
              </li>
            </ol>
            <Shot
              src="/screenshots/agent/approve.webp"
              alt="Antigravity summarising the AutoFlow setup and the new queue before running"
              caption="The agent confirms the character and the queue, then waits for your yes."
            />
            <Shot
              src="/screenshots/agent/clips.webp"
              alt="Google Flow generating clips of the same AI character, Ruby, one by one"
              caption="Clip by clip in Google Flow: same red hair, same green hoodie, same voice."
            />
            <Shot
              src="/screenshots/agent/done.webp"
              alt="Antigravity reporting five of five clips generated with no policy refusals, with the downloaded file names"
              caption="Done: 5 of 5 clips, zero refusals, downloaded in prompt order."
            />
            <p>
              Then we asked the same agent to edit them. It transcribed Ruby&apos;s lines, joined the clips and burned in captions.
              The result is a finished promo made by an AI agent, starring a saved character, without opening Flow.
            </p>

            <h2 id="money">Credits: the agent asks first</h2>
            <p>
              Reading, adding queues and changing settings are free. Only a few actions spend your Google Flow credits: running a
              queue, retrying failed prompts, re-running replaced prompts, making a character&apos;s portrait, and running a Studio
              workflow. Those tools say so in their description, the server tells every agent to ask before using them, and a
              good agent states the number of clips and the model before anything runs. Check the cost in Flow yourself, since an
              agent&apos;s own estimate can be wrong; see{" "}
              <Link href="/blog/google-flow-omni-1-2-model-changes-december-2026">Google Flow&apos;s models and their cost</Link>.
            </p>

            <h2 id="failures">When Google Flow refuses a prompt</h2>
            <p>
              The run itself re-sends a failed prompt up to three times. After that, the agent reads why. If Flow refused the
              words, it rewrites the prompt more gently in the same prompt number, keeping every character&apos;s name, and can
              show you the new words before re-running. If Flow says it is limiting the account (&quot;unusual activity&quot;),
              new words do not help: the agent stops, tells you, and waits.
            </p>

            <h2 id="accounts">Several Google accounts</h2>
            <p>
              Many creators run AutoFlow in several browsers, one per Google account. The agent sees each by name (the name you
              give it, or its Flow account), and every call must say which one. It never guesses, so a queue never runs on an
              account you did not choose, and you can run queues on several accounts at once, one per browser.
            </p>

            <h2 id="control">Staying in control</h2>
            <p>
              While an agent is connected, the Queue Manager shows a bar under its header naming it, for example
              &quot;Antigravity is controlling AutoFlow&quot;, with a <strong>Stop</strong> button that switches agent control off
              at once. The <strong>Agent page</strong> (the link under the switch) lists the connected agents, the settings they
              work with, what they changed, and every call they made with the answer they got back.
            </p>
            <Shot
              src="/screenshots/agent/agent-page.webp"
              alt="AutoFlow's Agent page listing every call the AI agent made"
              caption="The Agent page logs every call, and Stop switches the agent off."
            />

            <div className="blog-faq" id="faq">
              <h3>❓ Frequently Asked</h3>
              {FAQ.map(({ q, a }) => (
                <details key={q}>
                  <summary>{q}</summary>
                  <p>{a}</p>
                </details>
              ))}
            </div>

            <h2>Related guides</h2>
            <ul>
              <li><Link href="/blog/viral-ai-avatar-videos-google-flow">How to make viral AI avatar videos in Google Flow with an agent</Link></li>
              <li><Link href="/blog/autoflow-characters-same-face-voice">AutoFlow characters: the same face and voice in every clip</Link></li>
              <li><Link href="/blog/consistent-characters-google-flow">How Flow&apos;s Characters work</Link></li>
              <li><Link href="/blog/how-to-batch-generate-ai-videos-google-flow">How to batch generate AI videos in Google Flow</Link></li>
              <li><Link href="/blog/google-flow-omni-1-2-model-changes-december-2026">Google Flow&apos;s new models and their cost</Link></li>
            </ul>
          </div>
        </div>
      </article>
    </>
  );
}
