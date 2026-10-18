#!/usr/bin/env python3
"""Claude plays Rainbow Tower with 10 rings on every level.

Level 1 is played "live": each move is chosen by looking only at the current
board (no precomputed plan). The other levels follow the recursive solvers in
solvers.py. Every move goes through Game.move, which rejects illegal moves.

    python3 player.py            # play all four levels with 10 rings
    python3 player.py --rings 6  # smaller tower
"""

import argparse

from rainbow_tower import LEVELS, Game, optimal_moves
import solvers


def live_classic_move(game, turn):
    """Alternation rule. Odd turns: the smallest ring steps one peg along a fixed
    cycle (A->C->B for odd ring counts, A->B->C for even). Even turns: the only
    legal move that leaves the smallest ring alone."""
    small_at = next(i for i, p in enumerate(game.pegs) if p and p[-1] == 1)
    if turn % 2 == 1:
        step = 1 if game.rings % 2 == 0 else -1
        return small_at, (small_at + step) % 3
    a, b = [i for i in range(3) if i != small_at]
    pa, pb = game.pegs[a], game.pegs[b]
    if not pa or (pb and pb[-1] < pa[-1]):
        return b, a
    return a, b


def play(level, rings, seed=7):
    game = Game.from_level(level, rings, seed)
    if level == 1:
        turn = 0
        while not game.solved():
            turn += 1
            game.move(*live_classic_move(game, turn))
    else:
        plan = {
            2: lambda: solvers.neighbours(rings),
            3: lambda: solvers.four_pegs(rings),
            4: lambda: solvers.from_any(game.pegs),
        }[level]()
        for src, dst in plan:
            game.move(src, dst)
    return game


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rings", type=int, default=10)
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args()

    for level, cfg in LEVELS.items():
        start = Game.from_level(level, args.rings, args.seed)
        game = play(level, args.rings, args.seed)
        best = optimal_moves(level, args.rings)
        verdict = "SOLVED" if game.solved() else "FAILED"
        target = f"optimal {best}" if best is not None else "no fixed optimum"
        print(f"Level {level} {cfg['name']:<10} {verdict} in {game.moves:>6} moves ({target})")
        if level == 4:
            print(start.render(color=False))
            print("        ...gathered on C:")
            print(game.render(color=False))


if __name__ == "__main__":
    main()
