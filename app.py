#!/usr/bin/env python3
import argparse
import json
import os
import re
import urllib.parse
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Dict, List, Optional


def normalize_whitespace(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def word_count(text: str) -> int:
    return len(re.findall(r"\b[\w'-]+\b", text or ""))


def sentence_count(text: str) -> int:
    parts = re.split(r"[.!?]+", text or "")
    return len([p for p in parts if p.strip()])


def unique_word_ratio(text: str) -> float:
    words = [w.lower() for w in re.findall(r"\b[\w'-]+\b", text or "")]
    if not words:
        return 0.0
    return len(set(words)) / len(words)


@dataclass
class ReviewRecord:
    submission: str
    title: str
    authors: str
    file_name: str
    review_id: str
    pc_member: str
    overall_text: str
    overall_score: Optional[float]
    confidence_score: Optional[float]
    confidential_text: str
    subreviewer_name: str
    subreviewer_email: str
    word_count: int
    char_count: int
    sentence_count: int
    unique_word_ratio: float


class ReviewParseError(Exception):
    pass


def parse_score(node: Optional[ET.Element]) -> Optional[float]:
    if node is None or node.text is None:
        return None
    text = normalize_whitespace(node.text)
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def field_by_name(root: ET.Element, name: str) -> Optional[ET.Element]:
    for field in root.findall("field"):
        if (field.get("name") or "").strip() == name:
            return field
    return None


def parse_review_xml(xml_path: Path) -> ReviewRecord:
    try:
        tree = ET.parse(xml_path)
    except ET.ParseError as exc:
        raise ReviewParseError(f"Invalid XML in {xml_path.name}: {exc}") from exc

    root = tree.getroot()
    if root.tag != "review":
        raise ReviewParseError(f"Unexpected root tag in {xml_path.name}: {root.tag}")

    submission = (root.get("submission") or "").strip()
    title = (root.get("title") or "").strip()
    authors = (root.get("authors") or "").strip()
    review_id = (root.get("id") or "").strip()
    pc_member = (root.get("pc_member") or "").strip()

    overall_field = field_by_name(root, "Overall evaluation")
    confidence_field = field_by_name(root, "Reviewer's confidence")
    confidential_field = field_by_name(root, "Confidential remarks for the program committee")

    overall_text = ""
    overall_score = None
    if overall_field is not None:
        text_node = overall_field.find("text")
        score_node = overall_field.find("score")
        overall_text = normalize_whitespace((text_node.text if text_node is not None else "") or "")
        overall_score = parse_score(score_node)

    confidence_score = None
    if confidence_field is not None:
        confidence_score = parse_score(confidence_field.find("score"))

    confidential_text = ""
    if confidential_field is not None:
        confidential_node = confidential_field.find("text")
        confidential_text = normalize_whitespace((confidential_node.text if confidential_node is not None else "") or "")

    reviewer_node = root.find("reviewer")
    first_name = normalize_whitespace(reviewer_node.findtext("first_name") if reviewer_node is not None else "")
    last_name = normalize_whitespace(reviewer_node.findtext("last_name") if reviewer_node is not None else "")
    subreviewer_name = normalize_whitespace(f"{first_name} {last_name}")
    subreviewer_email = normalize_whitespace(reviewer_node.findtext("email") if reviewer_node is not None else "")

    wc = word_count(overall_text)

    return ReviewRecord(
        submission=submission,
        title=title,
        authors=authors,
        file_name=xml_path.name,
        review_id=review_id,
        pc_member=pc_member,
        overall_text=overall_text,
        overall_score=overall_score,
        confidence_score=confidence_score,
        confidential_text=confidential_text,
        subreviewer_name=subreviewer_name,
        subreviewer_email=subreviewer_email,
        word_count=wc,
        char_count=len(overall_text),
        sentence_count=sentence_count(overall_text),
        unique_word_ratio=round(unique_word_ratio(overall_text), 3),
    )


def summarize_reviews(reviews: List[ReviewRecord]) -> Dict[str, object]:
    reviewer_scores: Dict[str, List[float]] = {}

    def reviewer_key_for(review: ReviewRecord) -> str:
        if review.pc_member:
            return review.pc_member
        if review.subreviewer_email:
            return review.subreviewer_email
        if review.subreviewer_name:
            return review.subreviewer_name
        return f"unknown:{review.file_name}"

    for review in reviews:
        if review.overall_score is None:
            continue
        key = reviewer_key_for(review)
        reviewer_scores.setdefault(key, []).append(review.overall_score)

    reviewer_stats: Dict[str, Dict[str, float]] = {}
    for key, scores in reviewer_scores.items():
        if not scores:
            continue
        mean_score = sum(scores) / len(scores)
        min_score = min(scores)
        max_score = max(scores)
        reviewer_stats[key] = {
            "mean": mean_score,
            "min": min_score,
            "max": max_score,
            "range": max_score - min_score,
        }

    papers: Dict[str, Dict[str, object]] = {}
    review_rows: List[Dict[str, object]] = []

    for review in reviews:
        reviewer_key = reviewer_key_for(review)
        paper = papers.setdefault(
            review.submission,
            {
                "submission": review.submission,
                "title": review.title,
                "authors": review.authors,
                "reviews": [],
            },
        )

        review_obj = {
            "fileName": review.file_name,
            "reviewId": review.review_id,
            "pcMember": review.pc_member,
            "overallScore": review.overall_score,
            "confidenceScore": review.confidence_score,
            "overallText": review.overall_text,
            "confidentialText": review.confidential_text,
            "subreviewerName": review.subreviewer_name,
            "subreviewerEmail": review.subreviewer_email,
            "wordCount": review.word_count,
            "charCount": review.char_count,
            "sentenceCount": review.sentence_count,
            "uniqueWordRatio": review.unique_word_ratio,
            "reviewerKey": reviewer_key,
        }
        paper["reviews"].append(review_obj)

        review_rows.append(
            {
                "submission": review.submission,
                "title": review.title,
                "fileName": review.file_name,
                "overallScore": review.overall_score,
                "confidenceScore": review.confidence_score,
                "wordCount": review.word_count,
                "charCount": review.char_count,
                "sentenceCount": review.sentence_count,
                "uniqueWordRatio": review.unique_word_ratio,
                "pcMember": review.pc_member,
                "reviewerKey": reviewer_key,
                "reviewId": review.review_id,
                "hasConfidential": bool(review.confidential_text),
            }
        )

    paper_rows = []
    for paper in papers.values():
        rs = paper["reviews"]
        scores = [r["overallScore"] for r in rs if r["overallScore"] is not None]
        confs = [r["confidenceScore"] for r in rs if r["confidenceScore"] is not None]
        words = [r["wordCount"] for r in rs]

        avg_score = round(sum(scores) / len(scores), 3) if scores else None
        min_score = min(scores) if scores else None
        max_score = max(scores) if scores else None
        discrepancy = round((max_score - min_score), 3) if scores else None
        avg_conf = round(sum(confs) / len(confs), 3) if confs else None
        avg_words = round(sum(words) / len(words), 1) if words else 0

        weighted_score_total = 0.0
        weighted_score_denom = 0.0
        reviewer_adjusted_scores: List[float] = []

        for r in rs:
            score = r["overallScore"]
            if score is None:
                continue

            confidence = r["confidenceScore"]
            if confidence is None:
                confidence_weight = 1.0
            else:
                conf_clamped = min(max(float(confidence), 1.0), 5.0)
                # Confidence 1 -> 1.0x, confidence 5 -> 1.5x
                confidence_weight = 1.0 + (0.5 * (conf_clamped - 1.0) / 4.0)

            weighted_score_total += score * confidence_weight
            weighted_score_denom += confidence_weight

            reviewer_key = r.get("reviewerKey") or ""
            stats = reviewer_stats.get(reviewer_key)
            if stats:
                reviewer_range = stats["range"]
                if reviewer_range > 0:
                    reviewer_adjusted_scores.append((score - stats["mean"]) / reviewer_range)
                else:
                    reviewer_adjusted_scores.append(0.0)

        confidence_weighted_score = (
            round(weighted_score_total / weighted_score_denom, 3) if weighted_score_denom > 0 else None
        )
        reviewer_adjusted_score = (
            round(sum(reviewer_adjusted_scores) / len(reviewer_adjusted_scores), 3)
            if reviewer_adjusted_scores
            else None
        )

        paper_rows.append(
            {
                "submission": paper["submission"],
                "title": paper["title"],
                "authors": paper["authors"],
                "reviewCount": len(rs),
                "avgScore": avg_score,
                "minScore": min_score,
                "maxScore": max_score,
                "scoreDiscrepancy": discrepancy,
                "avgConfidence": avg_conf,
                "avgWordCount": avg_words,
                "confidenceWeightedScore": confidence_weighted_score,
                "reviewerAdjustedScore": reviewer_adjusted_score,
                "reviews": rs,
            }
        )

    return {
        "paperCount": len(paper_rows),
        "reviewCount": len(review_rows),
        "papers": paper_rows,
        "reviewRows": review_rows,
        "reviewerCount": len(reviewer_stats),
    }


def load_reviews_from_folder(folder: Path) -> Dict[str, object]:
    if not folder.exists() or not folder.is_dir():
        raise FileNotFoundError(f"Folder not found: {folder}")

    xml_files = sorted([p for p in folder.iterdir() if p.suffix.lower() == ".xml" and p.is_file()])
    if not xml_files:
        raise ReviewParseError(f"No XML files found in folder: {folder}")

    reviews: List[ReviewRecord] = []
    parse_errors = []

    for xml_file in xml_files:
        try:
            reviews.append(parse_review_xml(xml_file))
        except ReviewParseError as exc:
            parse_errors.append(str(exc))

    if not reviews:
        raise ReviewParseError("No valid review XML files could be parsed.")

    data = summarize_reviews(reviews)
    data["sourceFolder"] = str(folder)
    data["xmlFiles"] = len(xml_files)
    data["parsedFiles"] = len(reviews)
    data["parseErrors"] = parse_errors
    return data


class AppHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, static_dir: Path, default_data_dir: Optional[Path], **kwargs):
        self.static_dir = static_dir
        self.default_data_dir = default_data_dir
        super().__init__(*args, directory=str(static_dir), **kwargs)

    def send_json(self, payload: Dict[str, object], status: HTTPStatus = HTTPStatus.OK) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/reviews":
            query = urllib.parse.parse_qs(parsed.query)
            requested = query.get("dir", [""])[0].strip()
            folder = Path(requested) if requested else self.default_data_dir
            if folder is None:
                self.send_json(
                    {
                        "ok": False,
                        "error": "No review folder specified. Provide ?dir=/path/to/xml-folder or set --data-dir.",
                    },
                    status=HTTPStatus.BAD_REQUEST,
                )
                return
            if not folder.is_absolute():
                folder = Path.cwd() / folder
            folder = folder.resolve()

            try:
                data = load_reviews_from_folder(folder)
                self.send_json({"ok": True, "data": data})
            except Exception as exc:
                self.send_json(
                    {
                        "ok": False,
                        "error": str(exc),
                    },
                    status=HTTPStatus.BAD_REQUEST,
                )
            return

        return super().do_GET()


def main():
    parser = argparse.ArgumentParser(description="Review dashboard server")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8787)
    parser.add_argument(
        "--data-dir",
        default=None,
        help="Default directory containing review XML files (optional)",
    )
    parser.add_argument(
        "--static-dir",
        default="web",
        help="Directory containing frontend files",
    )
    args = parser.parse_args()

    static_dir = (Path.cwd() / args.static_dir).resolve()
    if not static_dir.exists():
        raise SystemExit(f"Static directory does not exist: {static_dir}")

    default_data_dir: Optional[Path] = None
    if args.data_dir:
        default_data_dir = Path(args.data_dir)
        if not default_data_dir.is_absolute():
            default_data_dir = (Path.cwd() / default_data_dir).resolve()

    def handler_factory(*h_args, **h_kwargs):
        return AppHandler(*h_args, static_dir=static_dir, default_data_dir=default_data_dir, **h_kwargs)

    server = ThreadingHTTPServer((args.host, args.port), handler_factory)
    print(f"Serving on http://{args.host}:{args.port}")
    print(f"Default data directory: {default_data_dir if default_data_dir else '(none)'}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
