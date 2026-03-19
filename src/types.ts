export interface Team {
  id: string;
  name: string;
  seed: number;
}

export interface Region {
  name: string;
  teams: Team[];
}

export interface Tournament {
  id: string;
  name: string;
  year: number;
  regions: Region[];
}

export interface TournamentPick {
  id: string;
  userId: string;
  userName: string;
  tournamentId: string;
  bracket: Record<string, string>; // gameId -> teamId
  createdAt: string;
  order?: number;
}

export interface Outcome {
  id: string;
  tournamentId: string;
  results: Record<string, string>; // gameId -> teamId
  isSimulated: boolean;
  updatedAt: string;
}

export interface Game {
  id: string;
  round: number;
  region?: string;
  team1Id?: string;
  team2Id?: string;
  nextGameId?: string;
}
