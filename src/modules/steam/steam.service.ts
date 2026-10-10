import { CurrencyService } from '../currency/currency.service';
import { describeSteamConversion } from '../conversion/conversion.types';
import {
  BUNDLE_CACHE_TTL_MS,
  ConvertedEdition,
  EditionInfo,
  REQUEST_DELAY_MS,
  SteamApiResponseSchema,
  SteamBrowsePurchaseOption,
  SteamBrowseResponseSchema,
  SteamConversionOptions,
} from './steam.types';
import { STEAM_REGION_CURRENCY } from './steam-regions.const';
import { logger } from '../../shared/logger';
import { pluralRu } from '../../shared/utils/text.util';
import { cleanSteamName, stripGameNamePrefix } from './names.util';

const RELEASE_DATE_MONTHS: Record<string, number> = {
  янв: 0,
  фев: 1,
  мар: 2,
  апр: 3,
  май: 4,
  июн: 5,
  июл: 6,
  авг: 7,
  сен: 8,
  окт: 9,
  ноя: 10,
  дек: 11,
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

export class SteamService {
  private lastRequestTime = 0;
  private bundlesCache = new Map<string, { bundles: EditionInfo[]; fetchedAt: number }>();

  constructor(private readonly currencyService: CurrencyService) {}

  private async throttledFetch(url: string): Promise<Response> {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    if (elapsed < REQUEST_DELAY_MS) {
      await new Promise((resolve) => setTimeout(resolve, REQUEST_DELAY_MS - elapsed));
    }
    this.lastRequestTime = Date.now();
    return fetch(url);
  }

  public async getGameInfo(
    appId: string,
    cc: string = 'kz',
  ): Promise<{
    editions: EditionInfo[];
    subscriptions: EditionInfo[];
    dlcIds: number[];
    headerImage: string | null;
    gameName: string;
    hasRussianLanguage: boolean;
    releaseDate: string | null;
    isComingSoon: boolean;
    isGameFree: boolean;
    currency: string;
  }> {
    const response = await this.throttledFetch(
      `https://store.steampowered.com/api/appdetails?cc=${cc}&appids=${appId}`,
    );
    const rawData = await response.json();
    const parsedData = SteamApiResponseSchema.parse(rawData);

    const gameInfo = parsedData[appId];

    if (!gameInfo || !gameInfo.success || !gameInfo.data) {
      throw new Error('Игра не найдена или API Steam недоступно');
    }

    const gameData = gameInfo.data;
    const currency = STEAM_REGION_CURRENCY[cc.toLowerCase()] ?? 'KZT';

    const editions: EditionInfo[] = [];
    const subscriptions: EditionInfo[] = [];

    if (gameData.is_free) {
      editions.push({
        name: 'Free',
        originalPrice: null,
        finalPrice: 0,
        discountPercent: null,
        isFree: true,
        currency,
      });
    }

    if (gameData.package_groups && gameData.package_groups.length > 0) {
      for (const group of gameData.package_groups) {
        const isSubscription =
          group.name?.toLowerCase().includes('subscript') ||
          group.title?.toLowerCase().includes('подпис');

        const target = isSubscription ? subscriptions : editions;

        for (const sub of group.subs) {
          const isFree = sub.is_free_license === true || sub.price_in_cents_with_discount === 0;

          if (isFree && gameData.is_free) continue;

          const finalPrice = sub.price_in_cents_with_discount / 100;
          const { originalPrice, discountPercent } = isFree
            ? { originalPrice: null, discountPercent: null }
            : this.parseSubDiscount(sub);

          target.push({
            name: isSubscription
              ? this.formatSubscriptionName(sub.option_text)
              : this.formatEditionName(sub.option_text, gameData.name),
            originalPrice,
            finalPrice: isFree ? 0 : finalPrice,
            discountPercent,
            isFree,
            currency,
          });
        }
      }
    }

    return {
      editions,
      subscriptions,
      dlcIds: gameData.dlc || [],
      headerImage: gameData.header_image || null,
      gameName: gameData.name,
      hasRussianLanguage: gameData.supported_languages
        ? /рус|russian/i.test(gameData.supported_languages)
        : false,
      releaseDate: gameData.release_date?.date || null,
      isComingSoon: gameData.release_date?.coming_soon || false,
      isGameFree: gameData.is_free,
      currency,
    };
  }

  public async getDlcInfo(
    dlcIds: number[],
    gameName?: string,
    onProgress?: (current: number, total: number) => Promise<void>,
    cc: string = 'kz',
  ): Promise<EditionInfo[]> {
    const currency = STEAM_REGION_CURRENCY[cc.toLowerCase()] ?? 'KZT';
    const dlcs: EditionInfo[] = [];

    for (const [index, id] of dlcIds.entries()) {
      if (onProgress) await onProgress(index + 1, dlcIds.length);
      try {
        const response = await this.throttledFetch(
          `https://store.steampowered.com/api/appdetails?cc=${cc}&appids=${id}`,
        );
        const rawData = await response.json();
        const parsed = SteamApiResponseSchema.parse(rawData);
        const data = parsed[String(id)];

        if (!data?.success || !data?.data) continue;

        const item = data.data;

        if (item.is_free) {
          dlcs.push({
            name: gameName ? this.formatEditionName(item.name, gameName) : item.name,
            originalPrice: null,
            finalPrice: 0,
            discountPercent: null,
            isFree: true,
            currency,
          });
          continue;
        }

        if (!item.price_overview) continue;

        const finalPrice = item.price_overview.final / 100;
        const originalPrice = item.price_overview.initial / 100;
        const discountPercent = item.price_overview.discount_percent;

        dlcs.push({
          name: gameName ? this.formatEditionName(item.name, gameName) : item.name,
          originalPrice: discountPercent > 0 ? originalPrice : null,
          finalPrice,
          discountPercent: discountPercent > 0 ? discountPercent : null,
          isFree: false,
          currency,
        });
      } catch (error) {
        logger.warn({ err: error, dlcId: id }, 'Ошибка при получении DLC');
      }
    }

    return dlcs;
  }

  public async getBundlesInfo(
    appId: string,
    gameName?: string,
    cc: string = 'kz',
  ): Promise<EditionInfo[]> {
    // цены сырые, в валюте региона — ключ кэша должен включать регион
    const cacheKey = `${appId}:${cc}`;
    const cached = this.bundlesCache.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < BUNDLE_CACHE_TTL_MS) {
      return cached.bundles;
    }

    const inputJson = encodeURIComponent(
      JSON.stringify({
        ids: [{ appid: Number(appId) }],
        context: { country_code: cc.toUpperCase(), language: 'russian' },
        data_request: { include_all_purchase_options: true },
      }),
    );

    try {
      const response = await this.throttledFetch(
        `https://api.steampowered.com/IStoreBrowseService/GetItems/v1/?input_json=${inputJson}`,
      );
      const rawData = await response.json();
      const parsed = SteamBrowseResponseSchema.parse(rawData);
      const item = parsed.response.store_items[0];

      if (item?.success !== 1) return [];

      const currency = STEAM_REGION_CURRENCY[cc.toLowerCase()] ?? 'KZT';
      const bundles = item.purchase_options
        .map((option) => this.bundleOptionToEdition(option, gameName, currency))
        .filter((bundle): bundle is EditionInfo => bundle !== null);

      this.bundlesCache.set(cacheKey, { bundles, fetchedAt: Date.now() });

      return bundles;
    } catch (error) {
      logger.warn({ err: error, appId }, 'Ошибка при получении бандлов');
      return [];
    }
  }

  private bundleOptionToEdition(
    option: SteamBrowsePurchaseOption,
    gameName: string | undefined,
    currency: string,
  ): EditionInfo | null {
    if (
      option.bundleid === undefined ||
      option.purchase_option_name === undefined ||
      option.final_price_in_cents === undefined
    ) {
      return null;
    }

    const finalPrice = option.final_price_in_cents / 100;
    const isFree = finalPrice === 0;
    const discountPercent =
      option.bundle_discount_pct !== undefined && option.bundle_discount_pct > 0
        ? option.bundle_discount_pct
        : null;
    const originalPrice =
      discountPercent !== null && option.price_before_bundle_discount !== undefined
        ? option.price_before_bundle_discount / 100
        : null;

    const count = option.included_game_count;
    const itemsSuffix =
      count !== undefined && count > 0
        ? ` (${count} ${pluralRu(count, 'игра', 'игры', 'игр')})`
        : '';

    const cleanedBundleName = cleanSteamName(option.purchase_option_name);
    // бандл с одной игрой — по сути издание этой игры, название можно отрезать;
    // в наборе из нескольких игр имя бандла про франшизу, обрезка лишит его смысла
    const trimmedName =
      gameName !== undefined && count === 1
        ? stripGameNamePrefix(option.purchase_option_name, gameName)
        : cleanedBundleName;

    return {
      name: `${trimmedName || cleanedBundleName}${itemsSuffix}`,
      originalPrice,
      finalPrice,
      discountPercent,
      isFree,
      currency,
    };
  }

  /**
   * Конвертирует цены изданий по настройкам чата. Ошибка конвертации
   * (курсы не загружены, источник не котирует валюту) даёт convertedPrice: null —
   * форматтеры тогда показывают только цену в валюте региона.
   * Совпадение валюты региона с целевой — конвертации нет (и доп. процент не применяется).
   */
  public convertEditions(
    editions: EditionInfo[],
    options: SteamConversionOptions,
  ): ConvertedEdition[] {
    return editions.map((edition) => {
      const sameCurrency = edition.currency.toUpperCase() === options.targetCurrency.toUpperCase();
      const convertedPrice = edition.isFree
        ? 0
        : sameCurrency
          ? edition.finalPrice
          : this.applyExtraPercent(
              this.convertEditionPrice(edition.finalPrice, edition.currency, options),
              options.extraPercent,
            );
      return {
        ...edition,
        convertedPrice,
        targetCurrency: options.targetCurrency,
        extraPercent: options.extraPercent,
      };
    });
  }

  private applyExtraPercent(value: number | null, extraPercent: number): number | null {
    if (value === null || extraPercent <= 0) return value;
    return value * (1 + extraPercent / 100);
  }

  private convertEditionPrice(
    amount: number,
    fromCurrency: string,
    options: SteamConversionOptions,
  ): number | null {
    const { path, targetCurrency, ratesSource } = options;
    try {
      if (path === 'steam') {
        return this.currencyService.convertPrice(amount, fromCurrency, targetCurrency, 'steam');
      }
      if (path === 'converter') {
        return this.currencyService.convertPrice(amount, fromCurrency, targetCurrency, ratesSource);
      }
      // usd_bridge: цена в долларах по паритету Steam, затем эти доллары покупаем
      // за целевую валюту по курсу конвертера (для Т-Банка — по курсу продажи)
      const usd = this.currencyService.convertPrice(amount, fromCurrency, 'USD', 'steam');
      return this.currencyService.convertPrice(usd, 'USD', targetCurrency, ratesSource);
    } catch (error) {
      logger.warn(
        { err: error, fromCurrency, targetCurrency, path },
        'Не удалось конвертировать цену Steam',
      );
      return null;
    }
  }

  /** Подпись, каким путём считалась конвертация (для футера сообщений) */
  public conversionNote(options: SteamConversionOptions): string {
    const description = describeSteamConversion({
      path: options.path,
      ratesSource: options.ratesSource,
    });
    const percent =
      options.extraPercent > 0
        ? ` + ${options.extraPercent.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}%`
        : '';
    return `_(цены: ${description}${percent})_`;
  }

  public formatGameInline(
    editions: ConvertedEdition[],
    subscriptions: ConvertedEdition[],
    gameName: string,
    hasRussianLanguage?: boolean,
    releaseDate?: string | null,
    isComingSoon?: boolean,
    isGameFree?: boolean,
  ): string {
    const parts: string[] = [];

    let title = `*${this.escapeTableCell(gameName)}*`;
    if (hasRussianLanguage) title += ' 🇷🇺';
    parts.push(title);

    if (isComingSoon) {
      parts.push('');
      parts.push(`_${releaseDate ? this.formatReleaseDate(releaseDate) : 'В разработке'}_`);
    }

    if (editions.length > 0) {
      parts.push('');
      parts.push('*Издания:*');
      for (const ed of editions) {
        if (ed.isFree) {
          parts.push(`  • ${ed.name} — Бесплатно`);
        } else if (ed.originalPrice && ed.discountPercent) {
          parts.push(
            `  • ${ed.name} — ${this.formatMoney(ed.finalPrice, ed.currency)}${this.formatConvertedSuffix(ed)} (скидка ${ed.discountPercent}%)`,
          );
        } else {
          parts.push(
            `  • ${ed.name} — ${this.formatMoney(ed.finalPrice, ed.currency)}${this.formatConvertedSuffix(ed)}`,
          );
        }
      }
    }

    if (subscriptions.length > 0) {
      parts.push('');
      parts.push('*Подписка:*');
      for (const sub of subscriptions) {
        parts.push(
          `  • ${this.formatMoney(sub.finalPrice, sub.currency)} / мес.${this.formatConvertedSuffix(sub)}`,
        );
      }
    }

    if (editions.length === 0 && subscriptions.length === 0 && !isComingSoon && !isGameFree) {
      parts.push('');
      parts.push('_Продажи прекращены_');
    }

    return parts.join('\n');
  }

  public formatGameMessage(
    editions: ConvertedEdition[],
    subscriptions: ConvertedEdition[],
    headerImage?: string | null,
    gameName?: string,
    hasRussianLanguage?: boolean,
    releaseDate?: string | null,
    isComingSoon?: boolean,
    isGameFree?: boolean,
  ): string {
    const parts: string[] = [];

    if (headerImage) {
      parts.push(`![](${headerImage})`);
      parts.push('');
    }

    if (gameName) {
      let title = `## ${this.escapeTableCell(gameName)}`;
      if (hasRussianLanguage) {
        title += ' ![🇷🇺](tg://emoji?id=5427133701861434230)';
      }
      parts.push(title);

      if (isComingSoon) {
        parts.push(
          `==${this.escapeTableCell(releaseDate ? this.formatReleaseDate(releaseDate) : 'В разработке')}==`,
        );
      }

      if (editions.length > 0) {
        parts.push(this.formatTable(editions, 'Издание'));
      }
    }

    if (subscriptions.length > 0) {
      parts.push(this.formatSubscriptionTable(subscriptions));
    }

    if (editions.length === 0 && subscriptions.length === 0 && !isComingSoon && !isGameFree) {
      parts.push('==Продажи прекращены==');
    }

    return parts.join('\n');
  }

  public formatDlcTable(dlcs: ConvertedEdition[]): string {
    const lines: string[] = [];
    lines.push('');
    lines.push('<h4>DLC</h4>');

    // все цены в одном сообщении в одной валюте региона — колонка конвертации
    // нужна, только если целевая валюта отличается
    const hasConversion =
      dlcs.length > 0 && !this.isSameCurrency(dlcs[0].currency, dlcs[0].targetCurrency);

    let rows = '';
    let totalOriginal = 0;
    let totalConverted = 0;

    for (const dlc of dlcs) {
      const name = this.escapeHtml(dlc.name);
      if (dlc.isFree) {
        rows += `<tr><td align="left">${name}</td><td align="center" colspan="2">Бесплатно</td></tr>`;
        continue;
      }

      totalOriginal += dlc.finalPrice;
      if (dlc.convertedPrice !== null) totalConverted += dlc.convertedPrice;

      if (!hasConversion) {
        rows += `<tr><td align="left">${name}</td><td align="center" colspan="2">${this.formatRegionPriceHtml(dlc)}</td></tr>`;
        continue;
      }

      const convertedCell =
        dlc.convertedPrice !== null
          ? `<td align="right">${this.formatConvertedPriceHtml(dlc)}</td>`
          : '<td></td>';
      rows += `<tr><td align="left">${name}</td><td align="center">${this.formatRegionPriceHtml(dlc)}</td>${convertedCell}</tr>`;
    }

    if (dlcs.length > 1) {
      const currency = dlcs[0].currency;
      const totalCell = hasConversion
        ? `<td align="right"><b>${this.formatConvertedPriceHtml({ ...dlcs[0], convertedPrice: totalConverted })}</b></td>`
        : '';
      rows += `<tr><td align="left"><b>Итого (${dlcs.length} шт.)</b></td><td align="center"><b>${this.formatMoney(totalOriginal, currency)}</b></td>${totalCell}</tr>`;
    }

    lines.push(
      `<table bordered striped><tr><th align="center">Название</th><th align="center" colspan="2">Цена</th></tr>${rows}</table>`,
    );
    return lines.join('\n');
  }

  public formatBundlesTable(bundles: ConvertedEdition[]): string {
    const lines: string[] = [];
    lines.push('');
    lines.push('<h4>Бандлы</h4>');

    const rows = bundles
      .map((bundle) => {
        const name = this.escapeHtml(bundle.name);
        if (bundle.isFree) {
          return `<tr><td align="left">${name}</td><td align="center" colspan="2">Бесплатно</td></tr>`;
        }
        return `<tr><td align="left">${name}</td><td align="center">${this.formatRegionPriceHtml(bundle)}</td><td align="right">${this.formatConvertedPriceHtml(bundle)}</td></tr>`;
      })
      .join('');

    lines.push(
      `<table bordered striped><tr><th align="center">Название</th><th align="center" colspan="2">Цена</th></tr>${rows}</table>`,
    );
    return lines.join('\n');
  }

  private formatTable(items: ConvertedEdition[], firstColumn: string = 'Название'): string {
    const rows = items.map((item) => {
      const name = this.escapeHtml(item.name);
      if (item.isFree) {
        return `<tr><td align="left">${name}</td><td align="center" colspan="2">Бесплатно</td></tr>`;
      }
      const regionPrice = this.formatRegionPriceHtml(item);
      const convertedPrice = this.formatConvertedPriceHtml(item);
      if (convertedPrice === null) {
        return `<tr><td align="left">${name}</td><td align="center" colspan="2">${regionPrice}</td></tr>`;
      }
      return `<tr><td align="left">${name}</td><td align="center">${regionPrice}</td><td align="right">${convertedPrice}</td></tr>`;
    });
    return `<table bordered striped><tr><th align="center">${firstColumn}</th><th align="center" colspan="2">Цена</th></tr>${rows.join('')}</table>`;
  }

  /** Цена в валюте региона, со скидкой при наличии */
  private formatRegionPriceHtml(item: ConvertedEdition): string {
    if (item.isFree) return 'Бесплатно';
    const finalFormatted = this.formatMoney(item.finalPrice, item.currency);
    if (item.originalPrice !== null && item.originalPrice > item.finalPrice) {
      const originalFormatted = this.formatMoney(item.originalPrice, item.currency);
      return `<s>${originalFormatted}</s> ${finalFormatted}`;
    }
    return finalFormatted;
  }

  /** Конвертированная цена; null — колонка не показывается (нет курса или валюты совпадают) */
  private formatConvertedPriceHtml(item: ConvertedEdition): string | null {
    if (this.isSameCurrency(item.currency, item.targetCurrency)) return null;
    if (item.convertedPrice === null) return null;
    return `~${this.formatMoney(item.convertedPrice, item.targetCurrency)}`;
  }

  private formatConvertedSuffix(item: ConvertedEdition): string {
    const converted = this.formatConvertedPriceHtml(item);
    return converted === null ? '' : ` (${converted})`;
  }

  private isSameCurrency(a: string, b: string): boolean {
    return a.toUpperCase() === b.toUpperCase();
  }

  private formatMoney(amount: number, currency: string): string {
    try {
      return new Intl.NumberFormat('ru-RU', {
        style: 'currency',
        currency,
        currencyDisplay: 'narrowSymbol',
        maximumFractionDigits: 0,
      }).format(amount);
    } catch {
      return `${this.formatPrice(amount)} ${currency}`;
    }
  }

  private formatPrice(price: number): string {
    return price.toLocaleString('ru-RU', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
  }

  private parseSubDiscount(sub: {
    option_text: string;
    price_in_cents?: number;
    percent_savings?: number;
    price_in_cents_with_discount: number;
  }): { originalPrice: number | null; discountPercent: number | null } {
    if (sub.percent_savings !== undefined && sub.percent_savings > 0) {
      const originalPrice = sub.price_in_cents ? sub.price_in_cents / 100 : null;
      return { originalPrice, discountPercent: sub.percent_savings };
    }

    if (sub.price_in_cents !== undefined && sub.price_in_cents > sub.price_in_cents_with_discount) {
      const originalPrice = sub.price_in_cents / 100;
      const discountPercent = Math.round(
        (1 - sub.price_in_cents_with_discount / sub.price_in_cents) * 100,
      );
      return { originalPrice, discountPercent };
    }

    if (sub.option_text.includes('discount_original_price')) {
      const originalPrice = this.extractOriginalPriceFromHtml(sub.option_text);
      if (originalPrice !== null && originalPrice > 0) {
        const finalPrice = sub.price_in_cents_with_discount / 100;
        const discountPercent = Math.round((1 - finalPrice / originalPrice) * 100);
        if (discountPercent > 0) {
          return { originalPrice, discountPercent };
        }
      }
    }

    return { originalPrice: null, discountPercent: null };
  }

  private extractOriginalPriceFromHtml(htmlText: string): number | null {
    const match = htmlText.match(/<span class="discount_original_price">([^<]+)<\/span>/);
    if (!match) return null;

    const priceStr = match[1].replace(/[^\d,]/g, '').replace(',', '.');
    const price = parseFloat(priceStr);
    return isNaN(price) ? null : price;
  }

  private formatEditionName(rawName: string, gameName: string): string {
    let name = rawName.replace(/<[^>]*>/g, '');
    // хвост вида "- 1 299₸" из option_text: валюта зависит от региона
    name = name.replace(/\s*-\s*[\d\s.,]+[₸₽$€£¥₴₺₹₩](?:\s*[\d\s.,]+[₸₽$€£¥₴₺₹₩])?\s*$/, '');
    return stripGameNamePrefix(name, gameName) || 'Базовая игра';
  }

  private formatSubscriptionName(rawName: string): string {
    let name = rawName.replace(/<[^>]*>/g, '');
    name = name.replace(/\bmonths?\b/gi, 'мес.');
    name = name.replace(/\byears?\b/gi, 'год');
    name = name.replace(/\bweeks?\b/gi, 'неделя');
    name = name.replace(/\s+/g, ' ').trim();
    return name;
  }

  private extractPeriod(name: string): string {
    const match = name.match(/\/([^/]+)$/);
    return match ? match[1].trim() : 'мес.';
  }

  private formatSubscriptionTable(subscriptions: ConvertedEdition[]): string {
    const rows = subscriptions.map((item) => {
      const name = this.escapeHtml(item.name);
      const period = this.extractPeriod(item.name);
      const converted = this.formatConvertedPriceHtml(item);
      const price =
        converted !== null
          ? `${converted} / ${period}`
          : `${this.formatMoney(item.finalPrice, item.currency)} / ${period}`;
      return `<tr><td align="center">${name}</td><td align="center">${price}</td></tr>`;
    });
    return [
      '',
      '<h4>Подписка</h4>',
      `<table bordered striped><tr><th align="center" colspan="2">Цена</th></tr>${rows.join('')}</table>`,
    ].join('\n');
  }

  private escapeTableCell(text: string): string {
    return text.replace(/([_*[\]()~`>#+={}.!\\-])/g, '\\$1');
  }

  public parseReleaseDateParts(dateStr: string): {
    day: number;
    month: number;
    year: number;
  } | null {
    if (/^(?:Ещё не объявлена|To be announced)$/i.test(dateStr)) return null;
    if (/^(?:coming soon|скоро выходит)$/i.test(dateStr)) return null;
    if (/^\d{4}$/.test(dateStr)) return null;

    const m = dateStr.match(/(\d{1,2})\s*([а-яёa-z]+)\.?\s*,?\s*(\d{4})/i);
    if (m) {
      const month = RELEASE_DATE_MONTHS[m[2].toLowerCase().slice(0, 3)];
      if (month !== undefined) {
        return { day: parseInt(m[1]), month: month + 1, year: parseInt(m[3]) };
      }
    }

    const fallback = new Date(dateStr.replace(/,/g, ''));
    if (isNaN(fallback.getTime())) return null;

    return {
      day: fallback.getDate(),
      month: fallback.getMonth() + 1,
      year: fallback.getFullYear(),
    };
  }

  private formatReleaseDate(dateStr: string): string {
    if (/^(?:Ещё не объявлена|To be announced)$/i.test(dateStr)) {
      return 'Дата выхода: Ещё не объявлена';
    }

    if (/^(?:coming soon|скоро выходит)$/i.test(dateStr)) {
      return 'Дата выхода: Скоро выходит';
    }

    if (/^\d{4}$/.test(dateStr)) {
      return `Дата выхода: ${dateStr} г.`;
    }

    const parts = this.parseReleaseDateParts(dateStr);
    if (!parts) return `Дата выхода: ${dateStr}`;

    const date = new Date(parts.year, parts.month - 1, parts.day);

    const formatted = date.toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });

    const diffMs = date.getTime() - Date.now();
    if (diffMs > 0) {
      const diffWeeks = Math.round(diffMs / (7 * 24 * 60 * 60 * 1000));
      if (diffWeeks <= 1) {
        const diffDays = Math.round(diffMs / (24 * 60 * 60 * 1000));
        return `Дата выхода: ${formatted} (≈${diffDays} дн.)`;
      }
      return `Дата выхода: ${formatted} (≈${diffWeeks} нед.)`;
    }

    return `Дата выхода: ${formatted}`;
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
