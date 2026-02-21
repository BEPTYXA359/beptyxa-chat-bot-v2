import { CurrencyService } from '../converter/currency.service';
import { SteamApiResponseSchema } from './steam.types';
import { logger } from '../../shared/logger';

export class SteamService {
  constructor(private readonly currencyService: CurrencyService) {}

  public async getGamePricesInfo(appId: string): Promise<string[]> {
    try {
      const response = await fetch(
        `https://store.steampowered.com/api/appdetails?cc=kz&appids=${appId}`,
      );
      const rawData = await response.json();
      const parsedData = SteamApiResponseSchema.parse(rawData);

      const gameInfo = parsedData[appId];

      if (!gameInfo || !gameInfo.success || !gameInfo.data) {
        throw new Error('Игра не найдена или API Steam недоступно');
      }

      const gameData = gameInfo.data;
      const prices: string[] = [];

      const gameNameEscaped = this.escapeMarkdown(gameData.name);

      if (gameData.is_free) {
        prices.push(`_${gameNameEscaped}_ \\- *Бесплатно*`);
      } else if (gameData.package_groups && gameData.package_groups.length > 0) {
        gameData.package_groups[0].subs.forEach((sub) => {
          const priceRub = this.currencyService
            .convert(sub.price_in_cents_with_discount / 100, 'KZT', 'RUB')
            .toFixed(0);

          const optionText = this.formatOptionText(sub.option_text);

          prices.push(`_${optionText}_ *\\~ ${priceRub}₽*`);
        });
      }

      return prices;
    } catch (error) {
      logger.error({ err: error, appId }, 'Ошибка получения данных из Steam');
      throw error;
    }
  }

  private formatOptionText(htmlText: string): string {
    let text = htmlText
      .replace(/<span class="discount_original_price">/g, 'STRIKETHROUGH')
      .replace(/<\/span>/g, 'STRIKETHROUGH');

    text = this.escapeMarkdown(text);

    text = text.replace(/STRIKETHROUGH/g, '~');

    return text;
  }

  private escapeMarkdown(text: string): string {
    return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
  }
}
