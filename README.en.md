<p align="center">
  <img src="assets/icon-animated.gif" alt="Website Replay" width="80" height="80">
</p>

<h1 align="center">Website Replay</h1>

<p align="center"><strong>Bring websites home. Keep the interactions.</strong></p>

<p align="center">Discover · Capture · Replay · Verify</p>

<p align="center">
  <a href="README.md">简体中文</a> &nbsp;·&nbsp; English
  <br>
  <a href="#installation-example-codex">Quick start</a> &nbsp;·&nbsp;
  <a href="#workflow">Workflow</a> &nbsp;·&nbsp;
  <a href="SKILL.md">Skill documentation</a>
</p>

---

Website Replay is a skill for coding agents, organized around `SKILL.md`, with standalone Node.js and Playwright scripts. It preserves a website's published HTML, styles, JavaScript, and data for local replay with minimal adaptation. It is intended for high-fidelity offline copies of charts, leaderboards, documentation, and multi-page websites.

It does not recover the author's original source project or automatically reproduce authentication, payments, voting, live generation, or paid backend services. Multi-page SPAs, cross-origin resources, Next.js RSC, and custom data protocols still require site-specific adaptation.

## Workflow

1. **Discover:** Find pages, controls, states, resources, and transitions through URLs, sitemaps, navigation, and observed interactions.
2. **Maintain a checklist:** Record source and local URLs, entry points, capture progress, evidence, and next actions. Treat languages, query variants, and workloads as states of their parent pages.
3. **Capture:** Save the original server HTML and browser-observed resources, preserving MIME types, query strings, bytes, and content hashes.
4. **Replay:** Match pages and resources precisely. Report missing content instead of hiding it behind a homepage fallback or fabricated JSON.
5. **Verify:** Block source-site dependencies in a fresh browser context, run scenarios, check data and screenshots, and update the checklist.

Downloaded files, working routes, correct interactions, and visual fidelity are separate checks. Passing a sample does not establish that every function on every page has been reproduced.

## Agent Compatibility

The core scripts do not depend on Codex-specific APIs. Skill discovery directories, invocation syntax, and tool permissions vary between agents. Compatible file structure does not mean an integration has been tested.

| Agent | Status |
| --- | --- |
| Codex | Used and tested in practice; the installation example below uses Codex |
| Claude Code | Uses a `SKILL.md` skill structure; install according to its conventions, such as `.claude/skills/website-replay/`. Not tested with this skill yet |
| Qoder | Not tested; check skill support, installation paths, and invocation syntax for your version |
| Other coding agents | Follow the agent's installation conventions if it supports `SKILL.md`; otherwise, ask it to read the documentation and run the scripts |

`agents/openai.yaml` contains Codex display metadata. It is not a runtime dependency. Other agents can use `SKILL.md` and the reference documents without relying on this file.

## Installation Example: Codex

Clone this repository into your Codex skills directory. This example uses the default location; adjust the target if you use a custom directory:

```bash
git clone https://github.com/lailoo/website-replay.git ~/.codex/skills/website-replay
```

Reload the skill list in Codex before invoking it. The workflow and diagnostic guidance can be used without running the scripts. Install the dependencies in the next section before executing capture or verification.

Example prompt:

```text
Use $website-replay to create an offline copy of https://example.com.
First explore the site and incrementally build a checklist of pages,
states, and transitions. Then capture the public frontend.
Verify direct URLs, navigation, state restoration, data, interactions,
and visual differences against the checklist.
```

## Running the Scripts

Requirements: Node.js 20.19+, npm, and Chromium. Run these commands from the repository root:

```bash
npm ci
npx playwright install chromium
npm test
```

Edit [examples/site.config.json](examples/site.config.json) with the target URL, output directory, and observed resource prefixes. Its URL is a placeholder, not a preconfigured adapter. Do not commit captured output to the public repository.

```bash
npm run discover -- examples/site.config.json
npm run checklist -- examples/site.config.json
npm run capture -- examples/site.config.json
npm run verify -- examples/site.config.json
npm run replay -- examples/site.config.json 5180
```

The configured output directory contains `CHECKLIST.md`, per-item evidence in `inventory.json`, and an `evidence/` directory for each snapshot. The default local address is `http://127.0.0.1:5180`; open the complete paths and queries from the checklist.

`maxPages` limits discovery and capture work per run. Repeat a command to continue the queue. Discovery reads links and controls; it does not blindly click buttons. Write scenarios based on observed behavior and assign them to routes through `scenarios`. Each scenario runs on both the source and local page, so use explicit, reversible actions and assertions about real results.

See [tooling documentation](references/tooling.md) for configuration, resuming work, exit codes, and limitations. Single-page scripts are also available:

```bash
node scripts/capture.mjs capture-config.json
node scripts/replay.mjs snapshots/example 5180
```

## Repository Contents

The skill and detailed reference documents are currently primarily in Chinese. This English README provides installation, usage, compatibility, and verification information; it is not a translation of every reference document.

| Path | Purpose |
| --- | --- |
| [SKILL.md](SKILL.md) | Agent workflow entry point |
| [Discovery and checklist](references/site-discovery-checklist.md) | Page, state, and transition model; checklist fields and completion rules |
| [Capture and replay](references/capture-and-replay.md) | Bytes, requests, resource mapping, and minimal adaptation |
| [Troubleshooting](references/difference-diagnosis.md) | Symptoms, evidence, fixes, and regression checks |
| [Verification](references/verification.md) | Offline, interaction, visual, and production-preview checks |
| [Dynamic page patterns](references/dynamic-site-patterns.md) | Data integrity, state discovery, navigation, and asynchronous APIs |
| [Source extraction](references/source-extraction.md) | Distinguishing original project source, bundled modules, and rewrites |
| `scripts/` | Single-page and multi-page discovery, capture, replay, and tests |
| `examples/` | Configuration and explicit interaction scenarios |

## Known Limitations

- The generic capture script saves public, same-origin GET resources. Cross-origin CDNs, read-only POST data, and SPA navigation require explicit adaptation; the references explain the approach.
- Automatic discovery does not exhaust search strings, numeric ranges, authenticated states, or unlimited combinations. Expand sitemap indexes into individual sitemap URLs first.
- Multi-page replay refuses to start when the same resource URL has conflicting hashes, rather than mixing build versions arbitrarily.
- Visual checks compare full-page screenshots at one configured viewport. Animation, time, random content, and antialiasing differences require diagnosis rather than blanket exclusion.
- Interaction coverage depends on scenario assertions. Pages without scenarios remain unverified for interactions.

## Contributing and License

Run `npm test` before submitting changes. Include a reproducible minimal page, request, or anonymous data sample with fixes, explaining the observed behavior, evidence, and regression results. Document the supported scope and untested features of new site adapters.

The tool code and project documentation are licensed under the [MIT License](LICENSE). Captured website code, images, data, fonts, and trademarks remain the property of their respective owners; MIT does not grant redistribution rights to those materials. This repository distributes tools, documentation, and tests, not third-party website snapshots or datasets. Respect the target site's terms and authorized access scope; do not bypass authentication or paywalls.
