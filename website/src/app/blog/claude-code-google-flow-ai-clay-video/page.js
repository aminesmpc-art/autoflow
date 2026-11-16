import { getPostBySlug } from "../content";
import PostShell, { metadataFor, Shot } from "../PostShell";

export const dynamic = 'force-static';

const post = getPostBySlug("claude-code-google-flow-ai-clay-video");
export const metadata = metadataFor(post, 400);

const FAQ = [
  {
    q: "Can Claude Code make videos in Google Flow?",
    a: "Yes, through AutoFlow. Claude Code connects to the AutoFlow Chrome extension with the autoflow-agent MCP server, then makes the characters, queues the prompts, runs them in Google Flow, reads why a clip was refused, rewrites it and downloads the files. In this run it also made the miniature sets as Flow images and edited the final video.",
  },
  {
    q: "Why did Google Flow refuse the prompts?",
    a: "Two lines contained the French word for \"late\" or \"delay\", which is spelled like an English slur. Flow's safety filter read it as the slur and blocked the clip, even after three different wordings. Rewriting the sentence without that word fixed both clips at once.",
  },
  {
    q: "How do I fix a Google Flow 'safety blocked' error?",
    a: "Read every word of the prompt, including the dialogue and in every language. A word that is harmless in one language can be an insult in another. Change wording rather than retrying the same text, and if a realistic-looking face keeps failing, check the reference image too.",
  },
  {
    q: "What is Agent mode in AutoFlow?",
    a: "Agent mode is the run mode an AI agent uses when it drives AutoFlow. The queue runs like Full mode in its own Flow project, but refused prompts are held for the agent to reword, every event is reported back to the agent, and the files are collected for it.",
  },
  {
    q: "Does the agent spend credits without asking?",
    a: "It should not. In this run Claude Code showed the cast and the script and asked before generating the clips and sets. Running a queue spends your own Flow credits, so the AutoFlow tools tell every agent to ask first.",
  },
  {
    q: "Are the legal facts in the video checked?",
    a: "Every claim was checked against Légifrance and service-public.gouv.fr on 16 November 2026: 14 days to withdraw from an online purchase even on sale items (Code de la consommation L221-18), a full refund including delivery on the same payment method (L221-24), and an increase for late refunds (L242-4). It is general information, not legal advice.",
  },
];

export default function Page() {
  return (
    <PostShell
      post={post}
      hero={{ src: "/screenshots/black-friday/cast.webp", alt: "The three clay characters Claude Code made in Google Flow: Jordan, Inès and Maître Amel", caption: "The cast Claude Code made through AutoFlow: Jordan, Inès and Maître Amel.", height: 400 }}
      toc={[
        ["result", "The finished video"],
        ["research", "Step 1: research and fact-check"],
        ["cast", "Step 2: three clay characters"],
        ["clips", "Step 3: twelve clips in Agent mode"],
        ["refused", "The word Google Flow refused"],
        ["collect", "Step 4: collecting the clips"],
        ["sets", "Step 5: seven miniature sets"],
        ["edit", "Step 6: the edit"],
        ["recipe", "The recipe"],
      ]}
      faq={FAQ}
      howto={{
        name: "How to make an AI clay video with Claude Code and Google Flow",
        steps: [
          ["Research", "Pick a timely topic and check every fact against official sources."],
          ["Make the cast", "Create each clay character once in AutoFlow's character maker with a face, name and voice."],
          ["Queue the clips", "Write one prompt per line naming the character and queue them in Agent mode."],
          ["Fix refusals", "Read why Flow refused a clip and change the words, checking every word in every language."],
          ["Collect", "Download every clip and match each file to its line."],
          ["Make sets and edit", "Generate miniature sets as Flow images, cut out the characters, build the scenes and render."],
        ],
      }}
      related={[
        ["/blog/ai-claymation-google-flow", "How to make AI claymation videos with Google Flow"],
        ["/blog/automate-google-flow-ai-agent", "How to automate Google Flow with an AI agent"],
        ["/blog/viral-ai-avatar-videos-google-flow", "How to make viral AI avatar videos in Google Flow"],
        ["/blog/consistent-characters-google-flow", "How to keep the same character in every Google Flow shot"],
      ]}
      note="Jordan, Inès and Maître Amel are fictional clay characters. The video explains French consumer law as general information, not legal advice."
    >
      <p>
        This is the full story of how <strong>Claude Code</strong> made a French AI clay video, &quot;Le Piège du Black
        Friday&quot;, through <strong>Google Flow</strong> and the AutoFlow Chrome extension: the research, three clay
        characters, twelve clips, seven miniature sets and the final edit. It also made one mistake and hit one wall, and the
        wall turned out to be a single word.
      </p>

      <h2 id="result">The finished video</h2>
      <p>
        An 86-second vertical video. Inès bought a €399 TV on Black Friday; Jordan, the shop owner, says sale items are never
        refunded; Maître Amel, a clay lawyer, explains that online buyers get 14 days to change their mind, a full refund
        including delivery, on their own card.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, margin: "0 0 24px" }}>
        <Shot src="/screenshots/black-friday/clay-hook.webp" alt="Clay character Inès with a 399 euros TV, Black Friday" width={540} height={960} />
        <Shot src="/screenshots/black-friday/clay-amel.webp" alt="Clay lawyer Maître Amel: online purchase" width={540} height={960} />
        <Shot src="/screenshots/black-friday/clay-jours.webp" alt="14 days to change your mind, Code de la consommation" width={540} height={960} />
        <Shot src="/screenshots/black-friday/clay-refund.webp" alt="Inès refunded in full" width={540} height={960} />
      </div>

      <h2 id="research">Step 1: research and fact-check</h2>
      <p>
        Black Friday falls on 27 November 2026, so Claude picked France&apos;s biggest money question of that week: can a sale
        item be returned? The twist is a real rule: bought online, you have 14 days to withdraw, even on a sale item. Claude
        checked every line against Légifrance and service-public.gouv.fr, and even asked a second fact-checking agent to
        confirm one line, whether a seller can refund with a voucher instead of money, before writing a single prompt.
      </p>

      <h2 id="cast">Step 2: three clay characters</h2>
      <p>
        Through AutoFlow&apos;s character maker, Claude made Jordan the shop owner, Inès the buyer and Maître Amel the lawyer.
        Each got a face, a name and a custom voice, saved once in Flow, so every clip that names them gets the same figurine.
        Then it showed the cast and the script and <strong>waited for a yes</strong> before spending any credits.
      </p>
      <Shot src="/screenshots/black-friday/characters.webp" alt="Making clay characters in Google Flow with AutoFlow" caption="The character maker in Flow, driven by Claude Code." height={652} />
      <Shot src="/screenshots/black-friday/cast-check.webp" alt="Claude Code assembling the cast picture" caption="Claude Code builds the cast picture and checks the script." height={652} />

      <h2 id="clips">Step 3: twelve clips in Agent mode</h2>
      <p>
        Claude wrote twelve prompts, each starting with the character&apos;s name, and added them as one queue in{" "}
        <strong>Agent mode</strong>: Omni 1.2 Flash, 9:16, 360p. It caught a bug before Flow did: one of Amel&apos;s lines said
        &quot;Jordan&quot;, so AutoFlow attached Jordan&apos;s character to her clip. It stopped the run and fixed the line.
      </p>
      <Shot src="/screenshots/black-friday/queue.webp" alt="The Agent-mode queue in AutoFlow with twelve clay prompts" caption="Twelve prompts, one Agent-mode queue." height={652} />
      <Shot src="/screenshots/black-friday/caught.webp" alt="Claude Code stopping the run to fix a prompt" caption="Claude stops the run when the wrong character is attached." height={652} />
      <Shot src="/screenshots/black-friday/generating.webp" alt="Google Flow generating the clay clips" caption="The clay clips generating in Flow." height={652} />

      <h2 id="refused">The word Google Flow refused</h2>
      <p>
        Ten clips came back perfect. Two of Amel&apos;s lines were refused, held by AutoFlow, and sent back to Claude with the
        reason. Claude reworded them, then tried a brand-new, more cartoon-like Amel; when told to keep the original, it
        stopped and put her back. Still refused: three wordings, four tries each.
      </p>
      <p>
        The real cause was one word. Both lines used the French word for &quot;late&quot;, which is spelled exactly like an
        English slur. Flow&apos;s safety filter read the English meaning. Rewriting the sentence without it (&quot;trop
        tard&quot;) and both clips passed. <strong>When Flow refuses a clip, check every word, in every language.</strong>
      </p>
      <Shot src="/screenshots/black-friday/held.webp" alt="AutoFlow holding refused prompts for the agent" caption="AutoFlow holds the refused prompts for the agent." height={652} />
      <Shot src="/screenshots/black-friday/word.webp" alt="Finding the word that triggered Google Flow's safety filter" caption="The cause: one word read in the wrong language." height={652} />

      <h2 id="collect">Step 4: collecting the clips</h2>
      <p>
        The downloads came back under Flow&apos;s own file names, so Claude transcribed all sixteen files with Whisper to match
        each one to its line. Then it found the bug in AutoFlow that caused it, fixed the download naming, added a test and
        rebuilt the extension.
      </p>
      <Shot src="/screenshots/black-friday/whisper.webp" alt="Claude Code matching clips to lines with Whisper" caption="Every clip matched to its line." height={652} />

      <h2 id="sets">Step 5: seven miniature sets</h2>
      <p>
        Google Cloud billing was off, so Claude made the seven miniature clay sets as Flow images instead, with Nano Banana in
        another Agent-mode queue: Inès&apos;s room, a cluttered shop, a lawyer&apos;s library and office, a courthouse
        staircase, a happy room and a studio.
      </p>
      <Shot src="/screenshots/black-friday/sets.webp" alt="Seven miniature clay sets made as Google Flow images" caption="The seven sets, made in Flow." width={1400} height={355} />

      <h2 id="edit">Step 6: the edit</h2>
      <p>
        A script pulled out each clip&apos;s audio, timed every word and cut each figurine out of its background. Claude
        trimmed the silence at the start of five clips, wrote twelve scenes (sets, slam words, law citations, close-ups and
        sound effects) and rendered the video. Every euro amount and article of law on screen came from the sources it
        checked.
      </p>
      <Shot src="/screenshots/black-friday/prepare.webp" alt="Preparing clips: audio, word timings and cut-outs" caption="Audio, word timings and cut-outs." height={652} />

      <h2 id="recipe">The recipe</h2>
      <ol>
        <li>Research a timely topic and source every fact.</li>
        <li>Make the characters once, with a face and a voice.</li>
        <li>Queue the clips in Agent mode, one prompt per line.</li>
        <li>Fix refusals by changing words, and check every language.</li>
        <li>Let the agent collect, build the sets and edit.</li>
      </ol>
      <p>
        It works with Claude Code, Codex or Antigravity. Install AutoFlow, switch on AI agents in Settings, and paste the
        setup for your agent; see <a href="/blog/automate-google-flow-ai-agent">how to connect an agent</a>.
      </p>
    </PostShell>
  );
}
