import { CurrencyService } from '../currency/currency.service';
import {
  BUNDLE_CACHE_TTL_MS,
  EditionInfo,
  REQUEST_DELAY_MS,
  SteamApiResponseSchema,
  SteamBrowsePurchaseOption,
  SteamBrowseResponseSchema,
} from './steam.types';
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

  public async getGameInfo(appId: string): Promise<{
    editions: EditionInfo[];
    subscriptions: EditionInfo[];
    dlcIds: number[];
    headerImage: string | null;
    gameName: string;
    hasRussianLanguage: boolean;
    releaseDate: string | null;
    isComingSoon: boolean;
    isGameFree: boolean;
  }> {
    const response = await this.throttledFetch(
      `https://store.steampowered.com/api/appdetails?cc=kz&appids=${appId}`,
    );
    const rawData = await response.json();
    const parsedData = SteamApiResponseSchema.parse(rawData);

    const gameInfo = parsedData[appId];

    if (!gameInfo || !gameInfo.success || !gameInfo.data) {
      throw new Error('Игра не найдена или API Steam недоступно');
    }

    const gameData = gameInfo.data;

    const editions: EditionInfo[] = [];
    const subscriptions: EditionInfo[] = [];

    if (gameData.is_free) {
      editions.push({
        name: 'Free',
        originalPriceKzt: null,
        finalPriceKzt: 0,
        discountPercent: null,
        finalPriceRub: 0,
        isFree: true,
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

          const finalPriceKzt = sub.price_in_cents_with_discount / 100;
          const { originalPriceKzt, discountPercent } = isFree
            ? { originalPriceKzt: null, discountPercent: null }
            : this.parseSubDiscount(sub);
          const finalPriceRub = isFree
            ? 0
            : this.currencyService.convert(finalPriceKzt, 'KZT', 'RUB');

          target.push({
            name: isSubscription
              ? this.formatSubscriptionName(sub.option_text)
              : this.formatEditionName(sub.option_text, gameData.name),
            originalPriceKzt,
            finalPriceKzt: isFree ? 0 : finalPriceKzt,
            discountPercent,
            finalPriceRub,
            isFree,
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
    };
  }

  public async getDlcInfo(
    dlcIds: number[],
    gameName?: string,
    onProgress?: (current: number, total: number) => Promise<void>,
  ): Promise<EditionInfo[]> {
    const dlcs: EditionInfo[] = [];

    for (const [index, id] of dlcIds.entries()) {
      if (onProgress) await onProgress(index + 1, dlcIds.length);
      try {
        const response = await this.throttledFetch(
          `https://store.steampowered.com/api/appdetails?cc=kz&appids=${id}`,
        );
        const rawData = await response.json();
        const parsed = SteamApiResponseSchema.parse(rawData);
        const data = parsed[String(id)];

        if (!data?.success || !data?.data) continue;

        const item = data.data;

        if (item.is_free) {
          dlcs.push({
            name: gameName ? this.formatEditionName(item.name, gameName) : item.name,
            originalPriceKzt: null,
            finalPriceKzt: 0,
            discountPercent: null,
            finalPriceRub: 0,
            isFree: true,
          });
          continue;
        }

        if (!item.price_overview) continue;

        const finalPriceKzt = item.price_overview.final / 100;
        const originalPriceKzt = item.price_overview.initial / 100;
        const discountPercent = item.price_overview.discount_percent;
        const finalPriceRub = this.currencyService.convert(finalPriceKzt, 'KZT', 'RUB');

        dlcs.push({
          name: gameName ? this.formatEditionName(item.name, gameName) : item.name,
          originalPriceKzt: discountPercent > 0 ? originalPriceKzt : null,
          finalPriceKzt,
          discountPercent: discountPercent > 0 ? discountPercent : null,
          finalPriceRub,
          isFree: false,
        });
      } catch (error) {
        logger.warn({ err: error, dlcId: id }, 'Ошибка при получении DLC');
      }
    }

    return dlcs;
  }

  public async getBundlesInfo(appId: string, gameName?: string): Promise<EditionInfo[]> {
    const cached = this.bundlesCache.get(appId);
    if (cached && Date.now() - cached.fetchedAt < BUNDLE_CACHE_TTL_MS) {
      return cached.bundles;
    }

    const inputJson = encodeURIComponent(
      JSON.stringify({
        ids: [{ appid: Number(appId) }],
        context: { country_code: 'KZ', language: 'russian' },
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

      const bundles = item.purchase_options
        .map((option) => this.bundleOptionToEdition(option, gameName))
        .filter((bundle): bundle is EditionInfo => bundle !== null);

      this.bundlesCache.set(appId, { bundles, fetchedAt: Date.now() });

      return bundles;
    } catch (error) {
      logger.warn({ err: error, appId }, 'Ошибка при получении бандлов');
      return [];
    }
  }

  private bundleOptionToEdition(
    option: SteamBrowsePurchaseOption,
    gameName?: string,
  ): EditionInfo | null {
    if (
      option.bundleid === undefined ||
      option.purchase_option_name === undefined ||
      option.final_price_in_cents === undefined
    ) {
      return null;
    }

    const finalPriceKzt = option.final_price_in_cents / 100;
    const isFree = finalPriceKzt === 0;
    const discountPercent =
      option.bundle_discount_pct !== undefined && option.bundle_discount_pct > 0
        ? option.bundle_discount_pct
        : null;
    const originalPriceKzt =
      discountPercent !== null && option.price_before_bundle_discount !== undefined
        ? option.price_before_bundle_discount / 100
        : null;

    const count = option.included_game_count;
    const itemsSuffix =
      count !== undefined && count > 0
        ? ` (${count} ${pluralRu(count, 'игра', 'игры', 'игр')})`
        : '';

    const cleanedBundleName = cleanSteamName(option.purchase_option_name);
    const trimmedName = gameName
      ? stripGameNamePrefix(option.purchase_option_name, gameName)
      : cleanedBundleName;

    return {
      name: `${trimmedName || cleanedBundleName}${itemsSuffix}`,
      originalPriceKzt,
      finalPriceKzt,
      discountPercent,
      finalPriceRub: isFree ? 0 : this.currencyService.convert(finalPriceKzt, 'KZT', 'RUB'),
      isFree,
    };
  }

  public formatGameInline(
    editions: EditionInfo[],
    subscriptions: EditionInfo[],
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
        } else if (ed.originalPriceKzt && ed.discountPercent) {
          parts.push(
            `  • ${ed.name} — ${this.formatPrice(ed.finalPriceKzt)}₸ (~${this.formatPrice(ed.finalPriceRub)} ₽) (скидка ${ed.discountPercent}%)`,
          );
        } else {
          parts.push(
            `  • ${ed.name} — ${this.formatPrice(ed.finalPriceKzt)}₸ (~${this.formatPrice(ed.finalPriceRub)} ₽)`,
          );
        }
      }
    }

    if (subscriptions.length > 0) {
      parts.push('');
      parts.push('*Подписка:*');
      for (const sub of subscriptions) {
        parts.push(
          `  • ${this.formatPrice(sub.finalPriceKzt)}₸ / мес. (~${this.formatPrice(sub.finalPriceRub)} ₽)`,
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
    editions: EditionInfo[],
    subscriptions: EditionInfo[],
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

  public formatDlcTable(dlcs: EditionInfo[]): string {
    const lines: string[] = [];
    lines.push('');
    lines.push('<h4>DLC</h4>');

    let rows = '';
    let totalKzt = 0;
    let totalRub = 0;

    for (const dlc of dlcs) {
      const name = this.escapeHtml(dlc.name);
      if (dlc.isFree) {
        rows += `<tr><td align="left">${name}</td><td align="center" colspan="2">Бесплатно</td></tr>`;
      } else {
        totalKzt += dlc.finalPriceKzt;
        totalRub += dlc.finalPriceRub;
        rows += `<tr><td align="left">${name}</td><td align="center">${this.formatKztPriceHtml(dlc)}</td><td align="right">${this.formatRubPriceHtml(dlc)}</td></tr>`;
      }
    }

    if (dlcs.length > 1) {
      rows += `<tr><td align="left"><b>Итого (${dlcs.length} шт.)</b></td><td align="center"><b>${this.formatPrice(totalKzt)}₸</b></td><td align="right"><b>~${this.formatPrice(totalRub)} ₽</b></td></tr>`;
    }

    lines.push(
      `<table bordered striped><tr><th align="center">Название</th><th align="center" colspan="2">Цена</th></tr>${rows}</table>`,
    );
    return lines.join('\n');
  }

  public formatBundlesTable(bundles: EditionInfo[]): string {
    const lines: string[] = [];
    lines.push('');
    lines.push('<h4>Бандлы</h4>');

    const rows = bundles
      .map((bundle) => {
        const name = this.escapeHtml(bundle.name);
        if (bundle.isFree) {
          return `<tr><td align="left">${name}</td><td align="center" colspan="2">Бесплатно</td></tr>`;
        }
        return `<tr><td align="left">${name}</td><td align="center">${this.formatKztPriceHtml(bundle)}</td><td align="right">${this.formatRubPriceHtml(bundle)}</td></tr>`;
      })
      .join('');

    lines.push(
      `<table bordered striped><tr><th align="center">Название</th><th align="center" colspan="2">Цена</th></tr>${rows}</table>`,
    );
    return lines.join('\n');
  }

  private formatTable(items: EditionInfo[], firstColumn: string = 'Название'): string {
    const rows = items.map((item) => {
      const name = this.escapeHtml(item.name);
      if (item.isFree) {
        return `<tr><td align="left">${name}</td><td align="center" colspan="2">Бесплатно</td></tr>`;
      }
      const kztPrice = this.formatKztPriceHtml(item);
      const rubPrice = this.formatRubPriceHtml(item);
      return `<tr><td align="left">${name}</td><td align="center">${kztPrice}</td><td align="right">${rubPrice}</td></tr>`;
    });
    return `<table bordered striped><tr><th align="center">${firstColumn}</th><th align="center" colspan="2">Цена</th></tr>${rows.join('')}</table>`;
  }

  private formatKztPriceHtml(item: EditionInfo): string {
    if (item.isFree) return 'Бесплатно';
    const finalFormatted = this.formatPrice(item.finalPriceKzt);
    if (item.originalPriceKzt !== null && item.originalPriceKzt > item.finalPriceKzt) {
      const originalFormatted = this.formatPrice(item.originalPriceKzt);
      return `<s>${originalFormatted}₸</s> ${finalFormatted}₸`;
    }
    return `${finalFormatted}₸`;
  }

  private formatRubPriceHtml(item: EditionInfo): string {
    return `~${this.formatPrice(item.finalPriceRub)} ₽`;
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
  }): { originalPriceKzt: number | null; discountPercent: number | null } {
    if (sub.percent_savings !== undefined && sub.percent_savings > 0) {
      const originalPriceKzt = sub.price_in_cents ? sub.price_in_cents / 100 : null;
      return { originalPriceKzt, discountPercent: sub.percent_savings };
    }

    if (sub.price_in_cents !== undefined && sub.price_in_cents > sub.price_in_cents_with_discount) {
      const originalPriceKzt = sub.price_in_cents / 100;
      const discountPercent = Math.round(
        (1 - sub.price_in_cents_with_discount / sub.price_in_cents) * 100,
      );
      return { originalPriceKzt, discountPercent };
    }

    if (sub.option_text.includes('discount_original_price')) {
      const originalKzt = this.extractOriginalPriceFromHtml(sub.option_text);
      if (originalKzt !== null && originalKzt > 0) {
        const finalKzt = sub.price_in_cents_with_discount / 100;
        const discountPercent = Math.round((1 - finalKzt / originalKzt) * 100);
        if (discountPercent > 0) {
          return { originalPriceKzt: originalKzt, discountPercent };
        }
      }
    }

    return { originalPriceKzt: null, discountPercent: null };
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
    name = name.replace(/\s*-\s*[\d\s]+₸(?:\s*[\d\s]+₸)?\s*$/, '');
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

  private formatSubscriptionTable(subscriptions: EditionInfo[]): string {
    const rows = subscriptions.map((item) => {
      const name = this.escapeHtml(item.name);
      const period = this.extractPeriod(item.name);
      const rubPrice = this.formatPrice(item.finalPriceRub);
      return `<tr><td align="center">${name}</td><td align="center">~${rubPrice} ₽ / ${period}</td></tr>`;
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
