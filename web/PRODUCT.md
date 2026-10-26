# Product

## Register

product

## Users

A non-technical teammate who turns a topic into a finished, narrated, illustrated history video. They never touch a terminal, the queue or the models. They work on a laptop at a desk in normal daytime light, in short sessions: start a project, review the research, read and approve the script, pick a look, start the render, come back to a finished film.

Their job on each screen is a decision, not an operation: is this research trustworthy, does this script say the right thing, which of these three frames is the look, is the film right. The system does the work between decisions, sometimes for forty minutes at a time, on a worker machine they never see.

## Product Purpose

An internal studio for researched history videos. A topic goes in; the pipeline researches it with sources, writes a beat-structured narration, generates one image per shot conditioned on a locked character reference, narrates it, and assembles the film. Accuracy is the product's only real claim, so the human gates (research approval, script approval, style choice) carry the weight, and the validators that guard them are visible, explained, and overridable only on purpose.

Success: the teammate drives a project from topic to finished video without help, trusts what they are approving, and always knows what the system is doing and how long it will take.

## Brand Personality

Bold, cinematic, energetic. This is a film studio, not an admin panel. Stills, frames and the finished film are the heroes, shown big and given room; text supports them. Milestones (a script approved, a look chosen, a film finished) feel like occasions. The working surfaces stay direct and legible: confident language, plain words, no hedging.

Voice: a capable director's assistant. Says what is happening and what is needed next, in plain English. Never pipeline jargon ("job", "lease", "artifact", "worker") in front of the user; "the studio machine", "rendering", "your script" instead.

## Anti-references

- Generic SaaS dashboard: card grids, big-number metric tiles, gradient accents, sidebar-of-icons chrome.
- AI chatbot product: chat bubbles, purple glow, sparkle icons, "magic" language. Claude writes the research and script here, but the UI presents documents to review, not a conversation.

## Design Principles

1. **The footage is the hero.** Frames, stills and the film get the space and the contrast. Chrome recedes until it is needed.
2. **Every gate explains itself.** A validator error, a stale document, a locked stage or an offline machine says what happened, why it matters, and what to do, in plain language next to the thing it is about.
3. **Make the wait feel like progress.** A render takes up to forty minutes. Show frames arriving as they are made, what stage it is in and an honest estimate, so leaving and coming back is safe and obvious.
4. **Overrides take a click and leave a name.** "Promote anyway" is deliberate, shows exactly what is being overridden, and records who did it.
5. **Occasion at milestones, calm in between.** Approvals and a finished film earn a moment of drama; editing and reviewing surfaces stay quiet enough to read for twenty minutes.

## Accessibility & Inclusion

WCAG 2.2 AA: text and UI contrast, full keyboard access with visible focus, labelled controls, and `prefers-reduced-motion` respected (cinematic motion degrades to simple fades). Status is never carried by colour alone; every state has a word.
