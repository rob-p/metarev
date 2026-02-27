const state = {
  data: null,
  sortedPapers: [],
  selectedSubmission: null,
  paperSortKey: "avgScore",
  paperSortDirection: "desc",
};

const SHORT_WORD_THRESHOLD = 120;

const els = {
  form: document.getElementById("load-form"),
  fileInput: document.getElementById("review-files"),
  status: document.getElementById("status-text"),
  kpiPapers: document.getElementById("kpi-papers"),
  kpiReviews: document.getElementById("kpi-reviews"),
  kpiMeanScore: document.getElementById("kpi-mean-score"),
  kpiHighDisc: document.getElementById("kpi-high-disc"),
  paperHistogram: document.getElementById("paper-histogram"),
  reviewHistogram: document.getElementById("review-histogram"),
  paperSortKey: document.getElementById("paper-sort-key"),
  sortDirection: document.getElementById("sort-direction"),
  paperBody: document.querySelector("#paper-table tbody"),
  detailTitle: document.getElementById("paper-detail-title"),
  detail: document.getElementById("paper-detail"),
  reviewBody: document.querySelector("#review-table tbody"),
  minWords: document.getElementById("filter-min-words"),
  maxWords: document.getElementById("filter-max-words"),
  minConf: document.getElementById("filter-min-confidence"),
  maxConf: document.getElementById("filter-max-confidence"),
  shortFlag: document.getElementById("filter-short-flag"),
};

function normalizeWhitespace(text) {
  return (text || "").replace(/\s+/g, " ").trim();
}

function wordCount(text) {
  return (text.match(/\b[\w'-]+\b/g) || []).length;
}

function sentenceCount(text) {
  return (text.split(/[.!?]+/g).filter((p) => p.trim().length > 0)).length;
}

function uniqueWordRatio(text) {
  const words = (text.match(/\b[\w'-]+\b/g) || []).map((w) => w.toLowerCase());
  if (!words.length) return 0;
  return Number((new Set(words).size / words.length).toFixed(3));
}

function parseScore(text) {
  const cleaned = normalizeWhitespace(text);
  if (!cleaned) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

function fieldByName(root, name) {
  const fields = Array.from(root.querySelectorAll("field"));
  return fields.find((f) => normalizeWhitespace(f.getAttribute("name")) === name) || null;
}

function parseReviewXml(xmlText, fileName) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, "text/xml");
  if (doc.querySelector("parsererror")) {
    throw new Error(`Invalid XML in ${fileName}`);
  }

  const root = doc.querySelector("review");
  if (!root) {
    throw new Error(`Missing <review> in ${fileName}`);
  }

  const overallField = fieldByName(root, "Overall evaluation");
  const confidenceField = fieldByName(root, "Reviewer's confidence");
  const confidentialField = fieldByName(root, "Confidential remarks for the program committee");

  const overallText = normalizeWhitespace(overallField?.querySelector("text")?.textContent || "");
  const overallScore = parseScore(overallField?.querySelector("score")?.textContent || "");
  const confidenceScore = parseScore(confidenceField?.querySelector("score")?.textContent || "");
  const confidentialText = normalizeWhitespace(confidentialField?.querySelector("text")?.textContent || "");

  const firstName = normalizeWhitespace(root.querySelector("reviewer > first_name")?.textContent || "");
  const lastName = normalizeWhitespace(root.querySelector("reviewer > last_name")?.textContent || "");

  return {
    submission: normalizeWhitespace(root.getAttribute("submission") || ""),
    title: normalizeWhitespace(root.getAttribute("title") || ""),
    authors: normalizeWhitespace(root.getAttribute("authors") || ""),
    fileName,
    reviewId: normalizeWhitespace(root.getAttribute("id") || ""),
    pcMember: normalizeWhitespace(root.getAttribute("pc_member") || ""),
    overallText,
    overallScore,
    confidenceScore,
    confidentialText,
    subreviewerName: normalizeWhitespace(`${firstName} ${lastName}`),
    subreviewerEmail: normalizeWhitespace(root.querySelector("reviewer > email")?.textContent || ""),
    wordCount: wordCount(overallText),
    charCount: overallText.length,
    sentenceCount: sentenceCount(overallText),
    uniqueWordRatio: uniqueWordRatio(overallText),
  };
}

function reviewerKeyFor(review) {
  if (review.pcMember) return review.pcMember;
  if (review.subreviewerEmail) return review.subreviewerEmail;
  if (review.subreviewerName) return review.subreviewerName;
  return `unknown:${review.fileName}`;
}

function summarizeReviews(reviews) {
  const reviewerScores = {};
  for (const review of reviews) {
    if (review.overallScore === null) continue;
    const key = reviewerKeyFor(review);
    reviewerScores[key] = reviewerScores[key] || [];
    reviewerScores[key].push(review.overallScore);
  }

  const reviewerStats = {};
  for (const [key, scores] of Object.entries(reviewerScores)) {
    if (!scores.length) continue;
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    const min = Math.min(...scores);
    const max = Math.max(...scores);
    reviewerStats[key] = { mean, min, max, range: max - min };
  }

  const papers = {};
  const reviewRows = [];

  for (const review of reviews) {
    const key = reviewerKeyFor(review);
    const submission = review.submission;
    if (!papers[submission]) {
      papers[submission] = {
        submission,
        title: review.title,
        authors: review.authors,
        reviews: [],
      };
    }

    const reviewObj = {
      fileName: review.fileName,
      reviewId: review.reviewId,
      pcMember: review.pcMember,
      overallScore: review.overallScore,
      confidenceScore: review.confidenceScore,
      overallText: review.overallText,
      confidentialText: review.confidentialText,
      subreviewerName: review.subreviewerName,
      subreviewerEmail: review.subreviewerEmail,
      wordCount: review.wordCount,
      charCount: review.charCount,
      sentenceCount: review.sentenceCount,
      uniqueWordRatio: review.uniqueWordRatio,
      reviewerKey: key,
    };

    papers[submission].reviews.push(reviewObj);

    reviewRows.push({
      submission,
      title: review.title,
      fileName: review.fileName,
      overallScore: review.overallScore,
      confidenceScore: review.confidenceScore,
      wordCount: review.wordCount,
      charCount: review.charCount,
      sentenceCount: review.sentenceCount,
      uniqueWordRatio: review.uniqueWordRatio,
      pcMember: review.pcMember,
      reviewerKey: key,
      reviewId: review.reviewId,
      hasConfidential: Boolean(review.confidentialText),
    });
  }

  const paperRows = Object.values(papers).map((paper) => {
    const rs = paper.reviews;
    const scores = rs.map((r) => r.overallScore).filter((x) => x !== null);
    const confs = rs.map((r) => r.confidenceScore).filter((x) => x !== null);
    const words = rs.map((r) => r.wordCount);

    const avgScore = scores.length ? Number((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(3)) : null;
    const minScore = scores.length ? Math.min(...scores) : null;
    const maxScore = scores.length ? Math.max(...scores) : null;
    const scoreDiscrepancy = scores.length ? Number((maxScore - minScore).toFixed(3)) : null;
    const avgConfidence = confs.length ? Number((confs.reduce((a, b) => a + b, 0) / confs.length).toFixed(3)) : null;
    const avgWordCount = words.length ? Number((words.reduce((a, b) => a + b, 0) / words.length).toFixed(1)) : 0;

    let weightedTotal = 0;
    let weightedDenom = 0;
    const reviewerAdjustedScores = [];

    for (const r of rs) {
      if (r.overallScore === null) continue;

      let confidenceWeight = 1;
      if (r.confidenceScore !== null) {
        const c = Math.min(Math.max(Number(r.confidenceScore), 1), 5);
        confidenceWeight = 1 + (0.5 * (c - 1)) / 4;
      }

      weightedTotal += r.overallScore * confidenceWeight;
      weightedDenom += confidenceWeight;

      const stats = reviewerStats[r.reviewerKey];
      if (stats) {
        if (stats.range > 0) {
          reviewerAdjustedScores.push((r.overallScore - stats.mean) / stats.range);
        } else {
          reviewerAdjustedScores.push(0);
        }
      }
    }

    const confidenceWeightedScore =
      weightedDenom > 0 ? Number((weightedTotal / weightedDenom).toFixed(3)) : null;
    const reviewerAdjustedScore =
      reviewerAdjustedScores.length > 0
        ? Number((reviewerAdjustedScores.reduce((a, b) => a + b, 0) / reviewerAdjustedScores.length).toFixed(3))
        : null;

    return {
      submission: paper.submission,
      title: paper.title,
      authors: paper.authors,
      reviewCount: rs.length,
      avgScore,
      minScore,
      maxScore,
      scoreDiscrepancy,
      avgConfidence,
      avgWordCount,
      confidenceWeightedScore,
      reviewerAdjustedScore,
      reviews: rs,
    };
  });

  return {
    paperCount: paperRows.length,
    reviewCount: reviewRows.length,
    papers: paperRows,
    reviewRows,
    reviewerCount: Object.keys(reviewerStats).length,
  };
}

function inferSourceLabel(files) {
  const first = files[0];
  if (!first) return "selected files";
  const rel = first.webkitRelativePath || "";
  if (!rel.includes("/")) return `${files.length} selected file(s)`;
  const folder = rel.split("/")[0];
  return folder || `${files.length} selected file(s)`;
}

function fmt(num, digits = 2) {
  return num === null || num === undefined || Number.isNaN(num) ? "-" : Number(num).toFixed(digits);
}

function cmpValues(a, b, direction = "desc") {
  const dir = direction === "asc" ? 1 : -1;
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;
  if (typeof a === "string" && typeof b === "string") {
    return a.localeCompare(b) * dir;
  }
  return (a - b) * dir;
}

function sortPapers() {
  const papers = [...(state.data?.papers || [])];
  papers.sort((a, b) => {
    const primary = cmpValues(a[state.paperSortKey], b[state.paperSortKey], state.paperSortDirection);
    if (primary !== 0) return primary;
    return cmpValues(Number(a.submission), Number(b.submission), "asc");
  });
  state.sortedPapers = papers;
}

function renderKpis() {
  const papers = state.data?.papers || [];
  // Match KPI to the visible "Avg" column values (shown at 2 decimals).
  const allPaperAverages = papers
    .map((p) => (p.avgScore === null ? null : Number(p.avgScore.toFixed(2))))
    .filter((n) => n !== null);
  const meanScore = allPaperAverages.length
    ? allPaperAverages.reduce((a, b) => a + b, 0) / allPaperAverages.length
    : null;
  const highDisc = papers.filter((p) => (p.scoreDiscrepancy ?? -1) >= 2).length;

  els.kpiPapers.textContent = papers.length;
  els.kpiReviews.textContent = state.data?.reviewCount || 0;
  els.kpiMeanScore.textContent = fmt(meanScore, 4);
  els.kpiHighDisc.textContent = highDisc;
}

function renderPapers() {
  sortPapers();
  const rows = state.sortedPapers
    .map((paper) => {
      const active = paper.submission === state.selectedSubmission ? "active" : "";
      return `
        <tr class="${active}" data-submission="${paper.submission}">
          <td>${paper.submission}</td>
          <td title="${paper.title}">${paper.title}</td>
          <td>${paper.reviewCount}</td>
          <td>${fmt(paper.avgScore, 2)}</td>
          <td>${fmt(paper.minScore, 0)}</td>
          <td>${fmt(paper.maxScore, 0)}</td>
          <td>${fmt(paper.scoreDiscrepancy, 2)}</td>
          <td>${fmt(paper.avgConfidence, 2)}</td>
          <td>${fmt(paper.avgWordCount, 1)}</td>
          <td>${fmt(paper.confidenceWeightedScore, 2)}</td>
          <td>${fmt(paper.reviewerAdjustedScore, 3)}</td>
        </tr>
      `;
    })
    .join("");

  els.paperBody.innerHTML = rows;
}

function reviewCardHtml(review) {
  const lowContent = review.wordCount < SHORT_WORD_THRESHOLD;
  return `
    <article class="review-card">
      <div class="review-meta">
        <span><strong>Score:</strong> ${fmt(review.overallScore, 0)}</span>
        <span><strong>Confidence:</strong> ${fmt(review.confidenceScore, 0)}</span>
        <span><strong>Words:</strong> ${review.wordCount}</span>
        <span><strong>PC:</strong> ${review.pcMember || "-"}</span>
        <span><strong>File:</strong> ${review.fileName}</span>
        <span class="flag ${lowContent ? "warn" : "ok"}">${lowContent ? "Likely low-content" : "Substantive length"}</span>
      </div>
      <p class="review-text">${escapeHtml(review.overallText || "")}</p>
    </article>
  `;
}

function renderPaperDetail() {
  if (!state.selectedSubmission) {
    els.detail.className = "review-list empty";
    els.detail.textContent = "No paper selected.";
    els.detailTitle.textContent = "Select a paper to view complete review text.";
    return;
  }

  const paper = (state.data?.papers || []).find((p) => p.submission === state.selectedSubmission);
  if (!paper) {
    state.selectedSubmission = null;
    renderPaperDetail();
    return;
  }

  els.detail.className = "review-list";
  els.detailTitle.textContent = `${paper.submission}: ${paper.title}`;
  els.detail.innerHTML = paper.reviews.map(reviewCardHtml).join("");
}

function escapeHtml(value) {
  return (value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getFilteredReviews() {
  const rows = state.data?.reviewRows || [];
  const minWords = Number(els.minWords.value || 0);
  const maxWords = Number(els.maxWords.value || 9999);
  const minConf = Number(els.minConf.value || 1);
  const maxConf = Number(els.maxConf.value || 5);
  const shortOnly = els.shortFlag.checked;

  return rows.filter((row) => {
    const wc = Number(row.wordCount || 0);
    const conf = Number(row.confidenceScore || 0);
    const basic = wc >= minWords && wc <= maxWords && conf >= minConf && conf <= maxConf;
    if (!basic) return false;
    if (shortOnly) return wc < SHORT_WORD_THRESHOLD;
    return true;
  });
}

function renderReviewTable() {
  const reviews = getFilteredReviews().sort((a, b) => {
    const flagA = a.wordCount < SHORT_WORD_THRESHOLD ? 0 : 1;
    const flagB = b.wordCount < SHORT_WORD_THRESHOLD ? 0 : 1;
    if (flagA !== flagB) return flagA - flagB;
    if (a.wordCount !== b.wordCount) return a.wordCount - b.wordCount;
    return Number(a.submission) - Number(b.submission);
  });

  els.reviewBody.innerHTML = reviews
    .map((r) => {
      const lowContent = r.wordCount < SHORT_WORD_THRESHOLD;
      return `
      <tr data-submission="${r.submission}">
        <td>${r.submission}</td>
        <td>${fmt(r.overallScore, 0)}</td>
        <td>${fmt(r.confidenceScore, 0)}</td>
        <td>${r.wordCount}</td>
        <td>${r.sentenceCount}</td>
        <td>${fmt(r.uniqueWordRatio, 2)}</td>
        <td class="flag ${lowContent ? "warn" : "ok"}">${lowContent ? "Review" : "OK"}</td>
      </tr>
    `;
    })
    .join("");
}

function histogramBins(values, binCount, minValue, maxValue) {
  const bins = new Array(binCount).fill(0);
  if (!values.length) return bins;

  const span = maxValue - minValue;
  if (span <= 0) {
    bins[0] = values.length;
    return bins;
  }

  for (const val of values) {
    let idx = Math.floor(((val - minValue) / span) * binCount);
    idx = Math.max(0, Math.min(binCount - 1, idx));
    bins[idx] += 1;
  }
  return bins;
}

function renderHistogram(container, values, minValue, maxValue, binCount = 12) {
  const bins = histogramBins(values, binCount, minValue, maxValue);
  const maxBin = Math.max(...bins, 1);
  const step = (maxValue - minValue) / binCount;

  container.innerHTML = bins
    .map((count, i) => {
      const start = minValue + i * step;
      const end = start + step;
      const heightPct = (count / maxBin) * 100;
      return `
        <div class="hist-bar">
          <div class="hist-count">${count}</div>
          <div class="hist-track">
            <div class="hist-col" style="height:${heightPct}%;"></div>
          </div>
          <div class="hist-label">${start.toFixed(1)}..${end.toFixed(1)}</div>
        </div>
      `;
    })
    .join("");
}

function renderHistograms() {
  const paperAverages = (state.data?.papers || []).map((p) => p.avgScore).filter((v) => v !== null);
  const reviewScores = (state.data?.reviewRows || []).map((r) => r.overallScore).filter((v) => v !== null);
  renderHistogram(els.paperHistogram, paperAverages, -3, 3, 12);
  renderHistogram(els.reviewHistogram, reviewScores, -3, 3, 12);
}

function renderAll() {
  renderKpis();
  renderHistograms();
  renderPapers();
  renderPaperDetail();
  renderReviewTable();
}

function setStatus(message, isError = false) {
  els.status.textContent = message;
  els.status.style.color = isError ? "#b1432f" : "#5f6a74";
}

async function loadDataFromFiles(fileList) {
  const allFiles = Array.from(fileList || []);
  const xmlFiles = allFiles.filter((f) => f.name.toLowerCase().endsWith(".xml"));
  if (!xmlFiles.length) {
    throw new Error("No XML files selected. Choose a folder (or files) containing review XML files.");
  }

  setStatus("Loading reviews...");

  const reviews = [];
  const parseErrors = [];

  for (const file of xmlFiles) {
    try {
      const text = await file.text();
      reviews.push(parseReviewXml(text, file.name));
    } catch (err) {
      parseErrors.push(`${file.name}: ${err.message || String(err)}`);
    }
  }

  if (!reviews.length) {
    throw new Error("No valid review XML files could be parsed.");
  }

  const data = summarizeReviews(reviews);
  data.sourceFolder = inferSourceLabel(xmlFiles);
  data.xmlFiles = xmlFiles.length;
  data.parsedFiles = reviews.length;
  data.parseErrors = parseErrors;

  state.data = data;
  if (!state.selectedSubmission && data.papers.length) {
    state.selectedSubmission = data.papers[0].submission;
  }
  renderAll();

  setStatus(
    `Loaded ${data.parsedFiles}/${data.xmlFiles} XML files from ${data.sourceFolder}` +
      (parseErrors.length ? ` (${parseErrors.length} parse errors)` : "")
  );
}

els.form.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  try {
    await loadDataFromFiles(els.fileInput.files);
  } catch (err) {
    setStatus(err.message || String(err), true);
  }
});

els.fileInput.addEventListener("change", async () => {
  if (!els.fileInput.files?.length) return;
  try {
    await loadDataFromFiles(els.fileInput.files);
  } catch (err) {
    setStatus(err.message || String(err), true);
  }
});

els.paperSortKey.addEventListener("change", () => {
  state.paperSortKey = els.paperSortKey.value;
  renderPapers();
});

els.sortDirection.addEventListener("click", () => {
  state.paperSortDirection = state.paperSortDirection === "desc" ? "asc" : "desc";
  els.sortDirection.textContent = state.paperSortDirection === "desc" ? "Descending" : "Ascending";
  renderPapers();
});

els.paperBody.addEventListener("click", (ev) => {
  const row = ev.target.closest("tr[data-submission]");
  if (!row) return;
  state.selectedSubmission = row.dataset.submission;
  renderPapers();
  renderPaperDetail();
});

els.reviewBody.addEventListener("click", (ev) => {
  const row = ev.target.closest("tr[data-submission]");
  if (!row) return;
  state.selectedSubmission = row.dataset.submission;
  renderPapers();
  renderPaperDetail();
});

[els.minWords, els.maxWords, els.minConf, els.maxConf, els.shortFlag].forEach((el) => {
  el.addEventListener("input", renderReviewTable);
  el.addEventListener("change", renderReviewTable);
});

setStatus("Select a review folder (or XML files), then click Load.");
