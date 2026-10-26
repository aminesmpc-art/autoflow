/* The privacy policy's one official text. /privacy renders it, and so does
   every /[locale]/privacy, so there is no second version of the facts to fall
   out of step. The translated summaries those pages carried before had done
   exactly that: they said AutoFlow collects no personal data and never uploads
   your content, while accounts hold an email address and Motion sends your
   videos to Google Flow. */

export const PRIVACY_UPDATED = "25 October 2026";

export default function PrivacyPolicy() {
  return (
    <>
      {/* ── 1. Introduction ── */}
      <h2>1. Introduction</h2>
      <p>
        AutoFlow (&quot;AutoFlow&quot;, &quot;we&quot;, &quot;us&quot;,
        &quot;our&quot;) is operated by amine.smpc and makes the AutoFlow
        Studio and AutoFlow Motion Chrome browser extensions. This Privacy
        Policy explains what personal data we collect through these extensions
        and the website at{" "}
        <a href="https://www.auto-flow.studio">auto-flow.studio</a>, how we
        use it, how we store and protect it, who we share it with, and your
        rights regarding that data. Where something applies to only one of the
        extensions, this policy says so.
      </p>
      <p>
        By installing or using AutoFlow Studio or AutoFlow Motion you agree to
        this policy. If you do not agree, please uninstall the extension and do
        not use our services.
      </p>

      {/* ── 2. Data We Collect ── */}
      <h2>2. Data We Collect</h2>

      <h3>2.1 Account &amp; Authentication Data</h3>
      <p>
        When you create an account or sign in, we collect the following. One
        AutoFlow account works in both extensions.
      </p>
      <ul>
        <li>
          <strong>Email address</strong> — used to identify your account,
          communicate important service updates, and link your subscription.
        </li>
        <li>
          <strong>Password</strong> (email/password sign-up only) — hashed
          on the server; we never store or transmit your password in plain
          text.
        </li>
        <li>
          <strong>Google ID token</strong> (Google Sign-In only) — received
          from Google via Chrome&apos;s <code>identity</code> API and sent to
          our server solely to verify your identity. We do not receive or
          store your Google password.
        </li>
      </ul>

      <h3>2.2 Usage Data (AutoFlow Studio)</h3>
      <p>
        To enforce plan limits (free vs. Pro) and prevent abuse, we collect
        the following <em>numeric counts only</em>:
      </p>
      <ul>
        <li>
          <strong>Prompt counts</strong> — number of text and full prompts
          submitted per day.
        </li>
        <li>
          <strong>Workflow run counts</strong> — number of queue runs started
          per day, broken down by mode (lite / flow / full).
        </li>
        <li>
          <strong>Download counts</strong> — number of media downloads per
          day.
        </li>
        <li>
          <strong>Node and generate counts</strong> — number of nodes and
          generation steps per workflow run.
        </li>
      </ul>
      <p>
        These counts are tied to your account for billing purposes. We do{" "}
        <strong>not</strong> collect the content of your prompts, the text of
        AI responses, or any images or videos. AutoFlow Motion keeps job
        records instead of these counts; see Section 2.6.
      </p>

      <h3>2.3 Community Posts (AutoFlow Studio, Optional)</h3>
      <p>
        AutoFlow Studio has a Community feed where people post workflows for
        others to use. If you post, like or report a post, we collect:
      </p>
      <ul>
        <li>
          <strong>Your display name</strong> — the name you choose for your
          posts. It is shown on every post you make; your email address is
          never shown.
        </li>
        <li>
          <strong>Your post</strong> — its title, caption, and the workflow:
          the steps, their prompt text and settings. The results of your runs
          (videos, images, AI replies) are never included, and pictures you
          added to the workflow are left out unless you choose to include
          them.
        </li>
        <li>
          <strong>Likes and reports</strong> — which posts you liked, and any
          report you send (the reason and an optional note).
        </li>
      </ul>
      <p>
        A post is <strong>public to everyone using AutoFlow Studio</strong>{" "}
        as soon as you post it. You can delete your own posts at any time.
        Posts reported by several people are hidden until we review them,
        and we may remove posts or stop an account posting. Nothing is
        uploaded unless you press &quot;Post&quot;.
      </p>

      <h3>2.4 Review Reward Claims (Optional)</h3>
      <p>
        If you claim a review reward, we collect the{" "}
        <strong>reviewer name</strong> you provide so we can verify the
        review.
      </p>

      <h3 id="sites">2.5 Websites the Extensions Work On</h3>
      <p>
        To automate the video work you ask for, the extensions open and
        operate pages on the following sites, using your own signed-in
        accounts:
      </p>
      <ul>
        <li>
          <strong>Google Flow</strong> — labs.google and flow.google.com. The
          extensions also download the media of your own Flow generations from
          flow-content.google and googlevideo.com.
        </li>
        <li><strong>ChatGPT</strong> — chatgpt.com</li>
        <li><strong>Gemini</strong> — gemini.google.com</li>
        <li><strong>Claude</strong> — claude.ai</li>
        <li><strong>Grok</strong> — grok.com (AutoFlow Studio only)</li>
        <li><strong>Z.AI</strong> — chat.z.ai (AutoFlow Studio only)</li>
        <li>
          <strong>auto-flow.studio</strong> — our own website, so you can send
          an analysis from the Extractor into AutoFlow Studio (AutoFlow Studio
          only)
        </li>
      </ul>
      <p>
        On these sites, the extensions read only the parts of the page that
        your task needs — the prompt box, upload and progress indicators, and
        the results — to bring AI responses and finished videos back into your
        workflow. What they read is processed locally in your browser and is{" "}
        <strong>not</strong> sent to our servers. The extensions do not read
        your conversation history, your other tabs, or any other website.
      </p>

      <h3 id="motion">2.6 AutoFlow Motion</h3>
      <p>
        AutoFlow Motion turns the movement of a video you choose into new
        clips in Google Flow. This is the data it handles:
      </p>
      <ul>
        <li>
          <strong>Your videos, images and prompts</strong> go only to the
          services you use for the job. The extension cuts your video into
          pieces on your computer. It sends the pieces (and, when a step needs
          them, your reference images) to the AI assistant you choose —
          Gemini, ChatGPT or Claude — which writes a prompt for each piece. It
          then uploads the pieces, your subject and place images and the
          prompts to Google Flow, which generates your clips. All of this
          happens in your browser with your own accounts. None of it passes
          through our servers or is stored by us.
        </li>
        <li>
          <strong>Plan and job records.</strong> To give Free accounts 3
          Motion jobs a day and AutoFlow Pro accounts unlimited jobs, the
          extension asks our server for your Motion allowance and registers
          each job you start. A job record holds a random job ID, a
          fingerprint, the date, and the time it was created. The fingerprint
          is a SHA-256 hash, calculated on your computer from your video file
          and the job&apos;s settings, which lets us recognise a retry of the
          same job so that retries are never counted again. It cannot be
          turned back into your video, and the video itself is never sent to
          us.
        </li>
        <li>
          <strong>Uploads to Flow.</strong> Automated uploads are off until
          you turn them on in the panel. When they are on, the extension uses
          Chrome&apos;s <code>debugger</code> permission only to choose your
          video file in Flow&apos;s file picker, and detaches when the upload
          is done; Chrome shows a &quot;started debugging this browser&quot;
          banner while it is attached. To make the file available to that
          picker, each piece is saved briefly to an{" "}
          <code>autoflow-omni-temp</code> folder in your Downloads, which the
          extension empties at the start of the next upload. Turning uploads
          off stops new uploads; it does not delete anything already uploaded.
        </li>
        <li>
          <strong>Saving clips.</strong> The clips you choose to save are
          ordinary browser downloads or, with &quot;Download all&quot;, files
          written into a folder you pick in Chrome&apos;s own folder picker.
          Either way they go only to your device. The extension&apos;s{" "}
          <code>downloads</code> permission is used only for the temporary
          upload folder above, and to empty it.
        </li>
      </ul>

      <h3>2.7 Technical Data</h3>
      <p>
        When the extensions or the website contact our server, our hosting
        providers process standard technical data needed to deliver and
        secure the service, such as your IP address and the time of the
        request. The extensions also send their version number with each
        request.
      </p>

      {/* ── 3. Data We Do NOT Collect ── */}
      <h2>3. Data We Do NOT Collect</h2>
      <ul>
        <li>
          Your prompts, AI responses, videos, images, or generated clips (in
          AutoFlow Motion these go only to the services you choose; see
          Section 2.6)
        </li>
        <li>Your browsing history or activity on sites other than those listed in Section 2.5</li>
        <li>Financial or payment information (payments are handled by our third-party payment processor, Whop; see Section 6)</li>
        <li>Location data</li>
        <li>Health or biometric data</li>
        <li>
          Any personal data beyond what is described in Section 2
        </li>
      </ul>

      {/* ── 4. How We Use Your Data ── */}
      <h2>4. How We Use Your Data</h2>
      <ul>
        <li>
          <strong>Authentication:</strong> To sign you in, issue and refresh
          session tokens, and reset your password.
        </li>
        <li>
          <strong>Plan enforcement:</strong> To check and enforce the daily
          and monthly usage limits of your plan, including the AutoFlow Motion
          daily job allowance.
        </li>
        <li>
          <strong>Service operation:</strong> To maintain the extensions,
          detect and prevent abuse, and improve reliability.
        </li>
        <li>
          <strong>Community features:</strong> To show posts in the Community
          feed under their authors&apos; display names, count likes and uses,
          and act on reports.
        </li>
      </ul>
      <p>
        We do <strong>not</strong> use your data for advertising,
        profiling, or any purpose unrelated to operating AutoFlow&apos;s
        extensions and website.
      </p>

      {/* ── 5. Where and How Data Is Stored ── */}
      <h2>5. Where and How Data Is Stored</h2>

      <h3>5.1 Data Stored Locally (On Your Device)</h3>
      <p>
        The following data is stored in your browser using Chrome&apos;s{" "}
        <code>chrome.storage.local</code> and IndexedDB. It leaves your device
        only when you share it, or when a task you start sends it to one of
        the services in Section 2.5:
      </p>
      <ul>
        <li>Workflows (node graphs, prompt text, settings)</li>
        <li>Reference images and extracted video frames</li>
        <li>
          AutoFlow Motion projects: your source video and its pieces, subject
          and place images, prompts, links to your results, and upload
          receipts
        </li>
        <li>Queue configurations and run logs</li>
        <li>Extension settings and preferences</li>
        <li>Authentication tokens (used to stay signed in)</li>
      </ul>

      <h3>5.2 Data Stored on Our Servers</h3>
      <p>
        The following data is stored on our backend at{" "}
        <code>api.auto-flow.studio</code>, hosted on secured
        infrastructure:
      </p>
      <ul>
        <li>Email address and hashed password</li>
        <li>Plan type and subscription status</li>
        <li>Daily and monthly usage counts (numeric values only)</li>
        <li>AutoFlow Motion job records (job ID, fingerprint, date)</li>
        <li>
          Community posts you make, your display name, the posts you liked,
          and reports you sent
        </li>
        <li>Review reward claim records</li>
      </ul>

      {/* ── 6. Data Sharing and Third Parties ── */}
      <h2>6. Data Sharing and Third Parties</h2>
      <p>
        We do <strong>not sell</strong> your data to any third party.
      </p>
      <p>We share data only with the following parties:</p>
      <ul>
        <li>
          <strong>Google (Sign-In):</strong> When you sign in with Google,
          your Google ID token is sent from Google to our server to verify
          your identity. We receive your email address from this token. No
          other Google data is accessed.
        </li>
        <li>
          <strong>Whop (Payment processing):</strong> If you upgrade to Pro,
          payment is processed by{" "}
          <a
            href="https://whop.com/privacy"
            target="_blank"
            rel="noopener noreferrer"
          >
            Whop
          </a>
          . Your email is shared with Whop to match the payment to your
          AutoFlow account. We do not handle credit card numbers or payment
          details directly.
        </li>
        <li>
          <strong>AI and video services (in your browser):</strong> The
          extensions work with the services listed in Section 2.5 inside your
          own browser session, using your own signed-in accounts. When you run
          a task, the content it needs — your prompts and, in AutoFlow Motion,
          your video pieces and reference images — goes from your browser
          directly to those services, under their own terms and privacy
          policies. It can remain in your accounts there until you delete it
          with that service. No content is routed through our servers.
        </li>
        <li>
          <strong>Railway (Server hosting):</strong> Our backend at
          api.auto-flow.studio, which holds the data in Section 5.2, is hosted
          on Railway.
        </li>
        <li>
          <strong>Vercel (Website hosting):</strong> Our website at
          auto-flow.studio is hosted on Vercel, which may collect standard
          web analytics (page views, country-level geo). This does not apply
          to the extensions themselves.
        </li>
      </ul>
      <p>
        Your data is <strong>not</strong> used or transferred for purposes
        unrelated to the extensions&apos; core functionality, and is{" "}
        <strong>not</strong> used to determine creditworthiness or for
        lending purposes. Our use of information received from Chrome APIs
        adheres to the Chrome Web Store User Data Policy, including the{" "}
        <a
          href="https://developer.chrome.com/docs/webstore/program-policies/limited-use"
          target="_blank"
          rel="noopener noreferrer"
        >
          Limited Use requirements
        </a>
        .
      </p>

      {/* ── 7. Data Retention ── */}
      <h2>7. Data Retention</h2>
      <ul>
        <li>
          <strong>Local data</strong> is retained until you clear it
          manually, clear your browser data, or uninstall the extension.
          AutoFlow Motion projects can be deleted from the extension&apos;s
          project list; removing the extension deletes everything it stored in
          your browser.
        </li>
        <li>
          <strong>Server-side account data</strong> is retained for as long
          as your account is active. Usage counts are aggregated daily and
          older daily records are automatically purged.
        </li>
        <li>
          <strong>AutoFlow Motion job records</strong> are kept while your
          account is active, so that your daily allowance and retries work,
          and are deleted with your account.
        </li>
        <li>
          <strong>Content you sent to Google Flow or an AI assistant</strong>{" "}
          stays in your account with that service until you delete it there.
        </li>
        <li>
          <strong>Deleted accounts:</strong> Upon account deletion request,
          all personal data (email, usage records, Motion job records,
          community posts, likes and reports) is permanently deleted from our servers within 30 days.
        </li>
      </ul>

      {/* ── 8. Your Rights ── */}
      <h2>8. Your Rights</h2>
      <p>You have the right to:</p>
      <ul>
        <li>
          <strong>Access</strong> the personal data we hold about you.
        </li>
        <li>
          <strong>Correct</strong> inaccurate data (e.g., update your email
          or password).
        </li>
        <li>
          <strong>Delete</strong> your account and all associated data.
        </li>
        <li>
          <strong>Export</strong> your locally stored workflows (AutoFlow
          Studio provides a Share/Export feature).
        </li>
        <li>
          <strong>Control uploads</strong> by turning AutoFlow Motion&apos;s
          automated uploads off at any time.
        </li>
        <li>
          <strong>Withdraw consent</strong> by uninstalling the extension at
          any time, which stops all data collection immediately.
        </li>
      </ul>
      <p>
        To exercise any of these rights, email{" "}
        <a href="mailto:support@auto-flow.studio">
          support@auto-flow.studio
        </a>
        .
      </p>

      {/* ── 9. Security ── */}
      <h2>9. Security</h2>
      <p>
        We protect your data with the following measures:
      </p>
      <ul>
        <li>Passwords are hashed server-side and never stored in plain text.</li>
        <li>All communication between the extensions and our backend uses HTTPS (TLS encryption).</li>
        <li>Authentication tokens are stored locally in Chrome&apos;s sandboxed extension storage, inaccessible to other extensions or websites.</li>
        <li>The extensions do not load or execute any remotely fetched code.</li>
      </ul>

      {/* ── 10. Children's Privacy ── */}
      <h2>10. Children&apos;s Privacy</h2>
      <p>
        Our extensions and website are not directed at children under the age
        of 13. We do not knowingly collect personal data from children. If you
        believe a child has provided us with personal data, please contact us
        and we will delete it promptly.
      </p>

      {/* ── 11. Changes to This Policy ── */}
      <h2>11. Changes to This Policy</h2>
      <p>
        We may update this Privacy Policy from time to time. When we do, we
        will update the &quot;Last updated&quot; date at the top of this page.
        Continued use of the extensions after changes constitutes acceptance
        of the updated policy.
      </p>

      {/* ── 12. Contact ── */}
      <h2>12. Contact</h2>
      <p>
        If you have questions, concerns, or requests regarding this Privacy
        Policy or your personal data, contact us at:
      </p>
      <ul>
        <li>
          Email:{" "}
          <a href="mailto:support@auto-flow.studio">
            support@auto-flow.studio
          </a>
        </li>
        <li>
          Website:{" "}
          <a href="https://www.auto-flow.studio">
            auto-flow.studio
          </a>
        </li>
      </ul>
    </>
  );
}
