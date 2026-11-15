export const dynamic = 'force-static';

export const metadata = {
  title: "About AutoFlow — Who Builds It and Why",
  description:
    "AutoFlow is an independent set of tools for making AI video: Chrome extensions that automate Google Flow and a node canvas, plus web tools that extract prompts from a video, explain why it works, and cut it into clips.",
  alternates: {
    canonical: "https://www.auto-flow.studio/about",
  },
  openGraph: {
    title: "About AutoFlow",
    description:
      "Who builds AutoFlow, what each tool does, and how we handle your videos and data.",
    url: "https://www.auto-flow.studio/about",
  },
};

export default function AboutPage() {
  return (
    <>
      <section className="legal-hero">
        <div className="container">
          <h1>About AutoFlow</h1>
          <p className="text-secondary">Tools for people who make AI video every day.</p>
        </div>
      </section>

      <section className="section">
        <div className="container legal-content">
          <h2>Why AutoFlow exists</h2>
          <p>
            Making a video with today&apos;s AI generators is mostly waiting and repeating: paste a
            prompt, wait for the clip, download it, rename it, paste the next prompt. A one-minute
            video can be thirty generations. AutoFlow started as a way to hand that repetition to the
            browser, so the person making the video can spend their time on the story, the look and
            the edit instead.
          </p>
          <p>
            It has grown into a small set of tools that each take one slow part of the job off your
            hands. They are built and run independently by amine.smpc, the same operator named in our{" "}
            <a href="/privacy">Privacy Policy</a>. AutoFlow is not affiliated with Google, OpenAI,
            Anthropic, xAI or any of the AI services it works with.
          </p>

          <h2>What each tool does</h2>

          <h3>AutoFlow Queue Manager</h3>
          <p>
            A Chrome extension for Google Flow. You give it a list of prompts and it submits them one
            after another, retries the ones that fail, and downloads the finished clips in order, so
            a batch of fifty runs while you do something else.
          </p>

          <h3>AutoFlow Studio</h3>
          <p>
            A visual canvas, also a Chrome extension. Each step of a video — a character reference, a
            still, a clip, a script written by a chat assistant — is a node, and the canvas runs them
            in order on the sites you already use. It keeps characters consistent from shot to shot
            and chains each clip from the last frame of the one before. <a href="/studio">More about Studio</a>.
          </p>

          <h3>Video Prompt Extractor</h3>
          <p>
            Upload a video or paste a link and it is watched shot by shot. You get each shot&apos;s
            image and motion prompt, the camera, the dialogue, a design sheet for every character and
            one master prompt for the whole video, ready to remake it or remix it. Results are private
            to your account unless you choose to publish them. <a href="/extractor">Try the Extractor</a>.
          </p>

          <h3>Why it works</h3>
          <p>
            The same engine, asked a different question: what makes this video hold attention? It
            reports the hook, the pacing measured from the real cuts, the structure, the moments
            viewers are likely to leave, and a list of what is worth copying. <a href="/breakdown">Break a video down</a>.
          </p>

          <h3>Clipping</h3>
          <p>
            Turns a long video into short vertical clips: it finds the moments worth posting, frames
            the speaker and adds captions. <a href="/clipping">Read how clipping works</a>.
          </p>

          <h2>How we work</h2>
          <ul>
            <li>
              <strong>We ship in the open.</strong> Every release and what it changed is listed in the{" "}
              <a href="/changelog">changelog</a>.
            </li>
            <li>
              <strong>Your videos are not kept.</strong> A video sent to the Extractor is held for one
              hour, so you can refine the result, and then deleted; the details are in the{" "}
              <a href="/privacy">Privacy Policy</a>.
            </li>
            <li>
              <strong>Free to start.</strong> Every tool has a free plan, and Pro is a single monthly
              price. See <a href="/pricing">pricing</a>.
            </li>
            <li>
              <strong>Guides from real use.</strong> The <a href="/blog">blog</a> covers the workflows
              we use ourselves: batch generation on Flow, prompts that hold up, and turning AI clips
              into finished Shorts.
            </li>
          </ul>

          <h2>Get in touch</h2>
          <p>
            Questions, bug reports and ideas are all welcome. Write to{" "}
            <a href="mailto:support@auto-flow.studio">support@auto-flow.studio</a> or see the{" "}
            <a href="/contact">contact page</a>.
          </p>
        </div>
      </section>
    </>
  );
}
