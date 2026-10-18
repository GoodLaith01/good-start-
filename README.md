# good-start-

## Rainbow Tower

A 10-ring Tower of Hanoi game with four levels, in `game/`.

| Level | Rules | Optimal for 10 rings |
|---|---|---|
| 1 Classic | 3 pegs, A -> C | 1,023 |
| 2 Neighbours | only hop between adjacent pegs | 59,048 |
| 3 Four Pegs | 4 pegs, A -> D | 49 |
| 4 Scrambled | random legal start, gather on C | depends on start |

```sh
cd game
python3 rainbow_tower.py --level 1        # play interactively (moves like AC)
python3 player.py                         # watch Claude solve every level
python3 -m unittest test_solvers          # solvers vs brute-force search
# or open index.html in a browser to watch Claude play move by move
```

What solving it taught: `.claude/skills/recursive-puzzle-solving/SKILL.md`.
