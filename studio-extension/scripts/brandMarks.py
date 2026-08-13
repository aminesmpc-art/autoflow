"""Regenerate src/studio/components/brandMarks.ts from assets/brands/.

The marks in that file are other companies' trademarks. They are generated
rather than hand-written so nobody has to trust that a path was transcribed
correctly — diff the assets against a fresh download and re-run this.

Where each came from:
  chatgpt.svg      Wikimedia Commons, File:ChatGPT-Logo.svg
  googlegemini.svg cdn.simpleicons.org/googlegemini
  grok.svg         Wikimedia Commons, File:Grok-icon.svg
  claude.svg       cdn.simpleicons.org/claude
  flow.svg         labs.google/fx/icons/favicon/favicon.svg

Run from studio-extension/:  python scripts/brandMarks.py
"""
import io, json, os, re

D = 'assets/brands'
OUT = 'src/studio/components/brandMarks.ts'

# Fill for a dark surface, the only kind this extension has. Monochrome marks
# go white; the two that own a colour keep it. Flow's own stylesheet specifies
# #ffffff under prefers-color-scheme: dark, which is what we are.
COLOR = {
    'chatgpt': '#FFFFFF',
    'gemini': '#8E75B2',
    'grok': '#FFFFFF',
    'claude': '#D97757',
    'flow': '#FFFFFF',
}
FILE = {
    'chatgpt': 'chatgpt.svg',
    'gemini': 'googlegemini.svg',
    'grok': 'grok.svg',
    'claude': 'claude.svg',
    'flow': 'flow.svg',
}


def extract(path):
    s = io.open(path, encoding='utf-8').read()
    vb = re.search(r'viewBox=["\']([^"\']+)["\']', s)
    if vb:
        view = vb.group(1)
    else:
        w = re.search(r'\bwidth=["\']([\d.]+)', s)
        h = re.search(r'\bheight=["\']([\d.]+)', s)
        view = '0 0 %s %s' % (w.group(1), h.group(1)) if w and h else '0 0 24 24'
    body = re.sub(r'<svg[^>]*>|</svg>', '', s)
    for pat in (r'<style[\s\S]*?</style>', r'<title[\s\S]*?</title>', r'<!--[\s\S]*?-->'):
        body = re.sub(pat, '', body)
    # Strip paint so one fill prop colours the whole mark.
    body = re.sub(r'\s(fill|stroke|style|class)="[^"]*"', '', body)
    body = re.sub(r"\s(fill|stroke|style|class)='[^']*'", '', body)
    return view, re.sub(r'\s+', ' ', body).strip()


def main():
    marks = {}
    for name, fn in FILE.items():
        view, body = extract(os.path.join(D, fn))
        if not body:
            raise SystemExit('%s produced an empty mark' % fn)
        marks[name] = {'viewBox': view, 'body': body, 'color': COLOR[name]}
        print('%-8s viewBox="%s"  %d chars' % (name, view, len(body)))

    header = io.open(OUT, encoding='utf-8').read().split('export interface')[0]
    body = json.dumps(marks, indent=2)
    for k in ('viewBox', 'body', 'color'):
        body = body.replace('"%s"' % k, k)
    io.open(OUT, 'w', encoding='utf-8', newline='\n').write(
        header
        + 'export interface BrandMark { viewBox: string; body: string; color: string; }\n\n'
        + 'export const BRAND_MARKS = ' + body
        + ' as const satisfies Record<string, BrandMark>;\n\n'
        + 'export type BrandName = keyof typeof BRAND_MARKS;\n'
    )
    print('wrote', OUT)


if __name__ == '__main__':
    main()
