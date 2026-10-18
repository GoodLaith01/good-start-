"""Checks every solver against brute-force search on small towers.

    python3 -m unittest test_solvers
"""

import unittest
from collections import deque

import solvers
from player import play
from rainbow_tower import Game, IllegalMove


def bfs_distance(start, adjacent=False):
    pegs, n = len(start), sum(len(p) for p in start)
    key = lambda s: tuple(map(tuple, s))
    goal = key([[] for _ in range(pegs - 1)] + [list(range(n, 0, -1))])
    seen = {key(start): 0}
    queue = deque([start])
    while queue:
        state = queue.popleft()
        dist = seen[key(state)]
        if key(state) == goal:
            return dist
        for a in range(pegs):
            for b in range(pegs):
                if a == b or not state[a] or (adjacent and abs(a - b) != 1):
                    continue
                if state[b] and state[b][-1] < state[a][-1]:
                    continue
                nxt = [list(p) for p in state]
                nxt[b].append(nxt[a].pop())
                if key(nxt) not in seen:
                    seen[key(nxt)] = dist + 1
                    queue.append(nxt)


def tower(n, pegs):
    return [list(range(n, 0, -1))] + [[] for _ in range(pegs - 1)]


class SolverTests(unittest.TestCase):
    def test_optimal_against_bfs(self):
        for n in range(1, 6):
            self.assertEqual(len(solvers.classic(n)), bfs_distance(tower(n, 3)))
            self.assertEqual(len(solvers.neighbours(n)), bfs_distance(tower(n, 3), adjacent=True))
            self.assertEqual(len(solvers.four_pegs(n)), bfs_distance(tower(n, 4)))
            for seed in range(20):
                start = Game.from_level(4, n, seed).pegs
                self.assertEqual(len(solvers.from_any(start)), bfs_distance(start))

    def test_ten_rings_every_level(self):
        expected = {1: 1023, 2: 59048, 3: 49}
        for level in range(1, 5):
            game = play(level, 10)
            self.assertTrue(game.solved())
            if level in expected:
                self.assertEqual(game.moves, expected[level])

    def test_illegal_moves_rejected(self):
        game = Game(3)
        game.move("A", "C")
        with self.assertRaises(IllegalMove):
            game.move("A", "C")  # ring 2 onto ring 1
        with self.assertRaises(IllegalMove):
            game.move("B", "C")  # empty peg
        with self.assertRaises(IllegalMove):
            Game(3, adjacent=True).move("A", "C")


if __name__ == "__main__":
    unittest.main()
