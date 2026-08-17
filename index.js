const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, REST, Routes, SlashCommandBuilder } = require("discord.js")
const cron = require("node-cron")

const TOKEN = process.env.TOKEN
const CLIENT_ID = process.env.CLIENT_ID
const GUILD_ID = process.env.GUILD_ID
const LEADERBOARD_CHANNEL_ID = process.env.LEADERBOARD_CHANNEL_ID
const SAVE_CHANNEL_ID = process.env.SAVE_CHANNEL_ID
const CURRENCY_NAME = process.env.CURRENCY_NAME || "Coins"
const CURRENCY_EMOJI = process.env.CURRENCY_EMOJI || "🪙"
const SERVER_NAME = process.env.SERVER_NAME || "Serveur"
const RAW_COLOR = process.env.COLOR || "#FFD700"
const COLOR = RAW_COLOR.startsWith("#") ? RAW_COLOR : "#FFD700"

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
})

let userData = {}
let quests = {}
let saveMessageId = null
let leaderboardMessageId = null

async function saveData() {
  try {
    const channel = await client.channels.fetch(SAVE_CHANNEL_ID)
    const content = "COINSDATA:" + JSON.stringify({ userData, quests, leaderboardMessageId })
    if (saveMessageId) {
      const msg = await channel.messages.fetch(saveMessageId)
      await msg.edit(content)
    } else {
      const msg = await channel.send(content)
      saveMessageId = msg.id
    }
  } catch (e) {
    console.error("Erreur sauvegarde:", e.message)
  }
}

async function loadData() {
  try {
    const channel = await client.channels.fetch(SAVE_CHANNEL_ID)
    const messages = await channel.messages.fetch({ limit: 20 })
    const dataMsg = messages.find(m => m.author.id === client.user.id && m.content.startsWith("COINSDATA:"))
    if (dataMsg) {
      const parsed = JSON.parse(dataMsg.content.replace("COINSDATA:", ""))
      userData = parsed.userData || {}
      quests = parsed.quests || {}
      leaderboardMessageId = parsed.leaderboardMessageId || null
      saveMessageId = dataMsg.id
      console.log("Donnees chargees")
    }
  } catch (e) {
    console.log("Pas de donnees existantes")
  }
}

function getSortedLeaderboard() {
  return Object.entries(userData).sort((a, b) => b[1].coins - a[1].coins)
}

async function updateLeaderboard() {
  try {
    const channel = await client.channels.fetch(LEADERBOARD_CHANNEL_ID)
    const sorted = getSortedLeaderboard().slice(0, 20)

    const medals = ["🥇", "🥈", "🥉"]
    const classement = sorted.length
      ? sorted.map(([id, data], i) => {
          const rank = medals[i] || (i + 1) + "."
          return `${rank} <@${id}> — **${data.coins} ${CURRENCY_EMOJI}** | ⭐ ${data.xp} XP`
        }).join("\n")
      : "Aucun participant pour le moment."

    const embed = new EmbedBuilder()
      .setTitle(`${CURRENCY_EMOJI} CLASSEMENT ${SERVER_NAME.toUpperCase()}`)
      .setDescription(classement)
      .setColor(COLOR)
      .setFooter({ text: `Mis a jour le ${new Date().toLocaleString("fr-FR", { timeZone: "Europe/Paris" })}` })

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("check_rank")
        .setLabel(`${CURRENCY_EMOJI} Mon classement`)
        .setStyle(ButtonStyle.Primary)
    )

    if (leaderboardMessageId) {
      try {
        const msg = await channel.messages.fetch(leaderboardMessageId)
        await msg.edit({ embeds: [embed], components: [row] })
      } catch {
        const msg = await channel.send({ embeds: [embed], components: [row] })
        leaderboardMessageId = msg.id
        await saveData()
      }
    } else {
      const msg = await channel.send({ embeds: [embed], components: [row] })
      leaderboardMessageId = msg.id
      await saveData()
    }
  } catch (e) {
    console.error("Erreur classement:", e.message)
  }
}

client.on("messageCreate", async msg => {
  if (msg.author.bot || !msg.guild) return
  if (!msg.attachments.size) return

  const quest = quests[msg.channelId]
  if (!quest) return

  const userId = msg.author.id
  const username = msg.author.username

  if (!userData[userId]) {
    userData[userId] = { username, coins: 0, xp: 0, completedQuests: [] }
  }

  if (quest.once && userData[userId].completedQuests.includes(msg.channelId)) {
    await msg.reply({
      embeds: [new EmbedBuilder()
        .setDescription("Tu as deja complete cette quete ! Reviens a la prochaine 👀")
        .setColor(COLOR)]
    })
    return
  }

  userData[userId].coins += quest.coins
  userData[userId].xp += quest.xp
  userData[userId].username = username

  if (quest.once) {
    userData[userId].completedQuests.push(msg.channelId)
  }

  await saveData()

  const embed = new EmbedBuilder()
    .setTitle(`${CURRENCY_EMOJI} Quete validee — ${quest.name} !`)
    .setDescription(
      `Bien joue <@${userId}> 🎉\n\n` +
      `${CURRENCY_EMOJI} **+${quest.coins} ${CURRENCY_NAME}**\n` +
      `⭐ **+${quest.xp} XP**\n\n` +
      `**Ton total :**\n` +
      `${CURRENCY_EMOJI} ${userData[userId].coins} ${CURRENCY_NAME} | ⭐ ${userData[userId].xp} XP`
    )
    .setColor(COLOR)
    .setThumbnail(msg.author.displayAvatarURL({ dynamic: true, size: 128 }))
    .setImage(msg.attachments.first()?.url || null)
    .setFooter({ text: SERVER_NAME, iconURL: msg.guild.iconURL({ dynamic: true }) || undefined })
    .setTimestamp()

  await msg.reply({ embeds: [embed] })
})

async function registerCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName("setup")
      .setDescription("Poste le classement dans le canal dedie"),

    new SlashCommandBuilder()
      .setName("createquete")
      .setDescription("Cree une quete dans un canal (admin)")
      .addChannelOption(o => o.setName("canal").setDescription("Canal de la quete").setRequired(true))
      .addStringOption(o => o.setName("nom").setDescription("Nom de la quete").setRequired(true))
      .addIntegerOption(o => o.setName("coins").setDescription("Coins a gagner").setRequired(true))
      .addIntegerOption(o => o.setName("xp").setDescription("XP a gagner").setRequired(true))
      .addBooleanOption(o => o.setName("once").setDescription("Une seule participation par membre ?").setRequired(false)),

    new SlashCommandBuilder()
      .setName("deletequete")
      .setDescription("Supprime une quete d'un canal (admin)")
      .addChannelOption(o => o.setName("canal").setDescription("Canal de la quete").setRequired(true)),

    new SlashCommandBuilder()
      .setName("listquetes")
      .setDescription("Liste toutes les quetes actives"),

    new SlashCommandBuilder()
      .setName("addcoins")
      .setDescription("Ajoute des coins a un membre (admin)")
      .addUserOption(o => o.setName("membre").setDescription("Membre").setRequired(true))
      .addIntegerOption(o => o.setName("montant").setDescription("Nombre de coins").setRequired(true))
      .addStringOption(o => o.setName("raison").setDescription("Raison").setRequired(false)),

    new SlashCommandBuilder()
      .setName("addxp")
      .setDescription("Ajoute de l'XP a un membre (admin)")
      .addUserOption(o => o.setName("membre").setDescription("Membre").setRequired(true))
      .addIntegerOption(o => o.setName("montant").setDescription("Nombre d'XP").setRequired(true))
      .addStringOption(o => o.setName("raison").setDescription("Raison").setRequired(false)),

    new SlashCommandBuilder()
      .setName("mescoins")
      .setDescription("Voir tes coins et ton XP"),

    new SlashCommandBuilder()
      .setName("resetmembre")
      .setDescription("Remet a zero un membre (admin)")
      .addUserOption(o => o.setName("membre").setDescription("Membre").setRequired(true)),

  ].map(c => c.toJSON())

  const rest = new REST({ version: "10" }).setToken(TOKEN)
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands })
  console.log("Commandes enregistrees")
}

client.on("ready", async () => {
  console.log("Bot connecte : " + client.user.tag)
  await registerCommands()
  await loadData()
  cron.schedule("0 */6 * * *", updateLeaderboard, { timezone: "Europe/Paris" })
})

client.on("interactionCreate", async interaction => {

  if (interaction.isButton() && interaction.customId === "check_rank") {
    const userId = interaction.user.id
    const sorted = getSortedLeaderboard()
    const rank = sorted.findIndex(([id]) => id === userId) + 1
    const data = userData[userId]

    if (!data || rank === 0) {
      return interaction.reply({ content: "Tu n'es pas encore dans le classement. Participe a une quete pour commencer !", ephemeral: true })
    }

    await interaction.reply({
      embeds: [new EmbedBuilder()
        .setDescription(`📊 Tu es **#${rank}** du classement\n${CURRENCY_EMOJI} **${data.coins} ${CURRENCY_NAME}** | ⭐ **${data.xp} XP**`)
        .setColor(COLOR)],
      ephemeral: true
    })
  }

  if (!interaction.isChatInputCommand()) return

  const isAdmin = interaction.member.permissions.has("Administrator")

  if (interaction.commandName === "setup") {
    await updateLeaderboard()
    await interaction.reply({ content: "Classement poste ! Il se met a jour toutes les 6h.", ephemeral: true })
  }

  if (interaction.commandName === "createquete") {
    if (!isAdmin) return interaction.reply({ content: "Permission refusee.", ephemeral: true })

    const canal = interaction.options.getChannel("canal")
    const nom = interaction.options.getString("nom")
    const coins = interaction.options.getInteger("coins")
    const xp = interaction.options.getInteger("xp")
    const once = interaction.options.getBoolean("once") ?? false

    quests[canal.id] = { name: nom, coins, xp, once }
    await saveData()

    await interaction.reply({
      embeds: [new EmbedBuilder()
        .setTitle("Quete creee !")
        .setDescription(`**${nom}** dans <#${canal.id}>\n${CURRENCY_EMOJI} **+${coins} ${CURRENCY_NAME}** | ⭐ **+${xp} XP**\nParticipation unique : ${once ? "Oui" : "Non"}`)
        .setColor(COLOR)],
      ephemeral: true
    })
  }

  if (interaction.commandName === "deletequete") {
    if (!isAdmin) return interaction.reply({ content: "Permission refusee.", ephemeral: true })

    const canal = interaction.options.getChannel("canal")
    if (!quests[canal.id]) return interaction.reply({ content: "Aucune quete dans ce canal.", ephemeral: true })

    delete quests[canal.id]
    await saveData()
    await interaction.reply({ content: `Quete supprimee dans <#${canal.id}>`, ephemeral: true })
  }

  if (interaction.commandName === "listquetes") {
    const list = Object.entries(quests)
    if (!list.length) return interaction.reply({ content: "Aucune quete active.", ephemeral: true })

    const desc = list.map(([id, q]) => `<#${id}> — **${q.name}** | ${CURRENCY_EMOJI} ${q.coins} | ⭐ ${q.xp} XP | Unique: ${q.once ? "Oui" : "Non"}`).join("\n")

    await interaction.reply({
      embeds: [new EmbedBuilder()
        .setTitle("Quetes actives")
        .setDescription(desc)
        .setColor(COLOR)],
      ephemeral: true
    })
  }

  if (interaction.commandName === "addcoins") {
    if (!isAdmin) return interaction.reply({ content: "Permission refusee.", ephemeral: true })

    const target = interaction.options.getUser("membre")
    const montant = interaction.options.getInteger("montant")
    const raison = interaction.options.getString("raison") || "Ajout manuel"

    if (!userData[target.id]) userData[target.id] = { username: target.username, coins: 0, xp: 0, completedQuests: [] }
    userData[target.id].coins += montant
    userData[target.id].username = target.username

    await saveData()
    await updateLeaderboard()

    await interaction.reply({
      embeds: [new EmbedBuilder()
        .setDescription(`${CURRENCY_EMOJI} **+${montant} ${CURRENCY_NAME}** ajoutes a <@${target.id}>\nRaison : ${raison}\nNouveau total : **${userData[target.id].coins} ${CURRENCY_NAME}**`)
        .setColor(COLOR)],
      ephemeral: true
    })
  }

  if (interaction.commandName === "addxp") {
    if (!isAdmin) return interaction.reply({ content: "Permission refusee.", ephemeral: true })

    const target = interaction.options.getUser("membre")
    const montant = interaction.options.getInteger("montant")
    const raison = interaction.options.getString("raison") || "Ajout manuel"

    if (!userData[target.id]) userData[target.id] = { username: target.username, coins: 0, xp: 0, completedQuests: [] }
    userData[target.id].xp += montant
    userData[target.id].username = target.username

    await saveData()

    await interaction.reply({
      embeds: [new EmbedBuilder()
        .setDescription(`⭐ **+${montant} XP** ajoutes a <@${target.id}>\nRaison : ${raison}\nNouveau total : **${userData[target.id].xp} XP**`)
        .setColor(COLOR)],
      ephemeral: true
    })
  }

  if (interaction.commandName === "mescoins") {
    const userId = interaction.user.id
    const data = userData[userId]
    const sorted = getSortedLeaderboard()
    const rank = sorted.findIndex(([id]) => id === userId) + 1

    await interaction.reply({
      embeds: [new EmbedBuilder()
        .setTitle("Mes stats")
        .setDescription(
          `${CURRENCY_EMOJI} **${data ? data.coins : 0} ${CURRENCY_NAME}**\n` +
          `⭐ **${data ? data.xp : 0} XP**\n` +
          `📊 Classement : **#${rank || "?"}**`
        )
        .setColor(COLOR)
        .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true, size: 128 }))],
      ephemeral: true
    })
  }

  if (interaction.commandName === "resetmembre") {
    if (!isAdmin) return interaction.reply({ content: "Permission refusee.", ephemeral: true })

    const target = interaction.options.getUser("membre")
    delete userData[target.id]
    await saveData()
    await interaction.reply({ content: `Membre <@${target.id}> remis a zero.`, ephemeral: true })
  }
})

client.login(TOKEN)
