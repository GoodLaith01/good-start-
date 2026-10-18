"""Solvers for every Rainbow Tower level. Each returns a list of (src, dst) peg indices."""

from functools import lru_cache


def classic(n, src=0, aux=1, dst=2):
    """Level 1: park n-1 rings on the spare, move the biggest, rebuild on top. 2^n - 1 moves."""
    if n == 0:
        return []
    return classic(n - 1, src, dst, aux) + [(src, dst)] + classic(n - 1, aux, src, dst)


def neighbours(n, src=0, dst=2):
    """Level 2: A<->B<->C only. The biggest ring must stop on the middle peg, so the
    small tower crosses the board twice per big move. 3^n - 1 moves."""
    if n == 0:
        return []
    if abs(src - dst) == 1:  # one hop: clear the small tower to the far side, hop, bring it back
        far = 3 - src - dst
        return neighbours(n - 1, src, far) + [(src, dst)] + neighbours(n - 1, far, dst)
    mid = 1
    return (neighbours(n - 1, src, dst) + [(src, mid)] +
            neighbours(n - 1, dst, src) + [(mid, dst)] +
            neighbours(n - 1, src, dst))


@lru_cache(maxsize=None)
def _fs_split(n, pegs):
    """Best (count, k) for Frame-Stewart: move k rings with all pegs, n-k with one fewer."""
    if n == 0:
        return 0, 0
    if n == 1:
        return 1, 0
    if pegs == 3:
        return 2 ** n - 1, 0
    best = None
    for k in range(1, n):
        cost = 2 * _fs_split(k, pegs)[0] + _fs_split(n - k, pegs - 1)[0]
        if best is None or cost < best[0]:
            best = (cost, k)
    return best


def frame_stewart_count(n, pegs=4):
    return _fs_split(n, pegs)[0]


def four_pegs(n, src=0, dst=3, spares=(1, 2)):
    """Level 3: stash the top k rings on a spare using every peg, move the remaining
    n-k with the classic 3-peg method, then bring the k rings back on top."""
    if n == 0:
        return []
    if not spares:
        assert n == 1
        return [(src, dst)]
    if len(spares) == 1:
        return classic(n, src, spares[0], dst)
    _, k = _fs_split(n, len(spares) + 2)
    if k == 0:
        return classic(n, src, spares[0], dst) if n > 1 else [(src, dst)]
    park, rest = spares[0], spares[1:]
    return (four_pegs(k, src, park, (dst,) + rest) +
            four_pegs(n - k, src, dst, rest) +
            four_pegs(k, park, dst, (src,) + rest))


def from_any(pegs, dst=2):
    """Level 4: work from the biggest ring down. If it is already home, ignore it;
    otherwise gather everything smaller on the third peg, move it, and continue
    with the small rings now gathered on one peg (the classic case)."""
    where = {}
    for i, peg in enumerate(pegs):
        for ring in peg:
            where[ring] = i
    moves = []

    def gather(n, target):
        # put rings 1..n on target, given the current `where`
        if n == 0:
            return
        if where[n] == target:
            gather(n - 1, target)
            return
        origin = where[n]
        other = 3 - origin - target
        gather(n - 1, other)
        moves.append((origin, target))
        where[n] = target
        moves.extend(classic(n - 1, other, origin, target))
        for r in range(1, n):
            where[r] = target

    gather(len(where), dst)
    return moves
