import type { LiveMatch } from "./state.js";
import { flagFor } from "./flags.js";

export interface PassFields {
  headerFields: PassFieldContent[];
  primaryFields: PassFieldContent[];
  secondaryFields: PassFieldContent[];
  auxiliaryFields: PassFieldContent[];
  backFields: PassFieldContent[];
}

interface PassFieldContent {
  key: string;
  label: string;
  value: string;
}

function scoreStr(home: number, away: number): string {
  return `${home}  ·  ${away}`;
}

function minuteStr(minute: number | null, status: string): string {
  const s = status.toLowerCase();
  if (s === "halftime" || s === "ht") return "HT";
  if (s === "finished" || s === "ft" || s === "ft_pen") return "FT";
  if (s === "aet") return "AET";
  if (minute != null) return `${minute}'`;
  return "LIVE";
}

function matchLine(m: LiveMatch): string {
  const home = `${flagFor(m.homeTeam)} ${m.homeTeam}`;
  const away = `${m.awayTeam} ${flagFor(m.awayTeam)}`;
  const s = m.status.toLowerCase();
  if (s === "finished" || s === "ft" || s === "ft_pen" || s === "aet") {
    return `${home}  ${m.homeScore}–${m.awayScore}  ${away}  FT`;
  }
  if (s === "inprogress") {
    const min = m.minute != null ? `${m.minute}'` : "LIVE";
    return `${home}  ${m.homeScore}–${m.awayScore}  ${away}  ${min}`;
  }
  if (m.eventDate) {
    const d = new Date(m.eventDate);
    const time = d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" });
    return `${home}  vs  ${away}  ${time}`;
  }
  return `${home}  vs  ${away}`;
}

export function buildLiveLayout(liveMatches: LiveMatch[]): PassFields {
  // primary match = first live one; others in auxiliary
  const [primary, ...rest] = liveMatches;
  if (!primary) return buildNoGameLayout([], []);

  const homeFlag = flagFor(primary.homeTeam);
  const awayFlag = flagFor(primary.awayTeam);
  const min = minuteStr(primary.minute, primary.status);

  const header: PassFieldContent[] = [
    { key: "status", label: "", value: `🔴 LIVE  ${min}` },
  ];

  const primaryFields: PassFieldContent[] = [
    { key: "home", label: homeFlag, value: primary.homeTeam },
    { key: "score", label: "VS", value: scoreStr(primary.homeScore, primary.awayScore) },
    { key: "away", label: awayFlag, value: primary.awayTeam },
  ];

  const secondary: PassFieldContent[] = [
    { key: "league", label: "COMPETITION", value: primary.leagueName },
  ];

  const auxiliary: PassFieldContent[] = rest.slice(0, 3).map((m, i) => ({
    key: `other${i}`,
    label: "ALSO LIVE",
    value: `${flagFor(m.homeTeam)} ${m.homeScore}–${m.awayScore} ${flagFor(m.awayTeam)}  ${minuteStr(m.minute, m.status)}`,
  }));

  const back = buildBackFields(liveMatches, [], []);

  return { headerFields: header, primaryFields, secondaryFields: secondary, auxiliaryFields: auxiliary, backFields: back };
}

export function buildNoGameLayout(recent: LiveMatch[], upcoming: LiveMatch[]): PassFields {
  const next = upcoming[0];
  const last = recent[0];

  let primaryFields: PassFieldContent[];
  let secondaryFields: PassFieldContent[] = [];

  if (next) {
    const homeFlag = flagFor(next.homeTeam);
    const awayFlag = flagFor(next.awayTeam);
    primaryFields = [
      { key: "home", label: homeFlag, value: next.homeTeam },
      { key: "vs", label: "", value: "vs" },
      { key: "away", label: awayFlag, value: next.awayTeam },
    ];
    if (next.eventDate) {
      const d = new Date(next.eventDate);
      const formatted = d.toLocaleDateString("en-US", {
        weekday: "short", month: "short", day: "numeric",
        hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC",
      });
      secondaryFields = [{ key: "kickoff", label: "NEXT MATCH", value: formatted }];
    }
  } else if (last) {
    const homeFlag = flagFor(last.homeTeam);
    const awayFlag = flagFor(last.awayTeam);
    primaryFields = [
      { key: "home", label: homeFlag, value: last.homeTeam },
      { key: "score", label: "FT", value: scoreStr(last.homeScore, last.awayScore) },
      { key: "away", label: awayFlag, value: last.awayTeam },
    ];
    secondaryFields = [{ key: "label", label: "LAST RESULT", value: last.leagueName }];
  } else {
    primaryFields = [
      { key: "title", label: "", value: "FIFA World Cup 2026" },
    ];
    secondaryFields = [{ key: "sub", label: "", value: "No matches scheduled" }];
  }

  const header: PassFieldContent[] = [
    { key: "wc", label: "", value: "⚽ World Cup 2026" },
  ];

  const back = buildBackFields([], recent, upcoming);
  return {
    headerFields: header,
    primaryFields,
    secondaryFields,
    auxiliaryFields: [],
    backFields: back,
  };
}

function buildBackFields(live: LiveMatch[], recent: LiveMatch[], upcoming: LiveMatch[]): PassFieldContent[] {
  const back: PassFieldContent[] = [];

  if (live.length > 0) {
    back.push({
      key: "live_header",
      label: "🔴 LIVE NOW",
      value: live.map(matchLine).join("\n"),
    });
  }

  if (recent.length > 0) {
    back.push({
      key: "recent_header",
      label: "RECENT RESULTS",
      value: recent.map(matchLine).join("\n"),
    });
  }

  if (upcoming.length > 0) {
    back.push({
      key: "upcoming_header",
      label: "UPCOMING",
      value: upcoming.map(matchLine).join("\n"),
    });
  }

  back.push({
    key: "refresh_note",
    label: "",
    value: "Pass updates automatically during live matches",
  });

  return back;
}
