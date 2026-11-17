# Rule Sabotage: 3-minute hackathon demo

**Setup (before you go on):** `npm start` with `.env` holding an OpenRouter key, and `kane-cli` logged in. Open http://127.0.0.1:3000. Check both header chips are green: *AI brain: OpenRouter · …* and *Referee: Kane CLI …*. Keep one finished trial page open in a second tab as a backup (`/trial/T0001`).

---

**0:00 Hook (one sentence)**
> "This is a race where you get to invent the rules in plain English. The catch: every trap you invent works on you too."

**0:15 The board**
Point at the two tokens, the goal columns and the yellow shape.
> "This round, traps can only go on this yellow column, for both of us. The AI already locked in its move. See the lock? It decided from the same board I see, without seeing my move."

**0:35 Invent a trap (the wow moment)**
Type: `Anyone stepping here gets pushed backward two spaces!` → **Interpret**.
> "OpenRouter turns my sentence into one of a few safe effects. The card shows exactly what will run: push back 2, costs 2 power per square, so I get two squares."
Click the two squares right in front of the AI. Press **→**.

**0:55 Kane the referee**
The referee panel appears: *"Kane is examining your rule…"*, then *"Sandbox ran 5 what-if scenarios"*, then *"Rule approved by Kane. Proceed at your own risk."*
> "Before any rule goes live, the engine replays it in a sandbox: both players stepping on it, chain reactions, an 8-round softlock check. Kane CLI then inspects that trial page and gives a verdict. If Kane can't verify a rule, it doesn't go live."
Click **see trial** to flash the trial page. (Say the real seconds shown on the card. Don't round them down.)

**1:30 Let the AI play back**
Make two or three quick moves. Point out the AI's trap colour (pink) vs yours (teal), the speech bubble ("said before the reveal"), and the log line *"AI's recorded decision … simulated 45 options × 15 replies"*.
> "The AI isn't scripted to lose. It simulates its options against my likely replies, and you can see what it decided before the reveal."

**2:00 Show a rejection**
Type: `Only the AI loses all its turns forever`.
> "Unfair rules get a reason, not silence: traps hit everyone, and nothing is permanent."
Optional: `Push back 5 squares` shows an approximation that I have to accept explicitly.

**2:20 The punchline**
Keep racing. The usual comedy: someone gets pushed back onto their own trap, then **SELF-SABOTAGE!** and *"That was not part of my plan."* If it doesn't happen naturally, say:
> "It doesn't always happen, and I can't make it happen. Every funny moment here comes from rules the players wrote."

**2:40 Game over + rematch**
Show the result card, achievements (Self-Sabotage, Uno Reverse, Calculated Disaster…) and press **R**.
> "Lose, laugh, press R. Ten seconds to the next game."

**2:55 Close**
> "OpenRouter for language and strategy, a TypeScript engine as the only source of truth, and Kane CLI as a referee that really runs on every new rule."

---

**If something fails live:** the header chip turns amber and says why (for example *Kane unavailable*). Say it out loud. The game keeps the honesty labels and does not fake a verdict. For a no-network demo, set `KANE_REFEREE=off` and show the "NOT Kane-verified" label.
