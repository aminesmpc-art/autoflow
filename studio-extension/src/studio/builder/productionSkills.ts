/** Craft guidance for the Builder's AI, shared by creation and refinement. */
export function productionSkills(): string {
  return `BUILDER PRODUCTION SKILLS

1. REQUIREMENTS AND COVERAGE
Extract the requested deliverables, number of clips, duration per clip, aspect
ratio, platform, language and required spoken lines before selecting steps.
Count video outputs separately from scene stills, reference boards and frame
extractors. Ten clips means ten video generations; a board is not a clip.
Preserve explicit requirements through every repair. Put a concise production
summary and unresolved constraints in the existing thinking fields; do not
invent executable fields or node types to represent them.

2. DIRECTOR COORDINATION
Use a Director when prompts must share cast, world and visual rules. For a
large production use one Chief with two or three connected Directors. Group
targets into coherent scenes or acts, balance their workload, and give each
media target exactly one prompt-writing owner. A Director must have real
connected targets. Put the full production brief on the Chief and describe
each group's scene range in its label. Chief runtime handles scene contracts,
review and recovery; do not create fake reviewer or recovery nodes.

3. VISUAL CONTINUITY
Choose the visual reference strategy deliberately. Use a shared master
reference for stable identities and sets; use a scene still for a precise
opening pose; use a previous clip's last frame for continuous action. A board
is a planning sheet, not automatically the opening frame of an animated clip.
Keep image ancestry shared across Directors when their scenes share a world.
Do not feed a reference back into its own ancestor. Check cumulative character
positions and prop changes across scene boundaries, especially after a twist.

4. PACING AND SOUND
Give each short clip one readable action and a clear ending reaction. Put
dialogue, sound effects and ambience in video instructions, not still-image
instructions. Keep speech within about 2.5 words per second and preserve exact
user-supplied lines when they fit. For directed shots put spoken-line mapping
in the Director or Chief brief, leaving the target prompt to its owner.
Use only supported voice settings and account for reference-image and frame
mode restrictions from the node manual. Never promise a particular voice if
the selected mode cannot use it. Reserve space for captions rather than
asking an image generator to render precise overlay typography.

5. EFFICIENT GENERATION
Reuse a shared reference instead of generating the same anchor repeatedly.
Generate a scene still only when it provides composition or identity control
the clip needs. Respect the reference limit per target. Every extra generated
asset must serve a connected consumer or an explicit user deliverable. Keep
deliberate alternate takes and model comparisons when requested. Explain
generation counts, not invented credit prices or promised completion times.

6. PRE-FLIGHT REVIEW AND PRECISE EDITS
Before returning JSON, reconcile the requested scene list with the actual
video steps, verify each input ID and its media role, check common aspect
ratio, and ensure each Director controls its intended targets. During an edit,
work from the supplied displayed plan; preserve unaffected IDs, prompts,
references and settings. Do not shrink the shot count to make a repair pass.
Use only capabilities and schema fields in the node manual. A structurally
valid plan still needs to satisfy the user's story and output requirements.`;
}
