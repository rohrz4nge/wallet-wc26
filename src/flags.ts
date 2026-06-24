// Country name → emoji flag lookup for WC 2026 teams
const FLAGS: Record<string, string> = {
  // Group A (USA/Canada/Mexico hosts)
  "United States": "🇺🇸", "USA": "🇺🇸",
  "Canada": "🇨🇦",
  "Mexico": "🇲🇽",
  "Uruguay": "🇺🇾",
  // Group B
  "Portugal": "🇵🇹",
  "Argentina": "🇦🇷",
  "Morocco": "🇲🇦",
  "Angola": "🇦🇴",
  // Group C
  "Spain": "🇪🇸",
  "Germany": "🇩🇪",
  "Japan": "🇯🇵",
  "New Zealand": "🇳🇿",
  // Group D
  "France": "🇫🇷",
  "Brazil": "🇧🇷",
  "England": "🏴󠁧󠁢󠁥󠁮󠁧󠁿",
  "Saudi Arabia": "🇸🇦",
  // Group E
  "Netherlands": "🇳🇱", "Holland": "🇳🇱",
  "South Korea": "🇰🇷", "Korea Republic": "🇰🇷",
  "Australia": "🇦🇺",
  "Iraq": "🇮🇶",
  // Group F
  "Ecuador": "🇪🇨",
  "Senegal": "🇸🇳",
  "Netherlands Antilles": "🇳🇱",
  "Panama": "🇵🇦",
  // Group G
  "Belgium": "🇧🇪",
  "Colombia": "🇨🇴",
  "Ivory Coast": "🇨🇮", "Côte d'Ivoire": "🇨🇮", "Cote d'Ivoire": "🇨🇮",
  "Paraguay": "🇵🇾",
  // Group H
  "Switzerland": "🇨🇭",
  "Nigeria": "🇳🇬",
  "Chile": "🇨🇱",
  "Honduras": "🇭🇳",
  // Group I
  "Italy": "🇮🇹",
  "Croatia": "🇭🇷",
  "Serbia": "🇷🇸",
  "Peru": "🇵🇪",
  // Group J
  "Denmark": "🇩🇰",
  "Algeria": "🇩🇿",
  "Costa Rica": "🇨🇷",
  "Venezuela": "🇻🇪",
  // Group K
  "Ukraine": "🇺🇦",
  "Turkey": "🇹🇷", "Türkiye": "🇹🇷",
  "Cameroon": "🇨🇲",
  "Dominican Republic": "🇩🇴",
  // Group L
  "Poland": "🇵🇱",
  "Iran": "🇮🇷",
  "Cuba": "🇨🇺",
  "Qatar": "🇶🇦",
  // Other common teams
  "China": "🇨🇳", "China PR": "🇨🇳",
  "Egypt": "🇪🇬",
  "Ghana": "🇬🇭",
  "Greece": "🇬🇷",
  "Hungary": "🇭🇺",
  "Indonesia": "🇮🇩",
  "Mali": "🇲🇱",
  "Norway": "🇳🇴",
  "Romania": "🇷🇴",
  "Scotland": "🏴󠁧󠁢󠁳󠁣󠁴󠁿",
  "Sweden": "🇸🇪",
  "Wales": "🏴󠁧󠁢󠁷󠁬󠁳󠁿",
  "Republic of Ireland": "🇮🇪", "Ireland": "🇮🇪",
  "Czech Republic": "🇨🇿", "Czechia": "🇨🇿",
  "Slovakia": "🇸🇰",
  "Slovenia": "🇸🇮",
  "Bosnia and Herzegovina": "🇧🇦", "Bosnia & Herzegovina": "🇧🇦", "BiH": "🇧🇦",
  "North Macedonia": "🇲🇰",
  "Albania": "🇦🇱",
  "Austria": "🇦🇹",
  "Russia": "🇷🇺",
  "Israel": "🇮🇱",
  "South Africa": "🇿🇦",
  "Tunisia": "🇹🇳",
  "Mali": "🇲🇱",
  "Zambia": "🇿🇲",
  "Mozambique": "🇲🇿",
  "Bahrain": "🇧🇭",
  "Jordan": "🇯🇴",
  "Oman": "🇴🇲",
  "Kuwait": "🇰🇼",
  "United Arab Emirates": "🇦🇪", "UAE": "🇦🇪",
  "Bolivia": "🇧🇴",
  "Jamaica": "🇯🇲",
  "El Salvador": "🇸🇻",
  "Guatemala": "🇬🇹",
  "Nicaragua": "🇳🇮",
  "Trinidad and Tobago": "🇹🇹",
  "Haiti": "🇭🇹",
  "Curacao": "🇨🇼", "Curaçao": "🇨🇼",
  "Bangladesh": "🇧🇩",
  "India": "🇮🇳",
  "Thailand": "🇹🇭",
  "Vietnam": "🇻🇳",
  "Malaysia": "🇲🇾",
  "Philippines": "🇵🇭",
  "Singapore": "🇸🇬",
  "Congo": "🇨🇬", "Congo DR": "🇨🇩", "DR Congo": "🇨🇩",
  "Uzbekistan": "🇺🇿",
  "Benin": "🇧🇯",
  "Tanzania": "🇹🇿",
  "Uganda": "🇺🇬",
  "Kenya": "🇰🇪",
  "Ethiopia": "🇪🇹",
  "Rwanda": "🇷🇼",
  "Cape Verde": "🇨🇻",
  "Guinea": "🇬🇳",
  "Equatorial Guinea": "🇬🇶",
  "Gabon": "🇬🇦",
  "Zimbabwe": "🇿🇼",
  "Comoros": "🇰🇲",
  "Namibia": "🇳🇦",
  "Libya": "🇱🇾",
  "Afghanistan": "🇦🇫",
  "Lebanon": "🇱🇧",
  "Syria": "🇸🇾",
  "Yemen": "🇾🇪",
  "Palestine": "🇵🇸",
};

export function flagFor(teamName: string): string {
  // exact match
  if (FLAGS[teamName]) return FLAGS[teamName]!;
  // case-insensitive
  const lower = teamName.toLowerCase();
  for (const [key, val] of Object.entries(FLAGS)) {
    if (key.toLowerCase() === lower) return val;
  }
  // partial match (e.g. "Brazil U20" → "Brazil")
  for (const [key, val] of Object.entries(FLAGS)) {
    if (lower.startsWith(key.toLowerCase())) return val;
  }
  return "🏳️";
}
