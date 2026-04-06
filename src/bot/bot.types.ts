import { Context } from 'grammy';
import { CurrencyService } from '../modules/currency/currency.service';
import { SteamService } from '../modules/steam/steam.service';
import { ChatService } from '../modules/chat/chat.service';

export interface BotContext extends Context {
  services: {
    currency: CurrencyService;
    steam: SteamService;
    chat: ChatService;
  };
}
