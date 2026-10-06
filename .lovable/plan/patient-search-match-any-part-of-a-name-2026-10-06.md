# Patient search: match any part of a name

## What's happening now
The Patients search only looks at **last name**. That's why "Bartos" finds Sheryl but "Sheryl" and "Gaines" don't.

## What will change
- Typing any part of a name finds the patient: first name, middle name or last name.
- Typing more than one word narrows the results. "Sheryl Bartos" and "Gaines Bartos" both find her, and every word you type must match part of the person's name.
- Partial words work too. "Sher" finds Sheryl, as long as the search tool behind the scenes accepts it.
- Nothing else on the page changes.

## One limitation to confirm while building
I'll test Sheryl's record before finishing:
- "Gaines" may be saved as her middle name, and the search tool behind the scenes may not support searching by middle name.
- If it doesn't, "Gaines" on its own may still not find her, but "Sheryl" or "Bartos" with "Gaines" will.
- I'll tell you exactly which searches work.

## Technical details
- `useElationPatients` in `src/hooks/useElation.ts`: for each typed word, run Elation `patients` queries in parallel with `first_name`, `last_name` and (if supported) `middle_name`. Merge the results and remove duplicates by id.
- On the screen, keep only patients whose full name (first, middle and last) contains every typed word, ignoring capitals.
- Keep the 250ms pause before searching. Cap at 3 words so a long search doesn't send too many requests.
- Verify with Sheryl's search (Sheryl / Gaines / Bartos / "Sheryl Bartos") through the live Elation function before calling it done.
