#!/usr/bin/env python3
"""Generate crawlable GitHub Pages job pages from the Ponty feed."""

from __future__ import annotations

import argparse
import html
import json
import os
import re
import shutil
import sys
import unicodedata
import urllib.parse
import urllib.request
from datetime import date
from html.parser import HTMLParser
from pathlib import Path
from typing import Any

DEFAULT_FEED_URL = "https://priorekrytering.ponty-system.se/extapi/job?p=eyJ0IjogW119.d5b3329070ca38f38e501bab97bf3947f31a4e3e26cfc73f7802d12949dae4e2"
APPLY_BASE = "https://pnty-apply.ponty-system.se/priorekrytering"
PRIO_LOGO = "https://priorekrytering.se/assets/uploads/logo-utkast/prio-p-rund-03-tva-solida-farger.png"
MONTHS = ("", "januari", "februari", "mars", "april", "maj", "juni", "juli", "augusti", "september", "oktober", "november", "december")
ALLOWED_TAGS = {"a", "b", "blockquote", "br", "div", "em", "figcaption", "figure", "h2", "h3", "h4", "hr", "i", "img", "li", "ol", "p", "span", "strong", "table", "tbody", "td", "th", "thead", "tr", "ul"}
VOID_TAGS = {"br", "hr", "img"}
REMOVED_TAGS = {"iframe", "object", "script", "style", "svg"}


def safe_url(value: Any, schemes: tuple[str, ...] = ("https",)) -> str:
    if not value:
        return ""
    candidate = str(value).strip()
    parsed = urllib.parse.urlparse(candidate)
    scheme = parsed.scheme.lower()
    if scheme not in schemes:
        return ""
    if scheme in ("http", "https"):
        return candidate if parsed.netloc else ""
    return candidate if parsed.path else ""


def slugify(value: Any) -> str:
    normalized = unicodedata.normalize("NFD", str(value or "jobb"))
    ascii_value = "".join(character for character in normalized if unicodedata.category(character) != "Mn")
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_value.lower()).strip("-")
    return slug or "jobb"


class Sanitizer(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.output: list[str] = []
        self.removed_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        if self.removed_depth:
            if tag in REMOVED_TAGS:
                self.removed_depth += 1
            return
        if tag in REMOVED_TAGS:
            self.removed_depth = 1
            return
        if tag not in ALLOWED_TAGS:
            return
        attributes = dict(attrs)
        rendered_attributes = ""
        if tag == "a":
            href = safe_url(attributes.get("href"), ("https", "http", "mailto", "tel"))
            if href:
                rendered_attributes = f' href="{html.escape(href, quote=True)}" rel="noopener noreferrer"'
        elif tag == "img":
            src = safe_url(attributes.get("src"))
            if not src:
                return
            rendered_attributes = f' src="{html.escape(src, quote=True)}" alt="" loading="lazy" decoding="async"'
        self.output.append(f"<{tag}{rendered_attributes}>")

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.handle_starttag(tag, attrs)

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if self.removed_depth:
            if tag in REMOVED_TAGS:
                self.removed_depth -= 1
            return
        if tag in ALLOWED_TAGS and tag not in VOID_TAGS:
            self.output.append(f"</{tag}>")

    def handle_data(self, data: str) -> None:
        if not self.removed_depth:
            self.output.append(html.escape(data).replace("{", "&#123;").replace("}", "&#125;"))


class TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []

    def handle_data(self, data: str) -> None:
        self.parts.append(data)


def sanitize_html(value: Any) -> str:
    parser = Sanitizer()
    parser.feed(str(value or ""))
    parser.close()
    return "".join(parser.output).strip()


def plain_text(value: Any) -> str:
    parser = TextExtractor()
    parser.feed(str(value or ""))
    parser.close()
    text = re.sub(r"\s+", " ", " ".join(parser.parts)).strip()
    return re.sub(r"\s+([.,;:!?])", r"\1", text)


def shortened(value: str, limit: int = 220) -> str:
    if len(value) <= limit:
        return value
    return value[: limit - 1].rsplit(" ", 1)[0].rstrip(".,;:") + "…"


def formatted_date(value: str) -> str:
    if not value:
        return ""
    try:
        parsed = date.fromisoformat(value[:10])
    except ValueError:
        return ""
    return f"{parsed.day} {MONTHS[parsed.month]} {parsed.year}"


def yaml_string(value: Any) -> str:
    return json.dumps(str(value or ""), ensure_ascii=False)


def fetch_feed(url: str) -> list[dict[str, Any]]:
    request = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "Prio-Rekrytering-Pages/1.0"})
    with urllib.request.urlopen(request, timeout=30) as response:
        payload = json.load(response)
    jobs = payload.get("jobs") if isinstance(payload, dict) else None
    if not isinstance(jobs, list):
        raise ValueError("Ponty returned an unexpected response: jobs is not an array")
    return [job for job in jobs if isinstance(job, dict)]


def normalize_job(raw: dict[str, Any], showcase: bool = False) -> dict[str, Any]:
    job_id = re.sub(r"[^A-Za-z0-9_-]", "", str(raw.get("assignment_id") or raw.get("id") or ""))
    if not job_id:
        raise ValueError("Ponty job is missing assignment_id")
    title = str(raw.get("title") or "Ledig tjänst").strip()
    organization = str(raw.get("organization_name") or raw.get("organization") or "").strip()
    body_source = str(raw.get("body") or raw.get("description") or "")
    safe_body = sanitize_html(body_source)
    summary = str(raw.get("excerpt") or raw.get("meta_description") or "").strip()
    description = shortened(summary or plain_text(safe_body) or f"Läs mer om tjänsten {title} hos Prio Rekrytering.")
    supplied_logo = raw.get("image_url") if raw.get("logo") is not False else ""
    logo_url = PRIO_LOGO if organization.casefold() == "prio rekrytering ab" else safe_url(supplied_logo)
    publish_date = str(raw.get("publish_date") or raw.get("published_at") or "")[:10]
    apply_url = safe_url(raw.get("external_apply_url") or raw.get("apply_url")) or f"{APPLY_BASE}?id={urllib.parse.quote(job_id)}"
    slug = slugify(raw.get("title_slug") or raw.get("slug") or title)
    route_name = f"{slug}-{job_id}"
    phone = str(raw.get("phone") or raw.get("user_phone") or "").strip()
    return {
        "id": job_id,
        "title": title,
        "slug": slug,
        "route_name": route_name,
        "route": f"/lediga-jobb/{route_name}/",
        "description": description,
        "summary": summary,
        "body": safe_body or f"<p>{html.escape(description)}</p>",
        "organization": organization,
        "location": str(raw.get("location") or raw.get("region") or "").strip(),
        "publish_date": publish_date,
        "published_label": formatted_date(publish_date),
        "logo_url": logo_url,
        "apply_url": apply_url,
        "showcase": bool(raw.get("showcase")) or showcase,
        "contact_name": str(raw.get("name") or raw.get("user_name") or "").strip(),
        "contact_title": str(raw.get("user_title") or "").strip(),
        "contact_email": str(raw.get("email") or raw.get("user_email") or "").strip(),
        "contact_phone": phone,
        "contact_phone_href": re.sub(r"[^+0-9]", "", phone),
    }


def front_matter(job: dict[str, Any], status: str, target: str = "") -> str:
    fields = [
        "---",
        "layout: ponty-job",
        f"permalink: {yaml_string(job['route'])}",
        f"job_status: {yaml_string(status)}",
        f"title: {yaml_string(job['title'])}",
        f"description: {yaml_string(job['description'])}",
        f"summary: {yaml_string(job.get('summary'))}",
        f"job_id: {yaml_string(job['id'])}",
        f"organization: {yaml_string(job.get('organization'))}",
        f"location: {yaml_string(job.get('location'))}",
        f"publish_date: {yaml_string(job.get('publish_date'))}",
        f"published_label: {yaml_string(job.get('published_label'))}",
        f"logo_url: {yaml_string(job.get('logo_url'))}",
        f"apply_url: {yaml_string(job.get('apply_url'))}",
        f"showcase: {'true' if job.get('showcase') else 'false'}",
        f"contact_name: {yaml_string(job.get('contact_name'))}",
        f"contact_title: {yaml_string(job.get('contact_title'))}",
        f"contact_email: {yaml_string(job.get('contact_email'))}",
        f"contact_phone: {yaml_string(job.get('contact_phone'))}",
        f"contact_phone_href: {yaml_string(job.get('contact_phone_href'))}",
    ]
    if target:
        fields.append(f"target_permalink: {yaml_string(target)}")
    fields.extend(("---", ""))
    return "\n".join(fields)


def write_page(jobs_root: Path, job: dict[str, Any], status: str, body: str = "", target: str = "") -> None:
    page_dir = jobs_root / job["route_name"]
    page_dir.mkdir(parents=True, exist_ok=True)
    (page_dir / ".ponty-generated").write_text("generated\n", encoding="utf-8")
    (page_dir / "index.html").write_text(front_matter(job, status, target) + body + "\n", encoding="utf-8")


def load_previous(manifest_path: Path) -> dict[str, dict[str, Any]]:
    if not manifest_path.exists():
        return {}
    payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    return {str(job["id"]): job for job in payload.get("jobs", []) if isinstance(job, dict) and job.get("id")}


def clean_generated_pages(jobs_root: Path) -> None:
    if not jobs_root.exists():
        return
    for child in jobs_root.iterdir():
        if child.is_dir() and (child / ".ponty-generated").exists():
            shutil.rmtree(child)


def manifest_record(job: dict[str, Any], status: str, aliases: list[str]) -> dict[str, Any]:
    keys = ("id", "title", "slug", "route_name", "route", "description", "organization", "location", "publish_date")
    record = {key: job.get(key, "") for key in keys}
    record.update({"status": status, "aliases": aliases})
    return record


def generate(root: Path, current_jobs: list[dict[str, Any]]) -> int:
    manifest_path = root / "_data" / "ponty_jobs.json"
    jobs_root = root / "lediga-jobb"
    previous = load_previous(manifest_path)
    current = {job["id"]: job for job in current_jobs}
    clean_generated_pages(jobs_root)
    records: list[dict[str, Any]] = []

    for job_id, job in sorted(
        current.items(),
        key=lambda item: (item[1].get("publish_date", ""), item[0]),
        reverse=True,
    ):
        old = previous.get(job_id, {})
        aliases = [str(alias) for alias in old.get("aliases", []) if alias]
        old_route_name = str(old.get("route_name") or "")
        if old_route_name and old_route_name != job["route_name"]:
            aliases.append(old_route_name)
        aliases = sorted(set(alias for alias in aliases if alias != job["route_name"]))
        write_page(jobs_root, job, "active", job["body"])
        for alias in aliases:
            alias_job = {**job, "route_name": alias, "route": f"/lediga-jobb/{alias}/"}
            write_page(jobs_root, alias_job, "redirect", target=job["route"])
        records.append(manifest_record(job, "active", aliases))

    for job_id, old in previous.items():
        if job_id in current:
            continue
        retired = {
            **old,
            "summary": "",
            "published_label": formatted_date(str(old.get("publish_date") or "")),
            "logo_url": "",
            "apply_url": "",
            "showcase": False,
            "contact_name": "",
            "contact_title": "",
            "contact_email": "",
            "contact_phone": "",
            "contact_phone_href": "",
        }
        aliases = [str(alias) for alias in old.get("aliases", []) if alias]
        write_page(jobs_root, retired, "closed")
        for alias in aliases:
            alias_job = {**retired, "route_name": alias, "route": f"/lediga-jobb/{alias}/"}
            write_page(jobs_root, alias_job, "redirect", target=retired["route"])
        records.append(manifest_record(retired, "closed", sorted(set(aliases))))

    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest = {"generated_from": "Ponty", "jobs": records}
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return sum(1 for record in records if record["status"] == "active")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--feed-file", type=Path, help="Use a local JSON response and skip network requests")
    args = parser.parse_args()

    if args.feed_file:
        payload = json.loads(args.feed_file.read_text(encoding="utf-8"))
        raw_jobs = payload.get("jobs")
        if not isinstance(raw_jobs, list):
            raise ValueError("Fixture jobs is not an array")
        normalized = [normalize_job(job) for job in raw_jobs]
    else:
        feed_url = os.environ.get("PONTY_FEED_URL", DEFAULT_FEED_URL)
        normal_jobs = fetch_feed(feed_url)
        showcase_jobs = fetch_feed(f"{feed_url}&showcase=1")
        normalized_by_id: dict[str, dict[str, Any]] = {}
        for raw in normal_jobs:
            job = normalize_job(raw)
            normalized_by_id[job["id"]] = job
        for raw in showcase_jobs:
            job = normalize_job(raw, showcase=True)
            normalized_by_id.setdefault(job["id"], job)
        normalized = list(normalized_by_id.values())

    count = generate(args.root.resolve(), normalized)
    print(f"Generated {count} active Ponty job page(s).")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, json.JSONDecodeError) as error:
        print(f"Ponty job generation failed: {error}", file=sys.stderr)
        raise SystemExit(1)
