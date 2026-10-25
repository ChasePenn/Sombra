import json
import re
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "artifacts" / "api-server" / "src" / "data"
CONFIG = ROOT / "artifacts" / "sombra" / "config"

RELIEF_TYPES = {"Cooling Center", "Hydration Station", "Respite Center"}
DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
TIME = re.compile(r"^(1[0-2]|[1-9]):([0-5]\d) (AM|PM)$")
ARIZONA = (31.3, -114.9, 37.0, -109.0)


def minutes(text):
    match = TIME.match(text.strip())
    if not match:
        return None
    hour, minute, half = int(match.group(1)), int(match.group(2)), match.group(3)
    hour = hour % 12 + (12 if half == "PM" else 0)
    return hour * 60 + minute


def inside(lat, lon, box):
    south, west, north, east = box
    return south <= lat <= north and west <= lon <= east


def check_relief(problems):
    sites = json.loads((DATA / "heat-relief.json").read_text())["features"]
    for site in sites:
        a, g = site["attributes"], site.get("geometry") or {}
        name = (a.get("Location") or "").strip() or f"site {a.get('OBJECTID')}"
        if a.get("HeatRelief_Type") not in RELIEF_TYPES:
            problems.append(f"{name}: unknown type {a.get('HeatRelief_Type')!r}")
        if not inside(g.get("y", 0), g.get("x", 0), ARIZONA):
            problems.append(f"{name}: location is outside Arizona")
        start, end = a.get("Start_Date"), a.get("End_Date")
        if start and end and date.fromisoformat(start) > date.fromisoformat(end):
            problems.append(f"{name}: season ends before it starts")
        for day in DAYS:
            opens, closes = a.get(f"{day}Open"), a.get(f"{day}Close")
            if not opens and not closes:
                continue
            o, c = minutes(opens or ""), minutes(closes or "")
            if o is None or c is None:
                problems.append(f"{name}: unreadable {day} hours {opens!r} to {closes!r}")
            elif c <= o and c != 0:
                problems.append(f"{name}: closes before it opens on {day}")
    return len(sites)


def check_places(problems):
    data = json.loads((DATA / "places.json").read_text())
    boxes = [region["box"] for region in data["regions"]]
    kinds = data["kinds"]
    for row in data["places"]:
        place = dict(zip(data["fields"], row))
        if not 0 <= place["kind"] < len(kinds):
            problems.append(f"place {place['id']}: unknown kind {place['kind']}")
        if not any(inside(place["lat"], place["lon"], box) for box in boxes):
            problems.append(f"place {place['id']}: outside every region")
    return len(data["places"])


def check_table(problems):
    table = json.loads((CONFIG / "work_rest_table.json").read_text())
    rows = sorted(table["categories"], key=lambda row: row["category"])
    for before, after in zip(rows, rows[1:]):
        if round(before["max_f"] + 0.1, 1) != after["min_f"]:
            problems.append(f"gap between category {before['category']} and {after['category']}")
    for row in rows:
        for level in ("easy", "moderate", "hard"):
            plan = row[level]
            if plan["work"] != "NL" and plan["work"] + plan["rest"] != 60:
                problems.append(f"category {row['category']} {level}: work and rest do not add to 60")
            if plan["water_qt"] > table["max_water_qt_per_hour"]:
                problems.append(f"category {row['category']} {level}: water above the hourly limit")
    albedo = json.loads((CONFIG / "site_adjustments.json").read_text())["albedo"]
    for surface, value in albedo.items():
        if not 0 <= value <= 1:
            problems.append(f"albedo for {surface} must be between 0 and 1")
    return len(rows)


def main():
    problems = []
    sites = check_relief(problems)
    places = check_places(problems)
    categories = check_table(problems)
    print(f"Checked {sites} relief sites, {places} places and {categories} heat categories.")
    for problem in problems:
        print(f"  - {problem}")
    if problems:
        print(f"{len(problems)} problem(s) found.")
        return 1
    print("Everything looks good.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
