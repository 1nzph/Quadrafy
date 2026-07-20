import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createApp } from "../src/app.js";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const frontendDirectory = path.resolve(testDirectory, "../../frontend");

async function withTestServer(run) {
  const dataDirectory = await mkdtemp(
    path.join(os.tmpdir(), "quadrafy-tasks13-test-"),
  );
  let server;
  try {
    const app = await createApp({
      environment: "test",
      dataDirectory,
      frontendDirectory,
      sessionTtlHours: 1,
      anthropicApiKey: "",
    });
    server = createServer(app.handler);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    async function api(
      pathname,
      { method = "GET", body, cookie, headers = {} } = {},
    ) {
      return fetch(`${baseUrl}${pathname}`, {
        method,
        redirect: "manual",
        headers: {
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...(cookie ? { Cookie: cookie } : {}),
          ...(method !== "GET" && method !== "HEAD" ? { Origin: baseUrl } : {}),
          ...headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    }
    await run({ api });
  } finally {
    if (server?.listening) {
      await new Promise((resolve) => server.close(resolve));
    }
    await rm(dataDirectory, { recursive: true, force: true });
  }
}

function cookieFrom(response) {
  const header = response.headers.get("set-cookie");
  assert.ok(header);
  return header.split(";", 1)[0];
}

async function registerPlayer(api, suffix, { gender, answers = 2 } = {}) {
  const response = await api("/api/v1/auth/register", {
    method: "POST",
    body: {
      role: "player",
      firstName: "Ana",
      lastName: `Silva ${suffix}`,
      email: `jogador-tasks13-${suffix}@example.com`,
      password: "SenhaSeguraJogador123",
      phone: "11912345678",
      city: "Sao Paulo",
    },
  });
  assert.equal(response.status, 201);
  const cookie = cookieFrom(response);
  const payload = await response.json();
  const levelTest = await api("/api/v1/player/level-test", {
    method: "POST",
    cookie,
    body: {
      tempo_pratica: answers,
      frequencia_semanal: answers,
      experiencia_esportes_raquete: answers,
      autoavaliacao_golpes: answers,
      experiencia_competicoes: answers,
      tatica_posicionamento: answers,
    },
  });
  assert.equal(levelTest.status, 200);
  if (gender) {
    const update = await api("/api/v1/player/profile", {
      method: "PATCH",
      cookie,
      body: { gender },
    });
    assert.equal(update.status, 200);
  }
  return { cookie, user: payload.data.user };
}

async function registerClub(api, suffix = "principal") {
  const response = await api("/api/v1/auth/register", {
    method: "POST",
    body: {
      role: "club",
      responsibleName: "Marina Costa",
      arenaName: `Arena Tasks13 ${suffix}`,
      cnpj: "12.345.678/0001-90",
      email: `clube-tasks13-${suffix}@example.com`,
      password: "SenhaSeguraClube123",
      phone: "11912345678",
    },
  });
  assert.equal(response.status, 201);
  const cookie = cookieFrom(response);
  const court = await api("/api/v1/club/courts", {
    method: "POST",
    cookie,
    body: {
      name: "Quadra Central",
      type: "covered",
      price: 160,
      opensAt: "06:00",
      closesAt: "23:00",
      slotDurationMinutes: 60,
    },
  });
  return { cookie, court: (await court.json()).data.court };
}

test("TASK-51: club creates extra arenas and courts bound to them", async () => {
  await withTestServer(async ({ api }) => {
    const clubAccount = await registerClub(api, "arenas");

    // arena inválida em quadra → 422
    const badCourt = await api("/api/v1/club/courts", {
      method: "POST",
      cookie: clubAccount.cookie,
      body: {
        name: "Quadra Fantasma",
        type: "covered",
        price: 100,
        opensAt: "06:00",
        closesAt: "22:00",
        slotDurationMinutes: 60,
        arenaId: "arena-que-nao-existe",
      },
    });
    assert.equal(badCourt.status, 422);

    const created = await api("/api/v1/club/arenas", {
      method: "POST",
      cookie: clubAccount.cookie,
      body: { name: "Arena Zona Sul", address: "Av. Padel, 100 - São Paulo" },
    });
    assert.equal(created.status, 201);
    const arena = (await created.json()).data.arena;
    assert.ok(arena.id);

    const list = await api("/api/v1/club/arenas", {
      cookie: clubAccount.cookie,
    });
    const arenas = (await list.json()).data.arenas;
    assert.equal(arenas.length, 1);
    assert.equal(arenas[0].name, "Arena Zona Sul");

    // quadra vinculada à nova arena
    const linkedCourt = await api("/api/v1/club/courts", {
      method: "POST",
      cookie: clubAccount.cookie,
      body: {
        name: "Quadra Sul 1",
        type: "outdoor",
        price: 120,
        opensAt: "06:00",
        closesAt: "22:00",
        slotDurationMinutes: 60,
        arenaId: arena.id,
      },
    });
    assert.equal(linkedCourt.status, 201);
    assert.equal((await linkedCourt.json()).data.court.arenaId, arena.id);

    // dados inválidos → 422
    const invalid = await api("/api/v1/club/arenas", {
      method: "POST",
      cookie: clubAccount.cookie,
      body: { name: "X", address: "" },
    });
    assert.equal(invalid.status, 422);
  });
});

test("TASK-54/55: full tournament flow — registration, groups, knockout, auto final standings", async () => {
  await withTestServer(async ({ api }) => {
    const clubAccount = await registerClub(api, "torneio");

    const created = await api("/api/v1/club/tournaments", {
      method: "POST",
      cookie: clubAccount.cookie,
      body: {
        name: "Aberto de Inverno",
        date: "2026-08-15T12:00:00.000Z",
        registrationType: "individual",
        genderCategory: "all",
        levelMin: 0.5,
        levelMax: 7,
      },
    });
    assert.equal(created.status, 201);
    const tournament = (await created.json()).data.tournament;
    assert.equal(tournament.status, "inscricoes_abertas");

    await api(`/api/v1/club/tournaments/${tournament.id}/courts`, {
      method: "PATCH",
      cookie: clubAccount.cookie,
      body: { courtIds: [clubAccount.court.id] },
    });

    // 8 jogadores individuais se inscrevem → 4 duplas → 1 grupo → final
    const players = [];
    for (let index = 0; index < 8; index += 1) {
      const player = await registerPlayer(api, `insc-${index}`);
      players.push(player);
      const register = await api(
        `/api/v1/players/tournaments/${tournament.id}/register`,
        { method: "POST", cookie: player.cookie },
      );
      assert.equal(register.status, 200);
    }
    const duplicate = await api(
      `/api/v1/players/tournaments/${tournament.id}/register`,
      { method: "POST", cookie: players[0].cookie },
    );
    assert.equal(duplicate.status, 409);

    // aparece em "open" para elegíveis e some após encerrar
    const openBefore = await api("/api/v1/players/tournaments/open", {
      cookie: players[0].cookie,
    });
    const openList = (await openBefore.json()).data.tournaments;
    assert.equal(openList.length, 1);
    assert.equal(openList[0].alreadyJoined, true);

    const closed = await api(
      `/api/v1/club/tournaments/${tournament.id}/close-registrations`,
      { method: "POST", cookie: clubAccount.cookie },
    );
    assert.equal(closed.status, 200);
    let current = (await closed.json()).data.tournament;
    assert.equal(current.status, "em_andamento");
    assert.equal(current.pairs.length, 4);
    assert.equal(current.groups.length, 1);
    // 1 grupo de 4 → 6 jogos de grupos
    assert.equal(current.games.length, 6);
    assert.ok(current.games.every((game) => game.phase === "grupos"));

    const registerLate = await api(
      `/api/v1/players/tournaments/${tournament.id}/register`,
      {
        method: "POST",
        cookie: (await registerPlayer(api, "atrasado")).cookie,
      },
    );
    assert.equal(registerLate.status, 404);

    // clube lança todos os jogos da fase de grupos (team1 sempre vence)
    for (const game of current.games) {
      const result = await api(
        `/api/v1/club/tournaments/${tournament.id}/games/${game.id}/result`,
        {
          method: "POST",
          cookie: clubAccount.cookie,
          body: { team1Games: 6, team2Games: 3 },
        },
      );
      assert.equal(result.status, 200);
      current = (await result.json()).data.tournament;
    }
    // grupos completos → Final gerada automaticamente (1 grupo → 2 classificados)
    const finalGame = current.games.find((game) => game.phase === "Final");
    assert.ok(finalGame, "final must be generated automatically");
    assert.equal(finalGame.status, "aguardando");

    // resultado de grupo travado após a fase seguinte existir
    const locked = await api(
      `/api/v1/club/tournaments/${tournament.id}/games/${current.games[0].id}/result`,
      {
        method: "POST",
        cookie: clubAccount.cookie,
        body: { team1Games: 2, team2Games: 6 },
      },
    );
    assert.equal(locked.status, 409);

    // jogador acompanha grupo/chaveamento (TASK-55)
    const mine = await api("/api/v1/players/tournaments/mine", {
      cookie: players[0].cookie,
    });
    const myTournaments = (await mine.json()).data.tournaments;
    assert.equal(myTournaments.length, 1);
    assert.equal(myTournaments[0].groups.length, 1);
    assert.ok(myTournaments[0].groups[0].standings.length === 4);

    // final lançada → torneio finalizado + classificação automática
    const finalResult = await api(
      `/api/v1/club/tournaments/${tournament.id}/games/${finalGame.id}/result`,
      {
        method: "POST",
        cookie: clubAccount.cookie,
        body: { team1Games: 7, team2Games: 5 },
      },
    );
    assert.equal(finalResult.status, 200);
    current = (await finalResult.json()).data.tournament;
    assert.equal(current.status, "finalizado");
    assert.equal(current.standings.length, 4);
    assert.equal(current.standings[0].stage, "Campeão");
    assert.equal(current.standings[1].stage, "Vice-campeão");
    assert.deepEqual(
      current.standings.map((row) => row.position),
      [1, 2, 3, 4],
    );
  });
});

test("TASK-55: eligibility filters (gender/level) and dupla registration rules", async () => {
  await withTestServer(async ({ api }) => {
    const clubAccount = await registerClub(api, "misto");
    const created = await api("/api/v1/club/tournaments", {
      method: "POST",
      cookie: clubAccount.cookie,
      body: {
        name: "Misto de Verão",
        registrationType: "dupla",
        genderCategory: "mixed",
        levelMin: 0.5,
        levelMax: 3,
      },
    });
    const tournament = (await created.json()).data.tournament;

    const woman = await registerPlayer(api, "mulher", { gender: "female" });
    const man = await registerPlayer(api, "homem", { gender: "male" });
    const manTwo = await registerPlayer(api, "homem-2", { gender: "male" });
    const noGender = await registerPlayer(api, "sem-genero");
    const strong = await registerPlayer(api, "forte", {
      gender: "male",
      answers: 4, // nível 5.6 — fora da faixa 0.5–3
    });

    // torneio misto não aparece para quem não definiu o gênero,
    // nem para quem está fora da faixa de nível
    for (const [account, expected] of [
      [woman, 1],
      [noGender, 0],
      [strong, 0],
    ]) {
      const open = await api("/api/v1/players/tournaments/open", {
        cookie: account.cookie,
      });
      assert.equal(
        (await open.json()).data.tournaments.length,
        expected,
      );
    }

    // dupla sem parceiro → 422; dupla do mesmo gênero em misto → 409
    const noPartner = await api(
      `/api/v1/players/tournaments/${tournament.id}/register`,
      { method: "POST", cookie: woman.cookie, body: {} },
    );
    assert.equal(noPartner.status, 422);
    const sameGender = await api(
      `/api/v1/players/tournaments/${tournament.id}/register`,
      {
        method: "POST",
        cookie: man.cookie,
        body: { partnerId: manTwo.user.id },
      },
    );
    assert.equal(sameGender.status, 409);
    // parceiro fora da faixa de nível → 409
    const strongPartner = await api(
      `/api/v1/players/tournaments/${tournament.id}/register`,
      {
        method: "POST",
        cookie: woman.cookie,
        body: { partnerId: strong.user.id },
      },
    );
    assert.equal(strongPartner.status, 409);

    const validPair = await api(
      `/api/v1/players/tournaments/${tournament.id}/register`,
      {
        method: "POST",
        cookie: woman.cookie,
        body: { partnerId: man.user.id },
      },
    );
    assert.equal(validPair.status, 200);
    assert.equal(
      (await validPair.json()).data.tournament.registrationsCount,
      1,
    );
    // parceiro já inscrito não pode entrar de novo
    const partnerAgain = await api(
      `/api/v1/players/tournaments/${tournament.id}/register`,
      {
        method: "POST",
        cookie: manTwo.cookie,
        body: { partnerId: man.user.id },
      },
    );
    assert.equal(partnerAgain.status, 409);
  });
});
