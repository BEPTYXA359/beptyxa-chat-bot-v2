import { Context } from 'grammy';
import { StreamFlavor } from '@grammyjs/stream';
import { CurrencyService } from '../modules/currency/currency.service';
import { SteamService } from '../modules/steam/steam.service';
import { ChatService } from '../modules/chat/chat.service';
import { ConversionSettingsService } from '../modules/conversion/conversion-settings.service';

export interface BotContext extends StreamFlavor<Context> {
  services: {
    currency: CurrencyService;
    steam: SteamService;
    chat: ChatService;
    conversion: ConversionSettingsService;
  };
}
