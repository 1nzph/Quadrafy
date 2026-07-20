import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildGroups,
  buildKnockoutBracket,
  computeFinalStandings,
  formPairsFromIndividuals,
  generateGroupGames,
  groupStandings,
  groupsCountFor,
  nextKnockoutRound,
  roundLabelFor,
} from "../src/lib/tournament-engine.js";

const makePairs = (count) =>
  Array.from({ length: count }, (_, index) => ({
    id: `p${index}`,
    seedLevel: 7 - index * 0.3, // p0 é a melhor cabeça de chave
  }));

const courts = [{ id: "c0", name: "Quadra 1" }];

test("group count keeps qualifiers a power of two (no byes)", () => {
  assert.equal(groupsCountFor(3), null);
  assert.equal(groupsCountFor(4), 1);
  assert.equal(groupsCountFor(5), 1);
  assert.equal(groupsCountFor(6), 2);
  assert.equal(groupsCountFor(9), 2);
  assert.equal(groupsCountFor(10), 4);
  assert.equal(groupsCountFor(16), 4);
  assert.equal(groupsCountFor(17), null);
});

test("snake seeding spreads top seeds across groups", () => {
  const groups = buildGroups(makePairs(8));
  assert.equal(groups.length, 2);
  // p0 e p1 (duas melhores) em grupos diferentes
  const groupOf = (pairId) =>
    groups.findIndex((group) => group.pairIds.includes(pairId));
  assert.notEqual(groupOf("p0"), groupOf("p1"));
  const groups16 = buildGroups(makePairs(16));
  assert.equal(groups16.length, 4);
  const top4 = ["p0", "p1", "p2", "p3"].map((id) =>
    groups16.findIndex((group) => group.pairIds.includes(id)),
  );
  assert.equal(new Set(top4).size, 4, "top 4 seeds must land in 4 groups");
  assert.ok(groups16.every((group) => group.pairIds.length === 4));
});

test("group games: full round-robin inside each group, no self-games", () => {
  const groups = buildGroups(makePairs(10)); // 4 grupos (3,3,2,2)
  const games = generateGroupGames(groups, courts);
  const expected = groups.reduce(
    (sum, group) =>
      sum + (group.pairIds.length * (group.pairIds.length - 1)) / 2,
    0,
  );
  assert.equal(games.length, expected);
  assert.ok(games.every((game) => game.team1PairId !== game.team2PairId));
  assert.ok(games.every((game, index) => game.order === index + 1));
});

test("group standings order by wins then balance", () => {
  const group = { name: "Grupo A", pairIds: ["a", "b", "c"] };
  const games = [
    { phase: "grupos", groupIndex: 0, team1PairId: "a", team2PairId: "b", score: { team1Games: 6, team2Games: 3 } },
    { phase: "grupos", groupIndex: 0, team1PairId: "b", team2PairId: "c", score: { team1Games: 6, team2Games: 4 } },
    { phase: "grupos", groupIndex: 0, team1PairId: "a", team2PairId: "c", score: { team1Games: 2, team2Games: 6 } },
  ];
  const rows = groupStandings(group, games);
  // todos com 1 vitória → saldo decide: c: (4-6)+(6-2)=+2, a: (6-3)+(2-6)=-1, b: (3-6)+(6-4)=-1
  assert.equal(rows[0].pairId, "c");
  assert.deepEqual(rows.map((row) => row.position), [1, 2, 3]);
});

test("knockout bracket uses the classic cross and same-group rematch only in the final", () => {
  // 2 grupos
  const two = buildKnockoutBracket([
    [{ pairId: "A1" }, { pairId: "A2" }],
    [{ pairId: "B1" }, { pairId: "B2" }],
  ]);
  assert.deepEqual(two, [
    { team1PairId: "A1", team2PairId: "B2" },
    { team1PairId: "B1", team2PairId: "A2" },
  ]);
  // 4 grupos: A1 e A2 em metades opostas da chave
  const four = buildKnockoutBracket([
    [{ pairId: "A1" }, { pairId: "A2" }],
    [{ pairId: "B1" }, { pairId: "B2" }],
    [{ pairId: "C1" }, { pairId: "C2" }],
    [{ pairId: "D1" }, { pairId: "D2" }],
  ]);
  assert.equal(four.length, 4);
  const half = (pairId) =>
    four.findIndex(
      (game) => game.team1PairId === pairId || game.team2PairId === pairId,
    ) < 2
      ? "top"
      : "bottom";
  assert.notEqual(half("A1"), half("A2"));
  assert.notEqual(half("B1"), half("B2"));
  assert.equal(roundLabelFor(four.length), "Quartas de final");
});

test("knockout progression pairs winners in order until the final", () => {
  const semis = [
    { team1PairId: "A1", team2PairId: "B2", score: { team1Games: 6, team2Games: 2 } },
    { team1PairId: "B1", team2PairId: "A2", score: { team1Games: 4, team2Games: 6 } },
  ];
  const final = nextKnockoutRound(semis);
  assert.deepEqual(final, [{ team1PairId: "A1", team2PairId: "A2" }]);
  assert.equal(roundLabelFor(final.length), "Final");
  assert.deepEqual(
    nextKnockoutRound([
      { team1PairId: "x", team2PairId: "y", score: { team1Games: 6, team2Games: 1 } },
    ]),
    [],
  );
});

test("final standings: champion, runner-up, then by elimination stage", () => {
  const groups = [
    { name: "Grupo A", pairIds: ["A1", "A2", "A3"] },
    { name: "Grupo B", pairIds: ["B1", "B2", "B3"] },
  ];
  const win = (t1, t2, phase, groupIndex = undefined) => ({
    phase,
    groupIndex,
    team1PairId: t1,
    team2PairId: t2,
    score: { team1Games: 6, team2Games: 2 },
  });
  const games = [
    // grupos (A1 e A2 avançam; B1 e B2 avançam)
    win("A1", "A2", "grupos", 0),
    win("A1", "A3", "grupos", 0),
    win("A2", "A3", "grupos", 0),
    win("B1", "B2", "grupos", 1),
    win("B1", "B3", "grupos", 1),
    win("B2", "B3", "grupos", 1),
    // semis: A1×B2 e B1×A2
    win("A1", "B2", "Semifinal"),
    win("B1", "A2", "Semifinal"),
    // final: A1 campeã
    win("A1", "B1", "Final"),
  ];
  const standings = computeFinalStandings({ games, groups });
  assert.equal(standings[0].pairId, "A1");
  assert.equal(standings[0].stage, "Campeão");
  assert.equal(standings[1].pairId, "B1");
  assert.equal(standings[1].stage, "Vice-campeão");
  assert.ok(
    standings
      .slice(2, 4)
      .every((row) => row.stage === "Eliminado na semifinal"),
  );
  assert.ok(
    standings.slice(4).every((row) => row.stage === "Fase de grupos"),
  );
  assert.deepEqual(
    standings.map((row) => row.position),
    [1, 2, 3, 4, 5, 6],
  );
});

test("individual registrations form level-adjacent pairs; mixed requires equal counts", () => {
  const entries = [
    { id: "u1", level: 6, gender: "male" },
    { id: "u2", level: 5, gender: "female" },
    { id: "u3", level: 4, gender: "male" },
    { id: "u4", level: 3, gender: "female" },
  ];
  const pairs = formPairsFromIndividuals(entries);
  assert.deepEqual(
    pairs.map((pair) => pair.map((entry) => entry.id)),
    [
      ["u1", "u2"],
      ["u3", "u4"],
    ],
  );
  const mixed = formPairsFromIndividuals(entries, "mixed");
  assert.ok(
    mixed.every(
      (pair) =>
        pair.some((entry) => entry.gender === "male") &&
        pair.some((entry) => entry.gender === "female"),
    ),
  );
  assert.throws(
    () =>
      formPairsFromIndividuals(
        [...entries, { id: "u5", level: 2, gender: "male" }],
        "mixed",
      ),
    /mixed_requires_equal_counts/,
  );
  assert.throws(
    () => formPairsFromIndividuals(entries.slice(0, 3)),
    /odd_individual_count/,
  );
});
