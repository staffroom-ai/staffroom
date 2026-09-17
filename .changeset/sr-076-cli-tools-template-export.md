---
"staffroom": minor
---

Three commands: write your own tool, lay down a template, and take the whole
office with you.

`npx staffroom tools new <name>` writes a tool file you fill in. It compiles as
it stands, so the office does not greet you with a load failure before you have
written a line, and the warning about what a custom tool can do is in the file
rather than in the docs — where the person who needs it is looking.

`npx staffroom template list` and `template apply <id> --into <dir>`. Apply
refuses a folder that already has an office in it rather than merging.

`npx staffroom export --out office-export.zip` puts everything in one file that
does not need Staffroom to read: the notes stay markdown, the settings stay YAML,
and the run log becomes JSON. No `.env`, nothing from `.staffroom/secrets/`, and
every value from your `.env` replaced by the name it came from.

`tools add` now prints the example's TRY IT line instead of telling you where to
find it.
