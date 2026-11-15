import Link from "next/link";
import { getPostBySlug, SITE_URL, AUTHOR } from "../content";

export const dynamic = 'force-static';

const post = getPostBySlug("ai-agent-controls-autoflow-claude-code-codex");

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
              <li><a href="#what">What the agent does</a></li>
              <li><a href="#switch-on">Step 1: switch it on in AutoFlow</a></li>
              <li><a href="#connect">Step 2: connect your AI app</a></li>
              <li><a href="#ask">Step 3: ask for a video</a></li>
              <li><a href="#money">Credits: the agent asks first</a></li>
              <li><a href="#failures">When Flow refuses a prompt</a></li>
              <li><a href="#accounts">Several Google accounts</a></li>
              <li><a href="#control">Staying in control</a></li>
            </ol>
          </nav>

          <div className="blog-article-content">
            <p>
              AutoFlow already takes the clicking out of Google Flow: you give it a list of prompts and it types them, waits for
              each clip, retries the ones that fail and downloads the results. The <strong>AutoFlow agent</strong> takes away the
              list too. You tell an AI assistant — Claude Code, Codex, Antigravity, Cursor or Claude Desktop — what video you want,
              and it writes the prompts, builds the queue in AutoFlow, runs it in your own browser and reports back.
            </p>
            <p>
              The video at the top of this post was made that way: an agent wrote ten shots, queued them with our presenter Ruby
              (an AutoFlow character — see <Link href="/blog/autoflow-characters-same-face-voice">the character guide</Link>), and
              ran them on Flow.
            </p>

            <h2 id="what">What the agent does</h2>
            <p>
              The agent does not get a second, hidden way into Flow. It presses AutoFlow&apos;s own buttons through a small local
              server called <code>autoflow-agent</code>, so every run is checked against your plan, charged exactly as if you had
              clicked Run, and shows up in the panel while it happens. It can:
            </p>
            <ul>
              <li>add queues of prompts, with reference images, characters and clips that continue each other;</li>
              <li>read and change the settings for one queue without touching your saved ones;</li>
              <li>run, pause, stop, skip and retry, and wait until a queue finishes;</li>
              <li>read each prompt&apos;s result, and why Flow refused one;</li>
              <li>make and manage characters with a face and a voice;</li>
              <li>build and run workflows in AutoFlow Studio.</li>
            </ul>

            <h2 id="switch-on">Step 1: switch it on in AutoFlow</h2>
            <p>
              Agent control is off until you turn it on. In the Queue Manager open <strong>Settings → AI agents</strong> and
              switch on <strong>Let AI agents control AutoFlow</strong>. Studio has the same switch in its side panel. The line
              under the switch says &quot;Waiting for the agent server&quot; until the next step is done, then &quot;Connected&quot;.
            </p>

            <h2 id="connect">Step 2: connect your AI app</h2>
            <p>The server runs with <code>npx</code>, so there is nothing to install by hand. Add it to your agent once:</p>
            <p><strong>Claude Code</strong></p>
            <Code>claude mcp add autoflow -s user -- npx -y autoflow-agent</Code>
            <p><strong>Codex</strong></p>
            <Code>codex mcp add autoflow -- npx -y autoflow-agent</Code>
            <p>
              <strong>Antigravity, Cursor or Claude Desktop</strong>: add this entry to the app&apos;s MCP configuration
              (Antigravity: Agent panel → ⋯ → MCP Servers → Manage MCP Servers → View raw config):
            </p>
            <Code>{`{
  "mcpServers": {
    "autoflow": { "command": "npx", "args": ["-y", "autoflow-agent"] }
  }
}`}</Code>
            <p>
              On Windows, if the app cannot start <code>npx</code>, use <code>&quot;command&quot;: &quot;cmd&quot;</code> with{" "}
              <code>&quot;args&quot;: [&quot;/c&quot;, &quot;npx&quot;, &quot;-y&quot;, &quot;autoflow-agent&quot;]</code>.
            </p>
            <p>
              Optionally, install the AutoFlow skill so Claude Code, Codex and Antigravity load the full guide whenever AutoFlow
              comes up — what costs credits, how characters and chained clips work, what to do with a refused prompt:
            </p>
            <Code>npx -y autoflow-agent install-skill</Code>
            <p>
              The server only listens on your own computer (<code>127.0.0.1</code>) and only accepts AutoFlow&apos;s extensions, so no
              website can use it. If you run AutoFlow in Multilogin or another proxied profile, add <code>127.0.0.1</code> to the
              profile&apos;s proxy bypass list.
            </p>

            <h2 id="ask">Step 3: ask for a video</h2>
            <p>Open your agent and ask in plain words, for example:</p>
            <Code>Check AutoFlow is connected. Then turn this script into ten landscape clips
with Ruby presenting, on Omni 1.2 at 360p, and tell me the cost before running.</Code>
            <p>
              A good agent checks the connection first, reads the settings Flow allows, splits the script into one prompt per
              shot (one prompt is one clip), and adds the queue. Every queue runs in its own new Flow project named after it, so
              each video&apos;s clips stay together.
            </p>

            <h2 id="money">Credits: the agent asks first</h2>
            <p>
              Reading, adding queues and changing settings are free. Only a few actions spend your Flow credits: running a queue,
              retrying failed prompts, re-running replaced prompts, making a character&apos;s portrait, and running a Studio
              workflow. Those tools say so in their description, the server tells every agent to ask before using them, and the
              agent should state the number of clips, the model and the expected cost before anything runs.
            </p>

            <h2 id="failures">When Flow refuses a prompt</h2>
            <p>
              The run itself re-sends a failed prompt up to three times. After that, the agent reads why. If Flow refused the
              words, it rewrites the prompt more gently in the same prompt number — keeping every character&apos;s name, which is how
              the character gets attached — and can show you the new words before re-running. If Flow says it is limiting the
              account (&quot;unusual activity&quot;), new words do not help: the agent stops, tells you, and waits.
            </p>

            <h2 id="accounts">Several Google accounts</h2>
            <p>
              Many creators run AutoFlow in several browsers, one per Google account. The agent sees each by name — the name you
              give it, or its Flow account — and every call must say which one. It never guesses, so a queue never runs on an
              account you did not choose, and you can run queues on several accounts at once, one per browser.
            </p>

            <h2 id="control">Staying in control</h2>
            <p>
              While an agent is connected, the Queue Manager shows a bar under its header and Studio a pill on its canvas naming
              it, for example &quot;Claude Code is controlling AutoFlow&quot;, with a <strong>Stop</strong> button that switches agent
              control off at once. The <strong>Agent page</strong> (the link under the switch) lists the connected agents, the
              settings they work with, what they changed, and every call they made with its answer.
            </p>

            <h2>Related guides</h2>
            <ul>
              <li><Link href="/blog/autoflow-characters-same-face-voice">AutoFlow characters: the same face and voice in every clip</Link></li>
              <li><Link href="/blog/consistent-characters-google-flow">How Flow&apos;s Characters work</Link></li>
              <li><Link href="/blog/google-flow-omni-1-2-model-changes-december-2026">Google Flow&apos;s new models and their cost</Link></li>
            </ul>
          </div>
        </div>
      </article>
    </>
  );
}
