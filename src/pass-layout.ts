import type { LiveMatch } from "./state.js";
import { flagFor } from "./flags.js";

interface Field { key: string; label: string; value: string; }

export interface PassLayout {
  headerFields: Field[];
  primaryFields: Field[];
  secondaryFields: Field[];
  auxiliaryFields: Field[];
  backFields: Field[];
}

function minuteLabel(minute: number | null, status: string): string {
  const s = status.toLowerCase();
  if (s === "halftime" || s === "ht") return "HT";
  if (s === "finished" || s === "ft" || s === "ft_pen") return "FT";
  if (s === "aet") return "AET";
  if (minute != null) return `${minute}'`;
  return "LIVE";
}

function kickoffTime(eventDate: string | undefined): string {
  if (!eventDate) return "";
  const d = new Date(eventDate);
  return d.toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC",
  });
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
    const t = d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" });
    return `${home}  vs  ${away}  ${t}`;
  }
  return `${home}  vs  ${away}`;
}

export function buildLayout(
  live: LiveMatch[],
  recent: LiveMatch[],
  upcoming: LiveMatch[],
): PassLayout {
  if (live.length > 0) {
    return buildLiveLayout(live, recent, upcoming);
  }
  return buildIdleLayout(recent, upcoming);
}

function buildLiveLayout(live: LiveMatch[], recent: LiveMatch[], upcoming: LiveMatch[]): PassLayout {
  const [main, ...others] = live;
  if (!main) return buildIdleLayout(recent, upcoming);

  const hf = flagFor(main.homeTeam);
  const af = flagFor(main.awayTeam);
  const min = minuteLabel(main.minute, main.status);

  return {
    headerFields: [
      { key: "status", label: "", value: `🔴 ${min}` },
    ],
    primaryFields: [
      { key: "score", label: `${hf} ${main.homeTeam}  vs  ${main.awayTeam} ${af}`, value: `${main.homeScore} – ${main.awayScore}` },
    ],
    secondaryFields: [
      { key: "league", label: "COMPETITION", value: main.leagueName },
    ],
    auxiliaryFields: others.slice(0, 3).map((m, i) => ({
      key: `other${i}`,
      label: `${flagFor(m.homeTeam)} ${flagFor(m.awayTeam)}`,
      value: `${m.homeScore}–${m.awayScore}  ${minuteLabel(m.minute, m.status)}`,
    })),
    backFields: buildBackFields(live, recent, upcoming),
  };
}

function buildIdleLayout(recent: LiveMatch[], upcoming: LiveMatch[]): PassLayout {
  const next = upcoming[0];
  const last = recent[0];

  if (next) {
    const hf = flagFor(next.homeTeam);
    const af = flagFor(next.awayTeam);
    return {
      headerFields: [],
      primaryFields: [
        { key: "matchup", label: `${hf} ${next.homeTeam}  vs  ${next.awayTeam} ${af}`, value: "Upcoming" },
      ],
      secondaryFields: [
        { key: "kickoff", label: "KICKOFF", value: kickoffTime(next.eventDate) },
      ],
      auxiliaryFields: upcoming.slice(1, 4).map((m, i) => ({
        key: `up${i}`,
        label: `${flagFor(m.homeTeam)} ${flagFor(m.awayTeam)}`,
        value: kickoffTime(m.eventDate).split(",").pop()?.trim() ?? "",
      })),
      backFields: buildBackFields([], recent, upcoming),
    };
  }

  if (last) {
    const hf = flagFor(last.homeTeam);
    const af = flagFor(last.awayTeam);
    return {
      headerFields: [],
      primaryFields: [
        { key: "score", label: `${hf} ${last.homeTeam}  vs  ${last.awayTeam} ${af}`, value: `${last.homeScore} – ${last.awayScore}` },
      ],
      secondaryFields: [
        { key: "result", label: "LAST RESULT", value: "Full time" },
      ],
      auxiliaryFields: [],
      backFields: buildBackFields([], recent, []),
    };
  }

  return {
    headerFields: [],
    primaryFields: [{ key: "wc", label: "FIFA WORLD CUP 2026", value: "No matches today" }],
    secondaryFields: [],
    auxiliaryFields: [],
    backFields: [],
  };
}

function buildBackFields(live: LiveMatch[], recent: LiveMatch[], upcoming: LiveMatch[]): Field[] {
  const back: Field[] = [];

  if (live.length > 0) {
    back.push({ key: "live_hdr", label: "🔴 LIVE NOW", value: live.map(matchLine).join("\n") });
  }
  if (recent.length > 0) {
    back.push({ key: "recent_hdr", label: "RECENT RESULTS", value: recent.map(matchLine).join("\n") });
  }
  if (upcoming.length > 0) {
    // group by day
    const byDay = new Map<string, LiveMatch[]>();
    for (const m of upcoming) {
      const day = m.eventDate ? m.eventDate.slice(0, 10) : "TBD";
      const arr = byDay.get(day) ?? [];
      arr.push(m);
      byDay.set(day, arr);
    }
    for (const [day, matches] of byDay) {
      const label = day === "TBD" ? "UPCOMING" :
        new Date(day + "T00:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).toUpperCase();
      back.push({ key: `up_${day}`, label, value: matches.map(matchLine).join("\n") });
    }
  }

  back.push({ key: "note", label: "", value: "Updates automatically during live matches" });
  return back;
}
