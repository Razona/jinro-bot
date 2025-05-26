// test_bot.js (フェーズ管理撤廃版)
require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  Partials,
  ChannelType,
  PermissionsBitField,
  SlashCommandBuilder,
  EmbedBuilder,
} = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.User],
});

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;

// --- ゲームセッション管理 ---
let gameSession = null;

function initializeGameSession() {
  gameSession = {
    isActive: false, // /game_setup で true
    gmUserId: null,
    guildId: null,
    gameTitle: '',
    categoryId: null,
    channels: {
      gm: null,
      announcement: null, // アナウンスチャンネルID（手動投稿用）
      vote: null, // 投票チャンネルID（手動投稿用）
      werewolf: null,
      madman: null,
      seer: null,
      medium: null,
      hunter: null
    },
    playerListMessageId: null,
    playerListMessageChannelId: null,
    reactionEmoji: '👍',
    players: [], // { id: 'userId', displayName: 'name', userObject: null, role: null, isAlive: true, roleChannelId: null }
    playerListFinalized: false,
    rolesAssigned: false,
    // currentPhase: null, // ★フェーズ管理撤廃
    dayCount: 0, // 日数カウントは維持（初日占い、霊媒、襲撃後の日数表示のため）
    lastExecutedUser: null, // { userId, role, displayName, id }
    wolfAttackTarget: null, // { userId, displayName, id }
    guardTarget: null, // { userId, displayName, id }
    lastNightGuardTargetId: null,
    attackSuccessful: null,
    winningFaction: null,
    gameEnded: false,
    config: {
      numPlayers: 13,
      roles: {
        WEREWOLF: 3, MADMAN: 1, SEER: 1, MEDIUM: 1, HUNTER: 1, VILLAGER: 6
      },
      canHunterGuardSelf: false,
      canAttackWerewolfTeam: false,
      firstNightAttack: false, // ア式ルール：初夜襲撃なし (このフラグ自体は残すが、Botによる強制制御は弱まる)
      firstDayFortuneTelling: true,
    },
    seerHistory: []
  };
}
initializeGameSession();

// --- ヘルパー関数 ---
async function sendToGmChannel(interaction, content) {
  if (gameSession && gameSession.channels && gameSession.channels.gm) {
    try {
      const gmChannel = await interaction.guild.channels.fetch(gameSession.channels.gm);
      if (gmChannel && gmChannel.isTextBased()) {
        await gmChannel.send(content);
        return;
      }
    } catch (error) {
      console.error("GMチャンネルへの送信に失敗:", error);
    }
  }
  try {
    // ephemeral: true は interaction がアクティブな場合のみ
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: `(GMチャンネル未設定または送信失敗) ${content}`, ephemeral: true });
    } else {
      await interaction.reply({ content: `(GMチャンネル未設定または送信失敗) ${content}`, ephemeral: true });
    }
  } catch (replyError) {
    console.error("コマンド実行チャンネルへの返信にも失敗:", replyError);
    if (interaction.channel && interaction.channel.isTextBased()) {
      try {
        await interaction.channel.send(`(GMチャンネル未設定/返信失敗) ${content}`);
      } catch (channelSendError) {
        console.error("フォールバック送信も失敗:", channelSendError);
      }
    }
  }
}

async function getGmChannel(guild) {
  if (gameSession && gameSession.channels && gameSession.channels.gm) {
    try {
      return await guild.channels.fetch(gameSession.channels.gm);
    } catch { /* ignore */ }
  }
  return null;
}

// --- 勝利判定ロジック ---
async function checkWinCondition(interaction) {
  if (!gameSession || !gameSession.isActive || gameSession.gameEnded || !gameSession.rolesAssigned) return false;

  const alivePlayers = gameSession.players.filter(p => p.isAlive);
  const aliveWerewolves = alivePlayers.filter(p => p.role === 'WEREWOLF');
  const aliveVillagerTeam = alivePlayers.filter(p =>
    ['VILLAGER', 'SEER', 'MEDIUM', 'HUNTER'].includes(p.role)
  );

  let gameEnded = false;
  let winningFaction = null;

  if (aliveWerewolves.length === 0 && alivePlayers.length > 0) { // 狼0かつ生存者あり
    winningFaction = '村人陣営';
    gameEnded = true;
  } else if (aliveWerewolves.length >= aliveVillagerTeam.length && aliveWerewolves.length > 0) { // 狼生存かつ同数以上
    winningFaction = '人狼陣営';
    gameEnded = true;
  }


  if (gameEnded) {
    gameSession.gameEnded = true;
    gameSession.winningFaction = winningFaction;
    const gmChannel = await getGmChannel(interaction.guild);
    const endMessage = `**ゲーム終了！ ${winningFaction} の勝利です！**`;
    if (gmChannel) {
      await gmChannel.send(endMessage);
    } else if (interaction.channel) { // GMチャンネルがない場合、コマンド実行チャンネルに
      await interaction.channel.send(endMessage);
    }
    // アナウンスチャンネルへの自動投稿はなし
    return true;
  }
  return false;
}

// --- 襲撃結果処理ロジック ---
async function processNightAttack(interaction) {
  if (!gameSession.rolesAssigned || gameSession.gameEnded) return; // 配役前やゲーム終了後は処理しない

  const gmChannel = await getGmChannel(interaction.guild);

  if (!gameSession.wolfAttackTarget) { // 人狼の襲撃対象が指定されていない場合
    if (gmChannel) await gmChannel.send("襲撃対象が指定されていませんでした。");
    // 狩人の護衛対象だけ指定されていても、襲撃がなければ何も起こらない
    gameSession.guardTarget = null; // 護衛もリセット
    return;
  }

  const hunter = gameSession.players.find(p => p.role === 'HUNTER' && p.isAlive);

  if (gameSession.config.firstNightAttack === false && gameSession.dayCount === 1 && gameSession.wolfAttackTarget) {
    if (gmChannel) await gmChannel.send("ア式ルールに基づき、初夜の襲撃は発生しませんでした。");
    gameSession.wolfAttackTarget = null;
    gameSession.guardTarget = null;
    // この後、GMが手動で昼の進行を指示する必要がある
    await sendToGmChannel(interaction, `初夜の処理が完了しました (襲撃なし)。\nGMは${gameSession.dayCount}日目の昼の議論を開始するよう指示してください。`);
    return; // 初夜はここで処理終了
  }


  let messageToGM = "";
  if (gameSession.wolfAttackTarget && (!hunter || !gameSession.guardTarget)) { // 人狼の襲撃対象あり、狩人がいないか護衛対象なし
    const attackTargetPlayer = gameSession.players.find(p => p.id === gameSession.wolfAttackTarget.id);
    if (attackTargetPlayer && attackTargetPlayer.isAlive) {
      attackTargetPlayer.isAlive = false;
      gameSession.attackSuccessful = true;
      messageToGM = `今夜の襲撃により、 <@${attackTargetPlayer.id}> (${attackTargetPlayer.displayName}) さん ([${attackTargetPlayer.role || '未確定'}]) が死亡しました。`;
    } else {
      messageToGM = `襲撃対象 <@${gameSession.wolfAttackTarget.id}> (${gameSession.wolfAttackTarget.displayName}) さんは既に死亡しているか、見つかりませんでした。`;
      gameSession.attackSuccessful = false;
    }
  } else if (gameSession.wolfAttackTarget && gameSession.guardTarget) { // 人狼の襲撃対象と狩人の護衛対象両方あり
    const attackTargetId = gameSession.wolfAttackTarget.id;
    const guardTargetId = gameSession.guardTarget.id;
    const attackTargetPlayer = gameSession.players.find(p => p.id === attackTargetId);
    const attackTargetRole = attackTargetPlayer ? attackTargetPlayer.role : '不明';

    if (attackTargetId === guardTargetId) {
      gameSession.attackSuccessful = false;
      messageToGM = `今夜の襲撃は狩人によって阻止されました。死亡者はいません。\n(襲撃対象: <@${attackTargetId}>, 護衛対象: <@${guardTargetId}>)`;
    } else {
      if (attackTargetPlayer && attackTargetPlayer.isAlive) {
        attackTargetPlayer.isAlive = false;
        gameSession.attackSuccessful = true;
        messageToGM = `今夜の襲撃により、 <@${attackTargetId}> (${gameSession.wolfAttackTarget.displayName}) さん ([${attackTargetRole}]) が死亡しました。\n(護衛対象: <@${guardTargetId}>)`;
      } else {
        messageToGM = `襲撃対象 <@${attackTargetId}> (${gameSession.wolfAttackTarget.displayName}) さんは既に死亡しているか、見つかりませんでした。護衛は <@${guardTargetId}> でした。`;
        gameSession.attackSuccessful = false;
      }
    }
  } else {
    // 襲撃対象がない場合は上でリターン済み。ここは通らないはず。
    return;
  }

  if (gmChannel) await gmChannel.send(messageToGM);

  gameSession.lastNightGuardTargetId = gameSession.guardTarget ? gameSession.guardTarget.id : null;
  gameSession.wolfAttackTarget = null;
  gameSession.guardTarget = null;

  if (await checkWinCondition(interaction)) {
    // 勝利判定でゲーム終了メッセージ送信済み
  } else {
    gameSession.dayCount++; // 夜が明けて日数を加算
    await sendToGmChannel(interaction, `夜の処理が完了し、${gameSession.dayCount}日目の朝になりました。ゲームは継続します。\nGMはプレイヤーに昼の議論を開始するよう指示してください。`);
  }
}


client.on('ready', () => {
  console.log(`Logged in as ${client.user.tag}!`);
  initializeGameSession();
  const guildId = process.env.DEV_GUILD_ID;
  if (guildId) {
    const guild = client.guilds.cache.get(guildId);
    if (guild) {
      registerCommands(guild);
    } else {
      console.warn(`DEV_GUILD_ID ${guildId} が見つかりません。コマンドは手動で登録してください。`);
    }
  } else {
    console.log("DEV_GUILD_IDが設定されていません。コマンドはグローバルに登録されるか、手動で登録が必要です。");
  }
});

const commands = [
  new SlashCommandBuilder().setName('game_setup').setDescription('新しい人狼ゲームセッションを開始します。')
    .addStringOption(option => option.setName('game_title').setDescription('作成されるカテゴリ名').setRequired(false)),
  new SlashCommandBuilder().setName('player_start_recruitment').setDescription('参加者募集を開始します。')
    .addChannelOption(option => option.setName('channel').setDescription('募集メッセージを投稿するチャンネル').setRequired(false).addChannelTypes(ChannelType.GuildText))
    .addStringOption(option => option.setName('message_text').setDescription('募集メッセージの本文').setRequired(false))
    .addStringOption(option => option.setName('reaction_emoji').setDescription('参加意思を示すリアクション絵文字').setRequired(false)),
  new SlashCommandBuilder().setName('player_finalize_list').setDescription('参加者募集を締め切り、プレイヤーリストを作成・確定します。'),
  new SlashCommandBuilder().setName('player_add').setDescription('プレイヤーリストにユーザーを手動で追加します。')
    .addUserOption(option => option.setName('user').setDescription('追加するDiscordユーザー').setRequired(true)),
  new SlashCommandBuilder().setName('player_remove').setDescription('プレイヤーリストからユーザーを手動で削除します。')
    .addUserOption(option => option.setName('user').setDescription('削除するDiscordユーザー').setRequired(true)),
  new SlashCommandBuilder().setName('player_show_list').setDescription('現在のプレイヤーリストを表示します。'),
  new SlashCommandBuilder().setName('role_assign').setDescription('プレイヤーに役職を割り当てます（ア式13人村固定）。'),
  new SlashCommandBuilder().setName('game_start_first_night').setDescription('ゲームを開始したことを記録します（初夜扱い）。'), // メッセージ変更
  new SlashCommandBuilder().setName('vote_result').setDescription('処刑者を記録します。')
    .addUserOption(option => option.setName('user').setDescription('処刑されるプレイヤー').setRequired(true)),
  new SlashCommandBuilder().setName('night_phase').setDescription('夜の処理を開始します（霊媒結果通知など）。'), // メッセージ変更
  new SlashCommandBuilder().setName('night_seer').setDescription('占い師の占い行動を実行します。')
    .addUserOption(option => option.setName('user').setDescription('占う対象のプレイヤー').setRequired(true)),
  new SlashCommandBuilder().setName('night_wolf').setDescription('人狼の襲撃対象を指定します。')
    .addUserOption(option => option.setName('user').setDescription('襲撃する対象のプレイヤー').setRequired(true)),
  new SlashCommandBuilder().setName('night_guard').setDescription('狩人の護衛対象を指定します。')
    .addUserOption(option => option.setName('user').setDescription('護衛する対象のプレイヤー').setRequired(true)),
  new SlashCommandBuilder().setName('game_restart').setDescription('現在のプレイヤーリストで新しいゲームを開始します。')
    .addStringOption(option => option.setName('new_game_title').setDescription('新しいゲームのカテゴリ名').setRequired(false)),
  new SlashCommandBuilder().setName('debug_reset_session').setDescription('[デバッグ用] ゲームセッションを完全にリセットします。'),
  new SlashCommandBuilder().setName('help').setDescription('利用可能なコマンドの一覧と説明を表示します。')
].map(command => command.toJSON());

async function registerCommands(guild) {
  try {
    console.log('ギルドコマンドを登録中...');
    await guild.commands.set(commands);
    console.log('ギルドコマンドの登録が完了しました。');
  } catch (error) {
    console.error('ギルドコマンドの登録中にエラーが発生しました:', error);
  }
}

client.on('interactionCreate', async interaction => {
  if (!interaction.isCommand()) return;

  const { commandName, options, guild, user } = interaction;

  // --- 基本的なGM権限チェック ---
  // game_setup, debug_reset_session, help 以外は、アクティブなセッションのGMのみ操作可能
  if (commandName !== 'game_setup' && commandName !== 'debug_reset_session' && commandName !== 'help') { // ← 'help' を除外条件に追加
    if (!gameSession || !gameSession.isActive || user.id !== gameSession.gmUserId) {
      // player_start_recruitment は isActive になる前でも GM なら許可する（game_setup 直後など）
      if (!(commandName === 'player_start_recruitment' && gameSession && gameSession.gmUserId === user.id && !gameSession.isActive)) {
        return interaction.reply({ content: 'このコマンドはゲームマスターのみ、またはゲームセットアップ後に実行できます。', ephemeral: true });
      }
    }
  }
  // ゲーム終了後のコマンド制限（game_restart と debug_reset_session, player_show_list 以外）
  if (gameSession && gameSession.gameEnded) {
    if (!['game_restart', 'debug_reset_session', 'player_show_list', 'game_setup'].includes(commandName)) {
      return interaction.reply({ content: 'ゲームは既に終了しています。新しいゲームを開始するには `/game_restart` を使用してください。', ephemeral: true });
    }
  }


  // --- コマンド処理 ---
  try {
    if (commandName === 'game_setup') {
      if (gameSession && gameSession.isActive && !gameSession.gameEnded) { // 終了してないアクティブセッションがある場合
        return interaction.reply({ content: 'エラー: 既に進行中のゲームセッションが存在します。先にゲームを終了させるか、`/debug_reset_session` を実行してください。', ephemeral: true });
      }
      initializeGameSession();
      gameSession.isActive = true; // ここでアクティブにする
      gameSession.gmUserId = user.id;
      gameSession.guildId = guild.id;
      const gameTitleInput = options.getString('game_title');
      gameSession.gameTitle = gameTitleInput || `人狼ゲーム-${new Date().toLocaleDateString('ja-JP')}`;

      const category = await guild.channels.create({
        name: gameSession.gameTitle, type: ChannelType.GuildCategory,
        permissionOverwrites: [
          { id: guild.roles.everyone, deny: [PermissionsBitField.Flags.ViewChannel] },
          { id: user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ManageChannels] },
          { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ManageChannels, PermissionsBitField.Flags.SendMessages] }
        ]
      });
      gameSession.categoryId = category.id;
      const gmChannel = await guild.channels.create({ name: 'gmチャンネル', type: ChannelType.GuildText, parent: category.id });
      gameSession.channels.gm = gmChannel.id;
      const announceChannel = await guild.channels.create({ name: '全体アナウンス', type: ChannelType.GuildText, parent: category.id });
      gameSession.channels.announcement = announceChannel.id; // IDは保存（GMの手動投稿用）
      const voteChannel = await guild.channels.create({ name: '投票チャンネル', type: ChannelType.GuildText, parent: category.id });
      gameSession.channels.vote = voteChannel.id; // IDは保存（GMの手動投稿用）

      await announceChannel.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: false, ViewChannel: true });
      await announceChannel.permissionOverwrites.edit(user.id, { SendMessages: true });
      await gmChannel.permissionOverwrites.edit(guild.roles.everyone, { ViewChannel: false });
      await gmChannel.permissionOverwrites.edit(user.id, { ViewChannel: true, SendMessages: true });
      await voteChannel.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: false, ViewChannel: true }); // GMが手動で結果を書き込む想定ならGMに書き込み権限
      await voteChannel.permissionOverwrites.edit(user.id, { SendMessages: true });


      await interaction.reply({ content: `ゲームセットアップが完了しました。カテゴリ「${category.name}」内にチャンネルを作成しました。\nGMチャンネル: ${gmChannel}\nアナウンスチャンネル: ${announceChannel}\n投票チャンネル: ${voteChannel}`, ephemeral: true });
      await sendToGmChannel(interaction, "GMとして認識されました。次に `/player_start_recruitment` で参加者募集を開始してください。");

    } else if (commandName === 'player_start_recruitment') {
      if (!gameSession || !gameSession.gmUserId) { // game_setup が最低限終わっているか
        return interaction.reply({ content: 'エラー: ゲームがセットアップされていません。先に `/game_setup` を実行してください。', ephemeral: true });
      }
      if (gameSession.playerListMessageId && !gameSession.playerListFinalized) { // 募集中のメッセージが既にある場合
        return sendToGmChannel(interaction, 'エラー: 既に別の参加者募集が進行中です。');
      }
      gameSession.isActive = true; // 募集開始で実質アクティブ扱い

      const targetChannelId = options.getChannel('channel')?.id || gameSession.channels.announcement;
      const messageText = options.getString('message_text') || `人狼ゲームの参加者を募集します！参加希望の方はこのメッセージに ${gameSession.reactionEmoji} でリアクションしてください。`;
      gameSession.reactionEmoji = options.getString('reaction_emoji') || '👍';

      const targetChannel = await guild.channels.fetch(targetChannelId);
      if (!targetChannel || !targetChannel.isTextBased()) {
        return sendToGmChannel(interaction, 'エラー: 指定されたチャンネルが見つからないか、テキストチャンネルではありません。');
      }
      const recruitmentMessage = await targetChannel.send(messageText);
      await recruitmentMessage.react(gameSession.reactionEmoji);
      gameSession.playerListMessageId = recruitmentMessage.id;
      gameSession.playerListMessageChannelId = targetChannel.id;
      gameSession.playerListFinalized = false; // リストは未確定

      await sendToGmChannel(interaction, `参加者募集を開始しました。${targetChannel} に募集メッセージを投稿し、${gameSession.reactionEmoji} でリアクションを受け付けます。\n募集を締め切るには \`/player_finalize_list\` コマンドを実行してください。`);
      await interaction.reply({ content: "参加者募集メッセージを送信しました。", ephemeral: true });


    } else if (commandName === 'help') {
      const helpEmbed = new EmbedBuilder()
        .setColor(0x0099FF)
        .setTitle('GM支援Bot コマンドヘルプ')
        .setDescription('以下は利用可能な主なコマンドの一覧です。各コマンドはGMが実行することを想定しています。\nこのBotは厳密なフェーズ管理を行わないため、GMが適切な順序でコマンドを実行してください。')
        .addFields(
          { name: 'ゲーム準備・管理', value: '------------------------------' },
          { name: '`/game_setup [game_title]`', value: '新しいゲームセッションを開始し、必要なチャンネル群を作成します。`[game_title]`は任意です。' },
          { name: '`/player_start_recruitment [channel] [message_text] [reaction_emoji]`', value: '参加者募集メッセージを指定チャンネルに投稿します。各引数は任意です。' },
          { name: '`/player_finalize_list`', value: '参加者募集を締め切り、リアクションを元にプレイヤーリストを確定します。' },
          { name: '`/player_add user:<@ユーザー>`', value: 'プレイヤーリストに指定したユーザーを手動で追加します。' },
          { name: '`/player_remove user:<@ユーザー>`', value: 'プレイヤーリストから指定したユーザーを手動で削除します。' },
          { name: '`/player_show_list`', value: '現在のプレイヤーリスト（役職、生死含む）をGMチャンネルに表示します。' },
          { name: '`/role_assign`', value: '確定した13名のプレイヤーに役職を割り当て、役職チャンネル作成と通知を行います。' },
          { name: 'ゲーム進行', value: '------------------------------' },
          { name: '`/game_start_first_night`', value: 'ゲーム開始を記録し、初夜（1日目の夜）の扱いとします。ア式ルールに基づき初夜襲撃は発生しません。' },
          { name: '`/vote_result user:<@ユーザー>`', value: '昼の投票結果として、処刑するプレイヤーをBotに記録します。' },
          { name: '`/night_phase`', value: '夜の処理を開始します。生存している霊媒師がいれば霊媒結果が通知されます。' },
          { name: '`/night_seer user:<@ユーザー>`', value: '占い師の占い対象を指定します。結果は占い師チャンネルに通知されます。' },
          { name: '`/night_wolf user:<@ユーザー>`', value: '人狼の襲撃対象を指定します。狩人の行動も入力されると襲撃結果が処理されます。' },
          { name: '`/night_guard user:<@ユーザー>`', value: '狩人の護衛対象を指定します。人狼の行動も入力されると襲撃結果が処理されます。' },
          { name: 'その他', value: '------------------------------' },
          { name: '`/game_restart [new_game_title]`', value: '現在のプレイヤーリストを維持して新しいゲーム（2戦目など）を開始します。新しいチャンネル群が作成されます。' },
          { name: '`/debug_reset_session`', value: '[デバッグ用] Botが記憶している現在のゲームセッション情報を完全にリセットします。' },
          { name: '`/help`', value: 'このヘルプメッセージを表示します。' }
        )
        .setTimestamp()
        .setFooter({ text: 'GM支援Bot' });

      await interaction.reply({ embeds: [helpEmbed], ephemeral: true });
    } else if (commandName === 'player_finalize_list') {
      if (!gameSession.playerListMessageId) {
        return sendToGmChannel(interaction, 'エラー: 参加者募集が開始されていません。');
      }
      const channel = await guild.channels.fetch(gameSession.playerListMessageChannelId);
      if (!channel) return sendToGmChannel(interaction, 'エラー: 募集メッセージのチャンネルが見つかりません。');
      const message = await channel.messages.fetch(gameSession.playerListMessageId);
      if (!message) return sendToGmChannel(interaction, 'エラー: 募集メッセージが見つかりません。');

      const reaction = message.reactions.cache.get(gameSession.reactionEmoji);
      gameSession.players = reaction ? (await reaction.users.fetch()).filter(u => !u.bot).map(u => ({ id: u.id, displayName: u.username, userObject: u, role: null, isAlive: true, roleChannelId: null })) : [];

      if (gameSession.players.length === 0) {
        return sendToGmChannel(interaction, 'エラー: 参加者が0名です。ゲームを開始できません。');
      }
      gameSession.playerListFinalized = true;
      let playerListString = `参加者募集を締め切りました。現在のプレイヤーリストは以下の通りです (計 ${gameSession.players.length}名):\n`;
      gameSession.players.forEach((p, index) => { playerListString += `${index + 1}. ${p.displayName} (ID: ${p.id})\n`; });
      playerListString += "次に `/role_assign` コマンドで配役を行ってください。";
      await sendToGmChannel(interaction, playerListString);
      await interaction.reply({ content: "プレイヤーリストを確定しました。", ephemeral: true });

    } else if (commandName === 'player_add' || commandName === 'player_remove' || commandName === 'player_show_list') {
      if (!gameSession.playerListFinalized && commandName !== 'player_show_list') { // show_listは未確定でもよいかもだが、一貫性のため
        return sendToGmChannel(interaction, `エラー: \`/${commandName}\` - プレイヤーリストがまだ確定されていません。`);
      }
      if (commandName === 'player_add') {
        const userToAdd = options.getUser('user');
        if (gameSession.players.find(p => p.id === userToAdd.id)) return sendToGmChannel(interaction, `エラー: ${userToAdd.username} さんは既にリストにいます。`);
        gameSession.players.push({ id: userToAdd.id, displayName: userToAdd.username, userObject: userToAdd, role: null, isAlive: true, roleChannelId: null });
        await sendToGmChannel(interaction, `${userToAdd.username} さんを追加しました。リストは \`/player_show_list\` で確認できます。`);
        await interaction.reply({ content: `${userToAdd.username} さんを追加しました。`, ephemeral: true });
      } else if (commandName === 'player_remove') {
        const userToRemove = options.getUser('user');
        const index = gameSession.players.findIndex(p => p.id === userToRemove.id);
        if (index === -1) return sendToGmChannel(interaction, `エラー: ${userToRemove.username} さんはリストにいません。`);
        gameSession.players.splice(index, 1);
        await sendToGmChannel(interaction, `${userToRemove.username} さんを削除しました。リストは \`/player_show_list\` で確認できます。`);
        await interaction.reply({ content: `${userToRemove.username} さんを削除しました。`, ephemeral: true });
      } else { // player_show_list
        if (!gameSession.players || gameSession.players.length === 0) return sendToGmChannel(interaction, 'エラー: プレイヤーリストが空です。');
        let listStr = `現在のプレイヤーリスト (計 ${gameSession.players.length}名):\n`;
        gameSession.players.forEach((p, i) => listStr += `${i + 1}. ${p.displayName} (ID: ${p.id}) - ${p.isAlive ? '生存' : '死亡'} ${p.role ? '(' + p.role + ')' : ''}\n`);
        await sendToGmChannel(interaction, listStr);
        await interaction.reply({ content: "プレイヤーリストをGMチャンネルに表示しました。", ephemeral: true });
      }

    } else if (commandName === 'role_assign') {
      if (!gameSession.playerListFinalized) return sendToGmChannel(interaction, 'エラー: プレイヤーリストが確定されていません。');
      if (gameSession.players.length !== gameSession.config.numPlayers) return sendToGmChannel(interaction, `エラー: プレイヤー数が${gameSession.config.numPlayers}人ではありません。現在 ${gameSession.players.length}人です。`);
      if (gameSession.rolesAssigned) return sendToGmChannel(interaction, 'エラー: 配役は完了済みです。再配役は `/game_restart` 後に行ってください。');

      const roles = [];
      for (const role in gameSession.config.roles) { for (let i = 0; i < gameSession.config.roles[role]; i++) roles.push(role); }
      const shuffledPlayers = [...gameSession.players].sort(() => 0.5 - Math.random());
      shuffledPlayers.forEach((player, index) => { player.role = roles[index]; player.isAlive = true; });
      gameSession.players = shuffledPlayers;

      const seer = gameSession.players.find(p => p.role === 'SEER');
      let firstFortuneTarget = null;
      if (seer && gameSession.config.firstDayFortuneTelling) {
        const eligible = gameSession.players.filter(p => p.id !== seer.id && p.role !== 'WEREWOLF');
        if (eligible.length > 0) {
          firstFortuneTarget = eligible[Math.floor(Math.random() * eligible.length)];
          gameSession.seerHistory.push({ day: 0, seerId: seer.id, targetId: firstFortuneTarget.id, targetName: firstFortuneTarget.displayName, result: 'HUMAN' });
        }
      }

      const category = await guild.channels.fetch(gameSession.categoryId);
      const roleChannelNames = { WEREWOLF: '人狼', MADMAN: '狂人', SEER: '占い師', MEDIUM: '霊媒師', HUNTER: '狩人' }; // チャンネル名は短縮
      for (const roleName in roleChannelNames) {
        const playersWithRole = gameSession.players.filter(p => p.role === roleName);
        if (playersWithRole.length > 0) {
          const channelName = `${roleChannelNames[roleName]}チャンネル`;
          const perms = [
            { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
            { id: gameSession.gmUserId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
            { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ManageChannels] }
          ];
          playersWithRole.forEach(p => perms.push({ id: p.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }));
          const roleCh = await guild.channels.create({ name: channelName, type: ChannelType.GuildText, parent: category.id, permissionOverwrites: perms });
          gameSession.channels[roleName.toLowerCase()] = roleCh.id;
          playersWithRole.forEach(p => p.roleChannelId = roleCh.id);
          let msg = playersWithRole.map(p => `<@${p.id}>`).join(' ') + `\n`;
          if (roleName === 'WEREWOLF') msg += `あなたたちは【人狼】です。仲間の人狼はここにいるメンバーです。`;
          else if (roleName === 'MADMAN') msg += `あなたは【狂人】です。人狼陣営の勝利のために行動してください。`;
          else if (roleName === 'SEER') { msg += `あなたの役職は【占い師】です。`; if (firstFortuneTarget) msg += `\nあなたは初日占いの結果、 **${firstFortuneTarget.displayName}** さんが【人間】であることを知っています。`; }
          else if (roleName === 'MEDIUM') msg += `あなたの役職は【霊媒師】です。`;
          else if (roleName === 'HUNTER') msg += `あなたの役職は【狩人】です。`;
          await roleCh.send(msg);
        }
      }
      gameSession.rolesAssigned = true;
      gameSession.dayCount = 0; // 配役完了時点では0日目
      await sendToGmChannel(interaction, `配役完了。各役職チャンネルへ通知しました（村人除く）。\n占い師へは初日占い結果も通知済。\n確認後、 \`/game_start_first_night\` を実行しゲームを開始してください。`);
      await interaction.reply({ content: "配役を完了し、通知しました。", ephemeral: true });

    } else if (commandName === 'game_start_first_night') {
      if (!gameSession.rolesAssigned) return sendToGmChannel(interaction, 'エラー: 配役が完了していません。');
      if (gameSession.dayCount !== 0) return sendToGmChannel(interaction, 'エラー: ゲームは既に開始されているか、初夜処理済みです。'); // dayCountで開始済みかを判断

      gameSession.dayCount = 1; // これで初夜(1日目の夜)開始を示す
      await sendToGmChannel(interaction, `ゲームを開始し、${gameSession.dayCount}日目の夜（初夜）の扱いとしました。\nア式ルールでは初夜の襲撃はありません。\nGMは適宜議論を促し、最初の処刑者を決定したら \`/vote_result\` で記録してください。\n夜の行動は \`/night_wolf\` \`/night_guard\` \`/night_seer\` でGMが入力します。\n(初夜の襲撃指定は \`processNightAttack\` 内で抑止されます)`);
      await interaction.reply({ content: "ゲーム開始処理を行いました（初夜扱い）。", ephemeral: true });

    } else if (commandName === 'vote_result') {
      if (!gameSession.rolesAssigned) return sendToGmChannel(interaction, 'エラー: 配役が完了していません。');
      if (gameSession.dayCount === 0) return sendToGmChannel(interaction, 'エラー: ゲームがまだ開始されていません (`/game_start_first_night` を実行してください)。');

      const executedUserOpt = options.getUser('user');
      const executedPlayer = gameSession.players.find(p => p.id === executedUserOpt.id);
      if (!executedPlayer) return sendToGmChannel(interaction, 'エラー: 指定ユーザーはプレイヤーリストにいません。');
      if (!executedPlayer.isAlive) return sendToGmChannel(interaction, `エラー: ${executedPlayer.displayName} さんは既に死亡しています。`);

      executedPlayer.isAlive = false;
      gameSession.lastExecutedUser = { userId: executedPlayer.id, id: executedPlayer.id, role: executedPlayer.role, displayName: executedPlayer.displayName };
      await sendToGmChannel(interaction, `<@${executedPlayer.id}> (${executedPlayer.displayName}) さんが処刑されました。`);

      if (await checkWinCondition(interaction)) { /* 終了処理はcheckWinCondition内 */ }
      else { await sendToGmChannel(interaction, "ゲームは継続します。夜の処理を行うには `/night_phase` を実行してください。"); }
      await interaction.reply({ content: "処刑結果を記録しました。", ephemeral: true });

    } else if (commandName === 'night_phase') {
      if (!gameSession.rolesAssigned) return sendToGmChannel(interaction, 'エラー: 配役が完了していません。');
      if (gameSession.dayCount === 0 && !gameSession.lastExecutedUser) return sendToGmChannel(interaction, 'エラー: ゲームが開始されていないか、最初の処刑が記録されていません。'); // 初夜明けの想定

      let mediumMessage = "霊媒師はいないか、既に死亡しています。";
      const medium = gameSession.players.find(p => p.role === 'MEDIUM' && p.isAlive);
      if (medium && medium.roleChannelId) {
        const mediumCh = await guild.channels.fetch(medium.roleChannelId);
        if (gameSession.lastExecutedUser) {
          mediumMessage = `<@${medium.id}> さん、昨夜処刑された ${gameSession.lastExecutedUser.displayName} さんの役職は【${gameSession.lastExecutedUser.role}】でした。`;
        } else {
          mediumMessage = `<@${medium.id}> さん、昨夜は処刑者はいませんでした。`;
        }
        if (mediumCh) await mediumCh.send(mediumMessage); else mediumMessage = "霊媒師チャンネルが見つかりません。";
      }
      await sendToGmChannel(interaction, `夜の処理を開始します。\n霊媒結果: ${gameSession.lastExecutedUser ? gameSession.lastExecutedUser.displayName + "さんは【" + gameSession.lastExecutedUser.role + "】でした。" : "昨夜の処刑者なし。"}\n(霊媒師への個別通知: ${mediumMessage})\n各役職の夜の行動指示を \`/night_seer\`, \`/night_wolf\`, \`/night_guard\` で入力してください。\n全ての行動入力が終わったら、GMが \`襲撃結果処理コマンド(仮)\` を実行するか、または \`/night_wolf\` か \`/night_guard\` の最後の入力で自動的に襲撃結果が処理されます。`);
      // `processNightAttack` はwolf/guardコマンドから呼ばれるので、このコマンド自体では呼び出さない。
      await interaction.reply({ content: "夜の処理(霊媒結果通知など)を開始しました。", ephemeral: true });

    } else if (commandName === 'night_seer' || commandName === 'night_wolf' || commandName === 'night_guard') {
      if (!gameSession.rolesAssigned) return sendToGmChannel(interaction, `エラー: \`/${commandName}\` - 配役が完了していません。`);
      if (gameSession.dayCount === 0) return sendToGmChannel(interaction, `エラー: \`/${commandName}\` - ゲームが開始されていません。`); // 夜行動は最低1日目以降

      const targetUser = options.getUser('user');
      const targetPlayer = gameSession.players.find(p => p.id === targetUser.id);
      if (!targetPlayer || !targetPlayer.isAlive) return sendToGmChannel(interaction, `エラー: \`/${commandName}\` - 対象プレイヤーが見つからないか死亡しています。`);

      if (commandName === 'night_seer') {
        const seer = gameSession.players.find(p => p.role === 'SEER' && p.isAlive);
        if (!seer) return sendToGmChannel(interaction, 'エラー: 占い師がいないか死亡しています。');
        if (targetPlayer.id === seer.id) return sendToGmChannel(interaction, 'エラー: 自分自身を占えません。');
        const result = (targetPlayer.role === 'WEREWOLF') ? '人狼' : '人間';
        gameSession.seerHistory.push({ day: gameSession.dayCount, seerId: seer.id, targetId: targetPlayer.id, targetName: targetPlayer.displayName, result: result });
        const seerCh = seer.roleChannelId ? await guild.channels.fetch(seer.roleChannelId) : null;
        if (seerCh) await seerCh.send(`<@${seer.id}> さん、<@${targetPlayer.id}> (${targetPlayer.displayName}) さんを占った結果、【${result}】でした。`);
        await sendToGmChannel(interaction, `占い結果を占い師チャンネルに通知しました。`);
        await interaction.reply({ content: "占い結果を記録・通知しました。", ephemeral: true });
      } else if (commandName === 'night_wolf') {
        if (!gameSession.players.some(p => p.role === 'WEREWOLF' && p.isAlive)) return sendToGmChannel(interaction, 'エラー: 生存人狼がいません。');
        if (gameSession.wolfAttackTarget) return sendToGmChannel(interaction, 'エラー: 今夜の襲撃対象は既に指定済みです。');
        if (!gameSession.config.canAttackWerewolfTeam && (targetPlayer.role === 'WEREWOLF' || targetPlayer.role === 'MADMAN')) return sendToGmChannel(interaction, 'エラー: 人狼または狂人を襲撃できません。');

        gameSession.wolfAttackTarget = { id: targetPlayer.id, displayName: targetPlayer.displayName };
        const wolfCh = gameSession.channels.werewolf ? await guild.channels.fetch(gameSession.channels.werewolf) : null;
        if (wolfCh) await wolfCh.send(`襲撃対象を <@${targetPlayer.id}> (${targetPlayer.displayName}) さんとしました。`);
        await sendToGmChannel(interaction, `人狼の襲撃対象を記録しました。`);
        await interaction.reply({ content: "人狼の襲撃対象を記録しました。", ephemeral: true });
        // 狩人がいないか、狩人の行動が既に入力済みなら襲撃結果処理
        const hunterExistsAndAlive = gameSession.players.some(p => p.role === 'HUNTER' && p.isAlive);
        if (!hunterExistsAndAlive || gameSession.guardTarget) {
          await processNightAttack(interaction);
        } else {
          await sendToGmChannel(interaction, "続けて狩人の行動 (`/night_guard`) を入力してください。");
        }
      } else { // night_guard
        const hunter = gameSession.players.find(p => p.role === 'HUNTER' && p.isAlive);
        if (!hunter) return sendToGmChannel(interaction, 'エラー: 狩人がいないか死亡しています。');
        if (gameSession.guardTarget) return sendToGmChannel(interaction, 'エラー: 今夜の護衛対象は既に指定済みです。');
        if (!gameSession.config.canHunterGuardSelf && targetPlayer.id === hunter.id) return sendToGmChannel(interaction, 'エラー: 自分自身を護衛できません。');

        gameSession.guardTarget = { id: targetPlayer.id, displayName: targetPlayer.displayName };
        const hunterCh = hunter.roleChannelId ? await guild.channels.fetch(hunter.roleChannelId) : null;
        if (hunterCh) await hunterCh.send(`護衛対象を <@${targetPlayer.id}> (${targetPlayer.displayName}) さんとしました。`);
        await sendToGmChannel(interaction, `狩人の護衛対象を記録しました。`);
        await interaction.reply({ content: "狩人の護衛対象を記録しました。", ephemeral: true });
        if (gameSession.wolfAttackTarget) { // 人狼の行動が既に入力済みなら襲撃結果処理
          await processNightAttack(interaction);
        } else {
          await sendToGmChannel(interaction, "続けて人狼の行動 (`/night_wolf`) を入力してください。");
        }
      }
    } else if (commandName === 'game_restart') {
      if (!gameSession || !gameSession.players || gameSession.players.length === 0) {
        return interaction.reply({ content: 'エラー: 有効なプレイヤーリストを持つゲームセッションが見つかりません。', ephemeral: true });
      }
      const oldGmChannelId = gameSession.channels.gm;
      const oldCategoryName = gameSession.gameTitle;
      const newGameTitleInput = options.getString('new_game_title');
      const newGameTitle = newGameTitleInput || `${oldCategoryName}-2戦目`;
      const preservedPlayers = gameSession.players.map(p => ({ id: p.id, displayName: p.displayName, userObject: p.userObject, role: null, isAlive: true, roleChannelId: null }));
      const oldGmId = gameSession.gmUserId;
      const oldGuildId = gameSession.guildId;

      initializeGameSession(); // リセット
      gameSession.players = preservedPlayers;
      gameSession.playerListFinalized = true;
      gameSession.gmUserId = oldGmId;
      gameSession.guildId = oldGuildId;
      gameSession.isActive = true;
      gameSession.gameTitle = newGameTitle;

      const category = await guild.channels.create({ name: newGameTitle, type: ChannelType.GuildCategory, permissionOverwrites: [{ id: guild.roles.everyone, deny: [PermissionsBitField.Flags.ViewChannel] }, { id: gameSession.gmUserId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ManageChannels] }, { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ManageChannels, PermissionsBitField.Flags.SendMessages] }] });
      gameSession.categoryId = category.id;
      const gmCh = await guild.channels.create({ name: 'gmチャンネル', type: ChannelType.GuildText, parent: category.id }); gameSession.channels.gm = gmCh.id;
      const annCh = await guild.channels.create({ name: '全体アナウンス', type: ChannelType.GuildText, parent: category.id }); gameSession.channels.announcement = annCh.id;
      const voteCh = await guild.channels.create({ name: '投票チャンネル', type: ChannelType.GuildText, parent: category.id }); gameSession.channels.vote = voteCh.id;
      await annCh.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: false, ViewChannel: true }); await annCh.permissionOverwrites.edit(gameSession.gmUserId, { SendMessages: true });
      await gmCh.permissionOverwrites.edit(guild.roles.everyone, { ViewChannel: false }); await gmCh.permissionOverwrites.edit(gameSession.gmUserId, { ViewChannel: true, SendMessages: true });
      await voteCh.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: false, ViewChannel: true }); await voteCh.permissionOverwrites.edit(gameSession.gmUserId, { SendMessages: true });

      const oldGmCh = oldGmChannelId ? await guild.channels.fetch(oldGmChannelId).catch(() => null) : null;
      if (oldGmCh && oldGmCh.isTextBased()) await oldGmCh.send(`ゲームセッションをリセットし、2戦目の準備が完了しました。新しいカテゴリ「${newGameTitle}」内にチャンネルを作成。詳細は新しいGMチャンネル ${gmCh} を確認してください。`);
      else await interaction.channel.send(`ゲームセッションをリセットし、2戦目の準備が完了。カテゴリ「${newGameTitle}」作成。詳細は新しいGMチャンネル ${gmCh} を確認。`);

      await gmCh.send(`2戦目のセットアップ完了。カテゴリ「${newGameTitle}」作成。\n GMチャンネル: ${gmCh}\n アナウンスチャンネル: ${annCh}\n 投票チャンネル: ${voteCh}\nプレイヤーリストは引継済。\`/role_assign\` で配役してください。`);
      await interaction.reply({ content: "2戦目のセットアップが完了しました。", ephemeral: true });

    } else if (commandName === 'debug_reset_session') {
      if (gameSession && gameSession.isActive && user.id !== gameSession.gmUserId && !gameSession.gameEnded) {
        return interaction.reply({ content: 'このデバッグコマンドは、進行中のゲームの場合ゲームマスターのみ実行できます。', ephemeral: true });
      }
      const oldCategory = gameSession && gameSession.categoryId ? await guild.channels.fetch(gameSession.categoryId).catch(() => null) : null;
      const oldCategoryName = oldCategory ? oldCategory.name : null;
      initializeGameSession();
      await interaction.reply({ content: '[デバッグ] ゲームセッションを完全にリセットしました。', ephemeral: true });
      console.log("ゲームセッションがデバッグコマンドによりリセットされました。");
      if (oldCategoryName) {
        await interaction.followUp({ content: `以前のカテゴリ「${oldCategoryName}」は残っています。必要に応じて手動で削除してください。`, ephemeral: true });
      }
    }

  } catch (error) {
    console.error(`コマンド ${commandName} の処理中にエラーが発生しました:`, error);
    try {
      const errorMsgToGm = `エラー: \`/${commandName}\` - 処理中に予期せぬエラー。\n\`\`\`${error.stack || error.message}\`\`\``;
      if (gameSession && gameSession.channels && gameSession.channels.gm) {
        const gmCh = await guild.channels.fetch(gameSession.channels.gm).catch(() => null);
        if (gmCh) await gmCh.send(errorMsgToGm);
      }
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: 'コマンド処理中にエラーが発生しました。GMチャンネルを確認してください。', ephemeral: true });
      } else {
        await interaction.followUp({ content: 'コマンド処理中にエラーが発生しました。GMチャンネルを確認してください。', ephemeral: true }).catch(() => { });
      }
    } catch (e) {
      console.error("エラー通知の送信にも失敗:", e);
    }
  }
});

if (DISCORD_TOKEN) {
  client.login(DISCORD_TOKEN);
} else {
  console.error("DISCORD_TOKENが.envファイルに設定されていません。");
}