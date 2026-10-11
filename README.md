# sombra

**Heat safety for every crew, team and family.**

Every summer, people in Phoenix get sick or die from heat because nobody knew how dangerous a specific place was at a specific hour. A weather app says "108°F." It doesn't tell a roofer on a black roof to rest 40 minutes of every hour by 2 PM.

sombra turns the forecast for your exact spot into an hour-by-hour plan: when to work, how long to rest in the shade, how much water to drink, and when to stop. It then checks in on everyone through the day.

## What it does

- **Real heat stress, not just temperature.** Calculates outdoor wet-bulb globe temperature (WBGT) hour by hour with the Liljegren model, the method behind OSHA's outdoor WBGT calculator.
- **Hour-by-hour work and rest plan** from the U.S. Army TB MED 507 work/rest and water table, color-coded from Low to Extreme.
- **Site check.** Take a photo and an on-device model recognizes the surface (dark roof, asphalt, grass…) and shade, then adjusts the plan. Photos never leave the phone. You can also pick the surface yourself.
- **Check-ins.** Quick symptom check-ins with fixed safety rules: signs of heat stroke always open first-aid steps and a Call 911 button. Non-emergency messages are personalized with the worker's real numbers.
- **Three modes:** Work crew, School & sports, and Everyday outdoors, with wording, activity examples and rules for each.
- **English and Spanish.** Works without an account; sign in to sync your plans and group across devices.

## Project layout

| Path | What's there |
| --- | --- |
| `artifacts/sombra` | The web app (React shell + planner page, configs for modes, schedule and site factors) |
| `artifacts/api-server` | Express API: weather + WBGT, check-ins, account data |
| `lib/heat-safety` | Shared safety rules, check-in templates and first-aid content |
| `lib/db` | PostgreSQL schema (Drizzle) |
| `lib/api-spec`, `lib/api-zod`, `lib/api-client-react` | OpenAPI contract and generated types |

## Run it

Requires Node.js 24 and pnpm.

```bash
pnpm install
pnpm --filter @workspace/api-server run dev      # API (needs DATABASE_URL)
PORT=25823 BASE_PATH=/ pnpm --filter @workspace/sombra run dev
```

Environment: `DATABASE_URL`, `GEMINI_API_KEY`, `GEMINI_MODEL`. Keys stay on the server and are never sent to the browser.

Tests: `pnpm --filter @workspace/sombra test`, `pnpm --filter @workspace/heat-safety test`.

## Sources

- Weather: [Open-Meteo](https://open-meteo.com/)
- WBGT: Liljegren et al. (2008), as used by the [OSHA outdoor WBGT calculator](https://osha.prod.pace.dol.gov/heat-exposure/wbgt-calculator)
- Work/rest and water: U.S. Army TB MED 507
- Heat illness first aid: OSHA and CDC heat illness guidance
- On-device image model: Transformers.js with CLIP
- Fonts: Rubik; Atkinson Hyperlegible (Braille Institute, designed for legibility)

sombra supports, but does not replace, an employer's heat safety plan or medical care. In an emergency, call 911.

## License

MIT
