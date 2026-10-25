#include <algorithm>
#include <cmath>
#include <iostream>
#include <optional>
#include <string>
#include <vector>

struct Place {
    std::string name;
    std::string kind;
    double distanceM;
    std::optional<bool> open;
};

struct Pick {
    Place best;
    bool hoursUnknown;
};

static const std::vector<std::string> kIndoor = {"library", "community", "mall", "cooling", "respite"};
static constexpr double kMaxIndoorM = 3200;

bool isIndoor(const std::string& kind) {
    return std::find(kIndoor.begin(), kIndoor.end(), kind) != kIndoor.end();
}

int walkMinutes(double meters) {
    return std::max(1, static_cast<int>(std::lround(meters * 1.3 / 80)));
}

double weight(const Place& p) {
    if (p.kind == "cooling") return p.distanceM * 0.8;
    if (p.kind == "respite") return p.distanceM * 1.3;
    return p.distanceM;
}

std::optional<Pick> pickCoolDown(const std::vector<Place>& places) {
    std::vector<Place> indoorOpen, indoorMaybe, outdoor;
    for (const auto& p : places) {
        if (p.open.has_value() && !*p.open) continue;
        if (isIndoor(p.kind) && p.distanceM <= kMaxIndoorM) {
            (p.open.has_value() ? indoorOpen : indoorMaybe).push_back(p);
        } else if (!isIndoor(p.kind)) {
            outdoor.push_back(p);
        }
    }
    auto byWeight = [](const Place& a, const Place& b) { return weight(a) < weight(b); };
    auto byDistance = [](const Place& a, const Place& b) { return a.distanceM < b.distanceM; };
    std::sort(indoorOpen.begin(), indoorOpen.end(), byWeight);
    std::sort(indoorMaybe.begin(), indoorMaybe.end(), byDistance);
    std::sort(outdoor.begin(), outdoor.end(), byDistance);
    if (!indoorOpen.empty()) return Pick{indoorOpen.front(), false};
    if (!indoorMaybe.empty()) return Pick{indoorMaybe.front(), true};
    if (!outdoor.empty()) return Pick{outdoor.front(), false};
    return std::nullopt;
}

static int failures = 0;

void expect(bool condition, const std::string& name) {
    std::cout << (condition ? "ok   " : "FAIL ") << name << "\n";
    if (!condition) failures++;
}

int main() {
    expect(walkMinutes(800) == 13, "800 m is about a 13 minute walk");
    expect(walkMinutes(10) == 1, "a short walk is at least 1 minute");

    std::vector<Place> nearby = {
        {"Burton Barr Library", "library", 1000, true},
        {"Senior Center", "cooling", 1200, true},
        {"Fountain", "water", 150, std::nullopt},
    };
    auto pick = pickCoolDown(nearby);
    expect(pick && pick->best.name == "Senior Center", "a cooling center wins a close call");

    nearby[1].distanceM = 1400;
    pick = pickCoolDown(nearby);
    expect(pick && pick->best.name == "Burton Barr Library", "a much closer library still wins");

    std::vector<Place> closed = {
        {"Mall", "mall", 900, false},
        {"Rec Center", "community", 2000, std::nullopt},
        {"Shade Ramada", "shade", 300, std::nullopt},
    };
    pick = pickCoolDown(closed);
    expect(pick && pick->best.name == "Rec Center" && pick->hoursUnknown, "unknown hours beat outdoor shade");

    std::vector<Place> far = {
        {"Far Library", "library", 5000, true},
        {"Shade Ramada", "shade", 300, std::nullopt},
    };
    pick = pickCoolDown(far);
    expect(pick && pick->best.name == "Shade Ramada", "too far to walk falls back to shade");

    std::cout << (failures == 0 ? "All checks passed." : std::to_string(failures) + " check(s) failed.") << "\n";
    return failures == 0 ? 0 : 1;
}
