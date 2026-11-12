# Notes: wiki links, backlinks and tags

The optional `notes` plugin connects Markdown notes to each other. It needs no authentication and no storage, and it works in server mode and in static builds.

```json
{ "name": "notes", "options": { "backlinksTitle": "Linked from" } }
```

## Front matter

Every Markdown document may start with YAML front matter. This is part of the framework, not of the plugin:

```markdown
---
title: Chimney Ø120
description: Installation scheme and suppliers
tags: [fireplace, house]
---
```

- `title` names the page and its search result; without it the first `# heading` is used.
- `description` becomes the page description.
- `tags` is a YAML list or a comma-separated string.
- The block is not rendered and not indexed as text. Other keys are kept in `metadata.frontMatter` for plugins.
- A leading `---` block that is not a YAML mapping stays ordinary Markdown.

## Wiki links

| Syntax | Meaning |
| --- | --- |
| `[[house]]` | The note whose file name is `house.md` |
| `[[projects/house]]` | A path from the content root or relative to the current note |
| `[[Будинок]]` | The note with this title (front matter `title` or first heading) |
| `[[house\|our house]]` | Custom link text |
| `[[house#Heating]]` | A heading inside the note |

A path wins over a file name, a file name over a title. When several notes share a name, the one nearest to the current note wins. A link that matches nothing is shown as marked text, not as a broken link. Text inside code is never a link.

## Backlinks

Each note ends with the list of notes that link to it, whether by wiki link or by an ordinary Markdown link to the `.md` file. `backlinksTitle` sets the heading.

## Tags

Tags from front matter are shown under the note. Create one document named `*.tags.md` (for example `tags.tags.md`) to get a tag index: every tag with its notes. When such a document exists, the tags on a note link to it.

## Options

| Option | Default | Meaning |
| --- | --- | --- |
| `wikiLinks` | `true` | Resolve `[[...]]` links |
| `backlinks` | `true` | Append the backlinks section |
| `tags` | `true` | Show tags and render `*.tags.md` |
| `backlinksTitle` | `Linked from` | Heading of the backlinks section |
| `refreshSeconds` | `30` | Upper bound for reusing the link index on a server. File changes refresh it at once; static builds index once |
