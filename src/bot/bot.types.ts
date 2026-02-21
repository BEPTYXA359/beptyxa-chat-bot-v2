import { Context } from 'grammy';
import { CurrencyService } from '../modules/converter/currency.service';
import { SteamService } from '../modules/steam/steam.service';

export interface BotContext extends Context {
  services: {
    currency: CurrencyService;
    steam: SteamService;
  };
}
