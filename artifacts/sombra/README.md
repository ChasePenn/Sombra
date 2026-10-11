# Sombra

Sombra is a practical shift planner for outdoor crews in Phoenix. Its hourly forecast helps workers and their families review the conditions for a planned shift.

## Typography

The app uses Atkinson Hyperlegible for body text and forecast numbers. It was designed by the Braille Institute to improve legibility, including for readers with low vision or dyslexia. Rubik is used for headings.

## Scope

This interface presents forecast data for the selected shift. It does not replace an employer's heat safety plan or medical care. In an emergency, call 911.

## Audience modes

Audience-specific interface copy, task-intensity labels and examples, validation and location messages, result copy, and check-in questions live in `config/modes/<mode>.json`. The app loads the mode named by the `mode` query parameter; it defaults to `workers`. Once a mode config is added, open it with `?mode=<mode>` without changing the planner or schedule logic.

Each locale in a mode config defines the same intensity IDs used by the schedule table (`easy`, `moderate`, and `hard`). Keep those IDs stable while changing their audience-specific labels and examples. `checkIn.questions` supplies localized symptom labels with stable IDs; those IDs are shared with the fixed safety evaluator. App-shell and About wording also live in the mode config. New modes also supply bilingual entries in `lib/heat-safety/config/checkin_templates.json`; mode selection does not require audience-specific logic branches.

## Accounts and privacy

Accounts are optional. Guests save their profile, crew, plans, check-ins, recorded work, breaks, and water in this browser; verified accounts use user-scoped PostgreSQL routes. Offline account activity is saved in an account-scoped device outbox, visibly marked as waiting to sync, and replayed only after verifying the server identity. Check-in IDs make retries idempotent. Guest import includes activity and detailed check-in history. Site photos are analyzed on-device and are never sent to the account API or stored.

## Check-in safety and personalization

The browser and server use the same deterministic safety rules in `lib/heat-safety/lib/safety.js`. Very tired/weak is CAUTION, not DANGER. Hot/dry skin or stopped sweating, confusion/slurred speech, and fainting/seizures are DANGER. Emergency guidance is immediate and never calls the AI model. First aid and source links are configured in `lib/heat-safety/config/first_aid.json`.

Work time starts only when a worker selects **Start work**, excludes recorded breaks, and stops on **Finish work**. Water is logged only by **Add a cup** (one 8-ounce cup); recommended intake is integrated from the solar-adjusted schedule over elapsed session time, never future hours. Missing schedule data is explicitly marked unavailable.

Non-emergency personalization uses the official `@google/genai` SDK on the server, `GEMINI_API_KEY` in Secrets, and the configured `GEMINI_MODEL` environment setting. The browser never receives the key. Names, recorded activity, risk words, site type, today's answers, and optional notes are sent to Gemini for this purpose; notes and model messages are not written to application logs. Validated structured output cannot change the safety level. There is one model request per user/guest session per 5 seconds, a 5-second timeout, and bilingual offline/error templates. CAUTION follow-ups are at most 30 minutes.

Reminders appear while Sombra is open, with overdue follow-ups checked when it regains focus. They are not background phone notifications. Optional dictation uses the browser's Web Speech API, which may rely on an online speech service.
