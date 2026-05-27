import type { DDBCharacter, StatBlock } from "@/lib/types";

// DDB's character-list API (character-service.dndbeyond.com) is blocked for
// server-side requests via Cloudflare TLS fingerprinting — all attempts return
// empty 404s regardless of headers. The public /character/{id}/json endpoint
// is unprotected and works reliably. Use share URLs.
const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  Origin: "https://www.dndbeyond.com",
  Referer: "https://www.dndbeyond.com/",
};

export async function fetchPublicCharacter(shareUrl: string): Promise<DDBCharacter> {
  const idMatch = shareUrl.match(/\/characters\/(\d+)/) ?? shareUrl.match(/^(\d+)$/);
  if (!idMatch) throw new Error("Paste a full D&D Beyond character URL or just the numeric ID");
  const id = idMatch[1];
  const res = await fetch(`https://www.dndbeyond.com/character/${id}/json`, {
    headers: BROWSER_HEADERS,
  });
  if (!res.ok) throw new Error(`Failed to fetch character ${id} (${res.status})`);
  const json = await res.json();
  return parseDDBCharacter(json);
}

function parseDDBCharacter(raw: Record<string, unknown>): DDBCharacter {
  const stats = (raw.stats as Array<{ id: number; value: number | null }>) ?? [];
  const getStatValue = (id: number) => stats.find((s) => s.id === id)?.value ?? 10;

  const statValues = {
    str: getStatValue(1),
    dex: getStatValue(2),
    con: getStatValue(3),
    int: getStatValue(4),
    wis: getStatValue(5),
    cha: getStatValue(6),
  };

  const classes =
    (raw.classes as Array<{ definition: { name: string }; level: number }>) ?? [];
  const totalLevel = classes.reduce((sum, c) => sum + c.level, 0);
  const dexMod = Math.floor(((statValues.dex ?? 10) - 10) / 2);
  const preferences = (raw.preferences as Record<string, unknown>) ?? {};

  return {
    id: raw.id as number,
    name: (raw.name as string) ?? "Unknown",
    race: ((raw.race as Record<string, unknown>)?.fullName as string) ?? undefined,
    classes: classes.map((c) => ({ name: c.definition.name, level: c.level })),
    level: totalLevel || 1,
    ac: calculateAC(raw),
    maxHp: calculateMaxHP(raw),
    currentHp:
      raw.removedHitPoints != null
        ? calculateMaxHP(raw) - (raw.removedHitPoints as number)
        : undefined,
    tempHp: (raw.temporaryHitPoints as number) ?? 0,
    initiativeBonus: dexMod + ((preferences.initiativeBonus as number) ?? 0),
    speed: getBaseSpeed(raw),
    avatarUrl: (raw.avatarUrl as string) ?? undefined,
    playerName:
      ((raw.campaign as Record<string, unknown>)?.dmUsername as string) ?? undefined,
    stats: statValues,
    proficiencyBonus: getProficiencyBonus(totalLevel),
    passivePerception: 10 + Math.floor(((statValues.wis ?? 10) - 10) / 2),
  };
}

function calculateMaxHP(raw: Record<string, unknown>): number {
  const baseHp = (raw.baseHitPoints as number) ?? 0;
  const bonusHp = (raw.bonusHitPoints as number) ?? 0;
  const overrideHp = raw.overrideHitPoints as number;
  if (overrideHp) return overrideHp;
  const classes =
    (raw.classes as Array<{ definition: { name: string }; level: number }>) ?? [];
  const totalLevel = classes.reduce((sum, c) => sum + c.level, 0);
  const stats = (raw.stats as Array<{ id: number; value: number | null }>) ?? [];
  const conScore = stats.find((s) => s.id === 3)?.value ?? 10;
  const conMod = Math.floor((conScore - 10) / 2);
  return baseHp + bonusHp + conMod * totalLevel;
}

function calculateAC(raw: Record<string, unknown>): number {
  const inventory =
    (raw.inventory as Array<{
      equipped: boolean;
      definition: { armorClass?: number };
    }>) ?? [];
  const armorItems = inventory.filter(
    (i) => i.equipped && i.definition?.armorClass != null
  );
  if (armorItems.length > 0) return armorItems[0].definition.armorClass! + 10;
  const stats = (raw.stats as Array<{ id: number; value: number | null }>) ?? [];
  const dex = stats.find((s) => s.id === 2)?.value ?? 10;
  return 10 + Math.floor((dex - 10) / 2);
}

function getBaseSpeed(raw: Record<string, unknown>): number {
  const race = (raw.race as Record<string, unknown>) ?? {};
  return ((race.weightSpeeds as Record<string, unknown>)?.normal as number) ?? 30;
}

function getProficiencyBonus(level: number): number {
  return Math.ceil(level / 4) + 1;
}

export function ddbCharacterToStatBlock(char: DDBCharacter): StatBlock {
  return {
    name: char.name,
    type: char.classes?.map((c) => `${c.name} ${c.level}`).join(" / ") ?? "Character",
    ac: char.ac,
    hp: char.maxHp,
    speed: `${char.speed} ft.`,
    str: char.stats.str,
    dex: char.stats.dex,
    con: char.stats.con,
    int: char.stats.int,
    wis: char.stats.wis,
    cha: char.stats.cha,
    imageUrl: char.avatarUrl,
  };
}
