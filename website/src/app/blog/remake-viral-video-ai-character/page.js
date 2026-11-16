import { getPostBySlug } from "../content";
import PostShell, { metadataFor, Shot } from "../PostShell";

export const dynamic = 'force-static';

const post = getPostBySlug("remake-viral-video-ai-character");
export const metadata = metadataFor(post);

const FAQ = [
  {
    q: "How do you swap the character in a viral video with AI?",
    a: "Use motion transfer: give the AI the original clip as the movement reference and a picture of your character. AutoFlow Motion splits the clip into short pieces, has Gemini write the movement for each, and runs them in Google Flow with your character, then you join the pieces and put the original sound back.",
  },
  {
    q: "Why is the clip split into pieces?",
    a: "AI video models make their best clips at around 8 seconds. A 23-second clip becomes three pieces, and each piece after the first starts from the ending frame of the one before so the joins stay continuous.",
  },
  {
    q: "Does the AI copy the lip movements?",
    a: "With lip-sync on, the model follows the mouth movement of the reference while the original conversation plays over it. It helps a lot, but it is not guaranteed; always check both joins and the mouth timing before you post.",
  },
  {
    q: "Which editor joins the clips?",
    a: "Any editor works. This guide uses CapCut: put the three clips next to each other on the timeline, trim a frozen ending if there is one, and lay the original audio underneath as one track.",
  },
  {
    q: "Can I use any viral clip?",
    a: "Only use footage you have permission to reuse, and credit the original creator. The remake should be clearly AI-generated; most platforms ask you to label realistic AI content.",
  },
];

export default function Page() {
  return (
    <PostShell
      post={post}
      hero={{ src: "/screenshots/fishing/remake.webp", alt: "AI remake of the viral who told you to fish here clip with a new character", caption: "Same moment, same conversation, a different face." }}
      toc={[
        ["what", "What a viral character remake is"],
        ["setup", "Step 1: the clip, your character and Transfer motion"],
        ["consistency", "Step 2: consistency and lip-sync"],
        ["gemini", "Step 3: Gemini writes the movement"],
        ["flow", "Step 4: the pieces generate in Google Flow"],
        ["download", "Step 5: download all three clips"],
        ["capcut", "Step 6: join them in CapCut with the original audio"],
      ]}
      faq={FAQ}
      howto={{
        name: "How to remake a viral video with your own AI character",
        steps: [
          ["Choose the clip and character", "Open AutoFlow Motion in Google Flow, add the viral clip as the reference and a picture of your character, and choose Transfer motion."],
          ["Turn on consistency", "Keep clips consistent and lip-sync on so each piece continues from the last one."],
          ["Let Gemini direct", "Gemini writes movement instructions for each 8-second piece."],
          ["Generate", "AutoFlow Motion hands the pieces to Google Flow with your character."],
          ["Download", "Download all three clips in one click."],
          ["Assemble", "Join the clips in CapCut and lay the original conversation underneath."],
        ],
      }}
      related={[
        ["/blog/free-ai-motion-transfer-google-flow", "Free AI motion transfer in Google Flow"],
        ["/blog/ai-videos-tiktok-shop", "How to make AI videos for TikTok Shop"],
        ["/blog/reverse-engineer-ai-video-shot-by-shot", "Reverse-engineering a viral AI video, shot by shot"],
      ]}
      note='Original fishing clip: bird28thegr8. The remake is AI-generated; only use footage you have permission to reuse. Ruby is an AI presenter made in Google Flow.'
    >
      <p>
        You have seen the trend: a viral clip, the same moment and the same conversation, but a completely different person.
        This guide shows how to remake the viral <strong>&quot;who told you to fish here?&quot;</strong> clip with your own AI
        character, step by step, with AutoFlow Motion, Gemini, Google Flow and CapCut.
      </p>

      <h2 id="what">What a viral character remake is</h2>
      <p>
        An <strong>AI character swap</strong> keeps the original video&apos;s movement and audio and replaces the person. It
        is called motion transfer or motion control: the original clip is the reference for every gesture, and the AI
        renders your character doing the same thing. The joke stays, the face changes, and that contrast is what makes these
        remakes spread.
      </p>

      <h2 id="setup">Step 1: the clip, your character and Transfer motion</h2>
      <p>
        Open <a href="/motion">AutoFlow Motion</a> next to Google Flow and choose <strong>Transfer motion</strong>. Add the
        original clip as the reference and a picture of your character. The output is portrait (9:16), ready for TikTok,
        Reels and Shorts.
      </p>
      <Shot src="/screenshots/fishing/transfer.webp" alt="AutoFlow Motion with Transfer motion selected in Google Flow" caption="Choose Transfer motion, add the clip and your character." />

      <h2 id="consistency">Step 2: consistency and lip-sync</h2>
      <p>
        Leave <strong>consistency</strong> on so every piece continues from the ending frame of the one before, and leave
        lip-sync on so the mouth follows the original conversation. Remove the source audio from the generation; you will
        put the original sound back at the end.
      </p>
      <Shot src="/screenshots/fishing/consistency.webp" alt="AutoFlow Motion consistency and lip-sync settings" caption="Leave consistency on." />

      <h2 id="gemini">Step 3: Gemini writes the movement</h2>
      <p>
        The 23-second clip is split into three pieces of about 8 seconds, the length AI video models handle best. Gemini
        watches each piece and writes the movement instructions for it, so you are not describing gestures by hand.
      </p>
      <Shot src="/screenshots/fishing/gemini.webp" alt="Gemini writing movement instructions for each piece of the clip" caption="Gemini writes movement instructions for each piece." />

      <h2 id="flow">Step 4: the pieces generate in Google Flow</h2>
      <p>
        AutoFlow Motion hands each piece to Google Flow with your character and starts it. The second and third pieces use
        the previous piece&apos;s ending frame, which keeps the joins smooth.
      </p>
      <Shot src="/screenshots/fishing/flow.webp" alt="The first piece starting in Google Flow with the AI character" caption="The first piece starts in Flow." />
      <Shot src="/screenshots/fishing/ending.webp" alt="The next piece continuing from the ending frame" caption="Each piece continues from the last frame." />

      <h2 id="download">Step 5: download all three clips</h2>
      <p>Review each piece, then download all three in one click.</p>
      <Shot src="/screenshots/fishing/download.webp" alt="Downloading all three motion transfer clips" caption="Download all three clips and open CapCut." />

      <h2 id="capcut">Step 6: join them in CapCut with the original audio</h2>
      <p>
        Drop the three clips next to each other on the CapCut timeline, trim a frozen ending if a piece has one, and lay the
        original conversation underneath as one audio track aligned from the start. Then check the sound against his mouth;
        if it feels off, nudge the audio a few frames.
      </p>
      <Shot src="/screenshots/fishing/timeline.webp" alt="Three AI clips side by side on the CapCut timeline" caption="Clips side by side; check both cut points." />
      <Shot src="/screenshots/fishing/sound.webp" alt="Aligning the original audio under the AI remake in CapCut" caption="Check the sound against the mouth." />
    </PostShell>
  );
}
