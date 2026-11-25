const DRIVER_NAMES_RU: Record<string, string> = {
  antonelli: 'Андреа Кими Антонелли',
  max_verstappen: 'Макс Ферстаппен',
  russell: 'Джордж Расселл',
  hamilton: 'Льюис Хэмилтон',
  leclerc: 'Шарль Леклер',
  norris: 'Ландо Норрис',
  piastri: 'Оскар Пиастри',
  hadjar: 'Исаак Хаджар',
  lawson: 'Лиам Лоусон',
  gasly: 'Пьер Гасли',
  arvid_lindblad: 'Арвид Линдблад',
  colapinto: 'Франко Колапинто',
  bearman: 'Оливер Берман',
  bortoleto: 'Габриэль Бортолето',
  hulkenberg: 'Нико Хюлькенберг',
  ocon: 'Эстебан Окон',
  alonso: 'Фернандо Алонсо',
  sainz: 'Карлос Сайнс',
  albon: 'Александр Албон',
  tsunoda: 'Юки Цунода',
  ryo_hirakawa: 'Рё Хиракава',
  stroll: 'Лэнс Стролл',
  bottas: 'Валттери Боттас',
  perez: 'Серхио Перес',
  rafael_camara: 'Рафаэль Камара',
};

const CONSTRUCTOR_NAMES_RU: Record<string, string> = {
  mercedes: 'Мерседес',
  ferrari: 'Феррари',
  red_bull: 'Ред Булл',
  mclaren: 'Макларен',
  rb: 'РБ',
  alpine: 'Альпин',
  haas: 'Хаас',
  audi: 'Ауди',
  williams: 'Уильямс',
  aston_martin: 'Астон Мартин',
  cadillac: 'Кадиллак',
};

/** Этапы в родительном падеже: «ГП Лас-Вегаса», «Гран-при Лас-Вегаса» */
const RACE_NAMES_RU: Record<string, string> = {
  'Australian Grand Prix': 'Австралии',
  'Chinese Grand Prix': 'Китая',
  'Japanese Grand Prix': 'Японии',
  'Miami Grand Prix': 'Майами',
  'Canadian Grand Prix': 'Канады',
  'Monaco Grand Prix': 'Монако',
  'Barcelona Grand Prix': 'Барселоны',
  'Austrian Grand Prix': 'Австрии',
  'British Grand Prix': 'Великобритании',
  'Belgian Grand Prix': 'Бельгии',
  'Hungarian Grand Prix': 'Венгрии',
  'Dutch Grand Prix': 'Нидерландов',
  'Italian Grand Prix': 'Италии',
  'Spanish Grand Prix': 'Испании',
  'Azerbaijan Grand Prix': 'Азербайджана',
  'Bahrain Grand Prix': 'Бахрейна',
  'Bahrain Grand Prix in Malaysia': 'Бахрейна в Малайзии',
  'Singapore Grand Prix': 'Сингапура',
  'United States Grand Prix': 'США',
  'Mexico City Grand Prix': 'Мексики',
  'Brazilian Grand Prix': 'Бразилии',
  'Las Vegas Grand Prix': 'Лас-Вегаса',
  'Qatar Grand Prix': 'Катара',
  'Abu Dhabi Grand Prix': 'Абу-Даби',
};

const CIRCUIT_NAMES_RU: Record<string, string> = {
  'Albert Park Grand Prix Circuit': 'Альберт-Парк',
  'Shanghai International Circuit': 'Шанхай',
  'Suzuka Circuit': 'Сузука',
  'Miami International Autodrome': 'Майами',
  'Circuit Gilles Villeneuve': 'Жиль Вильнёв',
  'Circuit de Monaco': 'Монако',
  'Circuit de Barcelona-Catalunya': 'Барселона-Каталунья',
  'Red Bull Ring': 'Ред Булл Ринг',
  'Silverstone Circuit': 'Сильверстоун',
  'Circuit de Spa-Francorchamps': 'Спа-Франкоршам',
  Hungaroring: 'Хунгароринг',
  'Circuit Park Zandvoort': 'Зандворт',
  'Autodromo Nazionale di Monza': 'Монца',
  Madring: 'Мадрид',
  'Baku City Circuit': 'Баку',
  'Sepang International Circuit': 'Сепанг',
  'Marina Bay Street Circuit': 'Марина-Бей',
  'Circuit of the Americas': 'Трасса Америк',
  'Autódromo Hermanos Rodríguez': 'Эрманос Родригес',
  'Autódromo José Carlos Pace': 'Интерлагос',
  'Las Vegas Strip Street Circuit': 'Лас-Вегас',
  'Lusail International Circuit': 'Лусаил',
  'Yas Marina Circuit': 'Яс-Марина',
};

/** ISO 3166-1 alpha-2 нужен мини-аппу для флага страны */
const COUNTRIES_RU: Record<string, { name: string; code: string }> = {
  Australia: { name: 'Австралия', code: 'AU' },
  China: { name: 'Китай', code: 'CN' },
  Japan: { name: 'Япония', code: 'JP' },
  USA: { name: 'США', code: 'US' },
  Canada: { name: 'Канада', code: 'CA' },
  Monaco: { name: 'Монако', code: 'MC' },
  Spain: { name: 'Испания', code: 'ES' },
  Austria: { name: 'Австрия', code: 'AT' },
  UK: { name: 'Великобритания', code: 'GB' },
  'United Kingdom': { name: 'Великобритания', code: 'GB' },
  Belgium: { name: 'Бельгия', code: 'BE' },
  Hungary: { name: 'Венгрия', code: 'HU' },
  Netherlands: { name: 'Нидерланды', code: 'NL' },
  Italy: { name: 'Италия', code: 'IT' },
  Azerbaijan: { name: 'Азербайджан', code: 'AZ' },
  Bahrain: { name: 'Бахрейн', code: 'BH' },
  Malaysia: { name: 'Малайзия', code: 'MY' },
  Singapore: { name: 'Сингапур', code: 'SG' },
  Mexico: { name: 'Мексика', code: 'MX' },
  Brazil: { name: 'Бразилия', code: 'BR' },
  Qatar: { name: 'Катар', code: 'QA' },
  UAE: { name: 'ОАЭ', code: 'AE' },
  'United Arab Emirates': { name: 'ОАЭ', code: 'AE' },
};

export const getDriverNameRu = (driverId: string | undefined, fallback: string): string =>
  (driverId ? DRIVER_NAMES_RU[driverId] : undefined) ?? fallback;

export const getConstructorNameRu = (constructorId: string | undefined, fallback: string): string =>
  (constructorId ? CONSTRUCTOR_NAMES_RU[constructorId] : undefined) ?? fallback;

/** Основа русского названия этапа в родительном падеже; для неизвестного — undefined */
export const getRaceNameRu = (raceName: string | undefined): string | undefined =>
  raceName ? RACE_NAMES_RU[raceName] : undefined;

export const getCircuitNameRu = (circuitName: string): string | undefined =>
  CIRCUIT_NAMES_RU[circuitName];

export const getCountryRu = (country: string): string | undefined => COUNTRIES_RU[country]?.name;

export const getCountryCode = (country: string): string | undefined => COUNTRIES_RU[country]?.code;

export const formatPositionDelta = (delta: number | null): string => {
  if (delta === null || delta === 0) return '—';
  return delta > 0 ? `▲ ${delta}` : `▼ ${Math.abs(delta)}`;
};

export const formatPointsDelta = (delta: number | null): string => {
  if (delta === null) return '—';
  if (delta > 0) return `+${delta}`;
  if (delta < 0) return `−${Math.abs(delta)}`;
  return '0';
};
