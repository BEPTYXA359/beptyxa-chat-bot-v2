import { GrammyError, type Api } from 'grammy';
import { formatPointsDelta, formatPositionDelta, getRaceNameRu } from './f1.names';
import type {
  F1ResultEntry,
  F1SessionResult,
  F1SessionSchedule,
  F1StandingEntry,
  F1StandingsSnapshot,
} from './f1.types';

export interface F1FormattedMessage {
  richHtml: string;
  fallbackHtml: string[];
}

const escapeHtml = (value: string): string =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

const titleFor = (session: F1SessionSchedule): string =>
  `ГП ${getRaceNameRu(session.raceName) ?? session.raceName ?? `раунд ${session.round}`} — ${session.label}`;

const resultValue = (entry: F1ResultEntry): string => {
  if (entry.segments?.some((segment) => segment !== null)) {
    return entry.segments.map((segment) => segment ?? '—').join(' | ');
  }
  return entry.time ?? entry.gap ?? entry.status ?? '—';
};

const compactEntries = (
  entries: F1ResultEntry[],
  race: boolean,
  full: boolean,
): F1ResultEntry[] => {
  if (full) return entries;
  if (race) return entries.filter((entry) => !entry.dnf);
  return entries.slice(0, 10);
};

const richResultRows = (entries: F1ResultEntry[]): string =>
  entries
    .map(
      (entry) =>
        `<tr><td>${escapeHtml(entry.positionText)}</td><td>${escapeHtml(entry.driverNameRu)}</td><td>${escapeHtml(entry.constructorNameRu)}</td><td>${escapeHtml(resultValue(entry))}</td></tr>`,
    )
    .join('');

const richStandingRows = (entries: F1StandingEntry[]): string =>
  entries
    .slice(0, 10)
    .map(
      (entry) =>
        `<tr><td>${entry.position}</td><td>${escapeHtml(entry.nameRu)}</td><td>${entry.points} (${formatPointsDelta(entry.pointsDelta)})</td><td>${formatPositionDelta(entry.positionDelta)}</td></tr>`,
    )
    .join('');

const richStandings = (title: string, entries: F1StandingEntry[]): string =>
  `<h3>${title}</h3><table><tr><th>#</th><th>Имя</th><th>Очки</th><th>Δ</th></tr>${richStandingRows(entries)}</table>${
    entries.length > 10 ? `<p>…и ещё ${entries.length - 10}</p>` : ''
  }`;

export function formatSessionMessage(
  sessionResult: F1SessionResult,
  standings: F1StandingsSnapshot | null,
  fullProtocols: boolean,
): F1FormattedMessage {
  const { session, entries } = sessionResult;
  const title = titleFor(session);
  const visibleEntries = compactEntries(entries, session.kind === 'race', fullProtocols);
  const omitted =
    !fullProtocols && session.kind !== 'race'
      ? Math.max(0, entries.length - visibleEntries.length)
      : 0;
  const dnf = session.kind === 'race' && !fullProtocols ? entries.filter((entry) => entry.dnf) : [];

  const richParts = [
    `<h1>${escapeHtml(title)}</h1>`,
    `<table><tr><th>#</th><th>Пилот</th><th>Команда</th><th>Время/отставание</th></tr>${richResultRows(visibleEntries)}</table>`,
  ];
  if (omitted) richParts.push(`<p>…и ещё ${omitted}</p>`);
  if (dnf.length) {
    richParts.push(`<p>DNF: ${escapeHtml(dnf.map((entry) => entry.driverNameRu).join(', '))}</p>`);
  }
  if (standings) {
    richParts.push(
      '<h2>Кубок после этапа</h2>',
      richStandings('Пилоты', standings.drivers),
      richStandings('Команды', standings.constructors),
    );
  }

  const blocks = [
    '<b>Протокол</b>',
    ...visibleEntries.map(
      (entry) =>
        `${escapeHtml(entry.positionText)}. ${escapeHtml(entry.driverNameRu)} — ${escapeHtml(entry.constructorNameRu)} — ${escapeHtml(resultValue(entry))}`,
    ),
  ];
  if (omitted) blocks.push(`…и ещё ${omitted}`);
  if (dnf.length)
    blocks.push(`DNF: ${escapeHtml(dnf.map((entry) => entry.driverNameRu).join(', '))}`);
  if (standings) {
    blocks.push('<b>Кубок после этапа — Пилоты</b>');
    blocks.push(
      ...standings.drivers
        .slice(0, 10)
        .map(
          (entry) =>
            `${entry.position}. ${escapeHtml(entry.nameRu)} — ${entry.points} (${formatPointsDelta(entry.pointsDelta)}), ${formatPositionDelta(entry.positionDelta)}`,
        ),
    );
    if (standings.drivers.length > 10) blocks.push(`…и ещё ${standings.drivers.length - 10}`);
    blocks.push('<b>Кубок после этапа — Команды</b>');
    blocks.push(
      ...standings.constructors
        .slice(0, 10)
        .map(
          (entry) =>
            `${entry.position}. ${escapeHtml(entry.nameRu)} — ${entry.points} (${formatPointsDelta(entry.pointsDelta)}), ${formatPositionDelta(entry.positionDelta)}`,
        ),
    );
    if (standings.constructors.length > 10)
      blocks.push(`…и ещё ${standings.constructors.length - 10}`);
  }

  const titleHtml = `<b>${escapeHtml(title)}</b>`;
  const fallbackHtml: string[] = [];
  let current = titleHtml;
  for (const block of blocks) {
    if (current.length + block.length + 2 > 4000 && current !== titleHtml) {
      fallbackHtml.push(current);
      current = titleHtml;
    }
    current += `\n\n${block}`;
  }
  fallbackHtml.push(current);
  return { richHtml: richParts.join(''), fallbackHtml };
}

/** 1 минуту, 2 минуты, 5 минут, 21 минуту — интервалы задаёт пользователь */
const minutesLabel = (minutes: number): string => {
  const mod10 = minutes % 10;
  const mod100 = minutes % 100;
  if (mod10 === 1 && mod100 !== 11) return 'минуту';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'минуты';
  return 'минут';
};

export function formatReminder(session: F1SessionSchedule, minutes: number): string {
  const date = new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(session.startsAt));
  return `${session.label} через ${minutes} ${minutesLabel(minutes)}\nСтарт: ${date} МСК`;
}

export async function sendF1RichWithFallback(
  api: Pick<Api, 'sendRichMessage' | 'sendMessage'>,
  chatId: number,
  message: F1FormattedMessage,
): Promise<void> {
  try {
    await api.sendRichMessage(chatId, { html: message.richHtml });
    return;
  } catch (error) {
    if (!(error instanceof GrammyError && error.error_code === 400)) throw error;
  }
  for (const part of message.fallbackHtml) {
    await api.sendMessage(chatId, part, { parse_mode: 'HTML' });
  }
}
