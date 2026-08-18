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
const SRC = readFileSync(join(__dirname, '..', 'sidepanel', 'index.ts'), 'utf8');
const WORKER = readFileSync(
  join(__dirname, '..', 'background', 'service-worker.ts'), 'utf8');
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
    expect(SRC).toMatch(/images: round === 0 \? refImages : \[\]/);
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
    expect(body).toMatch(/at\.resumeFrom[\s\S]{0,120}JSON\.stringify\(at\.resumeFrom/);
    expect(body).toMatch(/newChat: at\.resumeFrom \? 'auto' : 'never'/);
  });

  it('still continues the conversation for a plan that is live', () => {
    /* Only a reopened one needs carrying. A plan the model just wrote is the
       next turn, and re-sending it would waste the context it already has. */
    const fn = SRC.slice(SRC.indexOf('async function refineBuild'));
    expect(fn.slice(0, fn.indexOf('\n  } catch'))).toMatch(
      /const carry = at\.resumeFrom[\s\S]{0,200}: '';/);
  });

  it('stops carrying it once the change lands', () => {
    /* After one round the model has the plan in its own thread, so the next
       change is an ordinary follow-up. */
    expect(SRC).toMatch(/showPlan\(\{ \.\.\.at, template, warnings: explainPlan\(quality\), resumeFrom: undefined \}\)/);
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
    expect(SRC).toMatch(/images: refineImages,/);
  });

  it('draws both rows through one function rather than two copies', () => {
    expect(SRC).toMatch(/function renderRefs\(\): void \{ drawRefs\('build-refs', refImages\); \}/);
    expect(SRC).toMatch(/function renderRefineRefs\(\): void \{ drawRefs\('build-refine-refs', refineImages\); \}/);
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
    expect(SRC).toMatch(/buildSpec\(idea\) \+ aboutImages\(refImages\.length, 'make'\)/);
    expect(SRC).toMatch(/aboutImages\(refineImages\.length, 'edit'\)/);
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

  it('continues that thread rather than carrying the plan into it', () => {
    /* resumeFrom is what makes refine re-send the plan and open a new chat.
       With the real conversation in front of the model, both are wrong. */
    const fn = SRC.slice(SRC.indexOf('async function reopenBuild'));
    expect(fn.slice(0, fn.indexOf('\n}'))).toMatch(/resumeFrom: live \? undefined : b\.template/);
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
