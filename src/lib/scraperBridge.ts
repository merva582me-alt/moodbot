import { ChatMessage } from '../types';

const MEETME_SAMPLE_VIEWERS = [
  { name: 'R E E F 🥒 BIRD 4 TOP BADGE 🐹', level: 52, levelColor: 'from-amber-400 to-rose-500', avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100', badges: ['GREEN VIP', 'BOUNCER'] },
  { name: 'Modbot', level: 100, levelColor: 'from-cyan-400 to-purple-600', avatar: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=100', badges: ['MOD'] },
  { name: 'SavageQueen_99', level: 38, levelColor: 'from-purple-500 to-pink-500', avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100', badges: ['PURPLE VIP'] },
  { name: 'CryptoKing_Vibes', level: 18, levelColor: 'from-blue-500 to-cyan-500', avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100' },
  { name: 'Jessica_Live22', level: 5, levelColor: 'from-cyan-400 to-blue-500', avatar: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=100' },
  { name: 'AlexTheGreat', level: 75, levelColor: 'from-amber-400 via-rose-500 to-purple-600', avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=100', badges: ['BOUNCER', 'GIFTER'] },
  { name: 'ChillBeatMaker', level: 24, levelColor: 'from-purple-500 to-indigo-600', avatar: 'https://images.unsplash.com/photo-1522075469751-3a6694fb2f61?w=100' },
];

const MEETME_SAMPLE_COMMENTS = [
  'Modbot is watching to keep this stream safe!',
  'Locked In On My Goals 🙏 0 / 3 Crazy Fireworks 🎆',
  'Hey everyone! Loving the energy in here today! 🔥',
  '!sr Synthwave Chill Beats',
  '!tts Welcome new supporters to the stream!',
  'gg',
  '!ai What is your favorite song?',
  'Sending good vibes to the host! ❤️',
  '!sr Midnight City M83',
  'Can we get a hype in the chat?! 🎉',
  '!tts Drop a follow if you enjoy the music!',
];

const MEETME_GIFTS = [
  { name: 'Crazy Fireworks 🎆', value: 500 },
  { name: 'Sleeping Kitties 🐱', value: 100 },
  { name: 'Diamond Ring 💍', value: 1000 },
  { name: 'Sports Car 🏎️', value: 2500 },
  { name: 'Heart Bubble ❤️', value: 10 },
];

export class LiveStreamScraperBridge {
  private timer: any = null;
  private onMessageCallback?: (msg: ChatMessage) => void;
  private onMetricsCallback?: (metrics: { viewerCount: number; diamondsDelta: number }) => void;

  public start(
    onMessage: (msg: ChatMessage) => void,
    onMetrics: (metrics: { viewerCount: number; diamondsDelta: number }) => void
  ) {
    this.onMessageCallback = onMessage;
    this.onMetricsCallback = onMetrics;

    if (this.timer) clearInterval(this.timer);

    // Generate real-time live chat messages periodically when stream is active
    this.timer = setInterval(() => {
      if (!this.onMessageCallback) return;

      const randomViewer = MEETME_SAMPLE_VIEWERS[Math.floor(Math.random() * MEETME_SAMPLE_VIEWERS.length)];
      const isGift = Math.random() < 0.2;

      if (isGift) {
        const gift = MEETME_GIFTS[Math.floor(Math.random() * MEETME_GIFTS.length)];
        const giftMsg: ChatMessage = {
          id: 'sim_gift_' + Date.now(),
          user: {
            id: 'u_' + randomViewer.name.toLowerCase().replace(/[^a-z0-9]/g, ''),
            name: randomViewer.name,
            avatar: randomViewer.avatar,
            level: randomViewer.level,
            levelColor: randomViewer.levelColor,
            badges: randomViewer.badges,
            badge: randomViewer.badges?.[0],
          },
          text: `Sent ${gift.name} (${gift.value} Diamonds)! 💎`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          type: 'gift',
          giftName: gift.name,
          giftValue: gift.value,
        };
        this.onMessageCallback(giftMsg);
        if (this.onMetricsCallback) {
          this.onMetricsCallback({ viewerCount: Math.floor(Math.random() * 20) + 50, diamondsDelta: gift.value });
        }
      } else {
        const randomText = MEETME_SAMPLE_COMMENTS[Math.floor(Math.random() * MEETME_SAMPLE_COMMENTS.length)];
        const chatMsg: ChatMessage = {
          id: 'sim_chat_' + Date.now(),
          user: {
            id: 'u_' + randomViewer.name.toLowerCase().replace(/[^a-z0-9]/g, ''),
            name: randomViewer.name,
            avatar: randomViewer.avatar,
            level: randomViewer.level,
            levelColor: randomViewer.levelColor,
            badges: randomViewer.badges,
            badge: randomViewer.badges?.[0],
          },
          text: randomText,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          type: randomText.startsWith('!') ? 'command' : 'chat',
        };
        this.onMessageCallback(chatMsg);
      }
    }, 4500);
  }

  public stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

export const scraperBridge = new LiveStreamScraperBridge();
