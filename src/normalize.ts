import type { BzzoiroCardIncident, BzzoiroGoalIncident, BzzoiroLiveEvent } from "./bzzoiro.js";

export interface MatchEvent {
  eventType: string;
  dedupeId: string;
  matchId: number;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  minute: number | null;
  description: string;
}

function scores(match: BzzoiroLiveEvent): { home: number; away: number } {
  return { home: match.home_score ?? 0, away: match.away_score ?? 0 };
}

export function goalHasScore(incident: BzzoiroGoalIncident): boolean {
  return incident.home_score != null && incident.away_score != null;
}

export function goalDedupeId({
  matchId,
  incident,
}: {
  matchId: number;
  incident: BzzoiroGoalIncident;
}): string {
  return `${matchId}:goal:${incident.home_score}-${incident.away_score}`;
}

export function goalDisallowedDedupeId({
  matchId,
  side,
  homeScore,
  awayScore,
}: {
  matchId: number;
  side: "home" | "away";
  homeScore: number;
  awayScore: number;
}): string {
  return `${matchId}:disallowed:${side}:${homeScore}-${awayScore}`;
}

export function cardDedupeId({
  matchId,
  incident,
}: {
  matchId: number;
  incident: BzzoiroCardIncident;
}): string {
  const type = cardType(incident.card_type);
  if (incident.player_id != null) return `${matchId}:card:${incident.player_id}:${type}`;
  const side = incident.is_home ? "home" : "away";
  return `${matchId}:card:${side}:${incident.minute}:${type}`;
}

export function cardType(raw: string | undefined): "red" | "yellow" {
  return (raw ?? "").toLowerCase().includes("red") ? "red" : "yellow";
}

function goalEventType(goalType: string | undefined): string {
  switch (goalType) {
    case "penalty": return "PENALTY_GOAL";
    case "ownGoal": return "OWN_GOAL";
    default: return "GOAL";
  }
}

export function normalizeGoal({
  match,
  incident,
}: {
  match: BzzoiroLiveEvent;
  incident: BzzoiroGoalIncident;
}): MatchEvent {
  const { home, away } = scores(match);
  const homeScore = incident.home_score ?? home;
  const awayScore = incident.away_score ?? away;
  const eventType = goalEventType(incident.goal_type);
  const teamName = incident.is_home ? match.home_team : match.away_team;
  const player = incident.player ?? "Unknown";
  const verb =
    eventType === "PENALTY_GOAL" ? "Penalty!" :
    eventType === "OWN_GOAL" ? "Own goal —" : "Goal!";
  return {
    eventType,
    dedupeId: goalDedupeId({ matchId: match.id, incident }),
    matchId: match.id,
    homeTeam: match.home_team,
    awayTeam: match.away_team,
    homeScore,
    awayScore,
    minute: incident.minute ?? match.current_minute ?? null,
    description: `${verb} ${player} (${teamName}) ${homeScore}-${awayScore}`,
  };
}

export function normalizeGoalDisallowed({
  match,
  side,
}: {
  match: BzzoiroLiveEvent;
  side: "home" | "away";
}): MatchEvent {
  const { home, away } = scores(match);
  const teamName = side === "home" ? match.home_team : match.away_team;
  return {
    eventType: "GOAL_DISALLOWED",
    dedupeId: goalDisallowedDedupeId({
      matchId: match.id,
      side,
      homeScore: home,
      awayScore: away,
    }),
    matchId: match.id,
    homeTeam: match.home_team,
    awayTeam: match.away_team,
    homeScore: home,
    awayScore: away,
    minute: match.current_minute ?? null,
    description: `Goal disallowed — ${teamName} (${home}-${away})`,
  };
}

export function normalizeCard({
  match,
  incident,
}: {
  match: BzzoiroLiveEvent;
  incident: BzzoiroCardIncident;
}): MatchEvent {
  const { home, away } = scores(match);
  const teamName = incident.is_home ? match.home_team : match.away_team;
  const player = incident.player ?? "Unknown";
  const type = cardType(incident.card_type);
  return {
    eventType: "CARD",
    dedupeId: cardDedupeId({ matchId: match.id, incident }),
    matchId: match.id,
    homeTeam: match.home_team,
    awayTeam: match.away_team,
    homeScore: home,
    awayScore: away,
    minute: incident.minute ?? match.current_minute ?? null,
    description: `${type === "red" ? "🟥" : "🟨"} ${player} (${teamName})`,
  };
}

export function normalizeState({
  match,
  eventType,
}: {
  match: BzzoiroLiveEvent;
  eventType: string;
}): MatchEvent {
  const { home, away } = scores(match);
  return {
    eventType,
    dedupeId: `${match.id}:state:${eventType}`,
    matchId: match.id,
    homeTeam: match.home_team,
    awayTeam: match.away_team,
    homeScore: home,
    awayScore: away,
    minute: match.current_minute ?? null,
    description: stateDescription(eventType, match),
  };
}

function stateDescription(eventType: string, match: BzzoiroLiveEvent): string {
  switch (eventType) {
    case "KICKOFF": return `Kick-off: ${match.home_team} vs ${match.away_team}`;
    case "HALF_TIME": return "Half time";
    case "FULL_TIME": return "Full time";
    case "EXTRA_TIME_START": return "Extra time begins";
    case "PENALTY_SHOOTOUT_START": return "Penalty shootout";
    default: return eventType;
  }
}

const KNOWN_NON_ALERT = new Set([
  "", "inprogress", "notstarted", "2nd_half", "second_half", "2h", "2t", "live",
]);

export function stateEventType(status: string | undefined | null): string | null | undefined {
  if (status == null) return null;
  const s = status.toLowerCase();
  if (KNOWN_NON_ALERT.has(s)) return null;
  if (s === "1st_half" || s === "first_half" || s === "1h" || s === "1t") return "KICKOFF";
  if (s === "halftime" || s === "ht") return "HALF_TIME";
  if (s.includes("penalt")) return "PENALTY_SHOOTOUT_START";
  if (s.includes("extra")) return "EXTRA_TIME_START";
  if (s === "finished" || s === "ft" || s === "ft_pen" || s === "aet" || s.includes("full"))
    return "FULL_TIME";
  return undefined;
}

export function wsPhase(
  status: string | undefined | null,
  period: number | string | undefined | null,
): string {
  const s = (status ?? "").toLowerCase();
  if (s === "inprogress" || s === "live" || s === "") {
    const p = typeof period === "string" ? period.toLowerCase() : period;
    if (p === 1 || p === "1st_half" || p === "1h" || p === "1t") return "1st_half";
    if (p === 2 || p === "2nd_half" || p === "2h" || p === "2t") return "2nd_half";
  }
  return s;
}
