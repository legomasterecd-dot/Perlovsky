import { Tournament, Game, TournamentPick, Outcome } from './types';

export function generateGames(tournament: Tournament): Game[] {
  const games: Game[] = [];
  let gameCounter = 1;

  // Generate games for each region
  const regionPrefixes = ['east', 'south', 'west', 'midwest'];
  
  tournament.regions.forEach((region, regionIndex) => {
    const regionPrefix = regionPrefixes[regionIndex] || `region-${regionIndex}`;
    
    // Round 1: 8 games in standard bracket order
    // Order: (1,16), (8,9), (5,12), (4,13), (6,11), (3,14), (7,10), (2,15)
    const seedOrder = [1, 16, 8, 9, 5, 12, 4, 13, 6, 11, 3, 14, 7, 10, 2, 15];
    const round1Games: Game[] = [];
    
    for (let i = 0; i < 8; i++) {
      const s1 = seedOrder[i * 2];
      const s2 = seedOrder[i * 2 + 1];
      const t1 = region.teams.find(t => t.seed === s1)!;
      const t2 = region.teams.find(t => t.seed === s2)!;
      
      const g: Game = {
        id: `${regionPrefix}-r1-g${i + 1}`,
        round: 1,
        region: region.name,
        team1Id: t1.id,
        team2Id: t2.id,
      };
      round1Games.push(g);
      games.push(g);
    }

    // Round 2: 4 games
    const round2Games: Game[] = [];
    for (let i = 0; i < 4; i++) {
      const g: Game = {
        id: `${regionPrefix}-r2-g${i + 1}`,
        round: 2,
        region: region.name,
      };
      round2Games.push(g);
      games.push(g);
      // Link Round 1 to Round 2
      round1Games[i * 2].nextGameId = g.id;
      round1Games[i * 2 + 1].nextGameId = g.id;
    }

    // Sweet 16: 2 games
    const round3Games: Game[] = [];
    for (let i = 0; i < 2; i++) {
      const g: Game = {
        id: `${regionPrefix}-r3-g${i + 1}`,
        round: 3,
        region: region.name,
      };
      round3Games.push(g);
      games.push(g);
      // Link Round 2 to Round 3
      round2Games[i * 2].nextGameId = g.id;
      round2Games[i * 2 + 1].nextGameId = g.id;
    }

    // Elite 8: 1 game
    const g4: Game = {
      id: `${regionPrefix}-r4-g1`,
      round: 4,
      region: region.name,
    };
    games.push(g4);
    // Link Round 3 to Round 4
    round3Games[0].nextGameId = g4.id;
    round3Games[1].nextGameId = g4.id;
  });

  // Final Four
  const ff1: Game = { id: 'ff-g1', round: 5 };
  const ff2: Game = { id: 'ff-g2', round: 5 };
  games.push(ff1, ff2);

  // Link Elite 8 to Final Four
  // East vs South, West vs Midwest
  games.find(g => g.id === 'east-r4-g1')!.nextGameId = 'ff-g1';
  games.find(g => g.id === 'south-r4-g1')!.nextGameId = 'ff-g1';
  games.find(g => g.id === 'west-r4-g1')!.nextGameId = 'ff-g2';
  games.find(g => g.id === 'midwest-r4-g1')!.nextGameId = 'ff-g2';

  // Championship
  const champ: Game = { id: 'champ-g1', round: 6 };
  games.push(champ);
  ff1.nextGameId = 'champ-g1';
  ff2.nextGameId = 'champ-g1';

  return games;
}

export function calculateScores(picks: TournamentPick[], outcomes: Outcome): Record<string, number> {
  const scores: Record<string, number> = {};
  
  picks.forEach(p => {
    let score = 0;
    Object.entries(p.bracket).forEach(([gameId, pickedTeamId]) => {
      const actualWinnerId = outcomes.results[gameId];
      if (actualWinnerId && actualWinnerId === pickedTeamId) {
        // Round-based scoring: 1, 2, 4, 8, 16, 32
        // Game IDs are like 'east-r1-g1', 'ff-g1', 'champ-g1'
        let round = 0;
        if (gameId.startsWith('champ')) round = 6;
        else if (gameId.startsWith('ff')) round = 5;
        else {
          const match = gameId.match(/-r(\d+)-/);
          if (match) round = parseInt(match[1]);
        }
        
        if (round > 0) {
          score += Math.pow(2, round - 1);
        }
      }
    });
    scores[p.userId] = score;
  });

  return scores;
}
