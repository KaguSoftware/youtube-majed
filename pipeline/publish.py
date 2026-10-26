"""What YouTube is told about a film: the draft, and the rules it must meet.

Pure stdlib, because the studio runs it too (pipeline/webapi.py, vendored
into the Vercel function like docs.py): the form is filled from `draft` and
judged by `check`, and the worker judges again with the same code before it
uploads, so the two can never disagree about what YouTube will accept.

The limits are YouTube's, from the `videos` resource (read October 2026):
a title of at most 100 characters, a description of at most 5,000 bytes,
neither containing `<` or `>`, and tags of at most 500 characters in all,
where the commas between tags count, and so do the quotes YouTube puts
around a tag that contains a space.

### The draft

Accuracy is the product's only claim, so the description carries the film's
sources: every distinct URL the approved research cites, in claim order. A
viewer who doubts a line can follow it. It also says, in one line, what is
made by machine, which the person can edit or remove like any other line.
"""

from __future__ import annotations

import re

TITLE_MAX = 100
DESCRIPTION_MAX_BYTES = 5000
TAGS_MAX = 500
PRIVACY = ("private", "unlisted", "public")

#: YouTube's category for the films: Education. Category ids are regional,
#: but 27 is Education in every region that lists it.
CATEGORY_EDUCATION = "27"

DISCLOSURE = "The narration voice and the paintings are AI-generated."
SOURCED = "The script's facts are drawn from the sources below."

_FORBIDDEN = re.compile(r"[<>]")
_URL = re.compile(r"https?://\S+")


def tags_length(tags: list[str]) -> int:
    """Characters YouTube counts against the 500: the tags, a comma between
    each, and quotes around any tag with a space in it."""
    return sum(len(t) + (2 if " " in t else 0) for t in tags) + max(0, len(tags) - 1)


def clean_tags(raw: str | list[str]) -> list[str]:
    """Tags from a comma-separated field: trimmed, de-duplicated, no empties."""
    items = raw.split(",") if isinstance(raw, str) else list(raw)
    seen, out = set(), []
    for t in items:
        t = " ".join(str(t).split())
        if t and t.lower() not in seen:
            seen.add(t.lower())
            out.append(t)
    return out


def check(meta: dict) -> list[str]:
    """Every reason YouTube would refuse this metadata, in the studio's words.
    Empty when it is fine."""
    errors: list[str] = []
    title = str(meta.get("title") or "")
    description = str(meta.get("description") or "")
    tags = clean_tags(meta.get("tags") or [])
    if not title.strip():
        errors.append("The film needs a title.")
    elif len(title) > TITLE_MAX:
        errors.append(f"The title is {len(title)} characters; YouTube allows {TITLE_MAX}.")
    if _FORBIDDEN.search(title) or _FORBIDDEN.search(description):
        errors.append("YouTube does not allow < or > in a title or description.")
    size = len(description.encode())
    if size > DESCRIPTION_MAX_BYTES:
        errors.append(f"The description is {size:,} bytes; YouTube allows {DESCRIPTION_MAX_BYTES:,}. "
                      "Shorten it, or cut some sources.")
    if any(_FORBIDDEN.search(t) for t in tags):
        errors.append("YouTube does not allow < or > in a tag.")
    if tags_length(tags) > TAGS_MAX:
        errors.append(f"The tags come to {tags_length(tags)} characters; YouTube allows {TAGS_MAX}.")
    if meta.get("privacy") not in PRIVACY:
        errors.append("Choose who can see the film: private, unlisted or public.")
    return errors


def sources(research_markdown: str | None) -> list[str]:
    """The distinct source URLs the research cites, in claim order."""
    if not research_markdown:
        return []
    from . import docs

    research = docs.parse_research_text(research_markdown)
    out: list[str] = []
    for claim in research.claims.values():
        for url in _URL.findall(str(claim.source)):
            url = url.rstrip(").,;]>")
            if url not in out:
                out.append(url)
    return out


def draft(project: dict, research_markdown: str | None = None) -> dict:
    """A first title and description for the form, from the film's own
    record: its topic, its angle, and the sources its research cites."""
    title = _FORBIDDEN.sub("", " ".join(str(project.get("topic") or "").split()))
    if title[:1].islower():
        title = title[0].upper() + title[1:]
    if len(title) > TITLE_MAX:
        title = title[: TITLE_MAX - 1].rstrip() + "…"
    angle = _FORBIDDEN.sub("", " ".join(str(project.get("angle") or "").split()))
    angle = angle[:1].upper() + angle[1:]
    if angle and angle[-1] not in ".?!":
        angle += "."
    urls = sources(research_markdown)
    body = "\n\n".join(h for h in (angle, DISCLOSURE + (" " + SOURCED if urls else "")) if h)
    if urls:
        listing = "Sources\n"
        for i, url in enumerate(urls):
            line = f"{url}\n"
            rest = len(urls) - i
            more = f"…and {rest} more in the research.\n"
            if len((body + "\n\n" + listing + line + more).encode()) > DESCRIPTION_MAX_BYTES:
                listing += more
                break
            listing += line
        body = f"{body}\n\n{listing}".rstrip("\n")
    return {"title": title, "description": body, "tags": [], "sources": len(urls)}
