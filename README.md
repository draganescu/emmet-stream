# Emmet Stream

Generating a web page with an LLM is slow mostly because the model has to type every `<`, `class=` and `</div>` one token at a time. Emmet Stream tries two tricks to cut that down:

1. **The big model writes Emmet, not HTML.** It streams a compact notation (Emmet abbreviations for markup, Emmet shorthand for CSS). The browser expands each line into real DOM the moment the line arrives, which takes a few milliseconds.
2. **The big model writes no visible text.** Every piece of copy is a slot with a word budget and a hint, like `h1{@@hero_title|5-8w|bold promise}`. A small, fast model fills the slots in parallel batches while the big model is still writing the rest of the page.

**Live demo:** https://draganescu.github.io/emmet-stream/ (bring your own Anthropic API key; works over HTTPS only)

## How a run works

```
big model ──stream──▶ line parser ──▶ Emmet expand ──▶ DOM (layout visible, grey text bars)
                           │
                           └─ text slots, batched per section ──▶ fast model ×4 in parallel ──▶ text pops in
```

The demo page measures each run against a **raw-HTML baseline**: the same kind of model writing the same page directly as HTML with real copy. Baselines are stored in your browser per prompt and model, so every later run is compared with measured numbers, not estimates. It reports:

- time until the page is complete, and time until the first layout is on screen
- output tokens billed for the big model on both sides
- input tokens across all calls (the notation's prompt is longer, so this goes up)
- a timeline with the structure stream, every text batch and the baseline on one axis

## Two notations

**v1: Emmet + full CSS.** Sections `#brief`, `#css`, `#html`. The model writes all CSS itself, with Emmet CSS abbreviations (`d:f;jc:sb;p64-32;bgc#111`). In the first live test this gave 36% fewer big-model tokens and 80 s instead of 100 s to a finished page. CSS was most of what remained, and because it came first, layout appeared late.

**Kit (default).** A stylesheet ships with the expander ([`src/kit.css`](src/kit.css)), so the model picks classes instead of writing CSS:

```
#brief        key: value lines for the copywriter (brand, voice, audience, claims)
#theme        bg, ink, muted, accent, accent-ink, alt, surface, line, font-d, font-b, r, space
#parts        name = emmet   (reusable fragments; slots inside use @@_field)
#html         one Emmet abbreviation per line, indentation nests
#css          optional overrides only, at the end
```

A part is defined once and repeated with `@name:prefix*N`:

```
#parts
cls = article.card>div.media.wide.m$+h3{@@_name|2-3w|class name}+p{@@_body|18-24w|what you take home}
#html
section.sec
  div.w.g3>@cls:class*3        → slots class1_name, class1_body, class2_name, …
```

The theme's Google Fonts are loaded on the fly. HTML comes before CSS so the layout is on screen within the first few lines. The recorded Kit replay needs about 970 tokens from the big model, against about 4,200 for the same page as hand-written HTML plus the kit rules it uses (cl100k count).

The full notation spec is the prompt itself: [`src/prompts.js`](src/prompts.js).

## Security

- The page only runs live calls over HTTPS. Over plain HTTP the key field is disabled; the replay still works.
- Your key is kept in `sessionStorage` (this tab only) unless you tick "Remember on this device", which uses `localStorage`. "Forget" clears both.
- A Content Security Policy limits network connections to `https://api.anthropic.com`, so the key cannot be sent anywhere else, and allows no inline or third-party scripts.
- Generated pages render in sandboxed iframes where scripts never run; `<script>`, `on*` attributes and embeds are stripped from expanded markup.
- Calls go straight from the browser to the API with the `anthropic-dangerous-direct-browser-access` header. Use a key with a spending limit.

## Run it yourself

```sh
npm install
npm run build        # writes dist/
```

Serve `dist/` over HTTPS (any static host). Live calls are disabled on `http://`, including `http://localhost`; for local work use an HTTPS dev server, for example with a [mkcert](https://github.com/FiloSottile/mkcert) certificate.

The repo deploys to GitHub Pages through [`.github/workflows/pages.yml`](.github/workflows/pages.yml). In the repository settings, set **Pages → Source** to **GitHub Actions**.

## Files

| Path | What it is |
|---|---|
| `src/app.js` | Stream parser, Emmet expansion, slot batching, timeline, comparison |
| `src/anthropic.js` | Streaming Messages API client (fetch + SSE) |
| `src/prompts.js` | Prompts for Kit, v1, the text model and the baseline |
| `src/kit.css` | The stylesheet the Kit notation builds on |
| `demos/` | Recorded structure streams and text for the replay |

## Known limits

- Timing numbers from single runs are noisy. The Runs tab keeps a log so you can repeat each setup.
- Emmet CSS shorthand collides with some real property names (`d` is an SVG property); the expander handles the known cases.
- The text model sees the brief and its batch, not the whole page, so tone can drift between sections.
- Token counts for replays and projections use the cl100k tokenizer as a stand-in for Claude's.

## License

GNU General Public License v3.0. See [LICENSE](LICENSE).
