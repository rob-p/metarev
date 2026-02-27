# Review Triage Dashboard

A fully client-side web app for area-chair review analysis.

## What it does
- Loads EasyChair-style review XML files from a selected folder/files.
- Computes paper-level metrics:
  - average score
  - minimum score
  - maximum score
  - score discrepancy (`max - min`)
  - confidence-weighted score (confidence 5 counts 50% more than confidence 1)
  - reviewer-adjusted score (each reviewer score is centered by that reviewer's mean and scaled by that reviewer's score range)
  - average reviewer confidence
  - average review length (words)
- Lets you sort papers by any metric and click through to full review text.
- Shows histogram distributions for:
  - paper average scores
  - raw overall review scores
- Includes a separate **Review Quality Inspector** panel to filter individual reviews by:
  - min/max word count
  - min/max confidence
  - likely low-content flag (`<120` words)

## Run (no Python required)
Open the app directly:

- `web/index.html`

Then select a folder of XML reviews (or multiple XML files) using the file picker.

## Optional local static server
If you prefer serving over HTTP:

```bash
cd web
python3 -m http.server 8787
```

Open [http://127.0.0.1:8787](http://127.0.0.1:8787).
