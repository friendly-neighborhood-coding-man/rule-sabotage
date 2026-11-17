# Board crowding: self-play measurement (V4, no cap applied)

This report measures how full the board gets when effects persist. There is no geometric restriction and no automatic clearing.

- Command: `npm run selfplay -- 30` (engine only, no LLM, no Kane).
- Seeds: 2000–2029.
- Run: 2026-11-17, commit 645f935.
- Board: 49 cells. A player can place on a cell only if it has no piece and no enemy effect.

## Bots

| Bot | What it does |
|---|---|
| planner | The real AI planner: one placement, a move sequence, then the opponent's reply. |
| casual | Half its turns, places a random effect on 1–3 random eligible cells, then walks with some noise. A stand-in for a human who likes building. |
| mover | Planner moves, but it never places anything. |

## Results (30 games per matchup)

"Active effect cells" are counted at the end of every turn.

| Matchup | Wins (human / AI) | First player wins | Turns (both sides) | Cells placed / game | Triggers / game (own effect) | Active cells avg | Active cells, last 6 turns | Max active |
|---|---|---|---|---|---|---|---|---|
| planner vs planner | 17 / 13 | 20 | 11.1 | 28.5 | 13.7 (12.3) | 7.0 | 9.9 | **47** |
| casual vs planner | 0 / 30 | 15 | 9.0 | 18.5 | 8.5 (7.3) | 4.6 | 6.3 | 35 |
| casual vs casual | 17 / 13 | 14 | 31.1 | 31.2 | 10.8 (5.5) | 10.9 | **19.0** | 34 |
| mover vs planner | 0 / 30 | 15 | 7.7 | 12.2 | 6.8 (6.4) | 2.2 | 3.0 | 20 |
| planner vs mover | 30 / 0 | 15 | 7.4 | 11.9 | 7.0 (6.9) | 1.8 | 1.9 | 7 |

Planner vs planner, per game (separate run, same seeds):

- Median length: 9 turns. 4 of 30 games reached 25 or more active cells.
- One game hit the 60-turn limit. Its board reached **47 of 49** cells, and at one point the player to move had **0 free eligible cells**.
- Placements by effect: teleport 91, shove east 54, shove west 46, home 26, shove back 21, shield 19, haste 17, shove forward 8, freeze 6.

## Reading

1. **Typical games stay readable.** Short and medium games average 2–11 active cells, roughly 4–22% of the board. Even two builders who place every other turn (casual vs casual) average 19 cells, 39%, over their last 6 turns.
2. **Long, stalled games do fill up.** The board fills when nobody gets across, as in the turn-limit game above that reached 47 of 49. That is the overcrowding case. It is rare: 1 game in 30 planner games, and 0 in 30 casual games for the 47-level case.
3. **Most triggers are on the owner's own effects.** That was 12.3 of 13.7 per planner game. The planner mostly builds things it will use itself: shoves toward its own goal, teleports and shields. Persistent beneficial effects make racing strong and keep games short. This is a balance observation and is unrelated to crowding.
4. Placing anything at all is a big edge. Planner vs mover went 30–0 in both directions.

## Options (decision 2026-11-17: no cap for now)

- **No cap (current).** The cost is the rare stalled game that ends up with a nearly full board.
- **Per-player limit on active cells (for example 12, about a quarter of the board each).** At the limit you must remove or replace your own cells before placing new ones. Nothing is cleared automatically and there is no geometric rule. Per the data above, this binds only in long games.
- **A lower limit (for example 9 each).** This would also bind in builder-heavy games like casual vs casual.
