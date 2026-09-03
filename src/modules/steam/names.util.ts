/** Чистит имя для показа: убирает ®™©, выравнивает апострофы и тире, схлопывает пробелы. */
export const cleanSteamName = (name: string): string =>
  name
    .replace(/[®™©]/g, '')
    .replace(/[’ʼ´`]/g, "'")
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();

/** Ключ токена для сравнения: только буквы и цифры в нижнем регистре. */
const tokenKey = (token: string): string => token.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/**
 * Отрезает название игры из начала имени издания/DLC/бандла.
 * Сравнение по токенам без пунктуации, поэтому срабатывает и при расхождениях
 * Steam в апострофах, двоеточиях и знаках ™ («Batman™ Arkham Knight X» при игре
 * «Batman: Arkham Knight»). Возвращает '' если имя целиком совпало с названием
 * игры — фолбэк выбирает вызывающий код.
 */
export const stripGameNamePrefix = (name: string, gameName: string): string => {
  const cleaned = cleanSteamName(name);
  const gameTokens = cleanSteamName(gameName).split(' ').map(tokenKey).filter(Boolean);
  const rawTokens = cleaned.split(' ');

  let matched = 0;
  while (
    matched < gameTokens.length &&
    matched < rawTokens.length &&
    tokenKey(rawTokens[matched]) === gameTokens[matched]
  ) {
    matched++;
  }

  if (matched === 0) return cleaned;

  return rawTokens
    .slice(matched)
    .join(' ')
    .replace(/^[:;\-–—•\s]+/, '')
    .trim();
};
