#!/usr/bin/env python3
"""Read Meta's sheet and submit new leads to Ponty's Spontanansökan."""

import argparse
import json
import os
from pathlib import Path
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid


ROOT = Path(__file__).resolve().parents[1]


def request_json(url, data=None, headers=None):
    request = urllib.request.Request(url, data=data, headers=headers or {})
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        # Responses may contain applicant details: never print the body.
        raise RuntimeError(f"Request failed (HTTP {error.code})") from None
    except (urllib.error.URLError, TimeoutError, ValueError):
        raise RuntimeError("Request failed or returned invalid JSON") from None


def read_leads(url, token):
    result = request_json(
        url,
        json.dumps({"token": token}).encode(),
        {"Content-Type": "application/json"},
    )
    if not isinstance(result, dict) or result.get("ok") is not True:
        raise RuntimeError("Sheet endpoint refused the request")
    rows = result.get("rows")
    if not isinstance(rows, list) or not rows:
        raise RuntimeError("Sheet returned no header row")
    headers = [str(value).strip() for value in rows[0]]
    required = {"id", "email", "full_name", "phone_number"}
    if not required.issubset(headers) or len(headers) != len(set(headers)):
        raise RuntimeError("Sheet has missing or duplicate column headers")
    return [dict(zip(headers, row)) for row in rows[1:] if any(row)]


def application_payload(lead):
    email = str(lead.get("email", "")).strip()
    name = str(lead.get("full_name", "")).strip().split(maxsplit=1)
    if not email or "@" not in email or not name:
        raise ValueError("Missing name or invalid email")
    phone = str(lead.get("phone_number", "")).strip().removeprefix("p:")
    payload = {
        "assignment_id": 1,
        "email": email,
        "firstname": name[0],
        "lastname": name[1] if len(name) > 1 else "",
        "phone": phone,
        "referer": "meta-" + str(lead.get("platform", "unknown")).strip(),
    }
    extra = []
    for field, label in [("ad_name", "Annons"), ("job_title", "Angiven yrkestitel")]:
        value = str(lead.get(field) or "").strip()
        if value:
            extra.append(f"{label}: {value}")
    if extra:
        payload["extra"] = "\n".join(extra)
    return payload


def access_token(client_id, client_secret):
    result = request_json(
        "https://ponty-system.se/oauth2/token",
        urllib.parse.urlencode({
            "grant_type": "client_credentials",
            "client_id": client_id,
            "client_secret": client_secret,
            "scope": "applications:write recruitment:write",
        }).encode(),
        {"Content-Type": "application/x-www-form-urlencoded"},
    )
    token = result.get("access_token") if isinstance(result, dict) else None
    if not token:
        raise RuntimeError("Ponty did not return an access token")
    return token


def create_application(payload, token):
    boundary = "prio" + uuid.uuid4().hex
    body = (
        f"--{boundary}\r\n"
        'Content-Disposition: form-data; name="payload"\r\n'
        "Content-Type: application/json\r\n\r\n"
        + json.dumps(payload, ensure_ascii=False)
        + f"\r\n--{boundary}--\r\n"
    ).encode()
    result = request_json(
        "https://openapi.ponty-system.se/v2/applications",
        body,
        {
            "Authorization": f"Bearer {token}",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        },
    )
    data = result.get("data") if isinstance(result, dict) else None
    application_id = data.get("application_id") if isinstance(data, dict) else None
    if type(application_id) is not int or application_id <= 0:
        raise RuntimeError("Ponty did not return an application ID")
    return application_id


def import_leads(leads, state, state_path, submit=None, limit=0):
    pending = []
    seen = set(state)
    skipped = invalid = 0
    for lead in leads:
        lead_id = str(lead.get("id", "")).strip()
        if not lead_id:
            invalid += 1
            continue
        if lead_id in seen:
            skipped += 1
            continue
        seen.add(lead_id)
        try:
            payload = application_payload(lead)
        except ValueError:
            invalid += 1
            continue
        pending.append((lead_id, payload))
    selected = pending[:limit] if limit else pending
    print(f"Rows: {len(leads)}; already recorded/repeated: {skipped}; "
          f"invalid: {invalid}; pending: {len(pending)}; selected: {len(selected)}")
    if submit is None:
        print("Dry run: no Ponty applications or tracking changes made.")
        return invalid
    for lead_id, payload in selected:
        state[lead_id] = submit(payload)
        state_path.write_text(json.dumps(state, indent=2, sort_keys=True) + "\n")
    print(f"Imported: {len(selected)}")
    return invalid


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Actually submit applications")
    parser.add_argument("--limit", type=int, default=0, help="Maximum imports; 0 means all")
    args = parser.parse_args()
    if args.limit < 0:
        parser.error("--limit must be non-negative")
    required = ["AD_SHEET_URL", "AD_SHEET_TOKEN"]
    if args.apply:
        required += ["PONTY_AD_SYNC_CLIENT_ID", "PONTY_AD_SYNC_CLIENT_SECRET"]
    if any(not os.environ.get(key) for key in required):
        raise RuntimeError("Required environment variables are missing")
    state_path = ROOT / "_data/ad-sync.json"
    state = json.loads(state_path.read_text())
    if not isinstance(state, dict) or any(
        not isinstance(k, str) or type(v) is not int or v <= 0
        for k, v in state.items()
    ):
        raise RuntimeError("Invalid ad-sync.json mapping")
    leads = read_leads(os.environ["AD_SHEET_URL"], os.environ["AD_SHEET_TOKEN"])
    submit = None
    if args.apply:
        token = access_token(os.environ["PONTY_AD_SYNC_CLIENT_ID"],
                             os.environ["PONTY_AD_SYNC_CLIENT_SECRET"])
        submit = lambda payload: create_application(payload, token)
    invalid = import_leads(leads, state, state_path, submit, args.limit)
    return 1 if invalid else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:
        # Only our controlled messages are safe for public Actions logs.
        message = str(error) if isinstance(error, RuntimeError) else type(error).__name__
        print(f"Import stopped: {message}", file=sys.stderr)
        sys.exit(1)
