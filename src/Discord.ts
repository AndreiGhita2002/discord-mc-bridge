import { Client, Intents, Interaction, Message, TextChannel, User } from 'discord.js'

import emojiStrip from 'emoji-strip'

import type { Config } from './Config'

import Rcon from './Rcon'
import DiscordWebhooks from './DiscordWebhooks'
import { escapeUnicode } from './lib/util'

class Discord {
  config: Config
  client: Client
  webhookClient: DiscordWebhooks | null

  channel: TextChannel | null

  mentionCache: Map<string, User>

  constructor (config: Config, onReady?: () => void) {
    this.config = config

    this.client = new Client({ intents: [Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_MESSAGES] })
    if (onReady) this.client.once('ready', () => onReady())
    this.client.on('messageCreate', (message: Message) => this.onMessage(message))
    this.client.on('interactionCreate', (interaction: Interaction) => this.onInteraction(interaction))

    this.webhookClient = null

    this.channel = null

    this.mentionCache = new Map()
  }

  public async init () {
    try {
      await this.client.login(this.config.DISCORD_TOKEN)
    } catch (e) {
      console.log('[ERROR] Could not authenticate with Discord: ' + e)
      if (this.config.DEBUG) console.error(e)
      process.exit(1)
    }

    if (this.config.USE_WEBHOOKS) {
      this.webhookClient = new DiscordWebhooks(this.config)
      this.webhookClient.init()
    }

    if (this.config.DISCORD_CHANNEL_ID) {
      const channel = await this.client.channels.fetch(this.config.DISCORD_CHANNEL_ID) as TextChannel
      if (!channel) {
        console.log(`[INFO] Could not find channel with ID ${this.config.DISCORD_CHANNEL_ID}. Please check that the ID is correct and that the bot has access to it.`)
        process.exit(1)
      }
      this.channel = channel
    }

    // server messages (joins, deaths, etc.) sent through the webhook use the bot's own avatar
    if (!this.config.SERVER_IMAGE && this.client.user) {
      this.config.SERVER_IMAGE = this.client.user.displayAvatarURL({ format: 'png', size: 256 })
    }

    if (this.channel) {
      try {
        const description = 'List the players currently online on the Minecraft server'
        await this.channel.guild.commands.set([{ name: 'list', description }, { name: 'online', description }])
        console.log('[INFO] Registered /list and /online commands')
      } catch (e) {
        console.log('[ERROR] Could not register player list commands: ' + e)
      }
    }

    if (this.channel) {
      console.log(`[INFO] Using channel #${this.channel.name} (id: ${this.channel.id}) in the server "${this.channel.guild.name}"`)
    }
  }

  private async onMessage (message: Message) {
    // no channel, done
    if (!this.channel) return
    // don't want to check other channels
    if (message.channel.id !== this.channel.id || message.channel.type !== 'GUILD_TEXT') return
    // if using webhooks, ignore this!
    if (message.webhookId) {
      // backwards compatability with older config
      if (this.config.USE_WEBHOOKS && this.config.IGNORE_WEBHOOKS === undefined) return

      // if ignoring all webhooks, ignore
      if (this.config.IGNORE_WEBHOOKS) {
        return
      } else if (this.config.USE_WEBHOOKS) {
        // otherwise, ignore all webhooks that are not the same as this one
        if (this.webhookClient!.id === message.webhookId) {
          if (this.config.DEBUG) console.log('[DEBUG] Ignoring webhook from self')
          return
        }
      }
    }
    // ensure that the message has a sender
    if (!message.author) return
    // ensure that the message is a text message
    if (message.type !== 'DEFAULT') return
    // if the same user as the bot, ignore
    if (message.author.id === this.client.user?.id) return
    // ignore any attachments
    if (message.attachments.size) return
    
    const command = this.buildMinecraftCommand(message)
    
    if (command) {
      if (this.config.DEBUG) console.log(`[DEBUG] Sending command "${command}" to the server`)

      const rcon = new Rcon(this.config.MINECRAFT_SERVER_RCON_IP, this.config.MINECRAFT_SERVER_RCON_PORT, this.config.DEBUG)
      try {
        await rcon.auth(this.config.MINECRAFT_SERVER_RCON_PASSWORD)
      } catch (e) {
        console.log('[ERROR] Could not auth with the server!')
        if (this.config.DEBUG) console.error(e)
      }

      let response: string | undefined;
      try {
        response = await rcon.command(command)
      } catch (e) {
        console.log('[ERROR] Could not send command!')
        if (this.config.DEBUG) console.error(e)
      }

      if (response?.startsWith('Unknown command') || response?.startsWith('Unknown or incomplete command')) {
        console.log('[ERROR] Could not send command! (Unknown command)')
        if (command.startsWith('tellraw')) {
          console.log('[INFO] Your Minecraft version may not support tellraw, please check MINECRAFT_TELLRAW_DOESNT_EXIST in the README')
        }
      }

      rcon.close()
    }
  }

  private async onInteraction (interaction: Interaction) {
    if (!interaction.isCommand() || !['list', 'online'].includes(interaction.commandName)) return

    await interaction.deferReply()

    const rcon = new Rcon(this.config.MINECRAFT_SERVER_RCON_IP, this.config.MINECRAFT_SERVER_RCON_PORT, this.config.DEBUG)
    // a connection error would otherwise crash the bot; the timeout below reports it instead
    rcon.socket.on('error', (e) => { if (this.config.DEBUG) console.error(e) })

    try {
      const response = await Promise.race([
        (async () => {
          await rcon.auth(this.config.MINECRAFT_SERVER_RCON_PASSWORD)
          return rcon.command('list')
        })(),
        new Promise<string>((_resolve, reject) => setTimeout(() => reject(new Error('timed out')), 8000)),
      ])
      await interaction.editReply(this.formatPlayerList(response))
    } catch (e) {
      console.log('[ERROR] Could not get the player list: ' + e)
      await interaction.editReply('Could not reach the Minecraft server.')
    } finally {
      rcon.close()
    }
  }

  private formatPlayerList (response: string) {
    const clean = response.replace(/\u00a7./g, '').replace(/[^\x20-\x7e]/g, '').trim()
    const match = clean.match(/There are (\d+) of a max of (\d+) players online:\s*(.*)/)
    if (!match) return clean || 'No response from the server.'

    const [, count, max, names] = match
    if (count === '0') return `Nobody is online right now (0/${max}).`
    const players = names.split(',').map(name => name.trim()).filter(Boolean)
    return `**${count}/${max} online:** ${players.map(name => '`' + name + '`').join(', ')}`
  }

  private buildMinecraftCommand (message: Message) {
    if (this.config.ALLOW_SLASH_COMMANDS && this.config.SLASH_COMMAND_ROLES_IDS && message.cleanContent.startsWith('/') && message.member) {
      const hasSlashCommandRole = this.config.SLASH_COMMAND_ROLES_IDS.some(id => message.member?.roles.cache.get(id))
      if (hasSlashCommandRole) {
        // send the raw command, can be dangerous...
        return message.cleanContent
      } else {
        const { username, discriminator } = message.author
        console.log(`[INFO] User ${username}#${discriminator} attempted to send a slash command without a role`)
        return
      }
    }

    const username = emojiStrip(message.author.username)
    // name as shown in this Discord server: server nickname, then display name, then username
    const serverName = emojiStrip(message.member?.nickname ?? message.author.globalName ?? '').trim() || username

    let messageContent = message.cleanContent
    messageContent = messageContent.replace('@\u200b', '@')
    messageContent = emojiStrip(messageContent)

    const variables: {[index: string]: string} = {
      username,
      nickname: serverName,
      discriminator: message.author.discriminator,
      text: messageContent,
    }

    if (this.config.MINECRAFT_TELLRAW_DOESNT_EXIST) {
      const sayMessage = this.config.MINECRAFT_TELLRAW_DOESNT_EXIST_SAY_TEMPLATE
        .replace(/%username%/g, variables.username)
        .replace(/%nickname%/g, variables.nickname)
        .replace(/%discriminator%/g, variables.discriminator)
        .replace(/%message%/g, variables.text)
      return `say ${sayMessage}`
    }

    for (const [k, v] of Object.entries(variables)) {
      // use JSON to encode the strings for tellraw
      const stringified = JSON.stringify(v).slice(1, -1)
      // encode unicode characters for all fields
      variables[k] = escapeUnicode(stringified)
    }

    const tellrawComponent = this.config.MINECRAFT_TELLRAW_TEMPLATE
      .replace(/%username%/g, variables.username)
      .replace(/%nickname%/g, variables.nickname)
      .replace(/%discriminator%/g, variables.discriminator)
      .replace(/%message%/g, variables.text)
    return `tellraw @a ${tellrawComponent}`
  }

  private async replaceDiscordMentions(message: string): Promise<string> {
    const possibleMentions = message.match(/@[^#\s]*[#]?[0-9]{4}/gim)
    if (possibleMentions) {
      for (let mention of possibleMentions) {
        const mentionParts = mention.split('#')
        let username = mentionParts[0].replace('@', '')
        if (mentionParts.length > 1) {
          if (this.config.ALLOW_USER_MENTIONS) {
            let user = this.mentionCache.get(mention)
            if (!user) {
              // try fetching members by username to update cache
              await this.channel!.guild.members.fetch({ query: username })
              user = this.client.users.cache.find(user => user.username === username && user.discriminator === mentionParts[1])
            }

            if (user) {
              message = message.replace(mention, '<@' + user.id + '>')
              if (!this.mentionCache.has(mention)) this.mentionCache.set(mention, user)
            } else {
              console.log(`[ERROR] Could not find user by mention: "${mention}"`)
            }
          }
        }
      }
    }

    if (!this.config.ALLOW_HERE_EVERYONE_MENTIONS) {
      message = message
        .replace('@everyone', '@ everyone')
        .replace('@here', '@ here')
    }

    return message
  }

  private makeDiscordMessage(username: string, message: string) {
    return this.config.DISCORD_MESSAGE_TEMPLATE
      .replace('%username%', username)
      .replace('%message%', message)
  }

  public async sendMessage (username: string, message: string) {
    message = await this.replaceDiscordMentions(message)

    if (this.config.USE_WEBHOOKS) {
      const sentMessage = await this.webhookClient!.sendMessage(username, message)
      if (sentMessage) return
    }

    const messageContent = this.makeDiscordMessage(username, message)

    try {
      await this.channel!.send(messageContent)
    } catch (e) {
      console.log('[ERROR] Could not send Discord message through bot!')
      process.exit(1)
    }
  }
}

export default Discord
