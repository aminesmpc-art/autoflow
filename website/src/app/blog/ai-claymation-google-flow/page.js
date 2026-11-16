import { getPostBySlug } from "../content";
import PostShell, { metadataFor, Shot } from "../PostShell";

export const dynamic = 'force-static';

const post = getPostBySlug("ai-claymation-google-flow");
export const metadata = metadataFor(post);

const FAQ = [
  {
    q: "How do you make claymation with AI?",
    a: "Make each clay character once in Google Flow and save it as a character, write one prompt per scene that names the character, the action and the exact line, run all the prompts with AutoFlow, then let an AI agent such as Google Antigravity edit the clips with motion graphics. The whole video in this guide took under 30 minutes.",
  },
  {
    q: "Which AI model makes the clay characters talk?",
    a: "The clips here were made with Gemini Omni 1.1 Flash in Google Flow, 9:16, 720p, 8 seconds each, which gives real lip-sync when the exact words are in the prompt. Omni 1.1 Flash leaves Flow on December 5, 2026; Omni 1.2 Flash replaces it.",
  },
  {
    q: "How do I keep the clay characters the same in every scene?",
    a: "Save every character in Flow first, then use References (ingredients) mode in AutoFlow. AutoFlow matches each character to the prompts that name them, so Marco, Mia and Sammy look the same in all ten scenes.",
  },
  {
    q: "Do AI claymation videos get views?",
    a: "The channel's clay videos on TikTok passed 860K and 140K views. The format works because every scene is a short, readable moment with a character the viewer recognises, and the motion-graphics stamps and numbers make the story easy to follow with the sound off.",
  },
  {
    q: "Do I need editing skills?",
    a: "No editing timeline was used. Antigravity checked every clip, cut the characters out of the background, kept the Flow voices in sync, built ten motion-graphics scenes in HyperFrames and rendered the final video from one sentence of instructions.",
  },
  {
    q: "What are the best tips for clean results?",
    a: "Put every character on the same plain background so they cut out cleanly, and write the exact words each character says inside the prompt so Flow gives real lip-sync instead of mumbling.",
  },
];

export default function Page() {
  return (
    <PostShell
      post={post}
      hero={{ src: "/screenshots/clay/hero.webp", alt: "AI claymation clay cartoon made with Google Flow and Antigravity", caption: "A clay cartoon made by AI from start to finish." }}
      toc={[
        ["why", "Why AI claymation works"],
        ["characters", "Step 1: three clay characters in Google Flow"],
        ["story", "Step 2: the story and ten prompts"],
        ["autoflow", "Step 3: paste the prompts into AutoFlow"],
        ["settings", "Step 4: settings and one click"],
        ["download", "Step 5: download all ten clips"],
        ["edit", "Step 6: Antigravity edits the video"],
        ["tips", "Two tips for cleaner clay videos"],
      ]}
      faq={FAQ}
      howto={{
        name: "How to make an AI claymation video with Google Flow",
        steps: [
          ["Make the clay characters", "Create each clay character in Google Flow and save it as a character."],
          ["Write the story and prompts", "Ask an AI agent for the story and one prompt per scene naming the character, action and exact line."],
          ["Queue the prompts", "Paste all prompts into AutoFlow in References mode so it matches each character by name."],
          ["Generate", "Choose Omni Flash, 9:16, 720p, 8 seconds and run all prompts."],
          ["Download", "Scan the project in AutoFlow's Library and download every clip in one click."],
          ["Edit", "Give the clips to Antigravity and ask for the video with motion graphics."],
        ],
      }}
      related={[
        ["/blog/automate-google-flow-ai-agent", "How to automate Google Flow with an AI agent"],
        ["/blog/consistent-characters-google-flow", "How to keep the same character in every Google Flow shot"],
        ["/blog/how-to-batch-generate-ai-videos-google-flow", "How to batch generate AI videos in Google Flow"],
        ["/blog/viral-ai-avatar-videos-google-flow", "How to make viral AI avatar videos in Google Flow"],
      ]}
      note="Marco, Mia and Sammy are fictional clay characters, and Ruby is an AI presenter made in Google Flow. Flow uses your account's credits; this video was made on a Google AI Pro plan."
    >
      <p>
        <strong>AI claymation</strong> is one of the easiest viral formats to make today: little clay characters, a short
        story, a stamp or a number on screen, and real voices. This guide shows the exact workflow behind a 74-second clay
        cartoon, &quot;The Fake Manager Salary Trap&quot;, made with Google Flow, the AutoFlow Chrome extension and Google
        Antigravity, from the first prompt to the finished video in under 30 minutes.
      </p>

      <h2 id="why">Why AI claymation works</h2>
      <p>
        Clay characters read instantly on a phone, they feel handmade, and they can act out stories that would be awkward with
        real people: a boss who underpays, a landlord who keeps a deposit. The clay videos on our TikTok passed{" "}
        <strong>860K</strong> and <strong>140K views</strong>.
      </p>
      <Shot src="/screenshots/clay/tiktok.webp" alt="TikTok page with AI clay videos and their view counts" caption="The clay videos on TikTok: 869.6K, 142.7K and more." />
      <Shot src="/screenshots/clay/video.webp" alt="The finished AI claymation video, The Fake Manager Salary Trap" caption="The finished 74-second clay cartoon." />

      <h2 id="characters">Step 1: three clay characters in Google Flow</h2>
      <p>
        Make each character once in Google Flow and save it as a character: Marco the manager, Mia the worker and Sammy the
        lawyer. A saved character keeps the same face and clay style in every scene, which is what makes a series look
        professional. See <a href="/blog/consistent-characters-google-flow">how Flow&apos;s characters work</a>.
      </p>
      <Shot src="/screenshots/clay/characters.webp" alt="Three clay characters saved in Google Flow" caption="Three clay characters, saved once." />

      <h2 id="story">Step 2: the story and ten prompts</h2>
      <p>
        Ask Antigravity (or Claude, or ChatGPT) to write the story and ten prompts, one per scene. Each prompt names the
        character, the action and the exact line they say. Writing the line inside the prompt is what gives real lip-sync.
      </p>
      <Shot src="/screenshots/clay/prompts.webp" alt="Antigravity writing ten clay animation prompts" caption="Antigravity writes the story and ten prompts." />

      <h2 id="autoflow">Step 3: paste the prompts into AutoFlow</h2>
      <p>
        Paste all ten prompts into AutoFlow in <strong>References</strong> mode. AutoFlow matches Marco, Mia and Sammy to each
        prompt by name, so every scene gets the right character without uploading anything again.
      </p>
      <Shot src="/screenshots/clay/paste.webp" alt="Pasting ten prompts into AutoFlow in References mode" caption="AutoFlow matches each character to the prompts that name them." />

      <h2 id="settings">Step 4: settings and one click</h2>
      <p>
        Choose <strong>Omni 1.1 Flash, 9:16, 720p, 8 seconds</strong> and click Run 10 prompts. AutoFlow queues every prompt
        and keeps Flow busy while you walk away; this part took about seven minutes. (Omni 1.1 Flash leaves Flow on December
        5, 2026. Use Omni 1.2 Flash; see{" "}
        <a href="/blog/google-flow-omni-1-2-model-changes-december-2026">Flow&apos;s new models</a>.)
      </p>
      <Shot src="/screenshots/clay/settings.webp" alt="AutoFlow settings Omni Flash 9:16 720p and Run 10 prompts" caption="Omni Flash · 9:16 · 720p · Run 10 prompts." />
      <Shot src="/screenshots/clay/generating.webp" alt="Google Flow generating ten clay clips queued by AutoFlow" caption="Ten clips generating, sped up." />

      <h2 id="download">Step 5: download all ten clips</h2>
      <p>
        When it finishes, open AutoFlow&apos;s <strong>Library</strong>, click <strong>Scan project</strong>, select all ten
        videos and download them in one click, numbered in order.
      </p>
      <Shot src="/screenshots/clay/library.webp" alt="Downloading all ten clay clips from AutoFlow's Library" caption="Library → Scan project → download all." />

      <h2 id="edit">Step 6: Antigravity edits the video</h2>
      <p>
        Drag the ten clips into Antigravity and type one sentence: make the video with motion graphics. It checks every clip,
        cuts the clay characters off the background, keeps the Flow voices in sync, writes ten motion-graphics scenes in
        HyperFrames (title cards, floating numbers, red stamps), and renders the final video. No editing timeline and no
        keyframes.
      </p>
      <Shot src="/screenshots/clay/antigravity.webp" alt="Dropping the clay clips into Google Antigravity" caption="One sentence to Antigravity." />
      <Shot src="/screenshots/clay/hyperframes.webp" alt="Antigravity building motion graphics scenes in HyperFrames" caption="Ten motion-graphics scenes, built from code." />
      <Shot src="/screenshots/clay/result.webp" alt="The finished AI claymation result" caption="The result." />

      <h2 id="tips">Two tips for cleaner clay videos</h2>
      <ul>
        <li><strong>Same plain background for every character.</strong> Cut-outs come out much cleaner for the motion graphics.</li>
        <li><strong>Exact words in the prompt.</strong> Flow gives real lip-sync instead of mumbling and filler.</li>
      </ul>
      <Shot src="/screenshots/clay/tip-lines.webp" alt="A clay prompt with the character's exact line written in it" caption="Write the exact line inside each prompt." />
    </PostShell>
  );
}
