# MoodBot — The Ultimate MeetMe Livestream Assistant

MoodBot is a Windows desktop application that automates and enhances your MeetMe livestreams. It embeds the MeetMe and YouTube web apps side-by-side and adds a full suite of tools on top.

---

## Features

| Feature | Description |
|---------|-------------|
| **Live Chat Panel** | Real-time chat feed with viewer counts, likes, and diamonds |
| **Automated Alerts** | Auto-respond to follows, gifts, battles, and custom triggers |
| **Text-To-Speech (TTS)** | Edge TTS engine — reads chat messages aloud with voice/rate/pitch control |
| **Soundboard** | Keyword-triggered sound effects that play automatically in chat |
| **Audio Mixer** | Independent volume controls for music, TTS, and soundboard |
| **Music Player** | YouTube-backed music queue with `!sr` song request commands |
| **Timed Messages** | Scheduled chat messages sent at configurable intervals |
| **Super Speed Hearts** | Automated like-spamming to boost your broadcast's engagement |
| **Gift Previewer** | Browse the full MeetMe gift catalogue with values |
| **Custom Commands** | Define your own chat commands with custom responses |
| **Stream Schedule** | Display your streaming schedule to viewers via chat commands |
| **Command Permissions** | Control which viewers (all / mods / followers / subscribers) can use each command |

---

## Installation (Windows)

1. Download **MoodBot Installer.exe** from the Releases page
2. Run the installer — Windows may show a SmartScreen prompt; click **More info → Run anyway**
3. MoodBot installs to `%AppData%\Local\Programs\MoodBot` and creates a desktop shortcut
4. Launch MoodBot from the desktop shortcut or Start Menu

> **macOS / Linux:** Builds are available (`.dmg` and `.AppImage`) but are unsigned. See the Releases page.

---

## First Run

1. Open MoodBot — the **Stream & Live Chat** tab opens by default
2. The embedded MeetMe browser will load. Log in to your MeetMe account in the browser panel
3. Navigate to your livestream URL in the MeetMe panel, or paste it into the **Stream URL** field and click **Connect**
4. MoodBot will begin monitoring your stream and populating the dashboard

---

## Chat Commands (viewer-facing)

| Command | Description |
|---------|-------------|
| `!sr <song>` | Request a song to be added to the music queue |
| `!tts <message>` | Speak a message via Text-To-Speech |
| `!commands` | List all available chat commands |

Custom commands can be added in the **Custom Commands** tab.

---

## System Requirements

- **OS:** Windows 10 or later (64-bit)
- **RAM:** 4 GB minimum, 8 GB recommended
- **Network:** Stable internet connection for live stream monitoring

---

## Privacy

MoodBot operates entirely on your local machine. Your MeetMe credentials are never stored to disk — they are held in memory for the duration of your session only. No data is sent to any MoodBot servers.

---

## Support

For bug reports or feature requests, open an issue on the GitHub repository.
