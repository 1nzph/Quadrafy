import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ApiError } from "../lib/http.js";
import { createId } from "../lib/security.js";

// TASKS-13 / TASK-54 — Torneios tradicionais (grupos + mata-mata).
// Status: "inscricoes_abertas" → "em_andamento" (chaves geradas) →
// "finalizado" (automático quando o resultado da final é lançado).
export class TournamentStore {
  constructor(dataDirectory) {
    this.dataDirectory = dataDirectory;
    this.filePath = path.join(dataDirectory, "tournaments.json");
    this.tournaments = [];
    this.writeQueue = Promise.resolve();
  }

  async initialize() {
    await mkdir(this.dataDirectory, { recursive: true });
    try {
      const file = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(file);
      if (!Array.isArray(parsed)) throw new Error("Expected an array");
      this.tournaments = parsed;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await this.persist();
    }
  }

  findById(id) {
    return this.tournaments.find((entry) => entry.id === id) ?? null;
  }

  listByClub(clubId) {
    return this.tournaments
      .filter((entry) => entry.clubId === clubId)
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
  }

  listAll() {
    return this.tournaments;
  }

  requireOwned(id, clubId) {
    const tournament = this.findById(id);
    if (!tournament || tournament.clubId !== clubId) {
      throw new ApiError(404, "tournament_not_found", "Torneio não encontrado.");
    }
    return tournament;
  }

  async create(data) {
    return this.enqueueWrite(async () => {
      const now = new Date().toISOString();
      const tournament = {
        id: createId(),
        ...data,
        registrations: [], // individual: [{players:[p]}]; dupla: [{players:[p,p]}]
        pairs: [],
        groups: [],
        games: [],
        standings: null,
        status: "inscricoes_abertas",
        createdAt: now,
        updatedAt: now,
      };
      this.tournaments.push(tournament);
      await this.persist();
      return tournament;
    });
  }

  async update(id, changes) {
    return this.enqueueWrite(async () => {
      const tournament = this.findById(id);
      if (!tournament) {
        throw new ApiError(
          404,
          "tournament_not_found",
          "Torneio não encontrado.",
        );
      }
      Object.assign(tournament, changes, {
        updatedAt: new Date().toISOString(),
      });
      await this.persist();
      return tournament;
    });
  }

  async persist() {
    await writeFile(
      this.filePath,
      `${JSON.stringify(this.tournaments, null, 2)}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
  }

  enqueueWrite(operation) {
    const next = this.writeQueue.then(operation, operation);
    this.writeQueue = next.catch(() => {});
    return next;
  }
}
