/**
 * @jest-environment jsdom
 */

/* ============================================================
   Two things the builder threw away.

   THE PLAN, THE MOMENT IT LANDED. A workflow is rarely right first time, and
   the ask was exact: "sometimes I build a workflow but it needs some change
   with the help of AI". That was possible for about thirty seconds — while
   the preview was on screen and the refine box with it. Press Open on canvas
   and pendingBuild was cleared, so the idea, the plan and which AI wrote it
   were all gone. Nothing was stored anywhere: chrome.storage held the last
   typed idea and the pending handoff, and no record of anything ever built.

   AND ANY PICTURE OF WHAT YOU MEANT. The build request was text only. A
   sentence about "my product" is a great deal less use to a model than the
   product, and every adapter already knows how to attach a still — it is the
   same field a Story node uses to show a chat its references. The build path
   simply never filled it in.

   The honest part of reopening: the chat tab a plan was written in is long
   gone by the next day. This cannot resume that conversation, and pretending
   otherwise is the exact bug the builder already had once — repairs sent into
   a fresh chat that had never seen the plan, which came back smaller rather
   than fixed. So a reopened plan travels WITH the message.
   ============================================================ */

/// <reference types="node" />

import { readFileSync } from 'fs';
import { join } from 'path';

const DIST = join(__dirname, '../../dist');
/* Line endings normalised on read. Windows checkouts have core.autocrlf on,
   so these files are CRLF in the working tree while the regexes below are
   written with a bare newline escape — so these assertions failed on the
   developer's machine and passed in CI, which is the worst way round. */
const readSrc = (...p: string[]) =>
  readFileSync(join(...p), 'utf8').replace(/\r\n/g, '\n');

const SRC = readSrc(__dirname, '..', 'sidepanel', 'index.ts');
const WORKER = readSrc(__dirname, '..', 'background', 'service-worker.ts');
const CSS = () => readFileSync(join(DIST, 'sidepanel.css'), 'utf8');

function mountPanel(): void {
  document.head.innerHTML = '';
  const doc = new DOMParser().parseFromString(
    readFileSync(join(DIST, 'sidepanel.html'), 'utf8'), 'text/html');
  doc.querySelectorAll('script').forEach((s) => s.remove());
  document.body.innerHTML = doc.body.innerHTML;
  const style = document.createElement('style');
  style.textContent = CSS();
  document.head.append(style);
}

describe('showing the AI what you mean', () => {
  beforeEach(mountPanel);

  it('has a way to attach one, and somewhere to show it', () => {
    expect(document.getElementById('build-add-image')!.tagName).toBe('BUTTON');
    expect((document.getElementById('build-image-input') as HTMLInputElement).accept)
      .toBe('image/*');
    expect((document.getElementById('build-refs') as HTMLElement).hidden).toBe(true);
  });

  it('sends them on the field every adapter already reads', () => {
    /* referenceImageData is what a Story node uses for its reference stills.
       Inventing a second channel would have meant teaching five adapters
       something they already know. */
    expect(WORKER).toMatch(/referenceImageData: images\.length \? images : undefined/);
    expect(WORKER).toMatch(/askChatForPlan\([\s\S]{0,240}Array\.isArray\(msg\.images\)/);
  });

  it('attaches them to the first turn only', () => {
    /* A repair is the next message in the same conversation and the pictures
       are already above it. Sending them again re-uploads for nothing. */
    /* `&& !threadOpen` joined it when a long pasted brief started being read
       on a turn of its own: that turn sends the pictures, and the planning
       turn is the next message in the same conversation, with them above it. */
    expect(SRC).toMatch(
      /images: round === 0 && !threadOpen && IMAGE_CAPABLE\.has\(key\) \? refImages : \[\]/);
  });

  it('shrinks a phone photo before sending it', () => {
    /* Several megabytes, across two message boundaries, before it reaches the
       tab that needs it. */
    expect(SRC).toMatch(/const REF_MAX_PX = \d+;/);
    const fn = SRC.slice(SRC.indexOf('function readRef'));
    expect(fn.slice(0, fn.indexOf('\n}'))).toMatch(/toDataURL\('image\/jpeg'/);
  });

  it('gives an upload longer than a text-only ask', () => {
    /* The three-minute clock did not allow for sending pictures first. */
    expect(WORKER).toMatch(/images\.length \? 360_000 : 180_000/);
  });

  it('caps how many, because a chat tab will not take many', () => {
    /* In collectRefs, which both pickers go through — the cap used to be
       written into the first one and would not have covered the second. */
    const fn = SRC.slice(SRC.indexOf('async function collectRefs'));
    expect(fn.slice(0, fn.indexOf('\n}'))).toMatch(/list\.length >= \d\) break;/);
  });
});

describe('what you built before', () => {
  beforeEach(mountPanel);

  it('has somewhere to list it, hidden until there is one', () => {
    expect((document.getElementById('build-past') as HTMLElement).hidden).toBe(true);
    expect(document.getElementById('build-past-list')).not.toBeNull();
    expect(document.getElementById('build-past-clear')!.tagName).toBe('BUTTON');
  });

  it('records a build when it reaches the canvas, not when it is previewed', () => {
    /* A plan you looked at and discarded is not something you built. */
    expect(SRC).toMatch(/await openBuilt\(at\.template\);[\s\S]{0,160}rememberBuild\(at,/);
  });

  it('keeps what a later change actually needs', () => {
    const fn = SRC.slice(SRC.indexOf('async function rememberBuild'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    for (const field of ['idea:', 'platform:', 'model:', 'template:', 'at:']) {
      expect(body).toContain(field);
    }
  });

  it('stays a list rather than becoming an archive', () => {
    expect(SRC).toMatch(/const PAST_MAX = \d+;/);
    expect(SRC).toMatch(/\.slice\(0, PAST_MAX\)/);
  });

  it('survives storage being full without losing the build', () => {
    /* The workflow is already on the canvas by then. Failing to write the
       history entry must not read as the build failing. */
    const fn = SRC.slice(SRC.indexOf('async function rememberBuild'));
    expect(fn.slice(0, fn.indexOf('\n}'))).toMatch(/catch \{[^}]*\}/);
  });

  it('survives a first run with nothing stored', () => {
    const fn = SRC.slice(SRC.indexOf('async function readPast'));
    expect(fn.slice(0, fn.indexOf('\n}'))).toMatch(/Array\.isArray\(af_builds\) \? af_builds : \[\]/);
  });
});

describe('reopening one to change it', () => {
  it('brings back the plan and the refine box', () => {
    const fn = SRC.slice(SRC.indexOf('function reopenBuild'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    expect(body).toMatch(/showPlan\(\{/);
    /* platform is what showPlan uses to decide whether refine is offered, so
       a reopened build has to carry it or the box stays hidden. */
    expect(body).toMatch(/platform: b\.platform/);
    expect(body).toMatch(/idea\.value = b\.idea/);
  });

  it('hands the plan over rather than assuming the model still has it', () => {
    /* The exact bug the builder had once: repairs sent into a fresh chat that
       had never seen the plan, which came back smaller rather than fixed. A
       plan from yesterday is in that position by definition. */
    const fn = SRC.slice(SRC.indexOf('async function refineBuild'));
    const body = fn.slice(0, fn.indexOf('\n  } catch'));
    /* And what travels is the PLAN. resumeFrom used to hold the compiled
       template — nodes with positions, edges with handles, category,
       difficulty, every one of them a thing the brief tells the model never
       to send — under a sentence asking for "the same shape". */
    expect(body).toMatch(/JSON\.stringify\(at\.plan/);
    expect(body).toMatch(/NOT the shape to reply in/);
    /* The newChat half of this assertion used to live here, keyed on the same
       flag, and that pairing is what broke: once reopening carried the plan
       for a LIVE thread too, `resumeFrom` stopped meaning "no conversation"
       and every reopened build began opening a new chat next to the one the
       panel had just navigated back to. Carrying the plan and starting a chat
       are different decisions; only the first belongs to resumeFrom. */
    expect(body).toMatch(/newChat: at\.threadOpen \? 'never' : 'auto'/);
  });

  it('only carries the plan when the conversation is not live', () => {
    /* A plan the model just wrote is already in the thread — sending it again
       wastes tokens, pushes the user's question down, and teaches the model
       to echo the blob. Only a reopened build with no live thread needs it. */
    const fn = SRC.slice(SRC.indexOf('async function refineBuild'));
    expect(fn.slice(0, fn.indexOf('\n  } catch'))).toMatch(
      /const needsPlan = at\.resumeFrom && !at\.threadOpen/);
    expect(fn.slice(0, fn.indexOf('\n  } catch'))).toMatch(
      /const carry = needsPlan[\s\S]{0,900}: '';/);
  });

  it('stops carrying it once the change lands', () => {
    /* After one round the model has the plan in its own thread, so the next
       change is an ordinary follow-up — and there is now certainly a thread,
       whatever the state was a moment ago. */
    expect(SRC).toMatch(/resumeFrom: undefined, threadOpen: true,/);
  });
});

describe('changing a build instead of filing another one', () => {
  /* Seven rows in forty-five minutes, every one of them opening with the same
     "You are a cinematic AI workflow generator." Not seven builds — one, being
     changed. "Build" always appended a row, and nothing carried the identity
     of the entry a plan had been reopened from, so a piece of work being
     revised became a pile of near-identical rows nobody could tell apart. */

  it('carries the entry a reopened plan came from', () => {
    expect(SRC).toMatch(/originId\?: string;/);
    expect(SRC).toMatch(/originId: b\.id,/);
  });

  it('revises that row rather than adding a second one', () => {
    expect(SRC).toMatch(/const prior = b\.originId \? past\.find\(\(p\) => p\.id === b\.originId\)/);
    expect(SRC).toMatch(/entry\.id = prior\.id;/);
    expect(SRC).toMatch(/past\.filter\(\(p\) => p\.id !== prior\.id\)/);
  });

  it('keeps the conversation the reopening found', () => {
    /* Dropping it here would undo the reopen: the revised row would lose the
       thread and the next click would be back to carrying a plan. */
    expect(SRC).toMatch(/if \(!entry\.chatUrl && prior\.chatUrl\)/);
  });

  it('keeps the brief when the box was not the thing that changed', () => {
    expect(SRC).toMatch(/if \(!entry\.idea\.trim\(\) && prior\.idea\)/);
  });
});

describe('continuing the conversation, rather than one beside it', () => {
  /* Reported as "he dont remamber the conversation to contine on it", and the
     cause is one boolean answering two questions.

         resumeFrom   does the model need the plan pasted to it?
         threadOpen   is there a conversation to continue?

     refineBuild read `newChat: at.resumeFrom ? 'auto' : 'never'`, and its own
     comment explained why that worked: reopening only set resumeFrom when
     there was no live chat. Then reopening began setting it ALWAYS — right on
     its own terms, because a tab that opens is not a thread that loaded — and
     that flipped every reopened build to 'auto'. The panel navigated back to
     the Gemini conversation and then started a new chat next to it. */

  it('asks whether a thread is open, not whether the plan travelled', () => {
    expect(SRC).toMatch(/newChat: at\.threadOpen \? 'never' : 'auto'/);
    /* Comments stripped first. The line this replaces is quoted in the one
       explaining why it went, and a check that cannot tell the two apart
       would fail on its own documentation. */
    const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/newChat: at\.resumeFrom/);
  });

  it('still sends the plan across when there is no live thread', () => {
    /* The belt and braces stays. A tab that opened is not proof the thread
       loaded, and a model with the plan twice loses a few hundred tokens
       while a model with neither cannot help at all. But it only travels
       when the thread is NOT live — otherwise the model already has it. */
    expect(SRC).toMatch(/const needsPlan = at\.resumeFrom && !at\.threadOpen/);
    expect(SRC).toMatch(/const carry = needsPlan/);
    /* The plan first; the template only for a build stored before plans were
       kept, where it is better than nothing and is labelled as not the shape
       to answer in. */
    expect(SRC).toMatch(/resumeFrom: b\.plan \|\| b\.template,/);
  });

  it('knows a fresh build is already sitting in its own conversation', () => {
    const at = SRC.indexOf('warnings: explainPlan(best.quality)');
    expect(at).toBeGreaterThan(-1);
    expect(SRC.slice(at, at + 700)).toMatch(/threadOpen: true/);
    /* And the plan it wrote travels with it, so a reopen has the right shape
       to hand back. */
    expect(SRC.slice(at, at + 700)).toMatch(/plan: best\.plan/);
  });

  it('knows a reopened one only if the chat actually came back', () => {
    expect(SRC).toMatch(/threadOpen: live,/);
  });

  it('knows there is certainly one once a change has been answered', () => {
    const at = SRC.indexOf('resumeFrom: undefined, threadOpen: true');
    expect(at).toBeGreaterThan(-1);
  });
});

describe('the brief that came back as its first four hundred characters', () => {
  /* Caught by running the real thing. A Notion master prompt was pasted, built
     once, then reopened from the list and built again — and the material that
     reached the model ended mid-word:

         All outputs must depict entire buildings from a fixed d
         ───────────── END USER MATERIAL ─────────────

     401 characters. `slice(0, 400)` in rememberBuild, written as though it
     were a display cap, and it is not one: reopenBuild puts the stored string
     straight back into the build box. Everything the brief specified — six
     stills, five clips between them, the locked drone position — was in the
     part that never arrived, so the plan that came back was a good answer to
     a question nobody had asked. The reading turn stayed quiet too: by then
     the idea genuinely was fifty-six words. */

  it('keeps the whole brief, not a preview of it', () => {
    expect(SRC).toMatch(/const IDEA_MAX = \d{4,}/);
    expect(SRC).toMatch(/idea: full\.slice\(0, IDEA_MAX\)/);
    /* The line this replaces, left as an explicit check because it is one
       edit away from coming back and it fails silently when it does. */
    expect(SRC).not.toMatch(/idea: idea\.trim\(\)\.slice\(0, 400\)/);
  });

  it('shortens it for the row instead, which is the job that cap was doing', () => {
    expect(SRC).toMatch(/const IDEA_ROW_MAX = \d+/);
    expect(SRC).toMatch(/\.slice\(0, IDEA_ROW_MAX\)/);
  });

  it('says so when a brief really is too long to keep whole', () => {
    expect(SRC).toMatch(/ideaClipped: true/);
    expect(SRC).toMatch(/its ending is missing from the box/);
  });

  it('sheds old builds rather than losing the new one when storage is full', () => {
    /* A whole brief is far bigger than a four-hundred-character preview, so
       running out of room is now something that can happen — and the old
       answer, dropping the build, throws away the one just asked for. */
    expect(SRC).toMatch(/for \(let keep = Math\.floor\(list\.length \/ 2\)/);
    expect(SRC).toMatch(/af_builds: list\.slice\(0, keep\)/);
  });
});

describe('the build that had no conversation to go back to', () => {
  /* Reported as: clicking an earlier build does not open the Gemini chat it
     was written in, it just hands back the workflow.

     True, and not because reopening was broken. No URL was ever saved for
     those builds. The worker records where a conversation lives by reading
     the tab's address the moment the reply lands — and on Gemini the adapter
     was deleting its own thread at exactly that moment, so the address was
     back at /app, the id regex found nothing, and chatUrl was stored empty.
     Every Gemini build, silently, from the beginning.

     The cause is fixed at the source (deleteWhenDone in the worker's chat
     config, see builderThread). What is fixed here is the silence: a build
     with no thread now says so, on the row and on the click, instead of
     quietly coming back as something else. */

  it('marks the rows that can still reach their conversation', () => {
    expect(SRC).toMatch(/sp-past__thread/);
    expect(SRC).toMatch(/b\.chatUrl \? '💬' : ''/);
  });

  it('says on the row itself what a build without one will do', () => {
    expect(SRC).toMatch(/No saved conversation for this one/);
    expect(SRC).toMatch(/comes back as the plan rather than the thread/);
  });

  it('does not stay silent when the click cannot open anything', () => {
    /* The branch that did not exist. chatUrl empty skipped the whole block,
       so the user clicked expecting a chat and got a plan with no account of
       why — which is the report, word for word. */
    expect(SRC).toMatch(/No saved conversation for this build/);
    expect(SRC).toMatch(/this one is the last of its kind/);
  });

  it('still says the honest thing about what changing it will do', () => {
    expect(SRC).toMatch(/starts a fresh \$\{engineName\(b\.platform\)\} /);
    expect(SRC).toMatch(/which works but knows less/);
  });
});

describe('a picture with the change, too', () => {
  beforeEach(mountPanel);

  it('has its own button and its own row', () => {
    expect(document.getElementById('build-refine-image')!.tagName).toBe('BUTTON');
    expect((document.getElementById('build-refine-image-input') as HTMLInputElement).accept)
      .toBe('image/*');
    expect((document.getElementById('build-refine-refs') as HTMLElement).hidden).toBe(true);
  });

  it('keeps them apart from the ones on the first ask', () => {
    /* Those are already in the conversation. Re-sending them with every
       change would upload the same pictures again and again. */
    expect(SRC).toMatch(/let refineImages: string\[\] = \[\];/);
    expect(SRC).toMatch(/images: IMAGE_CAPABLE\.has\(at\.platform\) \? refineImages : \[\]/);
  });

  it('draws both rows through one function rather than two copies', () => {
    expect(SRC).toMatch(/function renderRefs\(\): void \{ drawRefs\('build-refs', refImages\);/);
    expect(SRC).toMatch(/function renderRefineRefs\(\): void \{ drawRefs\('build-refine-refs', refineImages\);/);
  });

  it('clears them once sent, whatever came back', () => {
    /* They went either way. Leaving them attached would send them twice. */
    const fn = SRC.slice(SRC.indexOf('async function refineBuild'));
    expect(fn.slice(0, fn.indexOf('\n  } catch'))).toMatch(
      /refineImages = \[\];\s*\n\s*renderRefineRefs\(\);/);
  });

  it('shares the cap and the downscale with the first ask', () => {
    const fn = SRC.slice(SRC.indexOf('async function collectRefs'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    expect(body).toMatch(/list\.length >= 4/);
    expect(body).toMatch(/readRef\(f\)/);
  });

  it('hides its row when empty, against the cascade', () => {
    /* .sp-shots is display:flex, which beats [hidden]. The refine row is the
       same class and would have had the same bug. */
    const el = document.getElementById('build-refine-refs') as HTMLElement;
    expect(getComputedStyle(el).display).toBe('none');
  });
});

describe('the model is told the pictures are there', () => {
  /* Attaching them is not the same as using them. A model handed an image and
     a sentence that never refers to it will often answer the sentence and
     leave the picture alone — it arrives as context, and nothing in the
     message says it matters. */

  it('says nothing when nothing is attached', () => {
    const fn = SRC.slice(SRC.indexOf('function aboutImages'));
    expect(fn.slice(0, fn.indexOf('\n}'))).toMatch(/if \(!count\) return '';/);
  });

  it('describes the first ask as what to MAKE', () => {
    const fn = SRC.slice(SRC.indexOf('function aboutImages'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    expect(body).toMatch(/the subject, the product or the look I want/);
    expect(body).toMatch(/rather than working from the/);
  });

  it('describes a change as what to EDIT', () => {
    /* The distinction the user drew: on a change the picture is the thing
       being pointed at, which is the whole reason for attaching it there. */
    const fn = SRC.slice(SRC.indexOf('function aboutImages'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    expect(body).toMatch(/what I want changed/);
    expect(body).toMatch(/what I am pointing at/);
    expect(body).toMatch(/the rest of the plan stays as it is/);
  });

  it('counts them, so the model knows how many to look at', () => {
    const fn = SRC.slice(SRC.indexOf('function aboutImages'));
    expect(fn.slice(0, fn.indexOf('\n}'))).toMatch(/count === 1 \? 'The attached picture shows'/);
  });

  it('is attached to both asks, with the right kind on each', () => {
    expect(SRC).toMatch(/aboutImages\(IMAGE_CAPABLE\.has\(key\) \? refImages\.length : 0, 'make'\)/);
    expect(SRC).toMatch(/aboutImages\(IMAGE_CAPABLE\.has\(at\.platform\) \? refineImages\.length : 0, 'edit'\)/);
  });

  it('says on the button itself what the change picture is for', () => {
    mountPanel();
    expect(document.getElementById('build-refine-image')!.getAttribute('title'))
      .toMatch(/what to change/i);
    expect((document.getElementById('build-refine') as HTMLInputElement).placeholder)
      .toMatch(/picture of what to change/i);
  });
});

describe('reopening the conversation, not a summary of it', () => {
  /* Re-sending the plan reconstructs a summary. The thread still holds the
     whole thing — the brief, the pictures, every repair round and the
     reasoning between them — and none of that fits in one message. */

  it('reads the conversation URL off the tab, not out of five adapters', () => {
    /* The worker owns the tab and knows its id. Asking each content script to
       report its own address would be five changes for one fact. */
    expect(WORKER).toMatch(/await chrome\.tabs\.get\(tabId\)/);
    expect(WORKER).toMatch(/conversationUrl: url/);
  });

  it('keeps only a real conversation, not the site’s front door', () => {
    /* A bare chatgpt.com would reopen a blank chat and look like it worked. */
    const at = WORKER.indexOf('if (settled.text) {');
    expect(WORKER.slice(at, at + 600)).toContain('(c|chat|app|share)');
  });

  it('takes the latest one, because a repair happens in the same thread', () => {
    /* And the URL only exists once the site has actually created it — often
       not until after the first message has landed. */
    expect(SRC).toMatch(/if \(res\.conversationUrl\) chatUrl = String\(res\.conversationUrl\)/);
  });

  it('stores it with the build', () => {
    const fn = SRC.slice(SRC.indexOf('async function rememberBuild'));
    expect(fn.slice(0, fn.indexOf('\n}'))).toMatch(/chatUrl: b\.chatUrl \|\| ''/);
  });

  it('opens the chat tab on that conversation when one was kept', () => {
    const fn = SRC.slice(SRC.indexOf('async function reopenBuild'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    expect(body).toMatch(/type: 'PANEL_OPEN_CHAT', platform: b\.platform, url: b\.chatUrl/);
  });

  it('carries the plan even when the conversation appears to reopen', () => {
    /* Opening the tab is not the same as the conversation loading. Gemini
       answers a navigation to a real conversation URL by rendering the
       attachment fullscreen and saying "Something went wrong" often enough
       that treating "no exception" as "the thread is there" left the user
       with neither the thread NOR the plan — worse than either alone.

       A model that does have the conversation open reads the plan twice and
       loses a few hundred tokens. A model that has neither cannot help. */
    /* What travels is the PLAN, though. The template is the compiled canvas
       and a different shape from the one asked for in reply. */
    const fn = SRC.slice(SRC.indexOf('async function reopenBuild'));
    expect(fn.slice(0, fn.indexOf('\n}')))
      .toMatch(/resumeFrom: b\.plan \|\| b\.template,/);
  });

  it('falls back to carrying the plan when the thread is gone', () => {
    /* Deleted conversations, a signed-out account, a site that never gave us
       a URL. All produce the same thing: no thread to continue. */
    const fn = SRC.slice(SRC.indexOf('async function reopenBuild'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    expect(body).toMatch(/live = !!res\?\.ok/);
    expect(body).toMatch(/could not be reopened/);
  });

  it('does not navigate a tab that is already on it', () => {
    /* Reloading would discard anything half-typed in the composer there. */
    const at = WORKER.indexOf("if (msg?.type === 'PANEL_OPEN_CHAT')");
    expect(WORKER.slice(at, at + 900)).toMatch(/\(tab\?\.url \|\| ''\) !== url/);
  });

  it('waits for the tab before saying it worked', () => {
    const at = WORKER.indexOf("if (msg?.type === 'PANEL_OPEN_CHAT')");
    expect(WORKER.slice(at, at + 900)).toMatch(/waitForTabReady\(tabId/);
  });
});

describe('a conversation id outlives the conversation', () => {
  /* Read off the live page rather than reasoned about. Navigating to
     /app/8ddbd0fbddb01467 — a well-formed id captured by a real build —
     redirected to /app: a blank new chat, zero turns, no error. That id is
     not among the twenty-five in the sidebar, and every one of those has the
     identical shape. So the format was never wrong; the conversation simply
     stopped existing, and Gemini answers that with a silent redirect.

     Which made the previous check useless: tabs.update threw nothing, so the
     worker reported success and handed the user a page that looked like a
     broken conversation. */

  it('checks where the navigation landed, not just that it ran', () => {
    const at = WORKER.indexOf("if (msg?.type === 'PANEL_OPEN_CHAT')");
    const block = WORKER.slice(at, at + 2200);
    expect(block).toMatch(/const landed = \(await chrome\.tabs\.get\(tabId\)\)\?\.url \|\| ''/);
    expect(block).toMatch(/if \(bare\(landed\) !== bare\(url\)\)/);
  });

  it('waits for the redirect before looking', () => {
    /* It happens after load, so reading the URL the instant the tab is ready
       sees the address we asked for and misses the bounce. */
    const at = WORKER.indexOf("if (msg?.type === 'PANEL_OPEN_CHAT')");
    expect(WORKER.slice(at, at + 2200)).toMatch(/setTimeout\(r, \d+\)[\s\S]{0,120}chrome\.tabs\.get\(tabId\)/);
  });

  it('ignores a query string these sites add themselves', () => {
    const at = WORKER.indexOf("if (msg?.type === 'PANEL_OPEN_CHAT')");
    expect(WORKER.slice(at, at + 2200)).toMatch(/split\('\?'\)\[0\]/);
  });

  it('names the reason it usually is, before the one it might be', () => {
    /* It said "it may have been deleted", which sent somebody looking through
       their own history for a conversation that was never in it. These sites
       put no account index in the path, so which conversations exist is
       decided by the cookies of the Chrome profile — a chat built under a
       different Google account is unreachable, and the site says so by
       redirecting to a blank page rather than by refusing. */
    const at = WORKER.indexOf("if (msg?.type === 'PANEL_OPEN_CHAT')");
    const block = WORKER.slice(at, at + 2600);
    expect(block).toMatch(/different Google account or Chrome profile/);
    expect(block.indexOf('different Google account'))
      .toBeLessThan(block.indexOf('may also have been deleted'));
  });

  it('shows that reason in the panel instead of a generic line', () => {
    const fn = SRC.slice(SRC.indexOf('async function reopenBuild'));
    expect(fn.slice(0, fn.indexOf('\n}'))).toMatch(/buildSays\('info', String\(res\?\.error/);
  });
});
