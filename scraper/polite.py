"""Shared manners for every scraper in this folder.

- One honest User-Agent that says what we are (no pretending to be a browser).
- A robots.txt check before fetching: a page a site asks automated tools to stay off is skipped,
  not fetched. (Wildcards `*` and `$` in robots rules are understood.)
- An optional CONTACT, set with the SCRAPER_CONTACT environment variable, is added to the
  User-Agent so a site owner can reach whoever runs this.

Use polite.urlopen(...) instead of urllib.request.urlopen(...), and polite.allowed(url) before
sending a headless browser to a page.
"""

import os
import re
import urllib.error
import urllib.parse
import urllib.request

_CONTACT = os.environ.get("SCRAPER_CONTACT", "").strip()
USER_AGENT = "GridlineRecruitingHub/1.0 (internal football recruiting tool; low-volume" + (f"; contact: {_CONTACT}" if _CONTACT else "") + ")"
_TOKEN = "gridlinerecruitinghub"

_robots_cache = {}  # origin -> list of (allow?, pattern) for our group, or None = no restrictions


class RobotsDisallowed(urllib.error.URLError):
    """The site's robots.txt asks automated tools not to fetch this URL."""

    def __init__(self, url):
        super().__init__(f"robots.txt disallows {url}")


def _parse(text):
    groups, agents, rules, in_rules = [], [], [], False
    for raw in text.splitlines():
        line = raw.split("#", 1)[0].strip()
        if ":" not in line:
            continue
        key, value = (x.strip() for x in line.split(":", 1))
        key = key.lower()
        if key == "user-agent":
            if in_rules:
                groups.append((agents, rules))
                agents, rules, in_rules = [], [], False
            agents.append(value.lower())
        elif key in ("allow", "disallow"):
            in_rules = True
            if value or key == "allow":
                rules.append((key == "allow", value))
    groups.append((agents, rules))
    ours = [r for a, r in groups if any(_TOKEN in x for x in a)]
    star = [r for a, r in groups if "*" in a]
    chosen = ours or star
    return [rule for r in chosen for rule in r]


def _matches(pattern, path):
    if not pattern:
        return False
    regex = re.escape(pattern).replace(r"\*", ".*")
    if regex.endswith(r"\$"):
        regex = regex[:-2] + "$"
    return re.match(regex, path) is not None


def _rules_for(origin):
    if origin in _robots_cache:
        return _robots_cache[origin]
    rules = None
    try:
        req = urllib.request.Request(origin + "/robots.txt", headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=20) as resp:
            body = resp.read(500_000).decode("utf-8", "replace")
        if "<html" not in body[:200].lower():
            rules = _parse(body)
    except Exception:  # no robots.txt (404/403), or unreachable: no restrictions published
        rules = None
    _robots_cache[origin] = rules
    return rules


def allowed(url):
    p = urllib.parse.urlsplit(url)
    if p.scheme not in ("http", "https") or not p.netloc:
        return True
    rules = _rules_for(f"{p.scheme}://{p.netloc}")
    if not rules:
        return True
    path = p.path or "/"
    if p.query:
        path += "?" + p.query
    best = None  # the longest matching rule wins; Allow wins a tie
    for allow, pattern in rules:
        if _matches(pattern, path):
            key = (len(pattern), allow)
            if best is None or key > best[0]:
                best = (key, allow)
    return True if best is None else best[1]


def urlopen(req, timeout=30):
    url = req.full_url if isinstance(req, urllib.request.Request) else req
    if not allowed(url):
        raise RobotsDisallowed(url)
    return urllib.request.urlopen(req, timeout=timeout)
