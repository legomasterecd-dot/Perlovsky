import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { 
  Trophy, 
  Users, 
  Play, 
  Save, 
  RefreshCw, 
  ChevronRight, 
  Search,
  Info,
  LogOut,
  LogIn,
  AlertCircle,
  Settings,
  Plus,
  Trash2,
  Edit2,
  Check,
  X,
  UserCheck,
  ChevronLeft,
  ChevronUp,
  ChevronDown,
  Crown,
  Zap
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  auth, 
  db, 
  signIn, 
  signOut, 
  onAuthStateChanged, 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  setDoc, 
  updateDoc,
  onSnapshot, 
  query, 
  where,
  deleteDoc,
  writeBatch,
  User
} from './firebase';
import { INITIAL_TOURNAMENT } from './data/initialTournament';
import { generateGames, calculateScores } from './utils';
import { Tournament, Game, TournamentPick, Outcome, Team, Region } from './types';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [tournament, setTournament] = useState<Tournament>(INITIAL_TOURNAMENT);
  const [picks, setPicks] = useState<TournamentPick[]>([]);
  const [outcome, setOutcome] = useState<Outcome>({
    id: 'actual',
    tournamentId: INITIAL_TOURNAMENT.id,
    results: {},
    isSimulated: false,
    updatedAt: new Date().toISOString()
  });
  
  // Admin State
  const [isAdmin, setIsAdmin] = useState(false);
  const [isAdminActionEnabled, setIsAdminActionEnabled] = useState(true);
  const [editingPickId, setEditingPickId] = useState<string | null>(null);
  const [editingGameId, setEditingGameId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [isSimulationMode, setIsSimulationMode] = useState(false);
  const [simulationOutcome, setSimulationOutcome] = useState<Outcome | null>(null);
  const [view, setView] = useState<'bracket' | 'leaderboard' | 'admin'>('bracket');
  const [highlightedTeamId, setHighlightedTeamId] = useState<string | null>(null);
  const [viewingPickId, setViewingPickId] = useState<string | null>(null);
  const [highlightedGameId, setHighlightedGameId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newCompetitorName, setNewCompetitorName] = useState('');
  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false);
  const [editingCompetitorId, setEditingCompetitorId] = useState<string | null>(null);
  const [editingCompetitorName, setEditingCompetitorName] = useState('');

  const GAMES = useMemo(() => generateGames(tournament), [tournament]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setIsAdmin(u?.email?.toLowerCase() === 'legomaster.ecd@gmail.com');
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    const unsubscribe = onSnapshot(doc(db, 'tournaments', INITIAL_TOURNAMENT.id), (snapshot) => {
      if (snapshot.exists()) {
        setTournament({ id: snapshot.id, ...snapshot.data() } as Tournament);
      }
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    
    const initData = async () => {
      try {
        const tDoc = await getDoc(doc(db, 'tournaments', INITIAL_TOURNAMENT.id));
        if (!tDoc.exists()) {
          await setDoc(doc(db, 'tournaments', INITIAL_TOURNAMENT.id), INITIAL_TOURNAMENT);
        }
        
        const oDoc = await getDoc(doc(db, 'outcomes', 'actual'));
        if (!oDoc.exists()) {
          await setDoc(doc(db, 'outcomes', 'actual'), {
            id: 'actual',
            tournamentId: INITIAL_TOURNAMENT.id,
            results: {},
            isSimulated: false,
            updatedAt: new Date().toISOString()
          });
        }
      } catch (err) {
        console.error("Initialization error:", err);
      }
    };
    
    initData();
  }, [isAdmin]);

  useEffect(() => {
    const q = query(collection(db, 'picks'), where('tournamentId', '==', tournament.id));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const allPicks = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as TournamentPick));
      setPicks(allPicks);
    });
    return unsubscribe;
  }, [tournament.id]);

  useEffect(() => {
    const unsubscribe = onSnapshot(doc(db, 'outcomes', 'actual'), (snapshot) => {
      if (snapshot.exists()) {
        setOutcome(snapshot.data() as Outcome);
      }
    });
    return unsubscribe;
  }, []);

  const activePick = useMemo(() => {
    if (editingPickId) return picks.find(p => p.id === editingPickId) || null;
    if (viewingPickId) return picks.find(p => p.id === viewingPickId) || null;
    if (user) return picks.find(p => p.userId === user.uid) || null;
    return null;
  }, [picks, editingPickId, viewingPickId, user]);

  const handlePick = async (gameId: string, teamId: string, targetPickId?: string) => {
    if (!isAdmin && !user) return;
    
    // If viewing someone else's bracket, don't allow picks unless explicitly editing
    if (viewingPickId && !editingPickId && !isAdmin) return;

    const target = targetPickId ? picks.find(p => p.id === targetPickId) : activePick;
    
    // If we're in bracket mode and not editing anyone, and not an admin in matchup mode, don't allow picks
    if (!editingPickId && !targetPickId && !user) {
      setError("Please sign in or select a competitor to edit.");
      return;
    }

    if (!target && targetPickId) {
      setError("Competitor not found.");
      return;
    }

    const newBracket = { ...(target?.bracket || {}) };
    if (newBracket[gameId] === teamId) {
      delete newBracket[gameId];
    } else {
      newBracket[gameId] = teamId;
    }
    
    const updatedPick: TournamentPick = {
      id: target?.id || targetPickId || `${user?.uid}-${tournament.id}`,
      userId: target?.userId || (targetPickId ? targetPickId : `manual-${Date.now()}`),
      userName: target?.userName || 'New Competitor',
      tournamentId: tournament.id,
      bracket: newBracket,
      createdAt: target?.createdAt || new Date().toISOString()
    };

    try {
      await setDoc(doc(db, 'picks', updatedPick.id), updatedPick);
    } catch (err) {
      console.error("Error saving pick:", err);
      setError("Failed to save pick. Check your connection.");
    }
  };

  const handleOutcome = async (gameId: string, teamId: string) => {
    if (isSimulationMode) {
      const currentSim = simulationOutcome || outcome;
      const newResults = { ...currentSim.results };
      if (newResults[gameId] === teamId) {
        delete newResults[gameId];
      } else {
        newResults[gameId] = teamId;
      }
      setSimulationOutcome({ ...currentSim, results: newResults });
      return;
    }

    if (!isAdmin) return;

    const newResults = { ...outcome.results };
    if (newResults[gameId] === teamId) {
      delete newResults[gameId];
    } else {
      newResults[gameId] = teamId;
    }
    const newOutcome = { ...outcome, results: newResults, updatedAt: new Date().toISOString() };
    try {
      await setDoc(doc(db, 'outcomes', 'actual'), newOutcome);
    } catch (err) {
      setError("Failed to save outcome.");
    }
  };

  const handleAddCompetitor = async () => {
    if (!newCompetitorName.trim()) return;
    const id = `manual-${Date.now()}`;
    const newPick: TournamentPick = {
      id,
      userId: id,
      userName: newCompetitorName,
      tournamentId: tournament.id,
      bracket: {},
      createdAt: new Date().toISOString()
    };
    try {
      await setDoc(doc(db, 'picks', id), newPick);
      setNewCompetitorName('');
    } catch (err) {
      setError("Failed to add competitor");
    }
  };

  const handleDeleteCompetitor = async (id: string) => {
    try {
      console.log("Deleting competitor with ID:", id);
      await deleteDoc(doc(db, 'picks', id));
      setConfirmDeleteId(null);
    } catch (err) {
      console.error("Delete competitor error:", err);
      setError("Failed to delete competitor. " + (err instanceof Error ? err.message : ""));
    }
  };

  const handleUpdateTeam = async (regionIndex: number, teamIndex: number, field: 'name' | 'seed', value: string | number) => {
    const newTournament = { ...tournament };
    if (field === 'name') {
      newTournament.regions[regionIndex].teams[teamIndex].name = value as string;
    } else {
      newTournament.regions[regionIndex].teams[teamIndex].seed = value as number;
    }
    setTournament(newTournament);
    try {
      await setDoc(doc(db, 'tournaments', tournament.id), newTournament);
    } catch (err) {
      setError("Failed to update tournament");
    }
  };

  const handleUpdateRegionName = async (regionIndex: number, newName: string) => {
    const newTournament = { ...tournament };
    newTournament.regions[regionIndex].name = newName;
    setTournament(newTournament);
    try {
      await setDoc(doc(db, 'tournaments', tournament.id), newTournament);
    } catch (err) {
      setError("Failed to update region name");
    }
  };

  const handleBulkPick = async (gameId: string, teamId: string) => {
    if (!isAdmin || !isAdminActionEnabled) return;
    try {
      const batch = writeBatch(db);
      picks.forEach(p => {
        const newBracket = { ...p.bracket, [gameId]: teamId };
        batch.update(doc(db, 'picks', p.id), { bracket: newBracket });
      });
      await batch.commit();
    } catch (err) {
      setError("Failed to apply bulk picks");
    }
  };

  const handleResetTournament = async () => {
    if (!isAdmin || !isAdminActionEnabled) return;
    try {
      // Reset tournament data
      await setDoc(doc(db, 'tournaments', INITIAL_TOURNAMENT.id), INITIAL_TOURNAMENT);
      
      // Reset actual outcomes to clear any glitched results
      const emptyOutcome: Outcome = {
        id: 'actual',
        tournamentId: INITIAL_TOURNAMENT.id,
        results: {},
        isSimulated: false,
        updatedAt: new Date().toISOString()
      };
      await setDoc(doc(db, 'outcomes', 'actual'), emptyOutcome);
      
      setTournament(INITIAL_TOURNAMENT);
      setOutcome(emptyOutcome);
      setIsResetConfirmOpen(false);
    } catch (err) {
      setError("Failed to reset tournament");
    }
  };

  const handleUpdateCompetitorName = async (id: string, newName: string) => {
    if (!isAdmin || !isAdminActionEnabled) return;
    try {
      await updateDoc(doc(db, 'picks', id), { userName: newName });
      setEditingCompetitorId(null);
    } catch (err) {
      setError("Failed to update competitor name");
    }
  };

  const handleReorderCompetitor = async (id: string, direction: 'up' | 'down') => {
    if (!isAdmin || !isAdminActionEnabled) return;
    
    // Use sortedPicks to determine current order
    const currentIdx = sortedPicks.findIndex(p => p.id === id);
    if (currentIdx === -1) return;
    if (direction === 'up' && currentIdx === 0) return;
    if (direction === 'down' && currentIdx === sortedPicks.length - 1) return;

    const newIdx = direction === 'up' ? currentIdx - 1 : currentIdx + 1;
    const batch = writeBatch(db);
    
    // Ensure all picks have an order
    const updatedPicks = sortedPicks.map((p, idx) => ({ ...p, order: p.order ?? idx }));
    
    const item1 = updatedPicks[currentIdx];
    const item2 = updatedPicks[newIdx];
    
    // Swap orders
    const order1 = item1.order ?? currentIdx;
    const order2 = item2.order ?? newIdx;
    
    batch.update(doc(db, 'picks', item1.id), { order: order2 });
    batch.update(doc(db, 'picks', item2.id), { order: order1 });
    
    try {
      await batch.commit();
    } catch (err) {
      setError("Failed to reorder competitors");
    }
  };

  const scores = useMemo(() => calculateScores(picks, outcome), [picks, outcome]);
  const projectedScores = useMemo(() => isSimulationMode && simulationOutcome ? calculateScores(picks, simulationOutcome) : null, [picks, simulationOutcome, isSimulationMode]);
  const teamPaths = useMemo(() => {
    const paths: Record<string, string[]> = {};
    tournament.regions.forEach(region => {
      region.teams.forEach(team => {
        const teamGames: string[] = [];
        let currentGame = GAMES.find(g => g.round === 1 && (g.team1Id === team.id || g.team2Id === team.id));
        while (currentGame) {
          teamGames.push(currentGame.id);
          currentGame = GAMES.find(g => g.id === currentGame?.nextGameId);
        }
        paths[team.id] = teamGames;
      });
    });
    return paths;
  }, [tournament, GAMES]);

  const isTeamEliminatedOfficial = useCallback((teamId: string): boolean => {
    if (!teamId) return false;
    const path = teamPaths[teamId];
    if (!path || path.length === 0) return false;
    return path.some(gameId => {
      const winnerId = outcome.results[gameId];
      return !!(winnerId && winnerId !== teamId);
    });
  }, [outcome.results, teamPaths]);

  const reachablePicks = useMemo(() => {
    const results: Record<string, Record<string, boolean>> = {};
    picks.forEach(p => {
      const reachable: Record<string, boolean> = {};
      const sortedGames = [...GAMES].sort((a, b) => (a.round || 0) - (b.round || 0));
      
      sortedGames.forEach(game => {
        const pickedTeamId = p.bracket[game.id];
        if (!pickedTeamId) return;
        
        if (isTeamEliminatedOfficial(pickedTeamId)) {
          reachable[game.id] = false;
          return;
        }

        if (game.round === 1) {
          reachable[game.id] = (game.team1Id === pickedTeamId || game.team2Id === pickedTeamId);
        } else {
          const feedingGames = GAMES.filter(g => g.nextGameId === game.id);
          const feedingGame = feedingGames.find(g => p.bracket[g.id] === pickedTeamId);
          if (feedingGame && reachable[feedingGame.id]) {
            reachable[game.id] = true;
          } else {
            reachable[game.id] = false;
          }
        }
      });
      results[p.userId] = reachable;
    });
    return results;
  }, [picks, GAMES, isTeamEliminatedOfficial]);

  const pprs = useMemo(() => {
    const results: Record<string, number> = {};
    picks.forEach(p => {
      let ppr = 0;
      const reachable = reachablePicks[p.userId] || {};
      GAMES.forEach(game => {
        if (!outcome.results[game.id]) {
          if (reachable[game.id]) {
            let round = game.round;
            if (!round) {
              if (game.id.startsWith('champ')) round = 6;
              else if (game.id.startsWith('ff')) round = 5;
            }
            if (round) ppr += Math.pow(2, round - 1);
          }
        }
      });
      results[p.userId] = ppr;
    });
    return results;
  }, [picks, outcome.results, GAMES, reachablePicks]);

  const getGameWinner = useCallback((gameId: string, pick?: TournamentPick): string | undefined => {
    if (pick) return pick.bracket[gameId];
    if (isSimulationMode && simulationOutcome) return simulationOutcome.results[gameId];
    return outcome.results[gameId];
  }, [isSimulationMode, simulationOutcome, outcome]);

  const getGameTeams = useCallback((game: Game, pick?: TournamentPick): [string | undefined, string | undefined] => {
    if (game.round === 1) return [game.team1Id, game.team2Id];
    const feedingGames = GAMES.filter(g => g.nextGameId === game.id);
    if (feedingGames.length !== 2) return [undefined, undefined];
    
    return [
      getGameWinner(feedingGames[0].id, pick),
      getGameWinner(feedingGames[1].id, pick)
    ];
  }, [GAMES, getGameWinner]);

  const isTeamEliminated = useCallback((teamId: string): boolean => {
    if (!teamId) return false;
    // For UI dimming, we might want to show if they are out in simulation or reality
    const results = isSimulationMode && simulationOutcome ? simulationOutcome.results : outcome.results;
    
    const path = teamPaths[teamId];
    if (!path) return false;
    return path.some(gameId => {
      const winnerId = results[gameId];
      return winnerId && winnerId !== teamId;
    });
  }, [isSimulationMode, simulationOutcome, outcome.results, teamPaths]);

  const eliminated = useMemo(() => {
    const results: Record<string, boolean> = {};
    const scoresArray = Object.values(scores) as number[];
    const maxScore = scoresArray.length > 0 ? Math.max(...scoresArray) : 0;
    picks.forEach(p => {
      const ppr = pprs[p.userId] || 0;
      const currentScore = scores[p.userId] || 0;
      results[p.userId] = (currentScore + ppr) < maxScore;
    });
    return results;
  }, [scores, pprs, picks]);

  const reachableSimPicks = useMemo(() => {
    if (!isSimulationMode || !simulationOutcome) return null;
    const results: Record<string, Record<string, boolean>> = {};
    picks.forEach(p => {
      const reachable: Record<string, boolean> = {};
      const sortedGames = [...GAMES].sort((a, b) => (a.round || 0) - (b.round || 0));
      
      sortedGames.forEach(game => {
        const pickedTeamId = p.bracket[game.id];
        if (!pickedTeamId) return;
        
        if (isTeamEliminated(pickedTeamId)) {
          reachable[game.id] = false;
          return;
        }

        if (game.round === 1) {
          reachable[game.id] = (game.team1Id === pickedTeamId || game.team2Id === pickedTeamId);
        } else {
          const feedingGames = GAMES.filter(g => g.nextGameId === game.id);
          const feedingGame = feedingGames.find(g => p.bracket[g.id] === pickedTeamId);
          if (feedingGame && reachable[feedingGame.id]) {
            reachable[game.id] = true;
          } else {
            reachable[game.id] = false;
          }
        }
      });
      results[p.userId] = reachable;
    });
    return results;
  }, [picks, GAMES, isTeamEliminated, isSimulationMode, simulationOutcome]);

  const simPprs = useMemo(() => {
    if (!isSimulationMode || !simulationOutcome || !reachableSimPicks) return null;
    const results: Record<string, number> = {};
    picks.forEach(p => {
      let ppr = 0;
      const reachable = reachableSimPicks[p.userId] || {};
      GAMES.forEach(game => {
        if (!outcome.results[game.id] && !simulationOutcome.results[game.id]) {
          if (reachable[game.id]) {
            let round = game.round;
            if (!round) {
              if (game.id.startsWith('champ')) round = 6;
              else if (game.id.startsWith('ff')) round = 5;
            }
            if (round) ppr += Math.pow(2, round - 1);
          }
        }
      });
      results[p.userId] = ppr;
    });
    return results;
  }, [picks, outcome.results, simulationOutcome, GAMES, reachableSimPicks, isSimulationMode]);

  const simEliminated = useMemo(() => {
    if (!isSimulationMode || !projectedScores || !simPprs) return null;
    const results: Record<string, boolean> = {};
    const projectedScoresArray = Object.values(projectedScores) as number[];
    const maxProjectedScore = projectedScoresArray.length > 0 ? Math.max(...projectedScoresArray) : 0;
    picks.forEach(p => {
      const ppr = simPprs[p.userId] || 0;
      const projectedScore = projectedScores[p.userId] || 0;
      results[p.userId] = (projectedScore + ppr) < maxProjectedScore;
    });
    return results;
  }, [projectedScores, simPprs, picks, isSimulationMode]);

  const leaderboardData = useMemo(() => {
    const sorted = [...picks].sort((a, b) => {
      if (view === 'admin' && !isSimulationMode) {
        return (a.order || 0) - (b.order || 0) || a.createdAt.localeCompare(b.createdAt);
      }
      const scoreA = projectedScores ? (projectedScores[a.userId] || 0) : (scores[a.userId] || 0);
      const scoreB = projectedScores ? (projectedScores[b.userId] || 0) : (scores[b.userId] || 0);
      
      if (scoreB !== scoreA) return scoreB - scoreA;
      
      const pprA = (isSimulationMode && simPprs) ? (simPprs[a.userId] || 0) : (pprs[a.userId] || 0);
      const pprB = (isSimulationMode && simPprs) ? (simPprs[b.userId] || 0) : (pprs[b.userId] || 0);
      if (pprB !== pprA) return pprB - pprA;

      return a.userName.localeCompare(b.userName);
    });

    let currentRank = 1;
    return sorted.map((p, i, arr) => {
      const score = projectedScores ? (projectedScores[p.userId] || 0) : (scores[p.userId] || 0);
      const ppr = (isSimulationMode && simPprs) ? (simPprs[p.userId] || 0) : (pprs[p.userId] || 0);
      
      if (i > 0) {
        const prev = arr[i - 1];
        const prevScore = projectedScores ? (projectedScores[prev.userId] || 0) : (scores[prev.userId] || 0);
        const prevPpr = (isSimulationMode && simPprs) ? (simPprs[prev.userId] || 0) : (pprs[prev.userId] || 0);
        
        if (score !== prevScore || ppr !== prevPpr) {
          currentRank = i + 1;
        }
      }
      return { ...p, score, ppr, rank: currentRank };
    });
  }, [picks, scores, projectedScores, view, isSimulationMode, pprs, simPprs]);

  const sortedPicks = useMemo(() => leaderboardData, [leaderboardData]);

  const getTeamById = (id: string): Team | undefined => {
    for (const region of tournament.regions) {
      const team = region.teams.find(t => t.id === id);
      if (team) return team;
    }
    return undefined;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-neutral-950 flex items-center justify-center text-white">
        <RefreshCw className="w-8 h-8 animate-spin text-emerald-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-200 font-sans selection:bg-emerald-500/30">
      <nav className="border-b border-neutral-800 bg-neutral-900/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-500 rounded-xl flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <Trophy className="text-white w-6 h-6" />
            </div>
            <div>
              <h1 className="font-bold text-white tracking-tight">MADNESS TRACKER</h1>
              <p className="text-[10px] text-neutral-500 uppercase tracking-widest font-mono">{tournament.name}</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {!editingPickId && (
              <button 
                onClick={() => {
                  if (!isSimulationMode) {
                    if (viewingPickId && activePick) {
                      setSimulationOutcome({
                        ...outcome,
                        results: { ...activePick.bracket },
                        isSimulated: true
                      });
                    } else {
                      setSimulationOutcome({ ...outcome });
                    }
                  }
                  setIsSimulationMode(!isSimulationMode);
                }}
                className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-bold transition-all border ${isSimulationMode ? 'bg-amber-500 text-black border-amber-400 shadow-lg shadow-amber-500/20' : 'bg-neutral-800 text-neutral-400 border-neutral-700 hover:border-neutral-600'}`}
              >
                <Zap className={`w-4 h-4 ${isSimulationMode ? 'fill-current' : ''}`} />
                {isSimulationMode ? 'Simulation Mode ON' : 'Start Simulation'}
              </button>
            )}
            <div className="flex bg-neutral-800 p-1 rounded-lg">
              <button onClick={() => setView('bracket')} className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${view === 'bracket' ? 'bg-neutral-700 text-white shadow-sm' : 'text-neutral-400 hover:text-neutral-200'}`}>Bracket</button>
              <button onClick={() => setView('leaderboard')} className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${view === 'leaderboard' ? 'bg-neutral-700 text-white shadow-sm' : 'text-neutral-400 hover:text-neutral-200'}`}>Leaderboard</button>
              {isAdmin && (
                <>
                  <button onClick={() => setView('admin')} className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${view === 'admin' ? 'bg-neutral-700 text-white shadow-sm' : 'text-neutral-400 hover:text-neutral-200'}`}>
                    <Settings className="w-4 h-4" />
                  </button>
                  <button 
                    onClick={() => setIsAdminActionEnabled(!isAdminActionEnabled)} 
                    className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all flex items-center gap-2 ${isAdminActionEnabled ? 'text-amber-500 hover:text-amber-400' : 'text-neutral-500 hover:text-neutral-400'}`}
                    title={isAdminActionEnabled ? "Admin Actions Enabled" : "Admin Actions Disabled"}
                  >
                    <UserCheck className={`w-4 h-4 ${isAdminActionEnabled ? 'fill-current' : ''}`} />
                  </button>
                </>
              )}
            </div>

            {user ? (
              <div className="flex items-center gap-3 pl-4 border-l border-neutral-800">
                <div className="text-right hidden sm:block">
                  <div className="flex items-center gap-2 justify-end">
                    {isAdmin && <span className="text-[8px] bg-amber-500 text-black px-1 rounded font-black">ADMIN</span>}
                    <p className="text-sm font-medium text-white">{user.displayName}</p>
                  </div>
                  <p className="text-xs text-emerald-500 font-mono">{scores[user.uid] || 0} PTS</p>
                </div>
                <button onClick={signOut} className="p-2 hover:bg-neutral-800 rounded-full text-neutral-400 hover:text-red-400 transition-colors">
                  <LogOut className="w-5 h-5" />
                </button>
              </div>
            ) : (
              <button onClick={signIn} className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-white px-4 py-2 rounded-lg font-medium transition-all shadow-lg shadow-emerald-500/20">
                <LogIn className="w-4 h-4" /> Sign In
              </button>
            )}
          </div>
        </div>
      </nav>

      <main className="max-w-full mx-auto px-4 py-8">
        {error && (
          <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center gap-3 text-red-400">
            <AlertCircle className="w-5 h-5" />
            <p className="text-sm">{error}</p>
            <button onClick={() => setError(null)} className="ml-auto text-xs font-bold">Dismiss</button>
          </div>
        )}

        {view === 'admin' && isAdmin ? (
          <div className="space-y-12 max-w-7xl mx-auto">
            <section className="space-y-6">
              <div className="flex items-center gap-3">
                <Users className="text-emerald-500 w-6 h-6" />
                <h2 className="text-2xl font-black text-white uppercase tracking-tighter">Competitors</h2>
              </div>
              <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 space-y-6">
                <div className="flex gap-3">
                  <input 
                    type="text" 
                    value={newCompetitorName} 
                    onChange={(e) => setNewCompetitorName(e.target.value)} 
                    placeholder="New competitor name..." 
                    className="flex-1 bg-neutral-800 border border-neutral-700 rounded-xl px-4 py-2 text-white focus:ring-2 focus:ring-emerald-500 outline-none transition-all" 
                  />
                  <button onClick={handleAddCompetitor} className="bg-emerald-500 hover:bg-emerald-400 text-white px-6 py-2 rounded-xl font-bold flex items-center gap-2 transition-all active:scale-95 shadow-lg shadow-emerald-500/20">
                    <Plus className="w-5 h-5" /> Add
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {sortedPicks.map((p, idx) => (
                    <div key={p.id} className="bg-neutral-800/50 border border-neutral-700 p-4 rounded-xl flex items-center justify-between group transition-all hover:border-emerald-500/30">
                      <div className="flex-1 min-w-0 mr-4">
                        {editingCompetitorId === p.id ? (
                          <div className="flex items-center gap-2">
                            <input 
                              type="text" 
                              value={editingCompetitorName} 
                              onChange={(e) => setEditingCompetitorName(e.target.value)} 
                              className="w-full bg-neutral-700 border border-emerald-500/50 rounded-lg px-2 py-1 text-sm text-white focus:ring-1 focus:ring-emerald-500 outline-none"
                              autoFocus
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleUpdateCompetitorName(p.id, editingCompetitorName);
                                if (e.key === 'Escape') setEditingCompetitorId(null);
                              }}
                            />
                            <button onClick={() => handleUpdateCompetitorName(p.id, editingCompetitorName)} className="p-1 text-emerald-500 hover:bg-emerald-500/10 rounded">
                              <Check className="w-4 h-4" />
                            </button>
                            <button onClick={() => setEditingCompetitorId(null)} className="p-1 text-neutral-400 hover:bg-neutral-700 rounded">
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 group/name">
                            <p className="font-bold text-white truncate">{p.userName}</p>
                            <button 
                              onClick={() => { setEditingCompetitorId(p.id); setEditingCompetitorName(p.userName); }} 
                              className="opacity-0 group-hover/name:opacity-100 p-1 text-neutral-500 hover:text-emerald-500 transition-all"
                            >
                              <Edit2 className="w-3 h-3" />
                            </button>
                          </div>
                        )}
                        <p className="text-[10px] text-neutral-500 font-mono uppercase tracking-widest">{p.userId.startsWith('manual') ? 'Manual' : 'User'}</p>
                      </div>
                      <div className="flex items-center gap-1">
                        <div className="flex flex-col gap-1 mr-2">
                          <button 
                            onClick={() => handleReorderCompetitor(p.id, 'up')} 
                            disabled={idx === 0}
                            className="p-1 hover:bg-neutral-700 disabled:opacity-20 text-neutral-400 rounded transition-colors"
                          >
                            <ChevronUp className="w-3 h-3" />
                          </button>
                          <button 
                            onClick={() => handleReorderCompetitor(p.id, 'down')} 
                            disabled={idx === sortedPicks.length - 1}
                            className="p-1 hover:bg-neutral-700 disabled:opacity-20 text-neutral-400 rounded transition-colors"
                          >
                            <ChevronDown className="w-3 h-3" />
                          </button>
                        </div>
                        <button 
                          onClick={() => { setEditingPickId(p.id); setView('bracket'); }} 
                          className="p-2 hover:bg-emerald-500/20 text-emerald-500 rounded-lg transition-colors"
                          title="Edit Bracket"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        {confirmDeleteId === p.id ? (
                          <div className="flex items-center gap-1">
                            <button 
                              onClick={() => handleDeleteCompetitor(p.id)} 
                              className="px-2 py-1 bg-red-500 hover:bg-red-400 text-white text-[10px] font-bold rounded-md transition-all"
                            >
                              Confirm
                            </button>
                            <button 
                              onClick={() => setConfirmDeleteId(null)} 
                              className="px-2 py-1 bg-neutral-700 hover:bg-neutral-600 text-white text-[10px] font-bold rounded-md transition-all"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button 
                            onClick={() => setConfirmDeleteId(p.id)} 
                            className="p-2 hover:bg-red-500/20 text-red-500 rounded-lg transition-colors"
                            title="Delete Competitor"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <section className="space-y-6">
              <div className="flex items-center gap-3">
                <Settings className="text-emerald-500 w-6 h-6" />
                <h2 className="text-2xl font-black text-white uppercase tracking-tighter">Tournament Teams</h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {tournament.regions.map((region, rIdx) => (
                  <div key={rIdx} className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 space-y-4">
                    <div className="flex items-center gap-3 border-b border-neutral-800 pb-2">
                      <input 
                        type="text" 
                        value={region.name} 
                        onChange={(e) => handleUpdateRegionName(rIdx, e.target.value)} 
                        className="flex-1 bg-transparent font-bold text-emerald-500 uppercase tracking-widest text-sm focus:ring-1 focus:ring-emerald-500 rounded px-1 outline-none transition-all" 
                      />
                      <span className="text-[10px] text-neutral-600 font-black uppercase tracking-widest">Region Title</span>
                    </div>
                    <div className="space-y-2">
                      {region.teams.sort((a, b) => a.seed - b.seed).map((team, tIdx) => {
                        const actualIdx = tournament.regions[rIdx].teams.findIndex(t => t.id === team.id);
                        return (
                          <div key={team.id} className="flex items-center gap-3">
                            <input 
                              type="number" 
                              value={team.seed} 
                              onChange={(e) => handleUpdateTeam(rIdx, actualIdx, 'seed', parseInt(e.target.value) || 0)} 
                              className="w-12 bg-neutral-800 border border-neutral-700 rounded-lg px-2 py-1.5 text-xs text-white text-center focus:border-emerald-500 outline-none transition-all" 
                            />
                            <input 
                              type="text" 
                              value={team.name} 
                              onChange={(e) => handleUpdateTeam(rIdx, actualIdx, 'name', e.target.value)} 
                              className="flex-1 bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-1.5 text-sm text-white focus:border-emerald-500 outline-none transition-all" 
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        ) : view === 'bracket' ? (
          <div className="space-y-8">
            <div className="flex flex-col md:flex-row items-center justify-between gap-4 bg-neutral-900 border border-neutral-800 rounded-2xl p-6 shadow-xl">
              <div className="flex items-center gap-4">
                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${editingPickId ? 'bg-emerald-500/10' : viewingPickId ? 'bg-blue-500/10' : 'bg-amber-500/10'}`}>
                  {editingPickId ? <Edit2 className="text-emerald-500 w-6 h-6" /> : viewingPickId ? <Users className="text-blue-500 w-6 h-6" /> : <Trophy className="text-amber-500 w-6 h-6" />}
                </div>
                <div>
                  <h2 className="text-lg font-bold text-white">
                    {editingPickId ? `Editing: ${activePick?.userName}` : viewingPickId ? `Viewing: ${activePick?.userName}'s Bracket` : 'Tournament Bracket'}
                  </h2>
                  <p className="text-sm text-neutral-400">
                    {editingPickId ? 'Filling in picks for this competitor' : viewingPickId ? 'Click on any pick to see who else has them' : 'View standings and picks'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {viewingPickId && (
                  <button onClick={() => setViewingPickId(null)} className="flex items-center gap-2 bg-neutral-800 hover:bg-neutral-700 text-white px-4 py-2 rounded-xl text-xs font-bold transition-all border border-neutral-700">
                    <X className="w-3 h-3" /> Clear View
                  </button>
                )}
                <button 
                  onClick={() => setIsResetConfirmOpen(true)}
                  className="flex items-center gap-2 bg-red-500/10 hover:bg-red-500/20 text-red-500 px-4 py-2 rounded-xl text-xs font-bold transition-all border border-red-500/20"
                >
                  <RefreshCw className="w-3 h-3" /> Reset Tournament
                </button>
                {editingPickId && (
                  <button onClick={() => setEditingPickId(null)} className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-white px-6 py-2 rounded-xl text-sm font-bold transition-all active:scale-95 shadow-lg shadow-emerald-500/20">
                    <Check className="w-4 h-4" /> Done Editing
                  </button>
                )}
                {isSimulationMode && (
                  <button 
                    onClick={() => setSimulationOutcome({ ...outcome })}
                    className="p-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-400 rounded-xl border border-neutral-700 transition-all"
                    title="Reset Simulation"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>

            {/* Competitor Selector Pool */}
            <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4 overflow-x-auto">
              <div className="flex items-center gap-2 min-w-max">
                <p className="text-[10px] font-black text-neutral-500 uppercase tracking-widest mr-4">View Bracket:</p>
                <button 
                  onClick={() => setViewingPickId(null)}
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition-all border ${!viewingPickId ? 'bg-emerald-500 text-white border-emerald-400' : 'bg-neutral-800 text-neutral-400 border-neutral-700 hover:border-neutral-600'}`}
                >
                  Official
                </button>
                {sortedPicks.map(p => (
                  <button 
                    key={p.id}
                    onClick={() => {
                      setViewingPickId(p.id);
                      setEditingPickId(null);
                    }}
                    className={`px-4 py-2 rounded-xl text-xs font-bold transition-all border ${viewingPickId === p.id ? 'bg-blue-500 text-white border-blue-400 shadow-lg shadow-blue-500/20' : 'bg-neutral-800 text-neutral-400 border-neutral-700 hover:border-neutral-600'}`}
                  >
                    {p.userName}
                  </button>
                ))}
              </div>
            </div>

            <div className="overflow-x-auto pb-12">
              <div className="min-w-max p-8">
                <div className="grid grid-cols-[1fr_300px_1fr] gap-12 items-center">
                  {/* Left Side: Regions 1 & 2 */}
                  <div className="space-y-16">
                    {tournament.regions.slice(0, 2).map((region, idx) => (
                      <div key={idx} className="space-y-4">
                        <h3 className="text-sm font-black text-neutral-500 uppercase tracking-widest px-4">{region.name} Region</h3>
                        <div className="flex gap-6">
                          {[1, 2, 3, 4].map(round => (
                            <div key={round} className="flex flex-col justify-around gap-4">
                              {GAMES.filter(g => g.region === region.name && g.round === round).map((game, gIdx) => {
                                const [t1Id, t2Id] = getGameTeams(game, activePick || undefined);
                                return (
                                  <div key={game.id} className="relative">
                                    <GameNode 
                                      game={game} 
                                      t1={getTeamById(t1Id || '')} 
                                      t2={getTeamById(t2Id || '')}
                                      winnerId={getGameWinner(game.id, activePick || undefined)}
                                      outcomeId={outcome.results[game.id]}
                                      onPick={(tid: string) => handlePick(game.id, tid)}
                                      isAdmin={isAdmin && isAdminActionEnabled}
                                      isEditing={!!editingPickId}
                                      onManageMatchup={() => isAdmin && isAdminActionEnabled && !editingPickId && setEditingGameId(game.id)}
                                      highlightedTeamId={highlightedTeamId}
                                      setHighlightedTeamId={setHighlightedTeamId}
                                      isSimulationMode={isSimulationMode}
                                      onSimulationPick={(tid: string) => handleOutcome(game.id, tid)}
                                      isTeamEliminated={isTeamEliminated}
                                      onShowPicks={(tid: string) => {
                                        setHighlightedTeamId(tid);
                                        setHighlightedGameId(game.id);
                                      }}
                                      viewingPickId={viewingPickId}
                                    />
                                    {/* Connecting Lines (Left) */}
                                    {game.round < 4 && (
                                      <>
                                        <div className="absolute -right-6 top-1/2 -translate-y-1/2 w-6 h-[2px] bg-neutral-800" />
                                        {gIdx % 2 === 0 && (
                                          <div 
                                            className="absolute -right-6 top-1/2 w-[2px] bg-neutral-800" 
                                            style={{ height: `${Math.pow(2, round - 1) * 4.5}rem` }} 
                                          />
                                        )}
                                      </>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Center: Final Four & Championship */}
                  <div className="flex flex-col justify-center gap-16">
                    <div className="space-y-12">
                      <div className="text-center">
                        <p className="text-[10px] font-black text-amber-500 uppercase tracking-widest mb-4">Final Four</p>
                        <div className="flex flex-col gap-12">
                          {GAMES.filter(g => g.round === 5).map(game => {
                            const [t1Id, t2Id] = getGameTeams(game, activePick || undefined);
                            return (
                              <GameNode 
                                key={game.id}
                                game={game} 
                                t1={getTeamById(t1Id || '')} 
                                t2={getTeamById(t2Id || '')}
                                winnerId={getGameWinner(game.id, activePick || undefined)}
                                outcomeId={outcome.results[game.id]}
                                onPick={(tid: string) => handlePick(game.id, tid)}
                                isAdmin={isAdmin && isAdminActionEnabled}
                                isEditing={!!editingPickId}
                                onManageMatchup={() => isAdmin && isAdminActionEnabled && !editingPickId && setEditingGameId(game.id)}
                                highlightedTeamId={highlightedTeamId}
                                setHighlightedTeamId={setHighlightedTeamId}
                                isSimulationMode={isSimulationMode}
                                onSimulationPick={(tid: string) => handleOutcome(game.id, tid)}
                                isTeamEliminated={isTeamEliminated}
                                onShowPicks={(tid: string) => {
                                  setHighlightedTeamId(tid);
                                  setHighlightedGameId(game.id);
                                }}
                                viewingPickId={viewingPickId}
                              />
                            );
                          })}
                        </div>
                      </div>

                      <div className="text-center">
                        <p className="text-[10px] font-black text-indigo-500 uppercase tracking-widest mb-4">Championship</p>
                        {GAMES.filter(g => g.round === 6).map(game => {
                          const [t1Id, t2Id] = getGameTeams(game, activePick || undefined);
                          return (
                            <div key={game.id} className="scale-110">
                              <GameNode 
                                game={game} 
                                t1={getTeamById(t1Id || '')} 
                                t2={getTeamById(t2Id || '')}
                                winnerId={getGameWinner(game.id, activePick || undefined)}
                                outcomeId={outcome.results[game.id]}
                                onPick={(tid: string) => handlePick(game.id, tid)}
                                isAdmin={isAdmin && isAdminActionEnabled}
                                isEditing={!!editingPickId}
                                onManageMatchup={() => isAdmin && isAdminActionEnabled && !editingPickId && setEditingGameId(game.id)}
                                highlightedTeamId={highlightedTeamId}
                                setHighlightedTeamId={setHighlightedTeamId}
                                isSimulationMode={isSimulationMode}
                                onSimulationPick={(tid: string) => handleOutcome(game.id, tid)}
                                isTeamEliminated={isTeamEliminated}
                                onShowPicks={(tid: string) => {
                                  setHighlightedTeamId(tid);
                                  setHighlightedGameId(game.id);
                                }}
                                viewingPickId={viewingPickId}
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {/* Right Side: Regions 3 & 4 */}
                  <div className="space-y-16">
                    {tournament.regions.slice(2, 4).map((region, idx) => (
                      <div key={idx + 2} className="space-y-4">
                        <h3 className="text-sm font-black text-neutral-500 uppercase tracking-widest px-4 text-right">{region.name} Region</h3>
                        <div className="flex flex-row-reverse gap-6">
                          {[1, 2, 3, 4].map(round => (
                            <div key={round} className="flex flex-col justify-around gap-4">
                              {GAMES.filter(g => g.region === region.name && g.round === round).map((game, gIdx) => {
                                const [t1Id, t2Id] = getGameTeams(game, activePick || undefined);
                                return (
                                  <div key={game.id} className="relative">
                                    <GameNode 
                                      game={game} 
                                      t1={getTeamById(t1Id || '')} 
                                      t2={getTeamById(t2Id || '')}
                                      winnerId={getGameWinner(game.id, activePick || undefined)}
                                      outcomeId={outcome.results[game.id]}
                                      onPick={(tid: string) => handlePick(game.id, tid)}
                                      isAdmin={isAdmin && isAdminActionEnabled}
                                      isEditing={!!editingPickId}
                                      onManageMatchup={() => isAdmin && isAdminActionEnabled && !editingPickId && setEditingGameId(game.id)}
                                      highlightedTeamId={highlightedTeamId}
                                      setHighlightedTeamId={setHighlightedTeamId}
                                      isSimulationMode={isSimulationMode}
                                      onSimulationPick={(tid: string) => handleOutcome(game.id, tid)}
                                      isTeamEliminated={isTeamEliminated}
                                      onShowPicks={(tid: string) => {
                                        setHighlightedTeamId(tid);
                                        setHighlightedGameId(game.id);
                                      }}
                                      viewingPickId={viewingPickId}
                                    />
                                    {/* Connecting Lines (Right) */}
                                    {game.round < 4 && (
                                      <>
                                        <div className="absolute -left-6 top-1/2 -translate-y-1/2 w-6 h-[2px] bg-neutral-800" />
                                        {gIdx % 2 === 0 && (
                                          <div 
                                            className="absolute -left-6 top-1/2 w-[2px] bg-neutral-800" 
                                            style={{ height: `${Math.pow(2, round - 1) * 4.5}rem` }} 
                                          />
                                        )}
                                      </>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto space-y-6">
            <div className="flex items-center gap-3">
              <Trophy className="text-amber-500 w-8 h-8" />
              <h2 className="text-3xl font-black text-white uppercase tracking-tighter">Leaderboard</h2>
            </div>
            <div className="bg-neutral-900 border border-neutral-800 rounded-3xl overflow-hidden shadow-2xl">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-neutral-800/50 text-neutral-400 text-[10px] uppercase tracking-widest font-bold">
                    <th className="px-8 py-5">Rank</th>
                    <th className="px-8 py-5">Competitor</th>
                    <th className="px-8 py-5 text-right">Actual</th>
                    <th className="px-8 py-5 text-right text-neutral-500" title="Points Possible Remaining">PPR</th>
                    <th className="px-8 py-5 text-right text-emerald-500" title="Maximum Possible Points (Current + PPR)">Max</th>
                    {isSimulationMode && (
                      <>
                        <th className="px-8 py-5 text-right text-amber-500">Sim</th>
                        <th className="px-8 py-5 text-right text-amber-600/50" title="Simulated Max Possible">Sim Max</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-800">
                  {leaderboardData.map((p) => (
                    <tr key={p.id} className={`group hover:bg-neutral-800/30 transition-colors ${p.userId === user?.uid ? 'bg-emerald-500/5' : ''}`}>
                      <td className="px-8 py-5">
                        <span className={`w-10 h-10 rounded-xl flex items-center justify-center font-black text-lg ${p.rank === 1 ? 'bg-amber-500 text-white shadow-lg shadow-amber-500/20' : p.rank === 2 ? 'bg-neutral-300 text-neutral-900' : p.rank === 3 ? 'bg-amber-700 text-white' : 'text-neutral-500'}`}>{p.rank}</span>
                      </td>
                      <td className="px-8 py-5">
                        <button 
                          onClick={() => {
                            setViewingPickId(p.id);
                            setView('bracket');
                          }}
                          className="flex items-center gap-3 text-left group/name"
                        >
                          <p className={`font-bold text-lg transition-colors group-hover/name:text-emerald-400 ${((isSimulationMode && simEliminated?.[p.userId]) || (!isSimulationMode && eliminated[p.userId])) ? 'text-neutral-500 line-through' : 'text-white'}`}>
                            {p.userName}
                          </p>
                          {((isSimulationMode && simEliminated?.[p.userId]) || (!isSimulationMode && eliminated[p.userId])) && (
                            <span className="text-[8px] font-black bg-red-500/10 text-red-500 border border-red-500/20 px-1.5 py-0.5 rounded uppercase tracking-widest">Eliminated</span>
                          )}
                          {p.userId === user?.uid && <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-widest">You</span>}
                          <ChevronRight className="w-4 h-4 text-neutral-600 opacity-0 group-hover/name:opacity-100 transition-all -translate-x-2 group-hover/name:translate-x-0" />
                        </button>
                      </td>
                      <td className="px-8 py-5 text-right font-black text-xl text-white font-mono tracking-tighter opacity-60">{scores[p.userId] || 0}</td>
                      <td className="px-8 py-5 text-right font-bold text-lg text-neutral-500 font-mono tracking-tighter">{pprs[p.userId] || 0}</td>
                      <td className="px-8 py-5 text-right font-black text-xl text-emerald-500 font-mono tracking-tighter">{(scores[p.userId] || 0) + (pprs[p.userId] || 0)}</td>
                      {isSimulationMode && (
                        <>
                          <td className="px-8 py-5 text-right font-black text-2xl text-amber-500 font-mono tracking-tighter">
                            {projectedScores ? (projectedScores[p.userId] || 0) : 0}
                          </td>
                          <td className="px-8 py-5 text-right font-bold text-lg text-amber-600/50 font-mono tracking-tighter">
                            {(projectedScores ? (projectedScores[p.userId] || 0) : 0) + (simPprs ? (simPprs[p.userId] || 0) : 0)}
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>

      {/* Projected Leaderboard Pop-up */}
      <AnimatePresence>
        {isSimulationMode && (
          <motion.div 
            initial={{ x: 300, opacity: 0 }} 
            animate={{ x: 0, opacity: 1 }} 
            exit={{ x: 300, opacity: 0 }} 
            className="fixed top-24 right-8 z-[60] w-80 bg-neutral-900/90 border border-amber-500/30 rounded-3xl shadow-[0_20px_50px_rgba(0,0,0,0.5)] backdrop-blur-xl overflow-hidden"
          >
            <div className="p-4 bg-amber-500/10 border-b border-amber-500/20 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Trophy className="w-4 h-4 text-amber-500" />
                <h3 className="text-xs font-black text-white uppercase tracking-widest">Projected Standings</h3>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 bg-amber-500 rounded-full animate-pulse" />
                <span className="text-[8px] font-black text-amber-500 uppercase">Live Sim</span>
              </div>
            </div>
            <div className="max-h-[400px] overflow-y-auto custom-scrollbar">
              <table className="w-full text-left border-collapse">
                <tbody className="divide-y divide-neutral-800">
                  {leaderboardData.slice(0, 10).map((p) => (
                    <tr key={p.id} className={`group hover:bg-neutral-800/30 transition-colors ${p.userId === user?.uid ? 'bg-emerald-500/5' : ''}`}>
                      <td className="pl-4 py-3 w-8">
                        <span className={`text-[10px] font-black ${p.rank === 1 ? 'text-amber-500' : 'text-neutral-500'}`}>{p.rank}</span>
                      </td>
                      <td className="py-3">
                        <button 
                          onClick={() => {
                            setViewingPickId(p.id);
                            setView('bracket');
                          }}
                          className="flex items-center gap-2 text-left group/name"
                        >
                          <p className={`text-xs font-bold truncate max-w-[120px] transition-colors group-hover/name:text-amber-400 ${((isSimulationMode && simEliminated?.[p.userId]) || (!isSimulationMode && eliminated[p.userId])) ? 'text-neutral-500 line-through' : 'text-white'}`}>
                            {p.userName}
                          </p>
                          {((isSimulationMode && simEliminated?.[p.userId]) || (!isSimulationMode && eliminated[p.userId])) && (
                            <span className="text-[6px] font-black bg-red-500/10 text-red-500 border border-red-500/20 px-1 py-0.5 rounded uppercase">Out</span>
                          )}
                        </button>
                      </td>
                      <td className="pr-4 py-3 text-right">
                        <div className="flex flex-col items-end">
                          <span className="text-sm font-black text-amber-500 font-mono tracking-tighter">
                            {p.score}
                          </span>
                          <span className="text-[8px] text-neutral-500 font-bold uppercase">
                            {scores[p.userId] || 0} Actual · PPR: {p.ppr}
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="p-3 bg-neutral-950/50 text-center">
              <p className="text-[8px] text-neutral-500 font-bold uppercase tracking-widest">Showing Top 10 Competitors</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Matchup Admin Modal */}
      <AnimatePresence>
        {editingGameId && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/90 backdrop-blur-md">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }} 
              animate={{ scale: 1, opacity: 1, y: 0 }} 
              exit={{ scale: 0.9, opacity: 0, y: 20 }} 
              className="bg-neutral-900 border border-neutral-800 rounded-[2.5rem] w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col shadow-[0_0_100px_rgba(0,0,0,0.5)]"
            >
              <div className="p-8 border-b border-neutral-800 flex items-center justify-between bg-neutral-900/50">
                <div>
                  <h3 className="text-2xl font-black text-white uppercase tracking-tighter">Matchup Admin</h3>
                  <p className="text-sm text-neutral-400">Manage picks and results for this game</p>
                </div>
                <button onClick={() => setEditingGameId(null)} className="p-3 hover:bg-neutral-800 rounded-2xl transition-colors"><X className="w-6 h-6" /></button>
              </div>
              
              <div className="p-8 overflow-y-auto flex-1 space-y-8 custom-scrollbar">
                {(() => {
                  const game = GAMES.find(g => g.id === editingGameId);
                  const [t1Id, t2Id] = getGameTeams(game!, undefined);
                  const t1 = getTeamById(t1Id || '');
                  const t2 = getTeamById(t2Id || '');
                  
                  return (
                    <>
                      <div className="bg-neutral-800/50 border border-neutral-700 p-6 rounded-3xl flex items-center justify-between">
                        <div className="text-center flex-1">
                          <p className={`text-[10px] uppercase font-black tracking-widest mb-4 ${isSimulationMode ? 'text-amber-500' : 'text-emerald-500'}`}>
                            {isSimulationMode ? 'Simulated Winner' : 'Official Winner'}
                          </p>
                          <div className="flex justify-center gap-4">
                            <div className="flex-1 max-w-[200px] space-y-2">
                              <button 
                                onClick={() => handleOutcome(game!.id, t1?.id || '')} 
                                className={`w-full px-6 py-4 rounded-2xl text-sm font-black uppercase tracking-widest transition-all border-2 ${getGameWinner(game!.id) === t1?.id ? (isSimulationMode ? 'bg-amber-500 border-amber-400 text-white shadow-lg shadow-amber-500/20' : 'bg-emerald-500 border-emerald-400 text-white shadow-lg shadow-emerald-500/20') : 'bg-neutral-800 border-neutral-700 text-neutral-500 hover:border-neutral-600'}`}
                              >
                                {t1?.name || '??'}
                              </button>
                              {isAdmin && isAdminActionEnabled && !isSimulationMode && t1 && (
                                <button 
                                  onClick={() => handleBulkPick(game!.id, t1.id)}
                                  className="w-full py-2 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-500 rounded-xl text-[8px] font-black uppercase tracking-widest border border-emerald-500/20 transition-all"
                                >
                                  Apply to All
                                </button>
                              )}
                            </div>
                            <div className="flex-1 max-w-[200px] space-y-2">
                              <button 
                                onClick={() => handleOutcome(game!.id, t2?.id || '')} 
                                className={`w-full px-6 py-4 rounded-2xl text-sm font-black uppercase tracking-widest transition-all border-2 ${getGameWinner(game!.id) === t2?.id ? (isSimulationMode ? 'bg-amber-500 border-amber-400 text-white shadow-lg shadow-amber-500/20' : 'bg-emerald-500 border-emerald-400 text-white shadow-lg shadow-emerald-500/20') : 'bg-neutral-800 border-neutral-700 text-neutral-500 hover:border-neutral-600'}`}
                              >
                                {t2?.name || '??'}
                              </button>
                              {isAdmin && isAdminActionEnabled && !isSimulationMode && t2 && (
                                <button 
                                  onClick={() => handleBulkPick(game!.id, t2.id)}
                                  className="w-full py-2 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-500 rounded-xl text-[8px] font-black uppercase tracking-widest border border-emerald-500/20 transition-all"
                                >
                                  Apply to All
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="space-y-3">
                        <p className="text-[10px] text-neutral-500 uppercase font-black tracking-widest mb-4">Competitor Picks</p>
                        {picks.map(p => {
                          const [pt1Id, pt2Id] = getGameTeams(game!, p);
                          const pt1 = getTeamById(pt1Id || '');
                          const pt2 = getTeamById(pt2Id || '');
                          
                          return (
                            <div key={p.id} className="flex items-center justify-between p-4 bg-neutral-800/30 border border-neutral-800 rounded-2xl hover:bg-neutral-800/50 transition-colors">
                              <button 
                                onClick={() => {
                                  setViewingPickId(p.id);
                                  setView('bracket');
                                  setEditingGameId(null);
                                }}
                                className="font-bold text-white hover:text-emerald-400 transition-colors flex items-center gap-2 group/name"
                              >
                                {p.userName}
                                <ChevronRight className="w-3 h-3 text-neutral-600 opacity-0 group-hover/name:opacity-100 transition-all" />
                              </button>
                              <div className="flex gap-2">
                                <button 
                                  onClick={() => handlePick(game!.id, pt1?.id || '', p.id)} 
                                  disabled={!pt1 || !isAdminActionEnabled}
                                  className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${p.bracket[game!.id] === pt1?.id && pt1 ? 'bg-emerald-500 text-white' : 'bg-neutral-700 text-neutral-500 hover:bg-neutral-600 disabled:opacity-30'}`}
                                >
                                  {pt1?.name || '??'}
                                </button>
                                <button 
                                  onClick={() => handlePick(game!.id, pt2?.id || '', p.id)} 
                                  disabled={!pt2 || !isAdminActionEnabled}
                                  className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${p.bracket[game!.id] === pt2?.id && pt2 ? 'bg-emerald-500 text-white' : 'bg-neutral-700 text-neutral-500 hover:bg-neutral-600 disabled:opacity-30'}`}
                                >
                                  {pt2?.name || '??'}
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  );
                })()}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Team Info Panel */}
      <AnimatePresence>
        {highlightedTeamId && (
          <motion.div initial={{ opacity: 0, y: 100 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 100 }} className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 w-full max-w-lg px-4">
            <div className="bg-neutral-900/80 border border-emerald-500/30 rounded-3xl p-8 shadow-[0_20px_50px_rgba(0,0,0,0.5)] backdrop-blur-2xl">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-emerald-500 rounded-2xl flex items-center justify-center text-white font-black text-xl shadow-lg shadow-emerald-500/20">{getTeamById(highlightedTeamId)?.seed}</div>
                  <h3 className="text-2xl font-black text-white uppercase tracking-tighter">{getTeamById(highlightedTeamId)?.name}</h3>
                </div>
                <div className="flex items-center gap-2">
                  {isAdmin && (
                    <button 
                      onClick={() => {
                        // Find a game involving this team to manage
                        const game = GAMES.find(g => {
                          const [t1Id, t2Id] = getGameTeams(g, undefined);
                          return t1Id === highlightedTeamId || t2Id === highlightedTeamId;
                        });
                        if (game) setEditingGameId(game.id);
                        setHighlightedTeamId(null);
                      }}
                      className="p-2 bg-amber-500 hover:bg-amber-400 text-black rounded-xl transition-all shadow-lg shadow-amber-500/20"
                      title="Manage Matchup"
                    >
                      <Settings className="w-5 h-5" />
                    </button>
                  )}
                  <button onClick={() => { setHighlightedTeamId(null); setHighlightedGameId(null); }} className="p-2 hover:bg-neutral-800 rounded-xl transition-colors text-neutral-500 hover:text-white"><X /></button>
                </div>
              </div>
              <div className="space-y-4">
                <p className="text-[10px] font-black text-neutral-500 uppercase tracking-widest">
                  {(() => {
                    const game = GAMES.find(g => g.id === highlightedGameId);
                    if (!game) return 'Picked by:';
                    const roundNames: Record<number, string> = {
                      1: 'Round of 64',
                      2: 'Round of 32',
                      3: 'Sweet 16',
                      4: 'Elite 8',
                      5: 'Final Four',
                      6: 'Championship'
                    };
                    return `Picked to win ${roundNames[game.round] || `Round ${game.round}`} by:`;
                  })()}
                </p>
                <div className="flex flex-wrap gap-2">
                  {picks
                    .filter(p => highlightedGameId ? p.bracket[highlightedGameId] === highlightedTeamId : Object.values(p.bracket).includes(highlightedTeamId))
                    .map(p => (
                      <button 
                        key={p.id} 
                        onClick={() => {
                          setViewingPickId(p.id);
                          setView('bracket');
                          setHighlightedTeamId(null);
                          setHighlightedGameId(null);
                        }}
                        className="bg-neutral-800/50 px-4 py-2 rounded-xl border border-neutral-700 flex items-center gap-2 hover:bg-neutral-700 hover:border-emerald-500/50 transition-all active:scale-95"
                      >
                        <span className="text-sm font-bold text-neutral-200">{p.userName}</span>
                        <ChevronRight className="w-3 h-3 text-neutral-500" />
                      </button>
                    ))}
                  {picks.filter(p => highlightedGameId ? p.bracket[highlightedGameId] === highlightedTeamId : Object.values(p.bracket).includes(highlightedTeamId)).length === 0 && (
                    <p className="text-sm text-neutral-600 italic">No one has picked this team for this game yet.</p>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Reset Confirmation Modal */}
      <AnimatePresence>
        {isResetConfirmOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsResetConfirmOpen(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative bg-neutral-900 border border-neutral-800 rounded-3xl p-8 max-w-md w-full shadow-2xl"
            >
              <div className="w-16 h-16 bg-red-500/10 rounded-2xl flex items-center justify-center mb-6 mx-auto">
                <RefreshCw className="text-red-500 w-8 h-8" />
              </div>
              <h3 className="text-2xl font-black text-white text-center uppercase tracking-tighter mb-2">Reset Tournament?</h3>
              <p className="text-neutral-400 text-center mb-8">
                This will restore all regions and teams to their original state and <span className="text-red-400 font-bold">clear all official results</span>. This action cannot be undone.
              </p>
              <div className="flex gap-3">
                <button 
                  onClick={() => setIsResetConfirmOpen(false)}
                  className="flex-1 px-6 py-3 rounded-xl font-bold text-neutral-400 hover:text-white hover:bg-neutral-800 transition-all"
                >
                  Cancel
                </button>
                <button 
                  onClick={handleResetTournament}
                  className="flex-1 px-6 py-3 rounded-xl font-bold bg-red-500 hover:bg-red-400 text-white shadow-lg shadow-red-500/20 transition-all active:scale-95"
                >
                  Reset All
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function GameNode({ game, t1, t2, winnerId, outcomeId, onPick, isAdmin, isEditing, onManageMatchup, highlightedTeamId, setHighlightedTeamId, isSimulationMode, onSimulationPick, isTeamEliminated, onShowPicks, viewingPickId }: any) {
  const canManage = isAdmin && !isEditing;
  
  return (
    <div 
      className={`w-56 bg-neutral-900 border rounded-2xl overflow-hidden transition-all shadow-lg relative group ${isEditing ? 'border-emerald-500/50 ring-2 ring-emerald-500/20' : isSimulationMode ? 'border-amber-500/30 hover:border-amber-500/60 cursor-pointer shadow-amber-500/5' : canManage ? 'border-neutral-800 hover:border-amber-500/50 cursor-pointer hover:shadow-amber-500/10' : 'border-neutral-800'}`}
      onClick={() => {
        if (isSimulationMode) return; // Clicks handled by TeamSlot
        if (canManage) onManageMatchup();
      }}
    >
      {canManage && !isSimulationMode && (
        <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity z-10 pointer-events-none">
          <div className="bg-amber-500 text-black p-1.5 rounded-lg shadow-lg flex items-center gap-1.5">
            <Settings className="w-3 h-3" />
            <span className="text-[8px] font-black uppercase">Manage</span>
          </div>
        </div>
      )}
      {isSimulationMode && (
        <div className="absolute top-2 right-2 z-10 pointer-events-none">
          <div className="bg-amber-500/20 text-amber-500 p-1 rounded-lg flex items-center gap-1">
            <Zap className="w-2.5 h-2.5 fill-current" />
            <span className="text-[7px] font-black uppercase">Sim</span>
          </div>
        </div>
      )}
      <div className="p-3 space-y-2">
        <TeamSlot 
          team={t1} 
          isWinner={winnerId === t1?.id} 
          isOutcome={outcomeId === t1?.id} 
          onSelect={() => onPick(t1?.id)}
          isHighlighted={highlightedTeamId === t1?.id}
          setHighlighted={() => setHighlightedTeamId(t1?.id)}
          isAdmin={isAdmin}
          isEditing={isEditing}
          onManageMatchup={onManageMatchup}
          isSimulationMode={isSimulationMode}
          onSimulationPick={() => onSimulationPick(t1?.id)}
          isEliminated={isTeamEliminated(t1?.id)}
          onShowPicks={() => onShowPicks(t1?.id)}
          viewingPickId={viewingPickId}
        />
        <div className="h-px bg-neutral-800 mx-2" />
        <TeamSlot 
          team={t2} 
          isWinner={winnerId === t2?.id} 
          isOutcome={outcomeId === t2?.id} 
          onSelect={() => onPick(t2?.id)}
          isHighlighted={highlightedTeamId === t2?.id}
          setHighlighted={() => setHighlightedTeamId(t2?.id)}
          isAdmin={isAdmin}
          isEditing={isEditing}
          onManageMatchup={onManageMatchup}
          isSimulationMode={isSimulationMode}
          onSimulationPick={() => onSimulationPick(t2?.id)}
          isEliminated={isTeamEliminated(t2?.id)}
          onShowPicks={() => onShowPicks(t2?.id)}
          viewingPickId={viewingPickId}
        />
      </div>
    </div>
  );
}

function TeamSlot({ team, isWinner, isOutcome, onSelect, isHighlighted, setHighlighted, isAdmin, isEditing, onManageMatchup, isSimulationMode, onSimulationPick, isEliminated, onShowPicks, viewingPickId }: any) {
  if (!team) return <div className="h-8 bg-neutral-800/20 rounded-lg m-1 animate-pulse" />;
  
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    
    if (isSimulationMode) {
      onSimulationPick();
      return;
    }

    if (viewingPickId) {
      onShowPicks();
      return;
    }

    if (isEditing) {
      // In competitor edit mode, clicking the team makes the pick
      onSelect();
    } else if (isAdmin) {
      // In admin mode, explicitly open the Matchup Admin Modal
      onManageMatchup();
    } else {
      // In viewer mode, show the highlight panel
      setHighlighted();
    }
  };

  return (
    <div 
      className={`flex items-center justify-between px-3 py-2 rounded-xl transition-all group ${isHighlighted ? 'bg-emerald-500/20' : 'hover:bg-neutral-800/50'}`}
      onClick={handleClick}
    >
      <div className="flex items-center gap-3 overflow-hidden">
        <span className="text-[10px] font-black text-neutral-500 w-4 text-center font-mono">{team.seed}</span>
        <span className={`text-sm truncate tracking-tight ${
          isWinner 
            ? isOutcome 
              ? 'text-emerald-400 font-black' 
              : isEliminated 
                ? 'text-red-400 line-through opacity-50' 
                : 'text-emerald-400/70 font-bold'
            : isOutcome
              ? 'text-neutral-200 font-bold'
              : isEliminated 
                ? 'text-red-400/50 line-through' 
                : 'text-neutral-400 font-medium'
        }`}>
          {team.name}
        </span>
      </div>
      <div className="flex items-center gap-2">
        {isOutcome && <div className={`w-2 h-2 rounded-full shadow-lg ${isOutcome === 'simulated' ? 'bg-amber-500 shadow-amber-500/50' : 'bg-emerald-500 shadow-emerald-500/50'}`} />}
        {isEditing && (
          <div className={`p-1 rounded-lg transition-all ${isWinner ? 'text-emerald-500 bg-emerald-500/10' : 'text-neutral-700'}`}>
            <Trophy className="w-3.5 h-3.5" />
          </div>
        )}
      </div>
    </div>
  );
}
