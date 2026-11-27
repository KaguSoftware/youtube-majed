# Product

Adapted from `legacy/web/PRODUCT.md` (v1). The user is now Majed, and the
product is the v2 story studio.

## Register

product

## Users

One person: Majed, who runs a YouTube channel of narrated stick-figure story videos (8+ minute stories and 60–90 s Reels). He built the system and is comfortable in a terminal, but the studio is where he makes judgement calls: which story to tell, whether a script holds attention, whether a fact is right. He works on a MacBook Pro at a desk, usually in the evening under warm, dim room light, in sessions of twenty minutes to an hour, often reading a script aloud under his breath while he edits it.

His job on each screen is a decision, not an operation: which of three master loops is the story, does this loop hold, is this fact true, accept or reject this rewrite, is the script ready to voice. Claude does the writing between decisions, a few seconds to a few minutes at a time, on the same machine.

## Product Purpose

A personal studio that turns one sentence into a finished story video. Phase 2 covers the story half: a brief, three master loop options, a loop map and narration written by Claude, a fact-checker and a retention critic, and a script editor where Majed shapes every line (text, energy, delivery) before locking it for the voice. Retention is the product's claim (every 20 seconds the viewer has an open question), and for true stories, accuracy. The checks that guard both are visible, explained and pinned to the exact line.

Success: Majed goes from a sentence to a locked script he'd happily read aloud in one sitting, trusts every change he accepts, and always knows what Claude is doing and how long it will take.

## Brand Personality

Bold, cinematic, focused. A screening room and a writers' room, not an admin panel. The script is the hero on the editing surface: set like a page, read top to bottom, with the story's shape (the tension graph) always in view. Milestones (a story picked, a script locked) feel like occasions. Working surfaces stay quiet and legible: confident language, plain words.

Voice: a sharp story editor. Says what's wrong and where, in plain English, and what to do next. No pipeline jargon in the main copy ("job", "step output", "schema"); "Claude is writing the narration", "your script", "the critic" instead. Line ids (L3.4) are fine: Majed uses them.

## Anti-references

- Generic SaaS dashboard: card grids, big-number metric tiles, gradient accents, sidebar-of-icons chrome.
- AI chatbot product: chat bubbles, purple glow, sparkle icons, "magic" language. Claude writes here, but the UI presents a script to edit and findings to judge, not a conversation.
- Google-Docs-style comment sidebars with avatars and threads. Comments here are editorial findings with a proposed fix, not discussion.

## Design Principles

1. **The script is the hero.** On the editor, the lines get the width, the contrast and the type. Controls appear where the line is, when it's focused.
2. **Every finding points at a line.** A checker error, a wrong fact or a weak moment names its line ids and sits next to those lines, with the fix one click away.
3. **Make the wait feel like progress.** Claude takes seconds to minutes. Show which step is running, an honest estimate from past runs, and let Majed keep reading meanwhile.
4. **Nothing changes behind his back.** Claude's rewrites arrive as proposals with a visible diff; only accept applies them. Locked lines say so and can't be touched.
5. **Occasion at milestones, calm in between.** Picking a story and locking a script earn a moment; editing stays quiet enough to read for an hour.

## Accessibility & Inclusion

WCAG 2.2 AA: text and UI contrast, full keyboard access with visible focus (the editor is keyboard-first: move between lines, accept, reject), labelled controls, and `prefers-reduced-motion` respected. Status is never carried by colour alone; every state has a word or a symbol.
