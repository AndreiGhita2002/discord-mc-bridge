# Discord Minecraft Bridge

> Connects [Discord](https://discord.com/) and [Minecraft](https://minecraft.net) servers by sending chat back and forth, without any mods or plugins.

This project started as a fork of [shulker](https://github.com/destruc7i0n/shulker) by [destruc7i0n](https://github.com/destruc7i0n). The log parsing, webhook messages and most of the configuration options come from shulker.

## Features
- Sends messages to and from vanilla (and Paper) Minecraft servers with no plugins or mods
- Can send messages about
  - Server start and stop
  - Players joining and leaving
  - Advancements
  - Player deaths
- Sends messages through a webhook, with each player's head as the avatar
- `/list` and `/online` Discord slash commands that show who is online
- Allows members with specific roles to send commands to Minecraft through Discord
- Runs in Docker, and the deployed container updates itself when `master` changes (see [Deployment](#deployment))

### Changes from shulker
- `/list` and `/online` slash commands, answered over RCON
- Server messages (joins, deaths, etc.) use the bot's avatar when `SERVER_IMAGE` is not set
- `%nickname%` in `MINECRAFT_TELLRAW_TEMPLATE` resolves to the Discord server nickname, then the user's display name, then their username
- Secrets are read from the environment (`.env`) instead of `config.json`
- discord.js 13.17, Node 22, and a Docker image published to GHCR by CI

## Setup

Create a Discord bot here: https://discord.com/developers/applications

* Important: Ensure that the bot has the **Server Members Intent** and the **Message Content Intent** (on the "Bot" tab in your application settings)

Add the bot to your Discord server with the following link, replacing the client ID with that of your bot. The `applications.commands` scope is needed for `/list` and `/online`.
```
https://discord.com/oauth2/authorize?client_id=<CLIENT ID>&scope=bot%20applications.commands
```

In your Minecraft `server.properties`, make sure you have the following and restart the server:
```
enable-rcon=true
rcon.password=<your password>
rcon.port=<1-65535>
```

With developer mode enabled in Discord (Settings > Advanced > Developer Mode), right click the channel you want the bridge to use and click "Copy ID".

Create a webhook in that channel (Edit Channel > Integrations > Webhooks > New Webhook) and copy its URL.

### Secrets

Secrets live in a `.env` file, which is gitignored. Copy `.env.example` to `.env` and fill it in:
```sh
DISCORD_TOKEN=<your bot token>
WEBHOOK_URL=<your webhook url>
MINECRAFT_SERVER_RCON_PASSWORD=<your rcon password>
```
The bridge loads `.env` at startup. Values set in the environment take priority over the same keys in `config.json`.

### Config

Copy `config.example.json` to `config.json` and set:
- `DISCORD_CHANNEL_ID` to the channel ID you copied
- `MINECRAFT_SERVER_RCON_IP` and `MINECRAFT_SERVER_RCON_PORT` (`127.0.0.1` works if the bridge shares a network with the Minecraft server)
- `IS_LOCAL_FILE` to `true` and `LOCAL_FILE_PATH` to the server's `logs/latest.log`, if the bridge can read the log file directly. Otherwise see [Remote Setup](#remote-setup).

`config.json` is gitignored as well.

### Running locally

```sh
yarn install
yarn build
yarn start
```

## Deployment

CI builds an arm64 image and pushes it to `ghcr.io/andreighita2002/discord-mc-bridge` (tagged `latest` and `sha-<commit>`) on every push to `master` that passes the unit tests. On the server, [Watchtower](https://github.com/nicholas-fedor/watchtower) checks for a new `latest` image every 5 minutes and recreates the bridge container when there is one.

Example `docker-compose.yml`, with the bridge sharing the Minecraft container's network so RCON is on `127.0.0.1`:
```yaml
services:
  mc:
    image: itzg/minecraft-server
    environment:
      EULA: "TRUE"
      ENABLE_RCON: "true"
      RCON_PASSWORD: "${RCON_PASSWORD}"
    volumes:
      - ./data:/data

  discord-bridge:
    image: ghcr.io/andreighita2002/discord-mc-bridge:latest
    pull_policy: always
    depends_on:
      mc:
        condition: service_healthy
    network_mode: "service:mc"
    env_file: ./discord-bridge/.env
    volumes:
      - ./data/logs:/mc-logs:ro
      - ./discord-bridge/config.json:/app/config.json:ro
    labels:
      - com.centurylinklabs.watchtower.enable=true

  watchtower:
    image: nickfedor/watchtower:latest
    restart: unless-stopped
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    environment:
      WATCHTOWER_LABEL_ENABLE: "true"
      WATCHTOWER_POLL_INTERVAL: "300"
      WATCHTOWER_CLEANUP: "true"
```
With the bridge reading the log from `/mc-logs`, set `LOCAL_FILE_PATH` to `/mc-logs/latest.log` in `config.json`.

The image doesn't contain `config.json` or any secrets; both are provided at runtime as above.

### Configuration
Details on the `config.json` file. `DISCORD_TOKEN`, `WEBHOOK_URL` and `MINECRAFT_SERVER_RCON_PASSWORD` can also be set here, but should go in `.env` instead.

```js
{
    "DEBUG": false, /* Dev debugging */

    "USE_WEBHOOKS": true, /* If you want to use webhooks rather than the Discord bot sending the messages (recommended) */
    "WEBHOOK_URL": "DISCORD_WEBHOOK_URL_HERE", /* Prefer setting this in .env */

    "IGNORE_WEBHOOKS": true, /* Ignore any messages that are sent by webhooks. If disabled, then all webhooks but those sent from the configured webhook will be handled as well */

    "DISCORD_TOKEN": "<12345>", /* Discord bot token. Prefer setting this in .env */
    "DISCORD_CHANNEL_ID": "<channel>", /* Discord channel ID for the bot. Enable developer mode in your Discord client, then right click the channel and select "Copy ID". */
    "DISCORD_MESSAGE_TEMPLATE": "`%username%`:%message%", /* Message template to display in Discord */

    "MINECRAFT_SERVER_RCON_IP": "127.0.0.1", /* Minecraft server IP (make sure you have enabled rcon) */
    "MINECRAFT_SERVER_RCON_PORT": <1-65535>, /* Minecraft server rcon port */
    "MINECRAFT_SERVER_RCON_PASSWORD": "<your password>", /* Minecraft server rcon password. Prefer setting this in .env */
    "MINECRAFT_TELLRAW_TEMPLATE": "[{\"color\": \"white\", \"text\": \"<%nickname%> %message%\"}]", /* Tellraw template to display in Minecraft. Supports %username%, %nickname%, %discriminator% and %message% */
    "MINECRAFT_TELLRAW_DOESNT_EXIST": false, /* Minecraft doesn't have the tellraw command (<1.7.2), use say instead. !this may be dangerous! */
    "MINECRAFT_TELLRAW_DOESNT_EXIST_SAY_TEMPLATE": "<%username%> %message%", /* used when MINECRAFT_TELLRAW_DOESNT_EXIST is set to true. say template to display on minecraft, same as MINECRAFT_TELLRAW_TEMPLATE. */

    "IS_LOCAL_FILE": true, /* tail the local file specified at `LOCAL_FILE_PATH` */
    "LOCAL_FILE_PATH": "/mc-logs/latest.log", /* the path to the local file if `IS_LOCAL_FILE` is set */
    "FS_WATCH_FILE": false, /* use node's watchFile rather than watch. see FAQ for more details */

    "PORT": 8000, /* Port you want to run the webserver for the hook on */
    "SHOW_INIT_MESSAGE": true, /* Sends the message on boot if not a local file of what command to run */

    "ALLOW_USER_MENTIONS": false, /* should replace @mentions with the mention in discord (format: @username#discriminator) */
    "ALLOW_HERE_EVERYONE_MENTIONS": false, /* replaces @everyone and @here with "@ everyone" and "@ here" respectively */
    "ALLOW_SLASH_COMMANDS": false, /* whether to allow users to run Minecraft commands from discord by starting a message with / */
    "SLASH_COMMAND_ROLES_IDS": [], /* if the above is enabled, the IDs of the roles which can run commands. With developer mode enabled, right click each role and "Copy ID". */

    "WEBHOOK": "/minecraft/hook", /* Web hook, where to send the log to */
    "REGEX_SERVER_PREFIX": "\\[Server thread/INFO\\]:", /* What the lines of the log should start with */
    "REGEX_MATCH_CHAT_MC": "^<([^>]*)> (.*)", /* What to match for chat (best to leave as default) */
    "REGEX_DEATH_MESSAGE": "^[\w_]+ (died|...)", /* What to match for death messages (best leave this default too) */
    "REGEX_IGNORED_CHAT": "packets too frequently", /* What to ignore, you can put any regex for swear words for example and it will be ignored */

    "SERVER_NAME": "Server", /* The username used when displaying any server information in chat, e.g., Server - Server : Server message here */
    "SERVER_IMAGE": "", /* Avatar for server messages (webhooks only). Defaults to the bot's avatar when empty */
    "HEAD_IMAGE_URL": "https://mc-heads.net/avatar/%uuid%/256", /* Url to get the heads for the webhook, %uuid% is replaced with the uuid of the player */
    "UUID_API_URL": "https://api.mojang.com/users/profiles/minecraft/%username%", /* Url to fetch the uuids from. %username% is replaced with the username of the player. expects uuid at top level key `id` (like the mojang api) */
    "DEFAULT_PLAYER_HEAD": "c06f89064c8a49119c29ea1dbd1aab82", /* UUID of player with the default head to use (currently is MHF_Steve) */

    "SHOW_SERVER_STATUS": false, /* Shows when the server turns on and off e.g., Server - Server : Server is online */
    "SHOW_PLAYER_CONN_STAT": false, /* Shows player connection status in chat, e.g., Server - Server : TheMachine joined the game */
    "SHOW_PLAYER_ADVANCEMENT": false, /* Shows when players earn advancements in chat, e.g., Server - Server : TheMachine has made the advancement [MEME - Machine] */
    "SHOW_PLAYER_DEATH": false, /* Shows when players die in chat, e.g., Server - Server : TheMachine was blown up by creeper */
    "SHOW_PLAYER_ME": false /* Shows when players use the /me command, e.g. **destruc7i0n** says hello */
}
```

## FAQ
* How do I make this work on a modded server?
  - Try replacing `REGEX_SERVER_PREFIX` with `"\\[Server thread/INFO\\] \\[.*\\]:"`

* Why can't I send commands even if I have the option enabled?
  - Make sure that you have a role on the server which is put in the array `SLASH_COMMAND_ROLES_IDS`.
    - e.g. `"SLASH_COMMAND_ROLES_IDS": ["<role id>"]`

* I am using a local file and no messages are being sent!
  - Enable `DEBUG` in the config to check for any errors.
  - If you are on Windows, try enabling `FS_WATCH_FILE`.

* `/list` and `/online` don't show up in Discord.
  - The bot needs the `applications.commands` scope. Re-invite it with the link in [Setup](#setup).

## Remote Setup

If the bridge can't read the log file directly, set `IS_LOCAL_FILE` to `false` and run the following on the machine hosting the Minecraft server (in a screen/tmux session or as a background process). Replace `YOUR_URL` with the bridge's address (`localhost:8000` if it runs on the same machine with the default config) and `PATH_TO_MINECRAFT_SERVER_INSTALL` with the path to the Minecraft server install:

```sh
tail -F /PATH_TO_MINECRAFT_SERVER_INSTALL/logs/latest.log | grep --line-buffered ": <" | while read x ; do echo -ne $x | curl -X POST -d @- http://YOUR_URL/minecraft/hook ; done
```
(The bridge also prints this command when it starts without a local file.)

## Thanks
* [destruc7i0n](https://github.com/destruc7i0n) and the contributors of [shulker](https://github.com/destruc7i0n/shulker), which this project is forked from
* [hydrabolt](https://github.com/hydrabolt) for discord.js
* [qrush](https://github.com/qrush) for the idea of shulker ([wither](https://github.com/qrush/wither))
* [SecretOnline](https://github.com/secretonline) for Rcon reconnecting and for making it only send messages in specified channel
* [TheZackCodec](https://github.com/TheZackCodec/) for the updates in server based messages

## License

ISC. See `LICENSE`. Original work copyright destruc7i0n.
