#!/usr/bin/env python3
"""Rainbow Tower - a Tower of Hanoi game with escalating twists.

Levels
  1 Classic     3 pegs, move the tower from A to C.
  2 Neighbours  3 pegs, rings may only hop between adjacent pegs (A<->B, B<->C).
  3 Four Pegs   4 pegs, move the tower from A to D. Fewer moves than classic.
  4 Scrambled   3 pegs, start from a random legal position, gather on C.

Rules everywhere: move one ring at a time, only the top ring of a peg,
and never put a bigger ring on a smaller one.

Play interactively:   python3 rainbow_tower.py --level 1   (10 rings by default)
Feed a move list:     python3 rainbow_tower.py --level 1 --rings 3 --moves "AC AB CB AC BA BC AC"
"""

import argparse
import random
import sys

COLORS = [196, 208, 214, 220, 190, 120, 51, 39, 63, 129]  # red -> violet, ANSI 256

LEVELS = {
    1: dict(name="Classic", pegs=3, adjacent=False, scrambled=False),
    2: dict(name="Neighbours", pegs=3, adjacent=True, scrambled=False),
    3: dict(name="Four Pegs", pegs=4, adjacent=False, scrambled=False),
    4: dict(name="Scrambled", pegs=3, adjacent=False, scrambled=True),
}


class IllegalMove(Exception):
    pass


class Game:
    def __init__(self, rings, pegs=3, adjacent=False, start=None):
        self.rings = rings
        self.adjacent = adjacent
        if start is None:
            start = [list(range(rings, 0, -1))] + [[] for _ in range(pegs - 1)]
        self.pegs = [list(p) for p in start]
        self.moves = 0

    @classmethod
    def from_level(cls, level, rings, seed=None):
        cfg = LEVELS[level]
        start = None
        if cfg["scrambled"]:
            rng = random.Random(seed)
            start = [[] for _ in range(cfg["pegs"])]
            for size in range(rings, 0, -1):  # place biggest first so stacks stay legal
                start[rng.randrange(cfg["pegs"])].append(size)
        return cls(rings, cfg["pegs"], cfg["adjacent"], start)

    @staticmethod
    def peg_index(label):
        return ord(label.upper()) - ord("A")

    def move(self, src, dst):
        if isinstance(src, str):
            src, dst = self.peg_index(src), self.peg_index(dst)
        n = len(self.pegs)
        if not (0 <= src < n and 0 <= dst < n) or src == dst:
            raise IllegalMove("pick two different pegs")
        if self.adjacent and abs(src - dst) != 1:
            raise IllegalMove("rings may only hop to a neighbouring peg")
        if not self.pegs[src]:
            raise IllegalMove("that peg is empty")
        ring = self.pegs[src][-1]
        if self.pegs[dst] and self.pegs[dst][-1] < ring:
            raise IllegalMove("a bigger ring cannot sit on a smaller one")
        self.pegs[dst].append(self.pegs[src].pop())
        self.moves += 1

    def solved(self):
        return len(self.pegs[-1]) == self.rings

    def render(self, color=True):
        height = self.rings
        width = 2 * self.rings + 1
        rows = []
        for level in range(height - 1, -1, -1):
            cells = []
            for peg in self.pegs:
                if level < len(peg):
                    size = peg[level]
                    body = "=" * (2 * size - 1)
                    text = body.center(width)
                    if color:
                        code = COLORS[(size - 1) % len(COLORS)]
                        text = text.replace(body, f"\033[38;5;{code}m{body}\033[0m")
                else:
                    text = "|".center(width)
                cells.append(text)
            rows.append(" ".join(cells))
        rows.append(" ".join(chr(65 + i).center(width) for i in range(len(self.pegs))))
        return "\n".join(rows)


def optimal_moves(level, rings):
    """Best-known move count for the standard (unscrambled) start."""
    if level == 1:
        return 2 ** rings - 1
    if level == 2:
        return 3 ** rings - 1
    if level == 3:
        from solvers import frame_stewart_count
        return frame_stewart_count(rings, 4)
    return None


def parse_moves(text):
    return [tok for tok in text.replace(",", " ").split() if tok]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--level", type=int, default=1, choices=sorted(LEVELS))
    ap.add_argument("--rings", type=int, default=10)
    ap.add_argument("--seed", type=int, default=None, help="seed for the scrambled level")
    ap.add_argument("--moves", help='space-separated moves like "AC AB CB"')
    ap.add_argument("--no-color", action="store_true")
    args = ap.parse_args()

    game = Game.from_level(args.level, args.rings, args.seed)
    cfg = LEVELS[args.level]
    color = not args.no_color and sys.stdout.isatty()
    print(f"Level {args.level}: {cfg['name']} - {args.rings} rings")
    print(game.render(color))

    scripted = parse_moves(args.moves) if args.moves else None
    stream = iter(scripted) if scripted is not None else None

    while not game.solved():
        if stream is not None:
            tok = next(stream, None)
            if tok is None:
                break
        else:
            try:
                tok = input("move (e.g. AC, q to quit)> ").strip()
            except EOFError:
                break
            if tok.lower() == "q":
                break
        if len(tok) != 2:
            print(f"? '{tok}' - use two peg letters like AC")
            continue
        try:
            game.move(tok[0], tok[1])
        except IllegalMove as err:
            print(f"illegal {tok.upper()}: {err}")
            continue
        if stream is None:
            print(game.render(color))

    if stream is not None:
        print(game.render(color))
    best = optimal_moves(args.level, args.rings)
    if game.solved():
        extra = f" (optimal: {best})" if best is not None else ""
        print(f"Solved in {game.moves} moves{extra}!")
    else:
        print(f"Not solved after {game.moves} moves.")
    return 0 if game.solved() else 1


if __name__ == "__main__":
    sys.exit(main())
