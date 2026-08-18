# Health Chart Dashboard

A personal health record dashboard: medications, tests & results, diagnoses,
vitals, visits, and a symptom log — merged into one cross-referenceable
timeline. Built as a static site so it can be hosted for free on GitHub Pages.

No data is hardcoded. `data.json` starts empty. Records only get added when
Claude extracts them from an uploaded document, or when you add them by hand
through the dashboard's "+ Add" buttons.

**The data lives in your GitHub repo, not in one browser.** The page reads
and writes `data.json` directly via the GitHub Contents API, so once you
connect it on a device, that device is reading/writing the same file as
every other device you connect — open the same URL on your phone, sign in
with the same repo details, and you see the same chart.

## What's in this folder

| File | Purpose |
|---|---|
| `index.html` | Page structure and layout |
| `styles.css` | Visual design (warm cream/coral/teal palette) |
| `data.json` | The health record itself (starts empty) — this is what gets synced |
| `app.js` | Rendering, editing, GitHub sync, file uploads, timeline merge, review-flag logic |

Uploaded files land in an `/uploads` folder in your repo (created
automatically on first upload) — that folder isn't in this download since
it starts empty.

## Host it on GitHub Pages (free, ~5 minutes)

1. Create a new **private** repository on GitHub (recommended, since this is
   personal health data) — e.g. `health-chart`.
2. Upload these four files to the repo root (drag-and-drop on the GitHub web
   UI works fine, or `git push` if you're comfortable with git).
3. In the repo, go to **Settings → Pages**.
4. Under "Build and deployment", set **Source** to `Deploy from a branch`,
   branch `main`, folder `/ (root)`. Save.
5. GitHub gives you a URL like `https://<your-username>.github.io/health-chart/`
   — that's your live dashboard.

> **Note on privacy:** a *private* repo's GitHub Pages site is still only
> reachable if you're signed into GitHub with access to that repo (GitHub
> Pages supports access control on paid plans; on free plans, Pages sites
> built from private repos are visible only to people with repo access via
> the github.io URL is technically public if the repo is public — for truly
> sensitive data, keep the repo **private** and check your plan's Pages
> visibility settings before uploading anything, or self-host instead
> (e.g. open `index.html` locally, or serve it from a password-protected host).

## Connect the dashboard to your repo (do this once per device)

1. On GitHub, go to **Settings → Developer settings → Personal access tokens
   → Fine-grained tokens → Generate new token**.
2. Set **Resource owner** to your account, and under **Repository access**
   choose **Only select repositories** → your `health-chart` repo.
3. Under **Permissions → Repository permissions**, set **Contents** to
   **Read and write**. Leave everything else as no access.
4. Generate the token and copy it (GitHub only shows it once).
5. On the live dashboard, click **Connect GitHub** in the side rail and
   fill in:
   - Repo owner — your GitHub username
   - Repository name — e.g. `health-chart`
   - Branch — usually `main`
   - Data file path — `data.json`
   - Personal access token — the one you just generated
6. Click **Save & sync**. The dashboard pulls `data.json` from the repo and
   from then on, every add/edit/delete commits straight back to it.

The token is stored only in that browser's `localStorage` — it's never
written into `data.json` or committed anywhere. You'll need to repeat this
five-field setup on each new device/browser (phone, laptop, etc.) using the
same token or a new one scoped the same way.

> If you'd rather not hand a token to a browser tab at all, the older
> **Import data** flow still works as a manual alternative: ask Claude for
> the extracted JSON, paste it into the dashboard, then copy the resulting
> `data.json` back into the repo yourself.

## Profiles

One chart, several people — e.g. yourself, a parent, a child. Click the
profile pill top-left of the side rail to switch, or **Add profile** to
create a new one (pick a name and a color). Every medication, test,
diagnosis, vital, visit, symptom entry, and uploaded document is tagged
with whichever profile was active when it was added or corrected, and the
whole dashboard — Overview, Timeline, Inference, every category tab, the
Documents queue, the Review queue — filters to the currently selected
profile. All profiles live in the same `data.json`, so switching profiles
never requires reconnecting GitHub.

## Inference tab

A plain, date-wise digest that pulls together medications (started/
stopped), test results, and symptoms for the active profile and groups
them by date, most recent first — so you can see at a glance what changed
on a given day. It's intentionally just organization, not interpretation:
no diagnosis, no "this caused that." The card says so up front, and a
healthcare professional is still the right call for actual interpretation.

## Day-to-day workflow

**Uploading a document:** in the **Documents** tab (or the "⤴ Upload document"
button on Medications/Tests/Diagnoses/Vitals/Visits), pick a file — image,
PDF, or other. It uploads straight into your GitHub repo under `/uploads`
and appears in the Documents queue as **pending**. Uploading does *not* read
or extract anything by itself — a static site has no safe way to run an AI
model without exposing a key to anyone who views the page source. So: bring
the file to Claude in this chat ("extract the file I just uploaded"), Claude
reads it under the project's strict no-hallucination rules and gives you a
JSON block, and you bring that back via **Import data** — optionally
selecting which pending document it came from, which flips that document to
**extracted** automatically.

**Logging a symptom:** use **+ Add symptom entry** directly in the
dashboard — no need to go through Claude for this one, it's just a form.

**Correcting a flagged or wrong field:** open any record and click
**Correct this entry**. Saving a correction clears the "⚠️ Unclear" tag and
adds an audit note ("Corrected \<fields\> by you on \<date\>") so the entry's
history shows what was extracted-as-is versus user-corrected.

**Reviewing what needs attention:** the **Needs Review** tab (with the red
count badge) lists every entry with at least one unclear field, across all
categories, in one place.

**Exporting for a doctor visit:** click **Export chart** — it opens the
browser print dialog with a print-friendly layout (side rail and buttons
hidden). Save as PDF from there, or print directly.

## Data model

Every record — medication, test, diagnosis, vital, visit — carries:
- `sourceDoc` / `sourceDate` for traceability back to the original document
- `unclearFields`: an array of field names still flagged for review
- `history`: an audit trail of corrections, each with date and who made it

Fields Claude wasn't confident about are stored as the literal string
`"⚠️ Unclear — needs review"`; fields genuinely absent from a document are
stored as `"Not mentioned"`. The dashboard renders these differently (amber
flag vs. muted italic) so you can tell "couldn't read it" apart from
"wasn't there" at a glance.

Full field-by-field schema for each record type:

```
medication: { id, name, dosage, frequency, route, duration, startDate, endDate,
  status: "active"|"discontinued", prescribingDoctor, sourceDoc, sourceDate,
  unclearFields: [...], history: [{date, action, by, note}] }

test: { id, testName, category: "Blood"|"Imaging"|"Urine"|"Other", reasonOrdered,
  dateOrdered, dateResult, value, unit, referenceRange,
  flag: "high"|"low"|"normal"|"not-mentioned", sourceDoc, sourceDate,
  unclearFields: [...], history: [...] }

diagnosis: { id, condition, dateNoted, notes, doctor, sourceDoc, sourceDate,
  unclearFields: [...], history: [...] }

vital: { id, date, bp, weight, temperature, pulse, sugar, other, sourceDoc,
  sourceDate, unclearFields: [...], history: [...] }

visit: { id, date, doctor, clinic, reason, followUp, remarks, sourceDoc,
  sourceDate, unclearFields: [...], history: [...] }

symptom: { id, date, symptoms, severity: "mild"|"moderate"|"severe", notes,
  enteredBy: "user", history: [...] }

allergy: { id, substance, reaction, notedDate, sourceDoc, sourceDate }
```

## Future-proofing notes

- Every save is a real GitHub commit to `data.json`, so you automatically
  get full version history and can roll back a bad edit from the repo's
  commit log if you ever need to.
- The **Import data** flow accepts any JSON matching this schema, so the
  dashboard keeps working as-is even if the extraction prompt or Claude's
  output format evolves, as long as field names stay aligned (or you adjust
  `fieldDefs` in `app.js` to match).
- If a fine-grained PAT in browser storage isn't secure enough for your
  needs, the cleanest upgrade path is replacing the direct GitHub API calls
  in `fetchFromGithub`/`saveState` with calls to a small backend that holds
  the token server-side instead — the rest of the app doesn't care where
  the data comes from.
