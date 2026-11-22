#!/usr/bin/env python3
"""Send a lab's results.json to your local Groundwork server (standard library only)."""
import argparse
import json
import sys
import urllib.error
import urllib.request

COURSE = "gpus-from-first-principles"


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("results", help="results.json written by the lab")
    ap.add_argument("--server", default="http://127.0.0.1:8765")
    a = ap.parse_args()
    try:
        data = json.load(open(a.results))
    except (OSError, ValueError) as e:
        sys.exit(f"couldn't read {a.results}: {e}. Run `make run` first.")
    lab = data.get("lab")
    if not lab:
        sys.exit("results.json has no lab id")
    url = f"{a.server}/api/courses/{COURSE}/items/{lab}/lab"
    req = urllib.request.Request(url, data=json.dumps(data).encode(), headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            out = json.load(r)
    except urllib.error.HTTPError as e:
        sys.exit(f"Groundwork refused the results ({e.code}): {e.read().decode(errors='replace')}")
    except urllib.error.URLError as e:
        sys.exit(f"couldn't reach Groundwork at {a.server} ({e.reason}). Is `groundwork` running?")
    print(f"Lab {lab}: {'PASSED' if out.get('passed') else 'not passed yet'}")
    for t in out.get("targets", []):
        mark = "✓" if t["met"] else "✗"
        print(f"  {mark} {t['label']}: {t['value']} (target {t['op']} {t['target']})")
    for name, ok in (data.get("checks") or {}).items():
        if not ok:
            print(f"  ✗ check failed: {name}")


if __name__ == "__main__":
    main()
