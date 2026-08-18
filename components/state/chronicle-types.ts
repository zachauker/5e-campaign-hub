export interface ThreadView {
  id: string;
  title: string;
  stakes: string | null;
  status: string;
  daysUntouched: number | null;
  lastTouchedDay: number | null;
  links: Array<{ targetKind: string; targetId: string; role: string }>;
}

export interface ClockView {
  id: string;
  name: string;
  segments: number;
  filled: number;
  status: string;
  cadenceDays: number | null;
  ownerKind: string | null;
  ownerId: string | null;
  payoff: string | null;
}

export interface TimelineEventView {
  id: string;
  day: number;
  kind: string;
  title: string;
  body: string | null;
  sourceKind: string;
  dateLabel: string;
}

export interface CampaignStateView {
  currentDay: number | null;
  epochLabel: string;
  currentDateLabel: string | null;
  threads: ThreadView[];
  clocks: ClockView[];
  events: TimelineEventView[];
}
