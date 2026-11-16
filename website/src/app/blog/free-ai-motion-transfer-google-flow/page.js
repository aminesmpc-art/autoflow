import { getPostBySlug } from "../content";
import PostShell, { metadataFor, Shot } from "../PostShell";

export const dynamic = 'force-static';

const post = getPostBySlug("free-ai-motion-transfer-google-flow");
export const metadata = metadataFor(post);

const FAQ = [
  {
    q: "Is AI motion transfer in Google Flow really free?",
    a: "Google Flow gave 50 credits a day with no subscription when we checked in October 2026, and editing an uploaded video with Gemini Omni Flash cost 40 credits, so one motion transfer a day fit in the free credits. Free accounts were 720p and could not always generate at peak hours. Prices and limits change; check Google's Flow help page before you plan around them.",
  },
  {
    q: "Is this a Higgsfield alternative?",
    a: "For copying the moves of a short reference video onto your own AI character, yes: AutoFlow Motion runs the whole motion transfer inside Google Flow, without a Higgsfield subscription. Higgsfield has other tools this workflow does not replace.",
  },
  {
    q: "What does AutoFlow Motion do?",
    a: "It takes your reference video and a character reference, has Gemini write the motion instructions, hands the job to Google Flow automatically, and lets you review and download the result, all from a side panel next to Flow.",
  },
  {
    q: "Can I use AI motion transfer for TikTok Shop?",
    a: "You can make the videos, but TikTok Shop approval, product choice and publishing are separate steps. Represent the product accurately, label realistic AI content, and turn on promotional disclosure when you promote a product.",
  },
  {
    q: "How do I keep the character the same in every video?",
    a: "Build one character reference (a clear front view, or a full turnaround sheet) and reuse it for every video. The same face and outfit across posts is what makes viewers recognise the account.",
  },
];

export default function Page() {
  return (
    <PostShell
      post={post}
      hero={{ src: "/screenshots/motion-ootd/ai-result.webp", alt: "AI motion transfer result: an AI character copying the moves of a reference video", caption: "The AI result: same moves, a new character.", width: 440, height: 740 }}
      toc={[
        ["what", "What AI motion transfer is"],
        ["free", "Is it really free?"],
        ["reference", "Step 1: build your character reference"],
        ["start", "Step 2: start the automated workflow"],
        ["gemini", "Step 3: Gemini writes the motion instructions"],
        ["flow", "Step 4: the automatic handoff to Google Flow"],
        ["review", "Step 5: review every take and download"],
        ["plan", "The 7-day TikTok Shop plan"],
      ]}
      faq={FAQ}
      howto={{
        name: "How to do free AI motion transfer in Google Flow",
        steps: [
          ["Build a character reference", "Prepare one clear picture of your AI character's face and outfit."],
          ["Start AutoFlow Motion", "Open AutoFlow Motion next to Google Flow, add the reference video and the character, and confirm the handoff."],
          ["Let Gemini write the motion", "Gemini watches the reference video and writes the motion instructions."],
          ["Generate in Google Flow", "AutoFlow Motion hands the job to Flow (Gemini Omni Flash) automatically."],
          ["Review and download", "Check the face, hands and product in every take, then download the version you reviewed."],
        ],
      }}
      related={[
        ["/blog/remake-viral-video-ai-character", "How to remake a viral video with your own AI character"],
        ["/blog/ai-videos-tiktok-shop", "How to make AI videos for TikTok Shop in 5 days"],
        ["/blog/google-flow-omni-1-2-model-changes-december-2026", "Google Flow's new models and their cost"],
      ]}
      note="The outfit clip shows the editing method; it is not proof of how any product looks, fits or performs. Use reference footage you own or have permission to use. Ruby and the character result are AI-generated."
    >
      <p>
        <strong>AI motion transfer</strong> gives the exact moves of a short reference video to an AI character: the same
        walk, the same pose, a completely different person. This guide shows how to do it for free in Google Flow with
        AutoFlow Motion, without Higgsfield or a paid subscription, and a simple 7-day plan to turn it into TikTok Shop
        content.
      </p>

      <h2 id="what">What AI motion transfer is</h2>
      <p>
        Motion transfer (also called <strong>motion control</strong>) uses a real video as the movement reference and renders
        your AI character performing it. It is how creators make AI outfit videos, product try-ons and character remakes of
        viral clips without filming themselves.
      </p>

      <h2 id="free">Is it really free?</h2>
      <p>
        When we checked in October 2026, Google Flow gave <strong>50 credits a day</strong> with no subscription, and editing
        an uploaded video with Gemini Omni Flash cost <strong>40 credits</strong>, so one motion transfer a day fit in the
        free credits. Free accounts were 720p (no 1080p upscaling) and could not always generate at peak hours (about 2–5 PM
        UTC). Limits change, so check{" "}
        <a href="https://support.google.com/flow/answer/16526234" target="_blank" rel="noopener noreferrer">Google&apos;s Flow help page</a>.
        Gemini Omni 1.1 Flash leaves Flow on December 5, 2026; see{" "}
        <a href="/blog/google-flow-omni-1-2-model-changes-december-2026">Flow&apos;s new models</a>.
      </p>

      <h2 id="reference">Step 1: build your character reference</h2>
      <p>
        One clear picture of your character, same face and same outfit, is enough. Reuse it for every video so your account
        has a recognisable face.
      </p>
      <Shot src="/screenshots/motion-ootd/reference.webp" alt="Building the AI character reference in AutoFlow Motion" caption="Build your character reference once." />

      <h2 id="start">Step 2: start the automated workflow</h2>
      <p>
        Open <a href="/motion">AutoFlow Motion</a> next to Google Flow, add the reference video and the character, confirm the
        handoff, and leave the rest to the automation.
      </p>
      <Shot src="/screenshots/motion-ootd/start.webp" alt="Starting the automated AutoFlow Motion workflow" caption="Confirm the handoff and let it run." />

      <h2 id="gemini">Step 3: Gemini writes the motion instructions</h2>
      <p>
        Gemini watches the reference video and writes the motion instructions, so you are not describing every movement by
        hand.
      </p>
      <Shot src="/screenshots/motion-ootd/gemini.webp" alt="Gemini writing motion instructions from the reference video" caption="Gemini writes the motion instructions." />

      <h2 id="flow">Step 4: the automatic handoff to Google Flow</h2>
      <p>
        AutoFlow Motion hands the job to Google Flow and starts the generation. While it renders, plan your next hooks: the
        first second decides whether anyone watches.
      </p>
      <Shot src="/screenshots/motion-ootd/handoff.webp" alt="AutoFlow Motion handing the motion transfer to Google Flow" caption="Automatic handoff to Flow." />
      <Shot src="/screenshots/motion-ootd/plan.webp" alt="Planning the next hooks while the AI video renders" caption="Plan the next hook while it renders." />

      <h2 id="review">Step 5: review every take and download</h2>
      <p>
        Check the face, the hands and the product in every take before you keep one. Then download the version you reviewed.
      </p>
      <Shot src="/screenshots/motion-ootd/review.webp" alt="Reviewing AI motion transfer takes in Google Flow" caption="Review every take: face, hands, product." />
      <Shot src="/screenshots/motion-ootd/download.webp" alt="Downloading the reviewed motion transfer video" caption="Download the version you reviewed." />

      <h2 id="plan">The 7-day TikTok Shop plan</h2>
      <ol>
        <li><strong>Day 1:</strong> check your TikTok Shop access and apply.</li>
        <li><strong>Day 2:</strong> choose one real product you understand.</li>
        <li><strong>Day 3:</strong> build your character reference.</li>
        <li><strong>Day 4:</strong> create your first video and keep the product accurate.</li>
        <li><strong>Day 5:</strong> review every take.</li>
        <li><strong>Day 6:</strong> add your caption and call to action.</li>
        <li><strong>Day 7:</strong> publish if you are approved.</li>
      </ol>
      <p>
        Already approved with your assets ready? Work through it sooner; a week is the plan, not a deadline. Label realistic AI
        content and turn on promotional disclosure when you promote a product.
      </p>
      <Shot src="/screenshots/motion-ootd/caption.webp" alt="Adding a caption and call to action to the AI video" caption="Day 6: one clear benefit, one call to action." />
    </PostShell>
  );
}
