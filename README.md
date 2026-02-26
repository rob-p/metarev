# Review Triage Dashboard

A local web app for area-chair review analysis.

## What it does
- Loads EasyChair-style review XML files from a folder.
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

## Run
From `/Users/rob/software_src/metarev`:

```bash
python3 app.py
```

Then open:

- [http://127.0.0.1:8787](http://127.0.0.1:8787)

No review folder is loaded by default.

## Load a different folder
Use the "Review folder" input in the top-right and click **Load**.

You can provide either:
- a relative path (relative to the project directory), or
- an absolute path.

## Optional flags
```bash
python3 app.py --host 127.0.0.1 --port 8787 --data-dir /path/to/reviews --static-dir web
```
