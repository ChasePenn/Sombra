import java.util.List;
import java.util.Set;

public final class HeatPlan {

    public enum Intensity { EASY, MODERATE, HARD }

    public enum Level { OK, CAUTION, DANGER }

    public record Advice(int work, int rest, double waterQuarts) {
        public boolean noLimit() { return work < 0; }
    }

    public record Category(int number, String label, double minF, Advice easy, Advice moderate, Advice hard) {
        Advice forIntensity(Intensity intensity) {
            return switch (intensity) {
                case EASY -> easy;
                case MODERATE -> moderate;
                case HARD -> hard;
            };
        }
    }

    public record Hour(String time, double wbgtF, int category, String label, Advice advice) {}

    private static final int NO_LIMIT = -1;
    private static final double MAX_QUARTS_PER_HOUR = 1.5;
    private static final double MAX_QUARTS_PER_DAY = 12;
    private static final Set<String> DANGER_SYMPTOMS = Set.of("hot_dry", "confused", "fainted");

    private static final List<Category> TABLE = List.of(
        new Category(0, "Low risk", Double.NEGATIVE_INFINITY, new Advice(NO_LIMIT, 0, 0.5), new Advice(NO_LIMIT, 0, 0.5), new Advice(NO_LIMIT, 0, 0.75)),
        new Category(1, "Caution", 78, new Advice(NO_LIMIT, 0, 0.5), new Advice(NO_LIMIT, 0, 0.75), new Advice(40, 20, 0.75)),
        new Category(2, "Elevated", 82, new Advice(NO_LIMIT, 0, 0.5), new Advice(50, 10, 0.75), new Advice(30, 30, 1)),
        new Category(3, "High", 85, new Advice(NO_LIMIT, 0, 0.75), new Advice(40, 20, 0.75), new Advice(30, 30, 1)),
        new Category(4, "Very high", 88, new Advice(NO_LIMIT, 0, 0.75), new Advice(30, 30, 0.75), new Advice(20, 40, 1)),
        new Category(5, "Extreme", 90, new Advice(50, 10, 1), new Advice(20, 40, 1), new Advice(10, 50, 1))
    );

    private HeatPlan() {}

    public static Category categoryFor(double wbgtF) {
        Category selected = TABLE.get(0);
        for (Category category : TABLE) {
            if (wbgtF >= category.minF()) selected = category;
        }
        return selected;
    }

    public static List<Hour> schedule(List<String> times, List<Double> wbgtF, Intensity intensity, boolean extraCaution) {
        double remaining = MAX_QUARTS_PER_DAY;
        List<Hour> hours = new java.util.ArrayList<>();
        for (int i = 0; i < times.size(); i++) {
            int base = categoryFor(wbgtF.get(i)).number();
            Category category = TABLE.get(Math.min(base + (extraCaution ? 1 : 0), TABLE.size() - 1));
            Advice advice = category.forIntensity(intensity);
            double water = Math.min(Math.min(advice.waterQuarts(), MAX_QUARTS_PER_HOUR), remaining);
            remaining = Math.max(0, remaining - water);
            hours.add(new Hour(times.get(i), wbgtF.get(i), category.number(), category.label(),
                new Advice(advice.work(), advice.rest(), water)));
        }
        return hours;
    }

    public static Level evaluateSafety(Set<String> symptoms, double hoursOut, double cupsLogged, double cupsRecommended) {
        if (symptoms.stream().anyMatch(DANGER_SYMPTOMS::contains)) return Level.DANGER;
        if (!symptoms.isEmpty()) return Level.CAUTION;
        if (hoursOut >= 1 && cupsRecommended > 0 && cupsLogged < cupsRecommended * 0.5) return Level.CAUTION;
        return Level.OK;
    }

    private static int failures = 0;

    private static void expect(boolean condition, String name) {
        System.out.println((condition ? "ok   " : "FAIL ") + name);
        if (!condition) failures++;
    }

    public static void main(String[] args) {
        expect(categoryFor(77).number() == 0, "77 F is low risk");
        expect(categoryFor(78).number() == 1, "78 F starts caution");
        expect(categoryFor(86).number() == 3, "86 F is high");
        expect(categoryFor(95).number() == 5, "95 F is extreme");

        List<Hour> plan = schedule(List.of("13:00", "14:00"), List.of(86.0, 91.0), Intensity.HARD, false);
        expect(plan.get(0).advice().work() == 30 && plan.get(0).advice().rest() == 30, "hard work at 86 F is 30 on, 30 off");
        expect(plan.get(1).advice().work() == 10, "hard work at 91 F is 10 minutes an hour");

        List<Hour> careful = schedule(List.of("13:00"), List.of(86.0), Intensity.HARD, true);
        expect(careful.get(0).category() == 4, "extra caution moves one category up");

        List<String> longDay = java.util.Collections.nCopies(14, "12:00");
        List<Hour> capped = schedule(longDay, java.util.Collections.nCopies(14, 92.0), Intensity.HARD, false);
        double total = capped.stream().mapToDouble(h -> h.advice().waterQuarts()).sum();
        expect(Math.abs(total - MAX_QUARTS_PER_DAY) < 1e-9, "water stops at 12 quarts a day");

        expect(evaluateSafety(Set.of("confused"), 1, 4, 4) == Level.DANGER, "confusion is an emergency");
        expect(evaluateSafety(Set.of("dizzy"), 1, 4, 4) == Level.CAUTION, "dizziness needs caution");
        expect(evaluateSafety(Set.of(), 2, 2, 8) == Level.CAUTION, "too little water needs caution");
        expect(evaluateSafety(Set.of(), 2, 6, 8) == Level.OK, "enough water is ok");

        System.out.println(failures == 0 ? "All checks passed." : failures + " check(s) failed.");
        if (failures > 0) System.exit(1);
    }
}
