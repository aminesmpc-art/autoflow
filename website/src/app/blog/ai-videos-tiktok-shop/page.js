import { getPostBySlug } from "../content";
import PostShell, { metadataFor, Shot } from "../PostShell";

export const dynamic = 'force-static';

const post = getPostBySlug("ai-videos-tiktok-shop");
export const metadata = metadataFor(post);

const FAQ = [
  {
    q: "How do you make AI videos for TikTok Shop?",
    a: "Start from a short video with the movement you want, give AutoFlow Motion a turnaround sheet of your AI character, and let it split the video into 8-second pieces, have Gemini direct each one, and generate them in Google Flow. Download the clips, move them to your phone and post from the TikTok app.",
  },
  {
    q: "Can I run a faceless TikTok Shop account with AI?",
    a: "Yes, an AI character can present your videos so you never show your face. TikTok asks you to label realistic AI content, represent products accurately and disclose promotions, and Shop approval is a separate step from making the videos.",
  },
  {
    q: "Why split the video into 8-second pieces?",
    a: "AI video models generate their best clips at about 8 seconds. A 24-second source becomes three 8-second pieces, and with Keep clips consistent on, each piece starts from the ending frame of the one before.",
  },
  {
    q: "What is a character turnaround sheet?",
    a: "One image showing your character from the front, the side and the back, with the same face, hair and outfit. It locks the look so every clip and every video shows the same person.",
  },
  {
    q: "How long does it take?",
    a: "The cloud render takes about ten minutes for a 24-second video. Setup is a few clicks once your character sheet is ready.",
  },
];

export default function Page() {
  return (
    <PostShell
      post={post}
      hero={{ src: "/screenshots/tiktok-shop/result.webp", alt: "AI character workout clips made automatically for TikTok Shop", caption: "Three clips of the same AI character, made automatically." }}
      toc={[
        ["why", "Why AI videos work for TikTok Shop"],
        ["open", "Step 1: open AutoFlow Motion and choose your video"],
        ["sheet", "Step 2: add your character turnaround sheet"],
        ["consistent", "Step 3: keep clips consistent and remove the source audio"],
        ["generate", "Step 4: generate with Gemini and Google Flow"],
        ["download", "Step 5: download and organise"],
        ["post", "Step 6: transfer to your phone and post"],
        ["plan", "The 5-day content plan"],
      ]}
      faq={FAQ}
      howto={{
        name: "How to make AI videos for TikTok Shop with AutoFlow Motion",
        steps: [
          ["Choose the source video", "Open AutoFlow Motion in Google Flow and choose a short video with the movement you want."],
          ["Add the character sheet", "Add a full turnaround sheet of your AI character."],
          ["Set consistency", "Turn on Keep clips consistent and lip-sync, and remove the source audio."],
          ["Generate", "Press Generate; Gemini directs each 8-second piece and Google Flow renders it."],
          ["Download", "Download all clips into a new numbered folder."],
          ["Post", "Upload to Google Drive, open it on your phone and post from the TikTok app."],
        ],
      }}
      related={[
        ["/blog/free-ai-motion-transfer-google-flow", "Free AI motion transfer in Google Flow"],
        ["/blog/remake-viral-video-ai-character", "How to remake a viral video with your own AI character"],
        ["/blog/how-to-make-tiktok-videos-with-ai", "How to make TikTok videos with AI"],
      ]}
      note="Use source footage you own or have permission to use. Ruby and the character clips are AI-generated. TikTok Shop approval, product choice and publishing are separate from making the videos."
    >
      <p>
        TikTok Shop rewards accounts that post often, and filming yourself every day is exhausting. This guide shows the
        AutoFlow Motion pipeline that turns one short source video into a set of <strong>AI videos for TikTok Shop</strong>,
        presented by the same AI character every time, plus a 5-day plan to get your first posts out.
      </p>

      <h2 id="why">Why AI videos work for TikTok Shop</h2>
      <ul>
        <li><strong>No camera.</strong> A faceless account can still have a face: your AI character.</li>
        <li><strong>Volume.</strong> One source video becomes several clips without reshoots.</li>
        <li><strong>Consistency.</strong> The same character in every video builds a recognisable account.</li>
      </ul>

      <h2 id="open">Step 1: open AutoFlow Motion and choose your video</h2>
      <p>
        <a href="/motion">AutoFlow Motion</a> sits on the right side of Google Flow. Choose the source video with the
        movement you want. A 24-second source is split into three 8-second pieces, because that is the length AI video
        models generate best.
      </p>
      <Shot src="/screenshots/tiktok-shop/open.webp" alt="AutoFlow Motion open next to Google Flow" caption="AutoFlow Motion on the right side of Google Flow." />
      <Shot src="/screenshots/tiktok-shop/pieces.webp" alt="A 24-second source split into three 8-second pieces" caption="24 s source = three 8 s pieces." />

      <h2 id="sheet">Step 2: add your character turnaround sheet</h2>
      <p>
        Add a full turnaround sheet of your AI character: front, side and back, same face, hair and outfit. It locks her look
        in every piece.
      </p>
      <Shot src="/screenshots/tiktok-shop/sheet.webp" alt="Adding the character turnaround sheet in AutoFlow Motion" caption="Add the character turnaround sheet." />
      <Shot src="/screenshots/tiktok-shop/turnaround.webp" alt="An AI character turnaround sheet" caption="A turnaround sheet locks her look." />

      <h2 id="consistent">Step 3: keep clips consistent and remove the source audio</h2>
      <p>
        Turn on <strong>Keep clips consistent</strong>, which uses each clip&apos;s ending frame as a reference for the next,
        and <strong>Keep exact lip sync</strong>. Remove the source audio so only the new video comes back.
      </p>
      <Shot src="/screenshots/tiktok-shop/consistent.webp" alt="Keep clips consistent and lip sync settings in AutoFlow Motion" caption="Keep clips consistent and lip sync on." />

      <h2 id="generate">Step 4: generate with Gemini and Google Flow</h2>
      <p>
        Press the orange <strong>Generate</strong> button. Gemini acts as the director and writes the motion for each piece,
        and Google Flow renders them. The cloud render takes about ten minutes.
      </p>
      <Shot src="/screenshots/tiktok-shop/generate.webp" alt="Pressing Generate in AutoFlow Motion" caption="Press Generate." />
      <Shot src="/screenshots/tiktok-shop/wait.webp" alt="Google Flow rendering the AI character clips" caption="The render takes about ten minutes." />

      <h2 id="download">Step 5: download and organise</h2>
      <p>
        Download all the clips into a new subfolder. Number your folders by day so you always know which videos are posted.
      </p>
      <Shot src="/screenshots/tiktok-shop/download.webp" alt="Downloading all AI clips into a new folder" caption="Download all clips into a new folder." />

      <h2 id="post">Step 6: transfer to your phone and post</h2>
      <p>
        Upload the folder to Google Drive, open it on your phone and post from the TikTok app. Posting from the app gives you
        TikTok&apos;s own sounds, captions and Shop product links.
      </p>
      <Shot src="/screenshots/tiktok-shop/drive.webp" alt="Uploading AI videos to Google Drive to post from the phone" caption="Upload to Drive, post from the app." />

      <h2 id="plan">The 5-day content plan</h2>
      <ol>
        <li><strong>Day 1:</strong> choose motion footage you can use and prepare your AI character references.</li>
        <li><strong>Day 2:</strong> set up AutoFlow Motion and generate your first batch of clips.</li>
        <li><strong>Day 3:</strong> review character consistency and retry clips that need work.</li>
        <li><strong>Day 4:</strong> organise your finished clips and prepare your posts.</li>
        <li><strong>Day 5:</strong> transfer the videos to your phone, publish, and review what to make next.</li>
      </ol>
    </PostShell>
  );
}
