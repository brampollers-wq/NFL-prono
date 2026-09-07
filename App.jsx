import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Trophy,
  Flame,
  Lock,
  Users,
  ClipboardList,
  Shield,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  Check,
  Trash2,
  Beer,
  UtensilsCrossed,
  KeyRound,
  LogIn,
  Wifi,
} from "lucide-react";
import { supabase } from "./supabaseClient";

/* ---------------------------------------------------------------
   Constants & helpers
--------------------------------------------------------------- */

const TEAMS = [
  "Arizona Cardinals","Atlanta Falcons","Baltimore Ravens","Buffalo Bills",
  "Carolina Panthers","Chicago Bears","Cincinnati Bengals","Cleveland Browns",
  "Dallas Cowboys","Denver Broncos","Detroit Lions","Green Bay Packers",
  "Houston Texans","Indianapolis Colts","Jacksonville Jaguars","Kansas City Chiefs",
  "Las Vegas Raiders","Los Angeles Chargers","Los Angeles Rams","Miami Dolphins",
  "Minnesota Vikings","New England Patriots","New Orleans Saints","New York Giants",
  "New York Jets","Philadelphia Eagles","Pittsburgh Steelers","San Francisco 49ers",
  "Seattle Seahawks","Tampa Bay Buccaneers","Tennessee Titans","Washington Commanders",
];

const PERIODS = [
  { id: 1, label: "Week 1 t/m 6", min: 1, max: 6 },
  { id: 2, label: "Week 7 t/m 12", min: 7, max: 12 },
  { id: 3, label: "Week 13 t/m 18", min: 13, max: 18 },
];

function periodForWeek(weekNum) {
  const p = PERIODS.find((p) => weekNum >= p.min && weekNum <= p.max);
  return p ? p.id : null;
}

// Vaste groepstoegangscode — zie ook SETUP.md om dit te wijzigen.
const APP_ACCESS_CODE = "NFL2026";

function computeGamePoints(pickedTeam, game, isDouble) {
  if (game.home_score === null || game.home_score === undefined) return null;
  const { home_score: homeScore, away_score: awayScore, home_team: home, away_team: away } = game;
  if (homeScore === awayScore) return 0;
  const winner = homeScore > awayScore ? home : away;
  const margin = Math.abs(homeScore - awayScore);
  let pts;
  if (pickedTeam === winner) pts = margin >= 10 ? 4 : 2;
  else pts = margin >= 10 ? 0 : 1;
  return isDouble ? pts * 2 : pts;
}

function fmtDeadline(iso) {
  if (!iso) return "geen deadline ingesteld";
  return new Date(iso).toLocaleString("nl-BE", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isLocked(week) {
  if (!week?.deadline) return false;
  return new Date() >= new Date(week.deadline);
}

/* ---------------------------------------------------------------
   Main App
--------------------------------------------------------------- */

export default function App() {
  const [unlocked, setUnlocked] = useState(() => localStorage.getItem("unlocked") === "true");
  const [players, setPlayers] = useState([]);
  const [weeks, setWeeks] = useState([]);
  const [games, setGames] = useState([]);
  const [picks, setPicks] = useState([]);
  const [rootingResults, setRootingResults] = useState([]);
  const [myPlayerId, setMyPlayerId] = useState(() => localStorage.getItem("myPlayerId") || null);
  const [tab, setTab] = useState("picks");
  const [activeWeek, setActiveWeek] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const channelRef = useRef(null);

  useEffect(() => {
    if (!unlocked) return;
    loadAll();
    subscribeRealtime();
    return () => {
      if (channelRef.current) supabase.removeChannel(channelRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlocked]);

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }

  async function loadAll() {
    setLoading(true);
    try {
      const [playersRes, weeksRes, gamesRes, picksRes, rootingRes] = await Promise.all([
        supabase.from("players").select("*"),
        supabase.from("weeks").select("*").order("week_num"),
        supabase.from("games").select("*"),
        supabase.from("picks").select("*"),
        supabase.from("rooting_results").select("*"),
      ]);
      if (playersRes.error) throw playersRes.error;
      if (weeksRes.error) throw weeksRes.error;
      if (gamesRes.error) throw gamesRes.error;
      if (picksRes.error) throw picksRes.error;
      if (rootingRes.error) throw rootingRes.error;

      setPlayers(playersRes.data);
      setWeeks(weeksRes.data);
      setGames(gamesRes.data);
      setPicks(picksRes.data);
      setRootingResults(rootingRes.data);

      const weekNums = weeksRes.data.map((w) => w.week_num);
      if (weekNums.length) setActiveWeek(Math.max(...weekNums));
    } catch (e) {
      setError("Kon de gegevens niet laden: " + e.message);
    }
    setLoading(false);
  }

  function subscribeRealtime() {
    const channel = supabase
      .channel("pronostiek-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "games" }, loadAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "picks" }, loadAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "rooting_results" }, loadAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "weeks" }, loadAll)
      .subscribe();
    channelRef.current = channel;
  }

  function unlock() {
    localStorage.setItem("unlocked", "true");
    setUnlocked(true);
  }

  function loginAs(id) {
    localStorage.setItem("myPlayerId", id);
    setMyPlayerId(id);
  }

  function logout() {
    localStorage.removeItem("myPlayerId");
    setMyPlayerId(null);
  }

  async function registerPlayer({ name, championshipTeam, rootingTeam, pin }) {
    const { data, error: insertError } = await supabase
      .from("players")
      .insert({ name, championship_team: championshipTeam, rooting_team: rootingTeam, pin })
      .select()
      .single();
    if (insertError) {
      showToast(
        insertError.code === "23505" ? "Die naam bestaat al, kies een andere." : "Aanmelden mislukt."
      );
      return;
    }
    setPlayers((prev) => [...prev, data]);
    loginAs(data.id);
    showToast(`Welkom, ${data.name}!`);
  }

  async function savePicks(weekNum, gamePicksMap, doubleGameId) {
    if (!myPlayerId) return;
    const rows = Object.entries(gamePicksMap).map(([gameId, team]) => ({
      week_num: weekNum,
      player_id: myPlayerId,
      game_id: gameId,
      picked_team: team,
      is_double: gameId === doubleGameId,
    }));
    const { error: upsertError } = await supabase
      .from("picks")
      .upsert(rows, { onConflict: "player_id,game_id" });
    if (upsertError) {
      showToast("Opslaan van picks is mislukt: " + upsertError.message);
      return;
    }
    await loadAll();
    showToast("Picks opgeslagen!");
  }

  async function adminSaveResult(gameId, homeScore, awayScore) {
    const { error: updateError } = await supabase
      .from("games")
      .update({ home_score: Number(homeScore), away_score: Number(awayScore), status: "final" })
      .eq("id", gameId);
    if (updateError) showToast("Opslaan mislukt: " + updateError.message);
    else await loadAll();
  }

  async function adminSaveRooting(weekNum, team, outcome) {
    const { error: upsertError } = await supabase
      .from("rooting_results")
      .upsert({ week_num: weekNum, team, outcome }, { onConflict: "week_num,team" });
    if (upsertError) showToast("Opslaan mislukt: " + upsertError.message);
    else await loadAll();
  }

  async function adminAddWeek(weekNum, deadline, draftGames) {
    const { error: weekError } = await supabase
      .from("weeks")
      .upsert({ week_num: weekNum, deadline: deadline ? new Date(deadline).toISOString() : null });
    if (weekError) {
      showToast("Opslaan van week mislukt: " + weekError.message);
      return;
    }
    const rows = draftGames.map((g) => ({
      week_num: weekNum,
      home_team: g.home,
      away_team: g.away,
      spread: g.spread || null,
      status: "scheduled",
    }));
    const { error: gamesError } = await supabase.from("games").insert(rows);
    if (gamesError) {
      showToast("Opslaan van wedstrijden mislukt: " + gamesError.message);
      return;
    }
    await loadAll();
    setActiveWeek(Number(weekNum));
    showToast(`Week ${weekNum} opgeslagen.`);
  }

  async function removePlayer(id) {
    const { error: deleteError } = await supabase.from("players").delete().eq("id", id);
    if (deleteError) showToast("Verwijderen mislukt: " + deleteError.message);
    else await loadAll();
  }

  if (!unlocked) return <AccessGate onUnlock={unlock} />;

  if (loading) {
    return (
      <div className="min-h-screen bg-emerald-950 flex items-center justify-center text-emerald-100">
        Bezig met laden…
      </div>
    );
  }

  const weekNums = weeks.map((w) => w.week_num).sort((a, b) => a - b);
  const currentWeek = weeks.find((w) => w.week_num === activeWeek) || null;
  const weekGames = games.filter((g) => g.week_num === activeWeek);
  const me = players.find((p) => p.id === myPlayerId) || null;
  const rootingTeams = Array.from(new Set(players.map((p) => p.rooting_team).filter(Boolean))).sort();

  return (
    <div className="min-h-screen bg-emerald-950 text-emerald-50 pb-16">
      <Header
        weekNums={weekNums}
        activeWeek={activeWeek}
        setActiveWeek={setActiveWeek}
        me={me}
        onLogout={logout}
      />

      <nav className="max-w-3xl mx-auto flex gap-1 px-4 mt-4 border-b border-emerald-800">
        <TabButton icon={<ClipboardList size={16} />} label="Picks" active={tab === "picks"} onClick={() => setTab("picks")} />
        <TabButton icon={<Trophy size={16} />} label="Stand" active={tab === "stand"} onClick={() => setTab("stand")} />
        <TabButton icon={<Shield size={16} />} label="Reglement" active={tab === "reglement"} onClick={() => setTab("reglement")} />
        <TabButton icon={<Users size={16} />} label="Beheer" active={tab === "beheer"} onClick={() => setTab("beheer")} />
      </nav>

      <main className="max-w-3xl mx-auto px-4 mt-6">
        {error && (
          <div className="mb-4 flex items-center gap-2 bg-red-950 border border-red-800 text-red-200 text-sm px-3 py-2 rounded">
            <AlertCircle size={16} />
            {error}
          </div>
        )}

        {tab === "picks" && (
          <PicksTab
            week={currentWeek}
            weekGames={weekGames}
            weekNum={activeWeek}
            players={players}
            me={me}
            picks={picks}
            savePicks={savePicks}
            onRegister={registerPlayer}
            onLogin={loginAs}
            showToast={showToast}
          />
        )}

        {tab === "stand" && (
          <StandTab players={players} weeks={weeks} games={games} picks={picks} rootingResults={rootingResults} />
        )}

        {tab === "reglement" && <ReglementTab />}

        {tab === "beheer" && (
          <BeheerTab
            weeks={weeks}
            games={games}
            players={players}
            rootingTeams={rootingTeams}
            rootingResults={rootingResults}
            onAddWeek={adminAddWeek}
            onSaveResult={adminSaveResult}
            onSaveRooting={adminSaveRooting}
            onRemovePlayer={removePlayer}
            showToast={showToast}
          />
        )}
      </main>

      <div className="fixed bottom-4 right-4 flex items-center gap-1.5 text-xs text-emerald-500">
        <Wifi size={13} /> live verbonden
      </div>

      {toast && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-amber-400 text-emerald-950 font-semibold text-sm px-4 py-2 rounded shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------
   Access gate
--------------------------------------------------------------- */

function AccessGate({ onUnlock }) {
  const [input, setInput] = useState("");
  const [error, setError] = useState("");

  function submit() {
    if (input.trim() === APP_ACCESS_CODE) onUnlock();
    else setError("Foute toegangscode.");
  }

  return (
    <div className="min-h-screen bg-emerald-950 text-emerald-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm border border-emerald-800 rounded-md p-6 bg-emerald-900/30">
        <div className="flex items-center gap-2 mb-1">
          <KeyRound size={18} className="text-amber-400" />
          <h1 style={{ fontFamily: "'Bebas Neue', sans-serif" }} className="text-2xl text-amber-400">
            NFL Pronostiek
          </h1>
        </div>
        <p className="text-sm text-emerald-300 mb-4">Voer de groepstoegangscode in om verder te gaan.</p>
        <input
          type="password"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Toegangscode"
          className="w-full bg-emerald-950 border border-emerald-700 rounded px-3 py-2 text-sm mb-2"
          autoFocus
        />
        {error && <p className="text-red-400 text-xs mb-2">{error}</p>}
        <button
          onClick={submit}
          className="w-full bg-amber-400 hover:bg-amber-300 text-emerald-950 font-semibold text-sm py-2.5 rounded"
        >
          Ontgrendelen
        </button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------
   Header & tabs
--------------------------------------------------------------- */

function Header({ weekNums, activeWeek, setActiveWeek, me, onLogout }) {
  const idx = weekNums.indexOf(activeWeek);
  return (
    <header className="border-b border-emerald-800 bg-emerald-900/40">
      <div className="max-w-3xl mx-auto px-4 py-5 flex items-center justify-between">
        <div>
          <h1 style={{ fontFamily: "'Bebas Neue', sans-serif", letterSpacing: "0.03em" }} className="text-4xl text-amber-400 leading-none">
            NFL Pronostiek
          </h1>
          <p className="text-emerald-300 text-sm mt-1">
            {me ? (
              <>
                Ingelogd als <span className="text-emerald-100 font-medium">{me.name}</span>{" "}
                <button onClick={onLogout} className="underline text-emerald-400 hover:text-amber-400 ml-1">
                  (wissel speler)
                </button>
              </>
            ) : (
              "Nog niet geregistreerd"
            )}
          </p>
        </div>
        {weekNums.length > 0 && (
          <div className="flex items-center gap-2">
            <button
              disabled={idx <= 0}
              onClick={() => setActiveWeek(weekNums[idx - 1])}
              className="p-1.5 rounded border border-emerald-700 disabled:opacity-30 hover:bg-emerald-800"
            >
              <ChevronLeft size={16} />
            </button>
            <div style={{ fontFamily: "'Bebas Neue', sans-serif" }} className="text-2xl w-24 text-center text-emerald-50 border border-emerald-700 rounded px-2 py-0.5">
              Week {activeWeek}
            </div>
            <button
              disabled={idx >= weekNums.length - 1}
              onClick={() => setActiveWeek(weekNums[idx + 1])}
              className="p-1.5 rounded border border-emerald-700 disabled:opacity-30 hover:bg-emerald-800"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        )}
      </div>
    </header>
  );
}

function TabButton({ icon, label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={
        "flex items-center gap-1.5 text-sm px-3 py-2 border-b-2 -mb-px transition-colors " +
        (active ? "border-amber-400 text-amber-400" : "border-transparent text-emerald-400 hover:text-emerald-100")
      }
    >
      {icon}
      {label}
    </button>
  );
}

/* ---------------------------------------------------------------
   Picks tab
--------------------------------------------------------------- */

function PicksTab({ week, weekGames, weekNum, players, me, picks, savePicks, onRegister, onLogin, showToast }) {
  const myExistingPicks = (me && picks.filter((p) => p.week_num === weekNum && p.player_id === me.id)) || [];
  const initialMap = {};
  let initialDouble = null;
  for (const p of myExistingPicks) {
    initialMap[p.game_id] = p.picked_team;
    if (p.is_double) initialDouble = p.game_id;
  }

  const [gamePicks, setGamePicks] = useState(initialMap);
  const [doubleGameId, setDoubleGameId] = useState(initialDouble);

  useEffect(() => {
    const map = {};
    let dbl = null;
    for (const p of picks.filter((x) => x.week_num === weekNum && x.player_id === me?.id)) {
      map[p.game_id] = p.picked_team;
      if (p.is_double) dbl = p.game_id;
    }
    setGamePicks(map);
    setDoubleGameId(dbl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekNum, me?.id]);

  if (!week || weekGames.length === 0) {
    return (
      <EmptyState
        title="Geen wedstrijden voor deze week"
        body="De wekelijkse selectie draait elke woensdag automatisch. Nog niets te zien? Kijk bij Beheer of er iets manueel moet worden toegevoegd."
      />
    );
  }

  if (!me) return <PlayerGate players={players} onRegister={onRegister} onLogin={onLogin} showToast={showToast} />;

  const locked = isLocked(week);
  const period = periodForWeek(weekNum);
  const allPicked = weekGames.every((g) => gamePicks[g.id]);

  let periodUsedElsewhere = false;
  if (period) {
    const myDoubles = picks.filter((p) => p.player_id === me.id && p.is_double && p.week_num !== weekNum);
    periodUsedElsewhere = myDoubles.some((p) => periodForWeek(p.week_num) === period);
  }

  function selectPick(gameId, team) {
    if (locked) return;
    setGamePicks((prev) => ({ ...prev, [gameId]: team }));
  }

  function toggleDouble(gameId) {
    if (locked || !allPicked || periodUsedElsewhere || !period) return;
    setDoubleGameId((prev) => (prev === gameId ? null : gameId));
  }

  function submit() {
    if (!allPicked) {
      showToast("Kies eerst een winnaar voor elke wedstrijd.");
      return;
    }
    savePicks(weekNum, gamePicks, doubleGameId);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="text-sm text-emerald-300 flex items-center gap-1.5">
          {locked ? <Lock size={14} /> : null}
          Deadline: <span className="text-emerald-100">{fmtDeadline(week.deadline)}</span>
        </div>
        {period && (
          <div className={"text-xs px-2 py-1 rounded border " + (periodUsedElsewhere ? "border-emerald-800 text-emerald-500" : "border-amber-700 text-amber-400")}>
            Dubbele-puntenvenster: {PERIODS.find((p) => p.id === period).label}
            {periodUsedElsewhere ? " (al gebruikt)" : ""}
          </div>
        )}
      </div>

      {locked && (
        <div className="mb-4 text-sm bg-emerald-900/60 border border-emerald-800 rounded px-3 py-2 text-emerald-300">
          De deadline voor deze week is verstreken.
        </div>
      )}

      <div className="space-y-3">
        {weekGames.map((g) => (
          <div key={g.id} className="border border-emerald-800 rounded-md p-3 bg-emerald-900/30">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-emerald-400">{g.spread ? `Spread: ${g.spread}` : "Geen spread"}</span>
              <button
                onClick={() => toggleDouble(g.id)}
                disabled={locked || !allPicked || periodUsedElsewhere || !period}
                className={
                  "flex items-center gap-1 text-xs px-2 py-1 rounded border disabled:opacity-30 " +
                  (doubleGameId === g.id ? "bg-amber-400 text-emerald-950 border-amber-400" : "border-emerald-700 text-emerald-300 hover:border-amber-500")
                }
              >
                <Flame size={13} />
                2x punten
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {[g.away_team, g.home_team].map((team) => (
                <button
                  key={team}
                  disabled={locked}
                  onClick={() => selectPick(g.id, team)}
                  className={
                    "text-sm px-3 py-2 rounded border text-left disabled:opacity-60 " +
                    (gamePicks[g.id] === team ? "bg-amber-400 border-amber-400 text-emerald-950 font-semibold" : "border-emerald-700 hover:border-amber-500")
                  }
                >
                  {team}
                </button>
              ))}
            </div>
            {g.status === "final" && (
              <div className="mt-2 text-xs text-emerald-400">
                Eindstand: {g.away_team} {g.away_score} – {g.home_score} {g.home_team}
              </div>
            )}
          </div>
        ))}
      </div>

      {!locked && (
        <button onClick={submit} className="mt-5 w-full bg-amber-400 hover:bg-amber-300 text-emerald-950 font-semibold text-sm py-2.5 rounded flex items-center justify-center gap-2">
          <Check size={16} />
          Picks opslaan
        </button>
      )}
    </div>
  );
}

function PlayerGate({ players, onRegister, onLogin, showToast }) {
  const [mode, setMode] = useState(players.length ? "login" : "register");

  if (mode === "register") {
    return (
      <div>
        <RegisterForm onRegister={onRegister} />
        {players.length > 0 && (
          <button onClick={() => setMode("login")} className="mt-3 text-xs text-emerald-400 hover:text-amber-400 underline">
            Ik ben al geregistreerd
          </button>
        )}
      </div>
    );
  }

  return (
    <div>
      <LoginForm players={players} onLogin={onLogin} showToast={showToast} />
      <button onClick={() => setMode("register")} className="mt-3 text-xs text-emerald-400 hover:text-amber-400 underline">
        Nieuwe speler? Meld je hier aan
      </button>
    </div>
  );
}

function LoginForm({ players, onLogin, showToast }) {
  const [playerId, setPlayerId] = useState(players[0]?.id || "");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");

  function submit() {
    const player = players.find((p) => p.id === playerId);
    if (!player) return;
    if (player.pin && player.pin !== pin) {
      setError("Foute pincode.");
      return;
    }
    onLogin(player.id);
    showToast(`Welkom terug, ${player.name}!`);
  }

  return (
    <div className="border border-emerald-800 rounded-md p-5 bg-emerald-900/30 space-y-4">
      <h2 style={{ fontFamily: "'Bebas Neue', sans-serif" }} className="text-2xl text-amber-400 flex items-center gap-2">
        <LogIn size={20} /> Inloggen
      </h2>
      <div>
        <label className="text-xs text-emerald-400">Wie ben jij?</label>
        <select value={playerId} onChange={(e) => setPlayerId(e.target.value)} className="w-full mt-1 bg-emerald-950 border border-emerald-700 rounded px-3 py-2 text-sm">
          {players.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="text-xs text-emerald-400">Pincode</label>
        <input
          type="password"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          className="w-full mt-1 bg-emerald-950 border border-emerald-700 rounded px-3 py-2 text-sm"
          placeholder="4 cijfers"
        />
      </div>
      {error && <p className="text-red-400 text-xs">{error}</p>}
      <button onClick={submit} className="w-full bg-amber-400 hover:bg-amber-300 text-emerald-950 font-semibold text-sm py-2.5 rounded">
        Inloggen
      </button>
    </div>
  );
}

function RegisterForm({ onRegister }) {
  const [name, setName] = useState("");
  const [championshipTeam, setChampionshipTeam] = useState("");
  const [rootingTeam, setRootingTeam] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");

  function submit() {
    if (!name.trim() || !championshipTeam || !rootingTeam || pin.trim().length !== 4) {
      setError("Vul je naam, beide teams en een pincode van 4 cijfers in.");
      return;
    }
    onRegister({ name: name.trim(), championshipTeam, rootingTeam, pin: pin.trim() });
  }

  return (
    <div className="border border-emerald-800 rounded-md p-5 bg-emerald-900/30 space-y-4">
      <h2 style={{ fontFamily: "'Bebas Neue', sans-serif" }} className="text-2xl text-amber-400">Meld je aan</h2>
      <p className="text-sm text-emerald-300">
        Kies je naam, je championship team, je rooting team en een pincode van 4 cijfers zodat niemand anders voor jou kan kiezen.
      </p>
      <div>
        <label className="text-xs text-emerald-400">Naam</label>
        <input value={name} onChange={(e) => setName(e.target.value)} className="w-full mt-1 bg-emerald-950 border border-emerald-700 rounded px-3 py-2 text-sm" placeholder="Bv. Niels" />
      </div>
      <div>
        <label className="text-xs text-emerald-400">Championship team</label>
        <select value={championshipTeam} onChange={(e) => setChampionshipTeam(e.target.value)} className="w-full mt-1 bg-emerald-950 border border-emerald-700 rounded px-3 py-2 text-sm">
          <option value="">Kies een team…</option>
          {TEAMS.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      <div>
        <label className="text-xs text-emerald-400">Rooting team</label>
        <select value={rootingTeam} onChange={(e) => setRootingTeam(e.target.value)} className="w-full mt-1 bg-emerald-950 border border-emerald-700 rounded px-3 py-2 text-sm">
          <option value="">Kies een team…</option>
          {TEAMS.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      <div>
        <label className="text-xs text-emerald-400">Pincode (4 cijfers)</label>
        <input
          type="password"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
          className="w-full mt-1 bg-emerald-950 border border-emerald-700 rounded px-3 py-2 text-sm"
          placeholder="Bv. 1234"
        />
      </div>
      {error && <p className="text-red-400 text-xs">{error}</p>}
      <button onClick={submit} className="w-full bg-amber-400 hover:bg-amber-300 text-emerald-950 font-semibold text-sm py-2.5 rounded">
        Aanmelden
      </button>
    </div>
  );
}

/* ---------------------------------------------------------------
   Stand (leaderboard) tab
--------------------------------------------------------------- */

function StandTab({ players, weeks, games, picks, rootingResults }) {
  if (players.length === 0) {
    return <EmptyState title="Nog geen spelers" body="Zodra iemand zich aanmeldt via de Picks-tab, verschijnt hier de stand." />;
  }

  const rows = players.map((player) => {
    let total = 0;
    for (const week of weeks) {
      const gamesOfWeek = games.filter((g) => g.week_num === week.week_num);
      const myPicks = picks.filter((p) => p.week_num === week.week_num && p.player_id === player.id);
      for (const pick of myPicks) {
        const game = gamesOfWeek.find((g) => g.id === pick.game_id);
        if (!game) continue;
        const pts = computeGamePoints(pick.picked_team, game, pick.is_double);
        if (pts !== null) total += pts;
      }
      const rooting = rootingResults.find((r) => r.week_num === week.week_num && r.team === player.rooting_team);
      if (rooting?.outcome === "win") total += 1;
      else if (rooting?.outcome === "loss") total -= 1;
    }
    return { player, total };
  });

  rows.sort((a, b) => b.total - a.total);

  return (
    <div>
      <div className="border border-emerald-800 rounded-md overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-emerald-900/60 text-emerald-400 text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left px-3 py-2">#</th>
              <th className="text-left px-3 py-2">Speler</th>
              <th className="text-left px-3 py-2">Rooting team</th>
              <th className="text-right px-3 py-2">Punten</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.player.id} className="border-t border-emerald-800">
                <td className="px-3 py-2 text-emerald-400">{i + 1}</td>
                <td className="px-3 py-2 flex items-center gap-1.5">
                  {i === 0 && <Trophy size={14} className="text-amber-400" />}
                  {r.player.name}
                </td>
                <td className="px-3 py-2 text-emerald-300">{r.player.rooting_team}</td>
                <td className="px-3 py-2 text-right font-semibold text-emerald-50">{r.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {rows.length >= 2 && (
        <div className="mt-4 grid sm:grid-cols-3 gap-3 text-xs text-emerald-300">
          <div className="border border-emerald-800 rounded p-3 flex items-center gap-2">
            <Trophy size={16} className="text-amber-400" />
            <span><span className="text-emerald-100 font-medium">{rows[0].player.name}</span> is voorlopig "King of the NFL".</span>
          </div>
          <div className="border border-emerald-800 rounded p-3 flex items-center gap-2">
            <Beer size={16} className="text-amber-400" />
            <span><span className="text-emerald-100 font-medium">{rows[1].player.name}</span> voorziet voorlopig de drank.</span>
          </div>
          <div className="border border-emerald-800 rounded p-3 flex items-center gap-2">
            <UtensilsCrossed size={16} className="text-amber-400" />
            <span>
              <span className="text-emerald-100 font-medium">{rows[rows.length - (rows.length >= 3 ? 2 : 1)].player.name}</span>{" "}
              {rows.length >= 3 ? "verzorgt voorlopig het vlees" : "organiseert voorlopig de BBQ"}.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------
   Reglement tab
--------------------------------------------------------------- */

function ReglementTab() {
  return (
    <div className="space-y-4 text-sm text-emerald-200 leading-relaxed">
      <Section title="Puntentelling per wedstrijd">
        <ul className="list-disc pl-5 space-y-1">
          <li>Winst met 10 punten verschil of meer: 4 punten</li>
          <li>Winst met minder dan 10 punten verschil: 2 punten</li>
          <li>Verlies met minder dan 10 punten verschil: 1 punt</li>
          <li>Verlies met 10 punten verschil of meer: 0 punten</li>
        </ul>
      </Section>
      <Section title="Rooting team">
        Wint je rooting team die week, dan krijg je 1 extra punt. Verliest het, dan verlies je 1 punt. Bij gelijkspel of een bye-week verandert er niets. Dit wordt automatisch bijgehouden.
      </Section>
      <Section title="Dubbele-puntenwedstrijden">
        Je krijgt 3 dubbele-puntenkaarten: één in te zetten tussen week 1 en 6, één tussen week 7 en 12, en één tussen week 13 en 18. Zet je hem niet op tijd in, dan vervalt hij. Je moet eerst al je picks voor die week hebben doorgegeven voordat je een dubbele-puntenwedstrijd mag kiezen.
      </Section>
      <Section title="Automatisering">
        Elke woensdagochtend worden de 5 spannendste wedstrijden (kleinste spread) automatisch toegevoegd. Zodra een wedstrijd is afgelopen, wordt de uitslag automatisch opgehaald en worden de punten meteen herberekend.
      </Section>
      <Section title="Eindstand & rechten/plichten">
        <ul className="list-disc pl-5 space-y-1">
          <li>Winnaar: officieel "King of the NFL", wordt gehuldigd op de afsluitende BBQ.</li>
          <li>Tweede plaats: verzorgt de drank op de BBQ.</li>
          <li>Voorlaatste plaats: verzorgt het feestmaal (vlees en dergelijke).</li>
          <li>Laatste plaats: organiseert de volledige afsluitende BBQ.</li>
        </ul>
      </Section>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="border border-emerald-800 rounded-md p-4 bg-emerald-900/30">
      <h3 className="text-amber-400 font-semibold mb-1.5">{title}</h3>
      <div>{children}</div>
    </div>
  );
}

/* ---------------------------------------------------------------
   Beheer (admin) tab — nu vooral voor manuele correcties, want
   wedstrijden en uitslagen komen automatisch binnen.
--------------------------------------------------------------- */

function BeheerTab({ weeks, games, players, rootingTeams, rootingResults, onAddWeek, onSaveResult, onSaveRooting, onRemovePlayer, showToast }) {
  const [newWeekNum, setNewWeekNum] = useState(weeks.length ? Math.max(...weeks.map((w) => w.week_num)) + 1 : 1);
  const [deadline, setDeadline] = useState("");
  const [draftGames, setDraftGames] = useState([{ home: "", away: "", spread: "" }]);

  function addDraftGame() {
    if (draftGames.length >= 6) return;
    setDraftGames([...draftGames, { home: "", away: "", spread: "" }]);
  }
  function removeDraftGame(idx) {
    setDraftGames(draftGames.filter((_, i) => i !== idx));
  }
  function updateDraftGame(idx, field, value) {
    setDraftGames(draftGames.map((g, i) => (i === idx ? { ...g, [field]: value } : g)));
  }

  function saveWeek() {
    if (!newWeekNum || draftGames.some((g) => !g.home || !g.away)) {
      showToast("Vul voor elke wedstrijd een thuis- en uitploeg in.");
      return;
    }
    onAddWeek(newWeekNum, deadline, draftGames);
    setDraftGames([{ home: "", away: "", spread: "" }]);
  }

  const sortedWeeks = [...weeks].sort((a, b) => b.week_num - a.week_num);

  return (
    <div className="space-y-8">
      <div className="border border-amber-800 rounded-md p-4 bg-amber-950/20 text-sm text-amber-200">
        Wedstrijden en uitslagen komen normaal automatisch binnen (elke woensdag, en na elke wedstrijd).
        Gebruik onderstaande formulieren enkel als noodgreep — bv. als de automatische taak een week heeft
        gemist, of een uitslag verkeerd staat.
      </div>

      <div className="border border-emerald-800 rounded-md p-4 bg-emerald-900/30">
        <h3 className="text-amber-400 font-semibold mb-3">Week handmatig toevoegen</h3>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className="text-xs text-emerald-400">Weeknummer</label>
            <input type="number" value={newWeekNum} onChange={(e) => setNewWeekNum(e.target.value)} className="w-full mt-1 bg-emerald-950 border border-emerald-700 rounded px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs text-emerald-400">Deadline (1e kickoff)</label>
            <input type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} className="w-full mt-1 bg-emerald-950 border border-emerald-700 rounded px-3 py-2 text-sm" />
          </div>
        </div>
        <div className="space-y-2">
          {draftGames.map((g, idx) => (
            <div key={idx} className="flex gap-2 items-center">
              <select value={g.away} onChange={(e) => updateDraftGame(idx, "away", e.target.value)} className="flex-1 bg-emerald-950 border border-emerald-700 rounded px-2 py-1.5 text-xs">
                <option value="">Uitploeg…</option>
                {TEAMS.map((t) => <option key={t}>{t}</option>)}
              </select>
              <span className="text-emerald-500 text-xs">@</span>
              <select value={g.home} onChange={(e) => updateDraftGame(idx, "home", e.target.value)} className="flex-1 bg-emerald-950 border border-emerald-700 rounded px-2 py-1.5 text-xs">
                <option value="">Thuisploeg…</option>
                {TEAMS.map((t) => <option key={t}>{t}</option>)}
              </select>
              <input placeholder="Bv. Cowboys -2.5" value={g.spread} onChange={(e) => updateDraftGame(idx, "spread", e.target.value)} className="w-28 bg-emerald-950 border border-emerald-700 rounded px-2 py-1.5 text-xs" />
              <button onClick={() => removeDraftGame(idx)} className="text-emerald-500 hover:text-red-400">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
        <button onClick={addDraftGame} disabled={draftGames.length >= 6} className="mt-2 text-xs text-amber-400 hover:text-amber-300 disabled:opacity-30">
          + Wedstrijd toevoegen (max. 6)
        </button>
        <button onClick={saveWeek} className="mt-4 w-full bg-amber-400 hover:bg-amber-300 text-emerald-950 font-semibold text-sm py-2 rounded">
          Week opslaan
        </button>
      </div>

      {sortedWeeks.map((wk) => (
        <div key={wk.week_num} className="border border-emerald-800 rounded-md p-4 bg-emerald-900/30">
          <h3 className="text-amber-400 font-semibold mb-3">Week {wk.week_num}</h3>
          <div className="space-y-2">
            {games.filter((g) => g.week_num === wk.week_num).map((g) => (
              <ResultRow key={g.id} game={g} onSave={onSaveResult} />
            ))}
          </div>

          {rootingTeams.length > 0 && (
            <>
              <h4 className="text-emerald-400 text-xs uppercase tracking-wide mt-4 mb-2">Rooting team-uitslagen</h4>
              <div className="space-y-1.5">
                {rootingTeams.map((team) => {
                  const current = rootingResults.find((r) => r.week_num === wk.week_num && r.team === team);
                  return (
                    <div key={team} className="flex items-center justify-between text-sm">
                      <span>{team}</span>
                      <select
                        value={current?.outcome || ""}
                        onChange={(e) => onSaveRooting(wk.week_num, team, e.target.value)}
                        className="bg-emerald-950 border border-emerald-700 rounded px-2 py-1 text-xs"
                      >
                        <option value="">– (nog niet bekend)</option>
                        <option value="win">Gewonnen (+1)</option>
                        <option value="loss">Verloren (-1)</option>
                        <option value="tie">Gelijk (0)</option>
                        <option value="bye">Bye-week (0)</option>
                      </select>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      ))}

      <div className="border border-emerald-800 rounded-md p-4 bg-emerald-900/30">
        <h3 className="text-amber-400 font-semibold mb-3">Spelers</h3>
        {players.length === 0 && <p className="text-sm text-emerald-400">Nog niemand aangemeld.</p>}
        <div className="space-y-1.5">
          {players.map((p) => (
            <div key={p.id} className="flex items-center justify-between text-sm">
              <span>
                {p.name}{" "}
                <span className="text-emerald-400 text-xs">
                  (championship: {p.championship_team}, rooting: {p.rooting_team})
                </span>
              </span>
              <button onClick={() => onRemovePlayer(p.id)} className="text-emerald-500 hover:text-red-400">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ResultRow({ game, onSave }) {
  const [home, setHome] = useState(game.home_score ?? "");
  const [away, setAway] = useState(game.away_score ?? "");

  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="flex-1">{game.away_team} @ {game.home_team}</span>
      <input type="number" value={away} onChange={(e) => setAway(e.target.value)} placeholder="Uit" className="w-16 bg-emerald-950 border border-emerald-700 rounded px-2 py-1 text-xs" />
      <span className="text-emerald-500">–</span>
      <input type="number" value={home} onChange={(e) => setHome(e.target.value)} placeholder="Thuis" className="w-16 bg-emerald-950 border border-emerald-700 rounded px-2 py-1 text-xs" />
      <button
        onClick={() => onSave(game.id, home, away)}
        disabled={home === "" || away === ""}
        className="text-xs px-2 py-1 rounded bg-amber-400 text-emerald-950 font-semibold disabled:opacity-30"
      >
        Opslaan
      </button>
    </div>
  );
}

/* ---------------------------------------------------------------
   Small shared bits
--------------------------------------------------------------- */

function EmptyState({ title, body }) {
  return (
    <div className="border border-dashed border-emerald-700 rounded-md p-8 text-center">
      <h3 className="text-amber-400 font-semibold mb-1">{title}</h3>
      <p className="text-sm text-emerald-300">{body}</p>
    </div>
  );
}
