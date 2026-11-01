# Demo video script (about 2:45)

**One-line pitch:** *Receipts turns "is this serum working?" into a real experiment on your own face, and gives a statistically honest answer, including "not enough data yet".*

## Before recording

- [ ] `npm run seed:demo` (two synthetic 21-day histories: one finished, one interim). Add `-- --live-agents` if `ANTHROPIC_API_KEY` is set, so the reasoning logs show real Claude turns.
- [ ] `ANTHROPIC_API_KEY` set so the live trial you create on camera uses the real agents (the "Mock agents" badge disappears).
- [ ] Decide on YouCam: keep `MOCK_YOUCAM=1` (0 units, the "Mock" badge is visible), or set `MOCK_YOUCAM=0` for **one** real capture on camera (9 units).
- [ ] Browser at a phone-sized width (390 px) for the capture scene and desktop width for the dashboard. Close the Next.js dev badge (or record a `next build && next start` run).
- [ ] Good, even, frontal light for the live capture scene. Have a lamp you can switch off to show a rejection.

## Shot list

| Time | Screen | Narration |
|---|---|---|
| 0:00–0:12 | Home page | "Skincare is sold on claims like *'reduces redness in 4 weeks'*. Most of us judge them by vibes in the mirror. Receipts runs an actual experiment, on you." |
| 0:12–0:40 | **New trial** → fill *Azelaic Acid 10% Serum*, claim chip "Reduces redness in 4 weeks", Leave-on, half-face **Yes** → *Design my trial* | "The Protocol Agent designs the trial. Open its reasoning: it looked up what YouCam can measure, estimated the YouCam cost (9 units a day), and since this is a topical serum it chose **split-face**: product on one side, the other side is the control. The side is randomized by the server, not picked by the model." *(Expand "how it reasoned"; point at `assign_treated_side` and `estimate_trial_cost`.)* |
| 0:40–0:52 | Protocol card → **Lock protocol & start** | "It also sets the smallest change worth paying for, in mask-intensity points. Locking pre-registers the plan: it's hashed before day one, so the goalposts can't move later." |
| 0:52–1:20 | **Take today's photo** (phone width). Face outline; checks turn green. Switch the lamp off → *Lighting* and *Even light* fail, button disabled. Lamp on → *Take photo* → *Analyze* | "Before spending YouCam units, the browser checks framing, pose, and lighting. In this recording we're using mock analysis, which costs zero units. A real SD analysis sends the cropped photo to YouCam and costs 9 units on success." |
| 1:20–1:30 | Result: "Day 0 logged" → back to trial: verdict **Not enough data** | "One day in, and the verdict refuses to guess. That's a feature." |
| 1:30–2:00 | `/demo` → **Azelaic split-face demo**: hover the chart | "Here's a synthetic 21-day example. Blue is the treated cheek patch; orange is the untreated one. Pairing may reduce shared lighting noise. Below is the effect estimate with its approximate interval. This is an experimental mask-intensity proxy, not a validated measure of skin improvement." |
| 2:00–2:20 | Home → **Collagen** pre/post demo | "An oral supplement can't be split-face, so the agent chose a baseline week, then treatment. After 21 days: **an interim estimate, with more time remaining in the planned trial.**" Open the Verdict Agent log: "The agent writes the words, but the label comes from the locked analysis. If it disagrees with the math, or says 'clinically proven', its answer is rejected." |
| 2:20–2:35 | **Open shareable receipt** → *Download PNG*; back → *Delete all photos* | "Every trial ends in a receipt you can share, with no photos in it. And your selfies are one click from gone." |
| 2:35–2:50 | README sections: YouCam APIs table and the stats calibration test | "Under the hood: YouCam's file, task and polling APIs with a unit ledger and a budget guard. One analysis a day, with experimental cheek-patch mask intensity from YouCam. Our intervals are approximate; simulation tests explore their limitations. Receipts: numbers, with context." |

## Fallbacks

- No camera at recording time: use **Upload a photo instead** on the capture page. The same checks run.
- If the live agent is slow, cut the wait. The "designing…" screen shows elapsed seconds.
