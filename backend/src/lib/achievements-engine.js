import {
  ACHIEVEMENT_CATALOG,
  CHAMPION_PIN_ASSETS,
  achievementById,
} from "../config/achievements.js";

const teams = ["team1", "team2"];

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function matchMetricsForPlayer(player, confirmedResults = []) {
  const playerId = player.id;
  let currentWinStreak = 0;
  const partners = new Set();
  const rivals = new Set();

  for (const result of confirmedResults) {
    const ownTeam = teams.find((team) => result.teams?.[team]?.includes(playerId));
    if (!ownTeam) continue;
    const opposingTeam = ownTeam === "team1" ? "team2" : "team1";
    for (const partnerId of result.teams?.[ownTeam] ?? []) {
      if (partnerId !== playerId) partners.add(partnerId);
    }
    for (const rivalId of result.teams?.[opposingTeam] ?? []) rivals.add(rivalId);
  }

  for (const result of [...confirmedResults].reverse()) {
    const ownTeam = teams.find((team) => result.teams?.[team]?.includes(playerId));
    if (!ownTeam || result.winningTeam !== ownTeam) break;
    currentWinStreak += 1;
  }

  return {
    matchesPlayed: Math.max(finite(player.profile?.matchesPlayed), confirmedResults.length),
    wins: finite(player.profile?.wins),
    currentWinStreak,
    frequentPartners: partners.size,
    recurringRivals: rivals.size,
    level: finite(player.profile?.level),
  };
}

export function countFinishedParticipations(playerId, super8Tournaments = [], tournaments = []) {
  const super8Count = super8Tournaments.filter(
    (competition) =>
      competition.status === "finalizado" &&
      (competition.players ?? []).some((player) => player.id === playerId),
  ).length;
  const tournamentCount = tournaments.filter(
    (competition) =>
      competition.status === "finalizado" &&
      (competition.registrations ?? []).some((registration) =>
        registration.players?.some((player) => player.id === playerId),
      ),
  ).length;
  return super8Count + tournamentCount;
}

export function isCriterionSatisfied(criterion, metrics) {
  if (!criterion || criterion.operator !== "gte") return false;
  return finite(metrics[criterion.metric]) >= finite(criterion.threshold);
}

export function eligibleProgressAchievements(metrics, catalog = ACHIEVEMENT_CATALOG) {
  return catalog.filter((achievement) => isCriterionSatisfied(achievement.criterion, metrics));
}

export function toAchievementView(record) {
  if (record.type === "champion_title") {
    const competitionLabel = record.competitionType === "super8" ? "Super 8" : "Torneio";
    return {
      ...record,
      name: `Campeão ${competitionLabel}`,
      description: `Título conquistado em ${record.competitionName}.`,
      category: "Campeão",
      asset: CHAMPION_PIN_ASSETS[record.competitionType] ?? CHAMPION_PIN_ASSETS.tournament,
      titleDetails: {
        competitionName: record.competitionName,
        clubName: record.clubName,
        competitionDate: record.competitionDate,
        levelCategory: record.levelCategory,
      },
    };
  }
  const definition = achievementById(record.achievementId);
  return definition ? { ...definition, ...record } : null;
}

export function createAchievementsEngine({ users, matchResults, super8, tournaments, clubs, achievementStore }) {
  async function metricsFor(playerId) {
    const player = users.findById(playerId);
    if (!player || player.role !== "player") return null;
    const metrics = matchMetricsForPlayer(player, matchResults.listConfirmedByPlayer(playerId));
    return {
      ...metrics,
      eventsParticipated: countFinishedParticipations(
        playerId,
        super8.listAll(),
        tournaments.listAll(),
      ),
    };
  }

  async function verifyPlayer(playerId) {
    const metrics = await metricsFor(playerId);
    if (!metrics) return [];
    const unlocked = [];
    for (const definition of eligibleProgressAchievements(metrics)) {
      const result = await achievementStore.grantProgress({
        playerId,
        achievementId: definition.id,
        tier: definition.tier,
      });
      if (result.created) unlocked.push(toAchievementView(result.achievement));
    }
    return unlocked;
  }

  async function verifyPlayers(playerIds) {
    const results = await Promise.all(
      [...new Set(playerIds)].map(async (playerId) => [playerId, await verifyPlayer(playerId)]),
    );
    return Object.fromEntries(results);
  }

  async function awardChampionTitle({ competition, competitionType, winnerIds }) {
    const club = clubs.findById(competition.clubId);
    const competitionDate = competition.date ?? competition.updatedAt ?? competition.createdAt;
    const levelCategory = competition.levelCategory ?? (Number.isFinite(Number(competition.levelMin)) ? `${competition.levelMin}–${competition.levelMax}` : null);
    const results = await Promise.all(
      [...new Set(winnerIds.filter(Boolean))].map(async (playerId) => {
        const result = await achievementStore.grantChampionTitle({
          playerId,
          competitionId: competition.id,
          competitionType,
          competitionName: competition.name,
          clubId: competition.clubId,
          clubName: club?.name ?? "Clube Quadrafy",
          competitionDate,
          levelCategory,
        });
        return result.created ? toAchievementView(result.achievement) : null;
      }),
    );
    return results.filter(Boolean);
  }

  return { metricsFor, verifyPlayer, verifyPlayers, awardChampionTitle };
}
