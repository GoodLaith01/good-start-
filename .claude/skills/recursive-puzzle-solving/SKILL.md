---
name: recursive-puzzle-solving
description: Lessons from solving the 10-ring Rainbow Tower (Tower of Hanoi variants) in game/. Use when facing a puzzle, algorithm or planning problem with many steps, a "biggest piece" constraint, or a state space too large to hold in your head - e.g. move/sort/reorder problems, recursive algorithms, long migration plans.
---

# Recursive puzzle solving

Learned by playing `game/rainbow_tower.py` with 10 rings on four rule sets.
Every result below was checked against brute-force search (`game/test_solvers.py`).

| Level | Twist | 10-ring result | Formula |
|---|---|---|---|
| Classic | 3 pegs | 1,023 moves | 2^n - 1 |
| Neighbours | only adjacent hops | 59,048 moves | 3^n - 1 |
| Four Pegs | one extra peg | 49 moves | Frame-Stewart |
| Scrambled | random legal start | 693 moves (seed 7) | biggest-first greedy |

## 1. Start from the hardest single move

Don't ask "what do I do first?" Ask "what has to be true just before the biggest
piece moves?" For Hanoi, everything smaller has to be on the one other peg. That
gives you the subproblem right away:
`solve(n) = solve(n-1 to spare) + move biggest + solve(n-1 onto it)`.

## 2. Trust the subproblem and count before you play

Once the recursion is written down, assume `solve(n-1)` works. Write the
recurrence for the cost (T(n) = 2T(n-1) + 1) and solve it **before** playing.
Then you know the target (1,023) and can measure any attempt against it.

## 3. A new constraint changes the recursion, not the method

With adjacent-only hops, the biggest ring can't jump A->C. It has to stop on B,
so the small tower crosses the board twice: T(n) = 3T(n-1) + 2 = 3^n - 1.
Go back to the hardest move, see which rule it now breaks, and rebuild the
recursion around that rule.

## 4. With extra resources, the work is in choosing the split

A fourth peg drops 10 rings from 1,023 moves to 49. The method: park the top k
rings using all the pegs, move the rest with three pegs, then bring the k rings
back. All the work is in picking k, so search over the split and keep the
cheapest (`_fs_split`). Use spare capacity to break the problem into smaller
pieces, then search for the best place to break it.

## 5. Pick a rule that only needs the current state when the plan is too long to keep

You can't keep 1,023 planned moves in your head, but you don't need to. The
alternation rule needs only the current board: on odd turns, step the smallest
ring along a fixed cycle; on even turns, make the only other legal move
(`player.py: live_classic_move`). When a plan is long, look for a step rule
that reads only the current state. It can be checked at any point and can't
lose its place.

## 6. A messy start: settle the biggest pieces first, ignore what's already done

From a scrambled position, go from the biggest ring down. If it's already on
its target, ignore it. If not, gather all the smaller rings on the third peg,
move it once, and the rest becomes a classic tower. Brute-force search shows
this is optimal. Settling the biggest pieces first means nothing has to be
undone later.

## 7. Check small cases exhaustively before trusting big ones

Each solver was checked against brute-force search on every tower size from 1
to 5 rings (plus 20 scrambled starts per size) before its 10-ring answer was
trusted. When a search over every state is feasible at small n, run it. It costs
a few seconds and replaces "I think this is optimal" with "this is optimal."

## 8. My own mistake while playing

My first `from_any` had a leftover placeholder helper and a no-op loop. It
looked plausible and would have failed silently. Write the simplest correct
version first, run it against a brute-force check, then clean up. Never leave
"temporary" code in a solver.

## Checklist

1. What's the hardest or largest single step? What must be true right before it?
2. Write the recursion and its cost formula, and compute the target number.
3. Does a rule block the direct move? Add a stop in the middle and recount.
4. Is there spare capacity? Make the split a parameter and minimise over it.
5. Is the plan too long to keep? Find a rule that reads only the current state.
6. Messy start? Settle the biggest pieces first and skip what's already in place.
7. Brute-force small cases and compare before scaling up.
