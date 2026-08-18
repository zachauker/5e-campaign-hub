export interface CalendarMonth {
  name: string;
  days: number;
}

export interface CalendarDate {
  year: number;
  monthIndex: number; // 0-based
  dayOfMonth: number; // 1-based
}

/**
 * An in-world calendar. Days are stored everywhere as a non-negative integer
 * absolute day number so that all date math is integer math; this interface is
 * the only place that knows the calendar's structure (month names and
 * lengths, day↔parts conversion). `formatInWorldDay` below renders a day for
 * display.
 */
export interface Calendar {
  readonly daysInYear: number;
  readonly months: ReadonlyArray<CalendarMonth>;
  toParts(day: number): CalendarDate;
  fromParts(parts: CalendarDate): number;
}

// The Calendar of Exandria: 11 months, 328 days, no leap year.
const MONTHS: ReadonlyArray<CalendarMonth> = [
  { name: "Horisal", days: 29 },
  { name: "Misuthar", days: 30 },
  { name: "Dualahei", days: 30 },
  { name: "Thunsheer", days: 31 },
  { name: "Unndilar", days: 28 },
  { name: "Brussendar", days: 31 },
  { name: "Sydenstar", days: 32 },
  { name: "Fessuran", days: 29 },
  { name: "Quen'pillar", days: 27 },
  { name: "Cuersaar", days: 29 },
  { name: "Duscar", days: 32 },
];

const DAYS_IN_YEAR = MONTHS.reduce((n, m) => n + m.days, 0);

export const EXANDRIA: Calendar = {
  daysInYear: DAYS_IN_YEAR,
  months: MONTHS,

  toParts(day: number): CalendarDate {
    if (!Number.isInteger(day) || day < 0) {
      throw new Error(`in-world day must be a non-negative integer, got ${day}`);
    }
    const year = Math.floor(day / DAYS_IN_YEAR);
    let rem = day - year * DAYS_IN_YEAR;
    for (let monthIndex = 0; monthIndex < MONTHS.length; monthIndex++) {
      const month = MONTHS[monthIndex];
      if (rem < month.days) return { year, monthIndex, dayOfMonth: rem + 1 };
      rem -= month.days;
    }
    // Unreachable: rem < DAYS_IN_YEAR by construction.
    throw new Error(`could not resolve day ${day}`);
  },

  fromParts({ year, monthIndex, dayOfMonth }: CalendarDate): number {
    if (!Number.isInteger(year) || year < 0) {
      throw new Error(`year must be a non-negative integer, got ${year}`);
    }
    if (!Number.isInteger(monthIndex) || monthIndex < 0 || monthIndex >= MONTHS.length) {
      throw new Error(`monthIndex must be 0..${MONTHS.length - 1}, got ${monthIndex}`);
    }
    const month = MONTHS[monthIndex];
    if (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > month.days) {
      throw new Error(`dayOfMonth must be 1..${month.days} for ${month.name}, got ${dayOfMonth}`);
    }
    let day = year * DAYS_IN_YEAR + (dayOfMonth - 1);
    for (let i = 0; i < monthIndex; i++) day += MONTHS[i].days;
    return day;
  },
};

function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

/** "13th of Fessuran, 843 P.D." */
export function formatInWorldDay(day: number, epochLabel: string): string {
  const { year, monthIndex, dayOfMonth } = EXANDRIA.toParts(day);
  const base = `${ordinal(dayOfMonth)} of ${EXANDRIA.months[monthIndex].name}, ${year}`;
  return epochLabel ? `${base} ${epochLabel}` : base;
}
