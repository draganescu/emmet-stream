// Prompts for the structure model, the text model and the raw-HTML baseline.

export const KIT_DOC = `Layout: .w (centered 1140px wrapper with gutter) · .sec (section padding; add .tight for less) · .alt (surface background) · .inv (dark section) · .acc (accent section) · .hero (hero padding) · .split (2-col hero grid; .rev swaps sides) · .g2 .g3 .g4 (equal grids) · .g21 .g12 (2:1 and 1:2 grids) · .row (inline flex, wraps) · .stack (vertical flex) · .center (centered text) · .head (section heading block with bottom space). All grids stack on phones.
Header/footer: header.nav (flex bar: a.logo + nav>a*N) · footer.foot>div.w>p* (auto columns) · .logo.
Type: h1 h2 h3 are styled · .eyebrow (small caps label) · .lede (large intro) · .muted · .small · .big (large display number) · blockquote.quote + cite.who.
Components: a.btn / .btn.ghost · .card (surface panel; a leading div.media becomes a full-bleed cover) · .card.line (outlined) · .pill (badge) · .stats>div.stat*N>span.big+span.muted (bordered stat row) · ul.list>li (dot list) · ol.steps>li>h3+p (numbered steps) · .faq>details>summary+p · .price (vertical pricing block) · form.form>input+button.btn (inline form).
Visuals: div.media (theme gradient block) + one of .m1 (circles) .m2 (stripes) .m3 (dot grid) .m4 (blob) .m5 (arch) .m6 (sunset) + shape .sq .tall .wide.`;

const SLOT_RULES = `Never write visible text. Every text is a slot: {@@name|N w|hint}, where name is a unique snake_case id ($ numbering is allowed inside *N repeats), N w is the target word count (6w, 12-18w), hint is 2-6 words on what it says. Attributes needing text (alt, placeholder, aria-label) use =@@name. Do not use the $ character anywhere else.
No img tags, no external URLs, no scripts. Links use href=#.`;

export const kitPrompt = req => `You design web pages in a compact notation that a program expands into HTML. A fixed stylesheet (the kit) is already loaded, so you mostly choose kit classes and set theme values. Output ONLY the notation: no prose, no code fences.

Page request: ${req}

Design a complete, distinctive landing page: header, hero, 4-6 content sections, footer. Vary section backgrounds (.alt .inv .acc) and layouts so the page has rhythm.

Sections, in this order, each starting with its header line alone:

#brief
3-6 short "key: value" lines for the copywriter: brand, voice, audience, offer, 3 key claims. A fast model writes all visible text from this brief.

#theme
One "name: value" per line: bg, ink, muted, accent, accent-ink (text on accent), alt (second color), surface, line (hex colors); font-d and font-b (a Google Fonts family, then fallbacks, e.g. "Fraunces, Georgia, serif"); r (corner radius in px); space (section spacing, 0.7 to 1.4). Choose a palette and type pairing specific to this subject.

#parts
Optional reusable fragments, one per line: name = emmet. Inside a part, slots use @@_field (e.g. {@@_title|3w|hint}). In #html write @name:prefix*N (N copies, slots become prefix1_field, prefix2_field...) or @name:prefix (one copy). Parts can be used inside a line, e.g. div.g3>@card:plan*3.

#html
One Emmet abbreviation per line, body content only. Indent 2 spaces to nest: a line's elements go inside the deepest last element of the nearest less-indented line above. Inside a line use > + * $ . # [attr=val] and ( ) for small subtrees.
${SLOT_RULES}

#css
Optional, and short: only rules the kit cannot express, one per line. Emmet CSS abbreviations are fine (d:f, gap24, maw:12ch, as:e).

Kit classes:
${KIT_DOC}

Example:
#brief
brand: Kiln & Co, a small-batch ceramics studio in Porto
voice: warm, precise, a little dry
#theme
bg: #f2ede6
ink: #1d1a16
accent: #b8643c
font-d: Instrument Serif, Georgia, serif
font-b: Inter Tight, system-ui, sans-serif
r: 6
#parts
feat = div.card>div.media.wide.m$+h3{@@_title|2-4w|feature name}+p.muted{@@_body|14-20w|what it means}
#html
header.nav
  a.logo[href=#]{@@brand|2w|studio name}
  nav>a[href=#]{@@nav$|1w|section name}*3
section.hero
  div.w.split
    div
      p.eyebrow{@@hero_eyebrow|3-5w|where and what}
      h1{@@hero_title|5-8w|bold promise}
      p.lede{@@hero_lede|18-24w|what and for whom}
      div.row>a.btn[href=#]{@@hero_cta|2-3w|action}
    div.media.tall.m4[role=img aria-label=@@hero_alt]
section.sec.alt
  div.w
    div.head>h2{@@feat_title|3-6w|section heading}
    div.g3>@feat:feat*3`;

const FORMAT_V1 = `Output ONLY the notation below. No prose, no code fences.

Three sections in this order, each starting with its header line alone:

#brief
3-6 short "key: value" lines for the copywriter: brand, voice, audience, offer, 3 key claims. A fast model writes all visible text from this brief.

#css
CSS rules; keep each rule on one line. Selectors are normal CSS. Inside a rule, separate declarations with ";". Use Emmet CSS abbreviations where they exist: d:f d:g d:ib jc:sb ai:c fxd:c tt:u td:n ta:c pos:r ov:h cur:p bd:n, p64-32 m0-a m0-0-20 pt4 gap24 fz48 fw700 lh1.5 bdrs12 maw1100 w100p, c#fff bgc#111, c:var(--ink), gtc:repeat(3,1fr). Numbers in abbreviations mean px. For anything with spaces or other units write "abbr:value" or the full "property:value". Never write an abbreviation without its value. One-line @media blocks are fine.

#html
One Emmet abbreviation per line, body content only. Indent 2 spaces to nest: a line's elements go inside the deepest last element of the nearest less-indented line above. Inside a line use > + * $ . # [attr=val] for small subtrees.
${SLOT_RULES}
For visuals use div.media blocks styled with CSS gradients and shapes.`;

export const v1Prompt = req => `You design web pages in a compact notation that a program expands into HTML and CSS.

Page request: ${req}

Design a complete, distinctive landing page: header, hero, 4-6 content sections, footer. Put your effort into the design: layout, type scale, color, spacing, and a responsive @media rule. Make visuals with CSS only.

${FORMAT_V1}`;

export const fillPrompt = (req, brief, slots) => `You write the visible text for slots in a web page.

Page request: ${req}
Brief:
${brief}

Write text for each slot below. Respect each word count and hint, keep one voice across all of them, and stay consistent with the brief. Plain text only: no markdown, no surrounding quotes.

Slots (name | html tag | words | hint):
${slots.map(s => `${s.name} | ${s.tag} | ${s.words || '?'} | ${s.hint || ''}`).join('\n')}

Reply with one JSON object per line, exactly {"k":"<slot name>","v":"<text>"}, in the order given, and nothing else.`;

export const basePrompt = req => `Write a complete single-file landing page as HTML with one embedded <style> block.

Page request: ${req}

Design a complete, distinctive landing page: header, hero, 4-6 content sections, footer, with real copy. Put your effort into the design: layout, type scale, color, spacing, and a responsive @media rule. No img tags, no external URLs, no scripts; make visuals with CSS gradients and shapes. Output only the HTML document, starting with <!doctype html>. No code fences, no commentary.`;
