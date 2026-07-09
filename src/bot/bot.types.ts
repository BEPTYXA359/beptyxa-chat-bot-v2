import { Context } from 'grammy';
import { StreamFlavor } from '@grammyjs/stream';
import { CurrencyService } from '../modules/currency/currency.service';
import { SteamService } from '../modules/steam/steam.service';
import { ChatService } from '../modules/chat/chat.service';

export interface BotContext extends StreamFlavor<Context> {
  services: {
    currency: CurrencyService;
    steam: SteamService;
    chat: ChatService;
  };
}
