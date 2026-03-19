# Simon Arena

Simon Arena is a fast, neon-styled Simon game with **solo** and **online multiplayer** play.  
Multiplayer includes **turn-based play**, **spectator mode**, **lobby chat**, **scoreboard**, and **theme switching**.

## How To Run

1. Open a terminal in `C:\Users\Administrator\OneDrive\Documents\CodeX[26]`.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the server:
   ```bash
   npm start
   ```
4. Open the game in your browser:
   ```
   http://localhost:3000/
   ```

## How To Play (Solo)

1. Stay in **Solo** mode.
2. Click **Start**.
3. Watch the sequence.
4. Repeat the sequence by clicking the colored pads.
5. Each round adds one new color. Survive as long as possible.

## How To Play (Multiplayer)

1. Switch to **Server** mode.
2. Make sure you are **Online** (use **Connect** if needed).
3. Enter your **Player name**.
4. Choose one action:
   - **Create server** to generate a room code.
   - **Join server** and enter a room code from a friend.
5. Turns rotate between players.
6. On your turn:
   - **Replay** the full sequence correctly.
   - **Add one new color** to extend the sequence for the next player.

## Spectator Mode

1. Toggle **Join as spectator (watch only)** before joining.
2. Spectators can watch the game and use lobby chat but cannot play turns.

## Lobby Chat

1. Join a server.
2. Type a message in the chat box.
3. Press **Send** or hit **Enter**.

## Scoreboard

The scoreboard tracks the best sequence length achieved by each player in that room.

## Themes

Use the **Theme** dropdown in the Appearance section to switch color themes.
Your selection is saved locally in your browser.

## Files

- `index.html` — the game UI and client logic
- `server.js` — the multiplayer server (WebSocket + HTTP)
- `package.json` — dependencies and scripts

## Play Online

- https://adhrit-simon-game.onrender.com

