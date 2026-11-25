import { getPostBySlug } from "../content";
import PostShell, { metadataFor, Shot } from "../PostShell";

export const dynamic = 'force-static';

const post = getPostBySlug("claude-code-stickman-animation-google-flow");
export const metadata = metadataFor(post, 676);

const FAQ = [
  {
    q: "Can Claude Code make stickman animations in Google Flow?",
    a: "Yes, through AutoFlow. Claude Code connects to the AutoFlow Chrome extension with the autoflow-agent MCP server. From one command it wrote the story, made the stickman character, queued all seven scenes in Google Flow, checked the clips and joined them into one video. Nobody clicked anything in Flow.",
  },
  {
    q: "How do I stop the narrator repeating the same line in every scene?",
    a: "Put the exact narration line for each scene inside that scene's prompt, and describe what the picture shows in the same prompt. In this run every prompt carried its own line, and a Whisper transcript of the finished clips confirmed each line was spoken once, in order.",
  },
  {
    q: "How do I keep the same stickman in every clip?",
    a: "Make the character once in AutoFlow's character maker with a face, a name and a voice, then write its exact name in every prompt. AutoFlow attaches the saved character to each clip, so Tuk looks the same in all seven scenes.",
  },
  {
    q: "How much did the video cost?",
    a: "One portrait image (Nano Banana 2.1) to make the stickman, and seven video generations on Omni 1.2 Flash at 360p, 16:9, 8 seconds each, on your own Google Flow credits. Claude showed the cost and waited for a yes before generating anything.",
  },
  {
    q: "How long did it take?",
    a: "Flow generated all seven scenes in about four minutes. From the yes to the finished, joined video took under ten minutes, including the checks.",
  },
  {
    q: "Is the history in the video real?",
    a: "Yes. Ötzi the Iceman, who lived about 5,300 years ago, carried glowing embers wrapped in fresh maple leaves inside a birch-bark container, and Neolithic people used dried tinder fungus to catch sparks. Claude checked both against the South Tyrol Museum of Archaeology and other sources before writing the story.",
  },
];

export default function Page() {
  return (
    <PostShell
      post={post}
      hero={{ src: "/screenshots/stickman/hero.webp", alt: "Tuk the AI stickman opening his birch-bark box with a glowing ember inside", caption: "Tuk, the stickman Claude Code made in Google Flow, with the ember that saves his tribe's fire.", height: 676 }}
      toc={[
        ["result", "The finished video"],
        ["command", "The one command"],
        ["facts", "Step 1: facts and story"],
        ["character", "Step 2: the stickman, made once"],
        ["scenes", "Step 3: seven scenes in Agent mode"],
        ["checks", "Step 4: checking the clips"],
        ["edit", "Step 5: the edit"],
        ["recipe", "The recipe"],
      ]}
      faq={FAQ}
      howto={{
        name: "How to make a stickman history video with Claude Code and Google Flow",
        steps: [
          ["Write one command", "Give the agent a question as the topic, the number of scenes and the story rules."],
          ["Check the facts", "Let the agent check the history against real sources and write a story with a problem and an answer."],
          ["Make the stickman once", "Create the character in AutoFlow's character maker with a face, name and voice."],
          ["Queue the scenes", "One prompt per scene with the picture and its exact narration line, in an Agent-mode queue."],
          ["Check and join", "Check a frame and the narration of every clip, then join them with short fades."],
        ],
      }}
      related={[
        ["/blog/claude-code-google-flow-ai-clay-video", "How Claude Code made a full AI clay video in Google Flow"],
        ["/blog/automate-google-flow-ai-agent", "How to automate Google Flow with an AI agent"],
        ["/blog/consistent-characters-google-flow", "How to keep the same character in every Google Flow shot"],
        ["/blog/viral-ai-avatar-videos-google-flow", "How to make viral AI avatar videos in Google Flow"],
      ]}
      note="Tuk is a fictional character. The facts in the story were checked on 24 November 2026."
    >
      <p>
        Stickman history videos are everywhere on YouTube: one small hand-drawn character, a calm narrator, a question
        answered in under a minute. This is how <strong>Claude Code</strong> made one in <strong>Google Flow</strong> from a
        single command, through the AutoFlow Chrome extension: the story, the narrator, the character, all seven scenes and
        the final edit. Nothing below was done by hand in Flow.
      </p>

      <h2 id="result">The finished video</h2>
      <p>
        &quot;Tuk and the Last Ember&quot;, 55 seconds at 720p. Tuk&apos;s job is to keep his tribe&apos;s fire alive. When
        the tribe moves, he carries a glowing ember in a birch-bark box, a storm puts out the fire at the new camp, and his
        ember starts it again. The answer at the end is real: that is how people carried fire before matches.
      </p>
      <Shot src="/screenshots/stickman/scenes.webp" alt="Six scenes of the AI stickman video: the night fire, tinder fungus, the storm, the ember, the new flame and the tribe cheering" caption="Six of the seven scenes, the same Tuk in every one." width={1200} height={450} />

      <h2 id="command">The one command</h2>
      <p>
        Everything started from this, pasted into Claude Code with AutoFlow connected:
      </p>
      <pre className="blog-code"><code>{`Make a stickman history video with AutoFlow.
Topic: How did ancient people keep fire alive?
Scenes: 7.
Write a real story: one small stickman character, a problem, something that goes wrong, and a clear answer at the end.
Every narration line must describe exactly what its scene shows.
Pick one narrator voice from Flow's voice list, make the stickman character once, and queue the 7 scenes in Agent mode (Omni 1.2 Flash, 16:9, 360p).
Check the facts, show me the prompts and the cost, and wait for my yes. Then run it, download the clips and edit them into one video.`}</code></pre>
      <p>
        Two rules do most of the work. &quot;A real story&quot; gives the video a problem and a turn instead of a list of
        facts. &quot;Every narration line must describe exactly what its scene shows&quot; stops the most common problem in
        AI stickman videos: the same line, or the wrong line, playing over every scene.
      </p>
      <Shot src="/screenshots/stickman/command.webp" alt="The stickman command pasted into Claude Code" caption="The command, pasted into Claude Code." height={496} />

      <h2 id="facts">Step 1: facts and story</h2>
      <p>
        Before writing a word of story, Claude checked the history. Ötzi the Iceman, about 5,300 years ago, carried glowing
        embers wrapped in fresh maple leaves inside a birch-bark container. Neolithic people dried tinder fungus to catch
        sparks and carry fire between camps. Both facts went into the story.
      </p>
      <Shot src="/screenshots/stickman/facts.webp" alt="Claude Code checking the history of how ancient people kept fire alive" caption="The facts, with their sources, before the story." height={572} />
      <p>
        Then it wrote &quot;Tuk and the Last Ember&quot; scene by scene, with the picture on one side and the exact narration
        line on the other, chose the narrator voice <strong>Sadaltager</strong> (Flow&apos;s &quot;male, knowledgeable&quot;
        voice), and listed the cost: one portrait image for the character and seven video generations. Then it stopped and
        waited for a yes.
      </p>
      <Shot src="/screenshots/stickman/plan.webp" alt="The seven scenes with their narration lines and the cost" caption="Seven scenes, seven lines, the cost, then a yes." height={780} />

      <h2 id="character">Step 2: the stickman, made once</h2>
      <p>
        Claude made Tuk in AutoFlow&apos;s character maker: a black-ink stickman with a round white head, a leaf headband and a
        brown fur tunic. Flow drew his portrait, AutoFlow named him and gave him a voice, and he was saved in the &quot;AutoFlow
        Characters&quot; project, so every scene can borrow the same face.
      </p>
      <Shot src="/screenshots/stickman/character-maker.webp" alt="AutoFlow making the stickman character Tuk in Google Flow" caption="Tuk being made in Flow." height={646} />
      <Shot src="/screenshots/stickman/tuk-saved.webp" alt="Tuk saved in AutoFlow's character list" caption="Tuk saved, ready for every scene." height={646} />

      <h2 id="scenes">Step 3: seven scenes in Agent mode</h2>
      <p>
        Claude added the seven prompts as one queue in <strong>Agent mode</strong> (Omni 1.2 Flash, 16:9, 360p, 8 seconds),
        with Tuk and the narrator voice on every prompt. AutoFlow opened a fresh Flow project, typed each scene, attached the
        character and the voice, and started it. Agent mode reports every event back to Claude, so it always knows which scene
        is generating, which is done and which failed.
      </p>
      <Shot src="/screenshots/stickman/queue.webp" alt="The Agent-mode queue starting in AutoFlow" caption="The queue starts; the agent bar says Claude is in control." height={646} />
      <Shot src="/screenshots/stickman/generating.webp" alt="Google Flow generating the stickman scenes" caption="Scenes generating in Flow, the same Tuk in each." height={646} />
      <p>All seven scenes were done in about four minutes.</p>

      <h2 id="checks">Step 4: checking the clips</h2>
      <p>
        AutoFlow marked every clip done about ten seconds after it started, which looked too fast. Instead of trusting it,
        Claude checked the download folder: seven real files of about 2 MB each, numbered in story order, with a manifest
        listing every clip&apos;s prompt and file.
      </p>
      <Shot src="/screenshots/stickman/checks.webp" alt="Claude Code checking that the downloaded clips are real" caption="Too fast? Claude checks the files." height={724} />
      <p>
        Then it looked at a frame from every scene and transcribed every narration line with Whisper. Each line was spoken
        once, in order, over its own picture, and every line ended before its clip did, so nothing would be cut.
      </p>

      <h2 id="edit">Step 5: the edit</h2>
      <p>
        Claude joined the seven clips with short fades and upscaled the video to 720p. From the yes to the finished video took
        under ten minutes, and at the end it summed up the story, the narrator, the character, the clips and where the video
        was saved.
      </p>
      <Shot src="/screenshots/stickman/summary.webp" alt="Claude Code's summary of the finished stickman video" caption="The summary, with the video ready to play." height={886} />

      <h2 id="recipe">The recipe</h2>
      <ol>
        <li>Ask a question as the topic and give the number of scenes.</li>
        <li>Ask for a real story: a character, a problem, a turn and an answer.</li>
        <li>Put each scene&apos;s exact narration line in its prompt.</li>
        <li>Make the character once, pick one narrator voice.</li>
        <li>Queue in Agent mode, check the clips, then join them.</li>
      </ol>
      <p>
        Change the topic and run it again: how did people find water, how were the first boats built, why did farmers stop
        moving? It works with Claude Code, Codex or Antigravity. Install AutoFlow, switch on AI agents in Settings, and see{" "}
        <a href="/blog/automate-google-flow-ai-agent">how to connect an agent</a>.
      </p>
    </PostShell>
  );
}
