# Standalone pages

Single-file HTML pages that are published as Claude artifacts rather than being
part of the app build. They are kept here so the source survives — an artifact
can be re-published from its file, but a file that only ever lived in a
temporary directory cannot.

## `coroner-to-memorial.html`

A checklist for an investigated death, from coroner custody through to the
memorial. Five questions — relationship, whether a coroner is involved, whether
police are holding belongings, what happens to the body, which gatherings — and
everything that does not apply disappears. Answers persist in `localStorage`.

The disposition question offers all eight legal routes, not the two a funeral
home sells: burial, green burial, cremation, water cremation, human composting,
burial at sea, body donation, and undecided. Each adds its own phase of steps,
and undecided produces a comparison. This mirrors the *Every way there is* group
in `artifacts/holding-today/src/content/first-days.ts`; if one changes, change
the other.

Published at <https://claude.ai/code/artifact/c8919e98-9cb0-4492-b939-de2f9da306b3>.
Re-publish by passing that URL, or the file will become a second artifact.

The page is written without `<!doctype>`, `<html>`, `<head>` or `<body>` tags
because the artifact host wraps it in those at publish time. Opening the file
directly in a browser works anyway; browsers are forgiving about it.
