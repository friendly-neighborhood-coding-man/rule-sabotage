# Rule Sabotage: 3-minute hackathon demo

**Setup (before you go on):** `npm start` with `.env` holding an OpenRouter key, and `kane-cli` logged in. Open http://127.0.0.1:3000. Check both header chips are green: *AI brain: OpenRouter · …* and *Referee: Kane CLI …*. Keep one finished trial page open in a second tab as a backup (`/trial/T0001`).

---

**0:00 Hook (one sentence)**
> "Three pieces each, a 7×7 board, and you write the traps in plain English. The catch: every effect works on everybody, including the person who built it."

**0:15 The board**
Point at the three teal pieces in column A, the three pink AI pieces in column G, and the action chip ("Your turn · 3 actions left").
> "One action per piece I still have on the board. Stack pieces and they move together. Land on an enemy and it goes back home."

**0:35 Write an effect (the wow moment)**
Type: `Anything entering here is shoved two squares north` → **Interpret**.
> "OpenRouter turns my sentence into one of a few safe effects. The card shows exactly what the engine will run."
Click three cells anywhere: two in front of the AI's pieces and one far away. Press **Place**.

**0:55 Kane the referee**
The referee panel shows *"Sandbox ran 4 what-if scenarios"*, then *"Kane is examining your rule…"*, then *"Kane approved your rule"* with the trial ID and scenario IDs.
> "Before any effect goes live, the engine replays it in a sandbox. A human piece and an AI piece walk into each cell the same way, and they must get the identical outcome. Then Kane CLI inspects that trial page and gives the verdict. If Kane can't verify it, it doesn't go live."
Click the **trial** link to flash the page. Read out the real seconds shown on the card, not a rounded number.

**1:30 Move, then let the AI play**
Click a piece, then a square, a couple of times, and press **E**. The AI's turn animates: its own effect lands (pink), its pieces move, and the log shows *"Local planner / OpenRouter: …"* with its rationale.
> "It simulated every effect it could place plus its move sequence, and then my best reply, all with the real engine."

**2:00 Show a rejection**
Type: `Only the AI is frozen forever`. Then `Pushed toward your own side`.
> "Unfair rules get a reason, not silence. Effects can't care whose piece it is."
Optional: `Shoved 5 squares north` shows an approximation that I must accept explicitly.

**2:20 The punchline**
Keep playing. Effects pile up, and sooner or later someone gets shoved onto their own trap: **"You stepped on your own effect!"** and *"That was not part of my plan."* If it hasn't happened, remove one of your own effects (click its cell chip) to show you can clean up your own mess. Point out that you can't touch the AI's.

**2:40 Game over + rematch**
Show the result card and achievements (Self-Sabotage, Uno Reverse, Bowling Ball, Architect…), then press **R**.

**2:55 Close**
> "OpenRouter for language and strategy, a TypeScript engine as the only source of truth, and Kane CLI as a referee that really runs on every new rule."

---

**If something fails live:** the header chip turns amber and says why (for example *Kane unavailable*). Say it out loud. The game keeps the honesty labels and does not fake a verdict. For a no-network demo, set `KANE_REFEREE=off` and show the "NOT Kane-verified" label.
