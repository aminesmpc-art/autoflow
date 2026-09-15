/**
 * Reading the API Flow actually has.
 *
 * The fixtures below are not invented. They are bytes recorded off
 * flow.google.com in a real signed-in Chrome — including one video generated
 * live and watched from submission to completion — trimmed only in length:
 *
 *   19  API calls to load a project
 *    0  of them matching any name the old interceptor filtered on
 *   19  arriving over XHR
 *    0  arriving over fetch
 *    0  enum strings like MEDIA_GENERATION_STATUS_SUCCESSFUL anywhere
 *
 * That last count is why nothing here reads a status field by name: there is
 * no readable status to read. What the live generation showed is that the
 * record grows a media URL and a byte size at the moment it finishes, and
 * that is what completion is read from.
 */

/// <reference types="node" />

import * as fs from 'fs';
import * as path from 'path';
import {
  parseBatchExecute, readStatuses, readRecord, findRecords,
  inferState, isMediaUrl, isUuid, rpcIdOf, isBatchExecuteUrl, diagnostics,
} from '../content/flowBatch';

/** A real response, as recorded: the project list. Carries no status. */
const PROJECT_RESPONSE = `)]}'

285
[["wrb.fr","ngNC2","[\\"095c79ed-ab64-432d-9f5f-e9712b9f0160\\",[\\"27 août, 09:05\\",\\"5a0b0e59-dbb6-41e4-a54d-3165520f8f41\\"],null,null,null,[null,null,[[null,null,null,\\"narwhal_display\\"],[\\"abra\\"]]]]",null,null,null,"generic"],["di",308],["af.httprm",301,"-5429531183661722936",31]]
25
[["e",4,null,null,144]]
`;

/** An empty result, also real — most calls on this path return nothing useful. */
const EMPTY_RESPONSE = `)]}'

108
[["wrb.fr","mrlkwd","[]",null,null,null,"generic"],["di",302],["af.httprm",301,"-5429531183661722936",31]]
25
[["e",4,null,null,144]]
`;

/**
 * A media-LIST record, as recorded. Media id first, project last, a title
 * before its timestamp — and nothing anywhere saying how it is doing.
 */
const LIST_RECORD = `["6a5b21d8-ce58-4745-8b9d-0f48014bb65e",null,null,` +
  `["Woman smiling with athletic build",[1787817903,283461000],null,null,` +
  `"5a0b0e59-dbb6-41e4-a54d-3165520f8f41","07eb21d4-a4d7-4d5f-921e-d74048a1cb6f"],` +
  `"f1f353d5-baec-4483-a9f4-1a2f3e6f3395"]`;

/** The prompt used for the generation these fixtures were recorded from. */
const PROMPT = 'A single red paper boat drifting across still dark water, slow push in';

/**
 * The STATUS record while the video was generating — scene, project and media
 * ids, then a metadata block that leads with the timestamp.
 */
const RUNNING = `["8a0059c8-2e06-43a9-b648-53c249298d5c",` +
  `"f1f353d5-baec-4483-a9f4-1a2f3e6f3395",` +
  `"b14eade5-e6d4-4bb1-b268-173dda18c8bc","CAE",null,` +
  `[[1788575632,79153000],"${PROMPT}",null,null,null,null,` +
  `[null,[["veo_3_1_t2v_lite",1,null,null,2,1]],null,null,1],null,[6],1]]`;

/** The same record once the video finished: the enum moved and a URL appeared. */
const FINISHED = `["8a0059c8-2e06-43a9-b648-53c249298d5c",` +
  `"f1f353d5-baec-4483-a9f4-1a2f3e6f3395",` +
  `"b14eade5-e6d4-4bb1-b268-173dda18c8bc","CAE",null,` +
  `[[1788575632,79153000],"${PROMPT}",null,null,null,null,` +
  `[null,[["veo_3_1_t2v_lite",1,null,null,2,1]],null,null,1],null,[3],1,` +
  `"https://flow-content.google/video/8a0059c8-2e06-43a9-b648-53c249298d5c",[],null,2213724]]`;

/** Wrap a record in the real envelope. */
const response = (recordJson: string) => {
  const payload = JSON.stringify(`[null,[${recordJson}]]`);
  const chunk = `[["wrb.fr","Zzl0ze",${payload},null,null,null,"generic"],["di",308]]`;
  return `)]}'\n\n${chunk.length}\n${chunk}\n25\n[["e",4,null,null,144]]\n`;
};

const SW_PATH = '../content/sw-bypass.ts';
const IDX_PATH = '../content/index.ts';

describe('recognising the request', () => {
  it('matches the one path the whole app now uses', () => {
    expect(isBatchExecuteUrl(
      'https://flow.google.com/_/AiSandboxAngularFrontend/data/batchexecute?rpcids=Zzl0ze',
    )).toBe(true);
  });

  it('does not match unrelated traffic', () => {
    expect(isBatchExecuteUrl('https://www.google-analytics.com/g/collect?v=2')).toBe(false);
  });

  it('can read the rpcid, which is for diagnostics only', () => {
    /* Recorded ids were nzlxg, Zzl0ze, WuwhI, DTaVef… — per-build obfuscated
       symbols. Routing on one would work until the next Flow deploy. */
    expect(rpcIdOf('https://flow.google.com/x/batchexecute?rpcids=Zzl0ze&f.sid=1')).toBe('Zzl0ze');
    expect(rpcIdOf('https://flow.google.com/x/batchexecute')).toBe('');
  });
});

describe('the wire format', () => {
  it('unwraps the prefix, the chunks and the doubly-encoded payload', () => {
    const envs = parseBatchExecute(PROJECT_RESPONSE);
    expect(envs).toHaveLength(1);
    expect(envs[0].rpcid).toBe('ngNC2');
    expect((envs[0].data as unknown[])[0]).toBe('095c79ed-ab64-432d-9f5f-e9712b9f0160');
  });

  it('ignores the non-wrb.fr bookkeeping rows', () => {
    /* Every response carries ["di",…] and ["af.httprm",…] rows; counting one
       as an envelope would put junk through the record walker. */
    for (const e of parseBatchExecute(PROJECT_RESPONSE)) expect(e.rpcid).not.toBe('');
  });

  it('survives brackets and quotes inside a prompt', () => {
    /* Scanning for the balanced array has to respect JSON strings, or a
       prompt like this one closes the chunk early and the rest is lost. */
    const record = RUNNING.split(PROMPT).join('A [red] boat, \\"drifting\\"');
    expect(readStatuses(response(record))[0].promptText)
      .toBe('A [red] boat, "drifting"');
  });

  it('does not depend on the declared chunk lengths', () => {
    /* They are byte counts; JavaScript slices in UTF-16 units. One accented
       character in a prompt — and these are French projects — puts every
       later offset out by one, so the lengths are not trusted. */
    const wrong = PROJECT_RESPONSE.replace('285', '999').replace('25\n[["e"', '3\n[["e"');
    expect(parseBatchExecute(wrong)).toHaveLength(1);
  });

  it('returns nothing rather than throwing on junk', () => {
    for (const bad of ['', ')]}\'\n\n', 'not json at all', '[[[', ')]}\'\n\n5\n[oops]']) {
      expect(() => parseBatchExecute(bad)).not.toThrow();
      expect(parseBatchExecute(bad)).toEqual([]);
    }
  });
});

describe('telling a status record from everything else', () => {
  it('reads nothing from a project list', () => {
    /* Projects are record-shaped too — a leading UUID and a title — so the
       walker finds them and the reader must still decline them. */
    expect(findRecords(parseBatchExecute(PROJECT_RESPONSE)[0].data).length)
      .toBeGreaterThan(0);
    expect(readStatuses(PROJECT_RESPONSE)).toEqual([]);
  });

  it('reads nothing from the empty responses most calls return', () => {
    expect(readStatuses(EMPTY_RESPONSE)).toEqual([]);
  });

  it('reads nothing from a media list', () => {
    /* This is the one that mattered. Media-list records describe what exists,
       not what is happening: they carry no status, so reading them reported
       39 finished videos as running on one real project — uploaded
       ingredients among them, whose "prompt" was a filename. */
    expect(readStatuses(response(LIST_RECORD))).toEqual([]);
  });

  it('reads a real status record', () => {
    const [s] = readStatuses(response(RUNNING));
    expect(s.mediaId).toBe('b14eade5-e6d4-4bb1-b268-173dda18c8bc');
    expect(s.projectId).toBe('f1f353d5-baec-4483-a9f4-1a2f3e6f3395');
    expect(s.workflowId).toBe('8a0059c8-2e06-43a9-b648-53c249298d5c');
    expect(s.promptText).toBe(PROMPT);
    expect(s.modelName).toBe('veo_3_1_t2v_lite');
    expect(s.createdAt).toBe(new Date(1788575632000).toISOString());
  });

  it('takes the media id, not the scene id it is filed under', () => {
    /* The record is keyed by the scene; the media is the third id. Keying the
       cache by the scene would mean every lookup by media id missed. */
    const [s] = readStatuses(response(RUNNING));
    expect(s.mediaId).not.toBe('8a0059c8-2e06-43a9-b648-53c249298d5c');
  });

  it('reports each media once even when the response repeats it', () => {
    expect(readStatuses(response(`${RUNNING},${FINISHED}`))).toHaveLength(1);
  });
});

describe('deciding whether it finished', () => {
  it('calls the record running while it was running', () => {
    expect(readStatuses(response(RUNNING))[0].state).toBe('generating');
  });

  it('calls it completed once the media URL appears', () => {
    /* Recorded at the moment the tile filled in: the record grew from 734 to
       1067 characters, gaining a flow-content.google/video URL and a byte
       size of 2213724 — the finished file. */
    expect(readStatuses(response(FINISHED))[0].state).toBe('completed');
  });

  it('knows both media hosts, and rejects page furniture', () => {
    expect(isMediaUrl('https://flow-content.google/video/8a0059c8-2e06')).toBe(true);
    expect(isMediaUrl('https://flow.google.com/asb/AB-nOUbdK7WIJIpPsBgS')).toBe(true);
    expect(isMediaUrl('https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=a')).toBe(true);
    expect(isMediaUrl('https://ssl.gstatic.com/gb/images/ring/pr_32px.png')).toBe(false);
  });

  it('does not read a failure out of the record text', () => {
    /* This used to scan every string for FAIL/SAFETY/BLOCK/REJECT/CANCEL and
       report the first hit as the failure reason. It was removed: the header
       above records that real responses carry no such token, so the scan had
       no true positive available — while the user's prompt sits in the same
       record and could trip it at any time. */
    const blocked = FINISHED.replace(
      '"https://flow-content.google/video/8a0059c8-2e06-43a9-b648-53c249298d5c"',
      '"Blocked by safety filter"',
    );
    const [s] = readStatuses(response(blocked));
    expect(s.state).not.toBe('failed');
  });

  it('does not fail a finished video over a word in its own prompt', () => {
    /* The bug this cost: "block", "cancel" and "fail" are ordinary English.
       The scan ran before the media check, so a completed generation was
       reported failed, and the prompt was passed on as the reason —
       classifyError reads "prominent" there and calls it a safety block,
       the one class that never retries. */
    for (const prompt of [
      'a city block at night, neon reflections',
      'she cancels the meeting and walks out',
      'the failing engine of an old truck',
      'a prominent statue in the town square',
    ]) {
      const withPrompt = FINISHED.replace('Woman posing', prompt);
      const [s] = readStatuses(response(withPrompt));
      expect(s.state).toBe('completed');
    }
  });

  it('prefers the record that has media when one response disagrees', () => {
    /* Seen live: a finished video was described twice in one response, once
       with its URL and once without, and came out completed and generating at
       the same time. A record carrying media proves it finished; one without
       proves nothing, so positive evidence wins. */
    const both = readStatuses(response(`${RUNNING},${FINISHED}`));
    expect(both).toHaveLength(1);
    expect(both[0].state).toBe('completed');

    const reversed = readStatuses(response(`${FINISHED},${RUNNING}`));
    expect(reversed[0].state).toBe('completed');
  });

  it('guesses "still running" rather than "completed" when unsure', () => {
    /* The safe direction: a wrong "generating" costs one more poll, a wrong
       "completed" ends the wait and moves the queue past a missing video. */
    expect(inferState(['6a5b21d8-ce58-4745-8b9d-0f48014bb65e', null, 7]).state)
      .toBe('generating');
  });

  it('does not read the unlabelled status enum', () => {
    /* The enum really does move — [6] while running, [3] when done — but it
       is a bare integer whose meaning is a proto detail that can be
       renumbered. Changing it must not change the reading; the media URL is
       what decides. */
    const stillRunning = RUNNING.replace('[6],1]]', '[3],1]]');
    expect(readStatuses(response(stillRunning))[0].state).toBe('generating');
  });
});

describe('the prompt', () => {
  it('is never a URL', () => {
    /* Run live, "longest string" returned https://lh3.googleusercontent.com/
       as the prompt of a real generation. */
    const withUrl = RUNNING.replace(
      `"${PROMPT}"`,
      '"boat","https://lh3.googleusercontent.com/a-very-long-url-indeed/x"',
    );
    expect(readStatuses(response(withUrl))[0].promptText).toBe('boat');
  });

  it('is not a long unbroken identifier either', () => {
    const withToken = RUNNING.replace(
      `"${PROMPT}"`,
      '"a boat","AB-nOUbdK7WIJIpPsBgS_aVeryLongOpaqueTokenWithNoSpacesAtAll"',
    );
    expect(readStatuses(response(withToken))[0].promptText).toBe('a boat');
  });
});

describe('ids', () => {
  it('accepts a Flow UUID and rejects the near misses', () => {
    expect(isUuid('6a5b21d8-ce58-4745-8b9d-0f48014bb65e')).toBe(true);
    /* Flow mixes cases: the workflow id came back uppercase. */
    expect(isUuid('DF02E89C-56EA-48F5-AB6F-E9BD8EE45FDE')).toBe(true);
    expect(isUuid('narwhal_display')).toBe(false);
    expect(isUuid('6a5b21d8-ce58-4745-8b9d')).toBe(false);
    expect(isUuid(null)).toBe(false);
  });

  it('refuses a record that is not one', () => {
    expect(readRecord(['not-a-uuid', []])).toBeNull();
  });
});

describe('the source itself', () => {
  it('carries no control character in any pattern', () => {
    /* Written three times in this project with a literal backspace where a
       word boundary was meant — a regex that compiles, runs, matches nothing
       and reports no error. */
    const src = fs.readFileSync(path.resolve(__dirname, '../content/flowBatch.ts'), 'utf8');
    // eslint-disable-next-line no-control-regex
    expect(src).not.toMatch(/[\x00-\x08\x0b\x0c\x0e-\x1f]/);
  });
});

describe('saying the interception is alive', () => {
  /* The symptom that started this: the panel showed "API Passive" after a
     whole run, which reads as broken. It was not — status records only exist
     while a video is actually in flight, so an idle tab and a dead
     interceptor looked identical, and every monitor re-render re-asked and
     re-rendered "Passive". Verified live afterwards: on an ordinary project
     load with nothing generating, the interceptor relays
     INTERCEPTOR_ALIVE. */
  const SW = fs.readFileSync(path.resolve(__dirname, SW_PATH), 'utf8');
  const IDX = fs.readFileSync(path.resolve(__dirname, IDX_PATH), 'utf8');

  it('relays aliveness before requiring any record', () => {
    /* The alive relay has to sit ABOVE the UUID guard, or it only ever fires
       for responses that already carry data — which is the bug again. */
    const alive = SW.indexOf('INTERCEPTOR_ALIVE');
    const guard = SW.indexOf('HAS_UUID.test(text)');
    expect(alive).toBeGreaterThan(-1);
    expect(guard).toBeGreaterThan(-1);
    expect(alive).toBeLessThan(guard);
  });

  it('still does not relay empty status data', () => {
    /* Aliveness is a separate message on purpose. Relaying an empty
       STATUS_UPDATE_V2 would refresh the cache timestamp and tell a waiting
       caller fresh data had arrived when none had. */
    expect(SW).toMatch(/if \(statuses\.length\) relay\('STATUS_UPDATE_V2'/);
  });

  it('throttles the alive relay', () => {
    /* One per response would be a message per API call on every page load. */
    expect(SW).toMatch(/ALIVE_EVERY_MS/);
  });

  it('carries a build marker readable from the page', () => {
    /* Two rounds went to "is the rebuilt extension actually loaded?" — a
       MAIN-world script only injects at document_start, so an open tab keeps
       the old one and looks identical. */
    expect(SW).toMatch(/const BUILD = 'batchexecute-3'/);
    expect(SW).toMatch(/__af_interceptor_build = BUILD/);
  });

  it('answers the badge with aliveness, not only cache freshness', () => {
    /* isApiAvailable alone is cache freshness, which is empty between
       generations — that is what reset the badge to Passive on every render. */
    expect(IDX).toMatch(/isApiAvailable\(\) \|\| isInterceptorAlive\(\)/);
  });
});

describe('the built-in tracker', () => {
  /* Shipped because the record shape for an ingredient / image-to-video run
     has never been seen, and a run that yields no statuses looks identical
     whether the records were absent or quietly declined. */

  it('counts what it saw and why it declined', () => {
    readStatuses(response(RUNNING));      // accepted
    readStatuses(response(LIST_RECORD));  // declined
    const d = JSON.parse(diagnostics());
    expect(d.responses).toBeGreaterThan(0);
    expect(d.recordsSeen).toBeGreaterThan(0);
    expect(d.accepted).toBeGreaterThan(0);
    expect(Object.keys(d.rejects).length).toBeGreaterThan(0);
  });

  it('counts accepted statuses, not envelopes', () => {
    /* Written after the counter was incremented in two places at once — in
       parseBatchExecute with the envelope count and again here with the
       status count. Instrumentation that lies is worse than none: the whole
       point of this number is to tell "parsed nothing" from "parsed fine". */
    const before = JSON.parse(diagnostics()).accepted;
    const n = readStatuses(response(RUNNING)).length;
    const after = JSON.parse(diagnostics()).accepted;
    expect(n).toBe(1);
    expect(after - before).toBe(n);
  });

  it('reports the shape of a declined record', () => {
    readStatuses(response(LIST_RECORD));
    const d = JSON.parse(diagnostics());
    const reason = Object.keys(d.rejects).find((k) => d.rejects[k].sample);
    expect(reason).toBeTruthy();
    /* The skeleton is what makes an unseen record diagnosable at a distance. */
    expect(d.rejects[reason!].sample).toMatch(/\[|"uuid"|null/);
  });

  it('never puts content in its output', () => {
    /* This is the property that makes the report safe to paste anywhere: the
       prompt, the ids and any signed URL must not survive into it. */
    readStatuses(response(RUNNING));
    readStatuses(response(FINISHED));
    readStatuses(response(LIST_RECORD));
    const out = diagnostics();
    expect(out).not.toContain(PROMPT);
    expect(out).not.toContain('paper boat');
    expect(out).not.toContain('b14eade5');
    expect(out).not.toContain('flow-content.google');
    expect(out).not.toMatch(/https?:\/\//);
    expect(out).not.toContain('veo_3_1_t2v_lite');
  });

  it('is valid JSON, so it can be pasted back verbatim', () => {
    expect(() => JSON.parse(diagnostics())).not.toThrow();
  });

  it('reports the build actually running, not a second copy of the literal', () => {
    /* diagnostics() used to write 'batchexecute-2' itself. It went stale the
       moment the protocol was bumped, so __afReport() answered "which build
       is in this tab?" with the wrong one — the single question it exists
       for. It reads sw-bypass's window stamp now. */
    /* This suite runs in the node environment — there is no window unless
       one is put there, which is also why the source guards on typeof. */
    (globalThis as any).window = { __af_interceptor_build: 'batchexecute-9' };
    expect(JSON.parse(diagnostics()).build).toBe('batchexecute-9');
    delete (globalThis as any).window;
  });

  it('says so plainly when no interceptor is installed', () => {
    expect(JSON.parse(diagnostics()).build).toBe('not-installed');
  });
});

describe('the active check', () => {
  const SW2 = fs.readFileSync(path.resolve(__dirname, SW_PATH), 'utf8');

  it('defines the function the engine already calls', () => {
    /* activeStatusCheck -> RUN_ACTIVE_CHECK -> executeScript(MAIN) ->
       window.__af_activeCheck. Every link existed except the last one, so
       the check returned false on this site every single time. */
    expect(SW2).toMatch(/__af_activeCheck = async function/);
  });

  it('replays a captured request instead of building one', () => {
    /* Constructing a batchexecute call means guessing the rpcid, the f.req
       encoding and the session tokens — and re-guessing at every deploy. */
    expect(SW2).toMatch(/lastStatusRequest/);
    expect(SW2).toMatch(/method: 'POST'/);
  });

  it('only keeps a request that actually reported statuses', () => {
    /* This path serves the whole app; keeping the latest of any request
       would usually replay one that reports nothing. */
    expect(SW2).toMatch(/mediaIds\.length > 0 && typeof reqBody === 'string'/);
  });

  it('replays through the real fetch, not our patched one', () => {
    /* Going through the patch would run relayBatch twice on one body and
       double every count the tracker reports. */
    expect(SW2).toMatch(/__af_real_fetch \|\| window\.fetch/);
  });

  it('reports success only when the reply described a generation', () => {
    expect(SW2).toMatch(/relayBatch\(req\.url, await res\.text\(\)\)\.length > 0/);
  });

  it('strips headers the Fetch API refuses to set', () => {
    /* Sending Cookie or Content-Length from a page throws, which would make
       every replay fail in the catch and look like "no data". */
    expect(SW2).toMatch(/FORBIDDEN_HEADER/);
    expect(SW2).toMatch(/cookie/);
  });
});

describe('the media URL, for downloading', () => {
  /* Full mode downloads videos "via API, no DOM needed" — by building
     media.getMediaUrlRedirect?name=<mediaId>. That endpoint does not exist on
     flow.google.com, so every Full-mode video download requested a dead URL.
     The replacement cannot be constructed: these URLs are signed and carry an
     Expires parameter, so the only working one is what the response issued. */

  it('captures the URL a finished generation carries', () => {
    const [s] = readStatuses(response(FINISHED));
    expect(s.mediaUrl).toContain('flow-content.google/video/');
  });

  it('has none while the generation is still running', () => {
    /* Nothing to download yet, and an empty string is the honest answer —
       the caller falls back to the menu download rather than fetching junk. */
    expect(readStatuses(response(RUNNING))[0].mediaUrl).toBe('');
  });

  it('prefers the video over a thumbnail when both are present', () => {
    /* A finished record carries both; the point of this field is the file. */
    const withBoth = FINISHED.replace(
      '"https://flow-content.google/video/8a0059c8-2e06-43a9-b648-53c249298d5c"',
      '"https://flow.google.com/asb/thumb","https://flow-content.google/video/8a0059c8-2e06-43a9-b648-53c249298d5c"',
    );
    expect(readStatuses(response(withBoth))[0].mediaUrl).toContain('/video/');
  });


  it('never offers a grid thumbnail as the file', () => {
    /* /asb/ is the tile thumbnail. Saving one under a .mp4 name produces a
       broken video that reports as a successful download. Measured on a real
       project load: 29 of 58 statuses carried a media URL and none was a
       video one, so this is the common case, not the edge case. */
    const thumbOnly = FINISHED.replace(
      '"https://flow-content.google/video/8a0059c8-2e06-43a9-b648-53c249298d5c"',
      '"https://flow.google.com/asb/AB-nOUbdK7WIJIpPsBgS"',
    );
    expect(readStatuses(response(thumbOnly))[0].mediaUrl).toBe('');
  });

  it('takes a real image file when that is what the record has', () => {
    const imageOnly = FINISHED.replace(
      '"https://flow-content.google/video/8a0059c8-2e06-43a9-b648-53c249298d5c"',
      '"https://flow-content.google/image/8a0059c8-2e06-43a9-b648-53c249298d5c"',
    );
    expect(readStatuses(response(imageOnly))[0].mediaUrl).toContain('/image/');
  });

  it('prefers the video when a thumbnail sits alongside it', () => {
    const both = FINISHED.replace(
      '"https://flow-content.google/video/8a0059c8-2e06-43a9-b648-53c249298d5c"',
      '"https://flow.google.com/asb/thumb","https://flow-content.google/video/8a0059c8-2e06-43a9-b648-53c249298d5c"',
    );
    expect(readStatuses(response(both))[0].mediaUrl).toContain('/video/');
  });

  it('keeps the signature intact', () => {
    /* Stripping the query would make the URL useless: it is what authorises
       the download. */
    const signed = FINISHED.replace(
      'video/8a0059c8-2e06-43a9-b648-53c249298d5c"',
      'video/8a0059c8-2e06-43a9-b648-53c249298d5c?Expires=1788576485"',
    );
    expect(readStatuses(response(signed))[0].mediaUrl).toContain('Expires=');
  });
});
