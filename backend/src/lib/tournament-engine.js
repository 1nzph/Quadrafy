// TASKS-13 / TASK-54 — Motor de torneios tradicionais do Quadrafy:
// fase de grupos (todos-contra-todos) + mata-mata eliminatório.
// Módulo isolado e testável, separado do super8-engine.js (a lógica é de
// eliminação, não de rotação).
//
// Regras de estrutura (documentadas):
//   - Mínimo de 4 duplas.
//   - Nº de grupos escolhido para que os classificados (2 por grupo) sejam
//     sempre potência de 2 — sem "byes": 4–5 duplas → 1 grupo (final direta
//     entre 1º e 2º); 6–9 duplas → 2 grupos (semifinais); 10–16 duplas →
//     4 grupos (quartas de final).
//   - Cabeças de chave: as duplas são ordenadas pelo nível médio (seed) e
//     distribuídas em "serpentina" (snake) entre os grupos, de modo que as
//     mais fortes NÃO caiam no mesmo grupo.
//   - Cruzamento clássico no mata-mata: 1º do grupo A × 2º do grupo B,
//     1º do B × 2º do A (e, com 4 grupos, A1×B2 / C1×D2 / B1×A2 / D1×C2 —
//     duplas do mesmo grupo só podem se reencontrar na final).

export const TOURNAMENT_MIN_PAIRS = 4;
export const TOURNAMENT_MAX_PAIRS = 16;

const GROUP_LETTERS = ["A", "B", "C", "D"];

export function groupsCountFor(pairCount) {
  if (pairCount < TOURNAMENT_MIN_PAIRS || pairCount > TOURNAMENT_MAX_PAIRS) {
    return null;
  }
  if (pairCount <= 5) return 1;
  if (pairCount <= 9) return 2;
  return 4;
}

export function roundLabelFor(matchCount) {
  if (matchCount === 1) return "Final";
  if (matchCount === 2) return "Semifinal";
  if (matchCount === 4) return "Quartas de final";
  return `Fase de ${matchCount * 2}`;
}

// TASK-54.3 (individual): forma duplas a partir de inscrições individuais.
// Regra documentada: jogadores ordenados por nível e pareados em duplas
// adjacentes (1º com 2º, 3º com 4º...) — duplas homogêneas, que preservam a
// lógica de cabeças de chave. Na categoria "mixed", cada homem é pareado
// com uma mulher de nível próximo (exige quantidades iguais).
export function formPairsFromIndividuals(entries, genderCategory = "all") {
  const byLevel = (a, b) => (Number(b.level) || 0) - (Number(a.level) || 0);
  if (genderCategory === "mixed") {
    const men = entries.filter((entry) => entry.gender === "male").sort(byLevel);
    const women = entries
      .filter((entry) => entry.gender === "female")
      .sort(byLevel);
    if (men.length !== women.length) {
      throw new Error("mixed_requires_equal_counts");
    }
    return men.map((man, index) => [man, women[index]]);
  }
  const sorted = [...entries].sort(byLevel);
  if (sorted.length % 2 !== 0) {
    throw new Error("odd_individual_count");
  }
  const pairs = [];
  for (let index = 0; index < sorted.length; index += 2) {
    pairs.push([sorted[index], sorted[index + 1]]);
  }
  return pairs;
}

// pairs: [{ id, players, seedLevel }] — distribui em grupos por serpentina.
export function buildGroups(pairs) {
  const groupsCount = groupsCountFor(pairs.length);
  if (!groupsCount) throw new Error("invalid_pair_count");
  const seeded = [...pairs].sort(
    (a, b) => (Number(b.seedLevel) || 0) - (Number(a.seedLevel) || 0),
  );
  const groups = Array.from({ length: groupsCount }, (_, index) => ({
    name: `Grupo ${GROUP_LETTERS[index]}`,
    pairIds: [],
  }));
  seeded.forEach((pair, index) => {
    const lap = Math.floor(index / groupsCount);
    const position = index % groupsCount;
    const groupIndex = lap % 2 === 0 ? position : groupsCount - 1 - position;
    groups[groupIndex].pairIds.push(pair.id);
  });
  return groups;
}

// Round-robin (circle method) dentro de cada grupo.
export function generateGroupGames(groups, courts) {
  const games = [];
  groups.forEach((group, groupIndex) => {
    const ids = [...group.pairIds];
    const hasBye = ids.length % 2 !== 0;
    if (hasBye) ids.push(null);
    const count = ids.length;
    let rotating = ids.slice(1);
    for (let round = 0; round < count - 1; round += 1) {
      const order = [ids[0], ...rotating];
      for (let index = 0; index < count / 2; index += 1) {
        const a = order[index];
        const b = order[count - 1 - index];
        if (a !== null && b !== null) {
          games.push({
            phase: "grupos",
            groupIndex,
            team1PairId: a,
            team2PairId: b,
          });
        }
      }
      rotating = [rotating[rotating.length - 1], ...rotating.slice(0, -1)];
    }
  });
  return games.map((game, index) => ({
    ...game,
    order: index + 1,
    court: courts[index % courts.length],
  }));
}

// Classificação dentro de um grupo: vitórias, depois saldo de games.
export function groupStandings(group, games) {
  const rows = new Map(
    group.pairIds.map((pairId) => [
      pairId,
      { pairId, played: 0, wins: 0, gamesFor: 0, gamesAgainst: 0 },
    ]),
  );
  for (const game of games) {
    if (game.phase !== "grupos" || !game.score) continue;
    const sides = [
      { pairId: game.team1PairId, gamesFor: game.score.team1Games, gamesAgainst: game.score.team2Games },
      { pairId: game.team2PairId, gamesFor: game.score.team2Games, gamesAgainst: game.score.team1Games },
    ];
    for (const side of sides) {
      const row = rows.get(side.pairId);
      if (!row) continue;
      row.played += 1;
      if (side.gamesFor > side.gamesAgainst) row.wins += 1;
      row.gamesFor += side.gamesFor;
      row.gamesAgainst += side.gamesAgainst;
    }
  }
  return [...rows.values()]
    .map((row) => ({ ...row, balance: row.gamesFor - row.gamesAgainst }))
    .sort((a, b) => b.wins - a.wins || b.balance - a.balance)
    .map((row, index) => ({ ...row, position: index + 1 }));
}

// Cruzamento clássico do mata-mata a partir das classificações dos grupos.
// Retorna a lista de confrontos da primeira fase eliminatória.
export function buildKnockoutBracket(groupStandingsList) {
  const winners = groupStandingsList.map((rows) => rows[0].pairId);
  const runnersUp = groupStandingsList.map((rows) => rows[1].pairId);
  const groupsCount = groupStandingsList.length;
  if (groupsCount === 1) {
    return [{ team1PairId: winners[0], team2PairId: runnersUp[0] }];
  }
  if (groupsCount === 2) {
    return [
      { team1PairId: winners[0], team2PairId: runnersUp[1] }, // A1 × B2
      { team1PairId: winners[1], team2PairId: runnersUp[0] }, // B1 × A2
    ];
  }
  // 4 grupos: metades separadas para reencontro do mesmo grupo só na final
  return [
    { team1PairId: winners[0], team2PairId: runnersUp[1] }, // A1 × B2
    { team1PairId: winners[2], team2PairId: runnersUp[3] }, // C1 × D2
    { team1PairId: winners[1], team2PairId: runnersUp[0] }, // B1 × A2
    { team1PairId: winners[3], team2PairId: runnersUp[2] }, // D1 × C2
  ];
}

// Próxima fase: vencedores dos jogos (em ordem) se enfrentam dois a dois.
export function nextKnockoutRound(roundGames) {
  const winners = roundGames.map((game) =>
    game.score.team1Games > game.score.team2Games
      ? game.team1PairId
      : game.team2PairId,
  );
  if (winners.length < 2) return [];
  const matchups = [];
  for (let index = 0; index < winners.length; index += 2) {
    matchups.push({
      team1PairId: winners[index],
      team2PairId: winners[index + 1],
    });
  }
  return matchups;
}

// Classificação final: campeão, vice, e demais por fase de eliminação
// (desempate dentro da mesma fase pelo desempenho na fase de grupos).
export function computeFinalStandings({ games, groups }) {
  const groupRank = new Map();
  groups.forEach((group, groupIndex) => {
    const rows = groupStandings(
      group,
      games.filter((game) => game.groupIndex === groupIndex),
    );
    rows.forEach((row) => {
      groupRank.set(row.pairId, {
        wins: row.wins,
        balance: row.balance,
        position: row.position,
      });
    });
  });
  const knockout = games.filter((game) => game.phase !== "grupos");
  const finalGame = knockout.find((game) => game.phase === "Final");
  const eliminationStage = new Map();
  for (const game of knockout) {
    if (!game.score) continue;
    const loser =
      game.score.team1Games > game.score.team2Games
        ? game.team2PairId
        : game.team1PairId;
    eliminationStage.set(loser, game.phase);
  }
  const champion =
    finalGame?.score &&
    (finalGame.score.team1Games > finalGame.score.team2Games
      ? finalGame.team1PairId
      : finalGame.team2PairId);
  const stageOrder = (pairId) => {
    if (pairId === champion) return 0;
    const stage = eliminationStage.get(pairId);
    if (stage === "Final") return 1;
    if (stage === "Semifinal") return 2;
    if (stage === "Quartas de final") return 3;
    return 4; // eliminado na fase de grupos
  };
  const stageLabel = (pairId) => {
    if (pairId === champion) return "Campeão";
    const stage = eliminationStage.get(pairId);
    if (stage === "Final") return "Vice-campeão";
    if (stage) return `Eliminado na ${stage.toLowerCase()}`;
    return "Fase de grupos";
  };
  const allPairIds = groups.flatMap((group) => group.pairIds);
  return allPairIds
    .map((pairId) => ({
      pairId,
      stage: stageLabel(pairId),
      stageOrder: stageOrder(pairId),
      group: groupRank.get(pairId) ?? { wins: 0, balance: 0, position: 99 },
    }))
    .sort(
      (a, b) =>
        a.stageOrder - b.stageOrder ||
        b.group.wins - a.group.wins ||
        b.group.balance - a.group.balance,
    )
    .map((row, index) => ({
      position: index + 1,
      pairId: row.pairId,
      stage: row.stage,
      groupWins: row.group.wins,
      groupBalance: row.group.balance,
    }));
}
