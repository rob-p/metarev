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
  folderPath: document.getElementById("folder-path"),
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
  const allAvg = papers.map((p) => p.avgScore).filter((n) => n !== null);
  const meanScore = allAvg.length ? allAvg.reduce((a, b) => a + b, 0) / allAvg.length : null;
  const highDisc = papers.filter((p) => (p.scoreDiscrepancy ?? -1) >= 2).length;

  els.kpiPapers.textContent = papers.length;
  els.kpiReviews.textContent = state.data?.reviewCount || 0;
  els.kpiMeanScore.textContent = fmt(meanScore, 2);
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

async function loadData(path) {
  const query = path ? `?dir=${encodeURIComponent(path)}` : "";
  setStatus("Loading reviews...");
  const response = await fetch(`/api/reviews${query}`);
  const payload = await response.json();
  if (!payload.ok) {
    throw new Error(payload.error || "Failed to load review data");
  }

  state.data = payload.data;
  if (!state.selectedSubmission && state.data.papers.length) {
    state.selectedSubmission = state.data.papers[0].submission;
  }
  renderAll();

  const parseErrors = payload.data.parseErrors.length;
  setStatus(
    `Loaded ${payload.data.parsedFiles}/${payload.data.xmlFiles} XML files from ${payload.data.sourceFolder}` +
      (parseErrors ? ` (${parseErrors} parse errors)` : "")
  );
}

els.form.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  try {
    await loadData(els.folderPath.value.trim());
  } catch (err) {
    setStatus(err.message, true);
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

setStatus("Enter a review folder path, then click Load.");
