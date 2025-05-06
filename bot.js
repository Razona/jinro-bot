require('dotenv').config();
const { Client, GatewayIntentBits, ChannelType } = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers, // メンバー情報を取得するためのIntent
    GatewayIntentBits.MessageContent,
  ],
});

//expressにてapiサーバーも立てる
const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const path = require('path');
app.use(express.static(path.join(__dirname, 'public'))); // publicフォルダ内の静的ファイルを提供

server.listen(80, () => {
  console.log('サーバーがポート80で起動しました。');
}
);

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html')); // index.htmlを返す
}
);


let guardTarget = null;
let attackTarget = null;
let uranaiTarget = null;
let foxKilled = false;

const categoryName = '3月13日-3陣営'; // 取得したいカテゴリ名
const targetChannelName = 'gm'; // 取得したいチャンネル名
const targetRoleName = 'GM'; // 取得したいロール名

let players = [];
let roles = [];

// 15人のプレイヤーを作成
// players = Array.from({ length: 15 }, (_, i) => `てすと${i + 1}`);
// roles = ["占い師", "人狼", "人狼", "狐", "人狼", "騎士", "霊媒師", "狂人", "共有者", "共有者", ...Array.from({ length: 5 }, () => "村人")];

console.log(players);
console.log(roles);

// players と roles の長さが一致しない場合に警告
if (players.length !== roles.length) {
  console.warn("警告: players と roles の長さが一致しません！");
}

function uranai(targetIndex) {
  uranaiTarget = targetIndex;
  // 存在しないプレイヤー名が指定された場合のエラーハンドリング
  if (targetIndex === -1) {
    return "指定されたプレイヤーは存在しません";
  }

  // 役職を取得
  const targetRole = roles[targetIndex];

  // 妖狐を占った場合の処理
  if (targetRole === "狐") {
    foxKilled = true;
    return "人間";
  }

  // 人狼かどうか判定
  return targetRole === "人狼" ? "人狼" : "人間";
}

client.once('ready', async () => {
  console.log('Bot is ready!');

  // Botが参加しているすべてのサーバー（Guild）を取得
  for (const [guildId, guild] of client.guilds.cache) {
    console.log(`Checking server: ${guild.name}`);

    try {
      // ギルドのメンバー情報を取得（ロール情報を含む）
      await guild.members.fetch();

      // 指定のロールを取得
      const targetRole = guild.roles.cache.find(role => role.name === targetRoleName);

      if (!targetRole) {
        console.log(`Role "${targetRoleName}" not found in ${guild.name}`);
        continue;
      }

      // 指定のロールを持つメンバーをフィルタリング
      const membersWithRole = guild.members.cache.filter(member => member.roles.cache.has(targetRole.id));

      if (membersWithRole.size > 0) {
        console.log(`Users with role "${targetRoleName}" in ${guild.name}:`);
        membersWithRole.forEach(member => {
          console.log(`- ${member.user.tag} (${member.id})`);
        });
      } else {
        console.log(`No users found with role "${targetRoleName}" in ${guild.name}`);
      }
    } catch (error) {
      console.error(`Failed to fetch members for ${guild.name}: ${error}`);
    }
  }
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const channel = message.channel;

  // addPlayer@コマンド
  if (message.content.startsWith('addPlayer@')) {
    const playerNames = message.content.split('@')[1].trim().split('\n');
    playerNames.forEach(playerName => {
      players.push(playerName.trim());
    });
    await channel.send(`プレイヤーが追加されました: ${playerNames.join(', ')}`);
    console.log(`プレイヤーが追加されました: ${playerNames.join(', ')}`);
  }

  // setRoles@コマンド
  if (message.content.startsWith('setRoles@')) {
    const roleNames = message.content.split('@')[1].trim().split('\n');
    roles = roleNames.map(roleName => roleName.trim());
    await channel.send(`役職が設定されました: ${roles.join(', ')}`);
    console.log(`役職が設定されました: ${roles.join(', ')}`);
  }

  // 占いコマンド (f@playerID)
  if (
    channel.type === ChannelType.GuildText &&
    channel.name === targetChannelName &&
    channel.parent && channel.parent.name === categoryName &&
    (message.content.startsWith('占い@') || message.content.startsWith('f@'))
  ) {
    const playerId = message.content.split('@')[1].trim();
    // playerIdから名前を引っ張る
    const playerName = players[playerId];
    const confirmationMessage = `占い対象は"${playerName}"でいいですか? y/n`;

    try {
      await channel.send(confirmationMessage);
      console.log(`Sent message: ${confirmationMessage}`);

      // メッセージコレクターを設定してユーザーの応答を待つ
      const filter = response => {
        return response.author.id === message.author.id && ['y', 'n'].includes(response.content.toLowerCase());
      };

      const collector = channel.createMessageCollector({ filter, time: 15000, max: 1 });

      collector.on('collect', async response => {
        if (response.content.toLowerCase() === 'y') {
          const resultMessage = `占い結果："${playerName}" は"${uranai(playerId)}"です`;
          await channel.send(resultMessage);
          console.log(`Sent message: ${resultMessage}`);

          // categoryNameで指定されたカテゴリ内の「占い師」という名前のチャンネルにも占い結果を表示
          const uranaiChannel = channel.guild.channels.cache.find(ch => ch.name === '占い師' && ch.parent && ch.parent.name === categoryName && ch.type === ChannelType.GuildText);
          if (uranaiChannel) {
            await uranaiChannel.send(resultMessage);
            console.log(`Sent message to 占い師 channel in ${categoryName} category: ${resultMessage}`);
          } else {
            console.log(`占い師チャンネルがカテゴリ「${categoryName}」内に見つかりませんでした。`);
          }
        } else {
          await channel.send('占いをキャンセルしました。');
          console.log('占いをキャンセルしました。');
        }
      });

      collector.on('end', collected => {
        if (collected.size === 0) {
          channel.send('時間切れです。占いをキャンセルしました。');
          console.log('時間切れです。占いをキャンセルしました。');
        }
      });

    } catch (error) {
      console.error(`Failed to send message: ${error}`);
    }
  }

  // 霊媒コマンド (s@playerID)
  if (
    channel.type === ChannelType.GuildText &&
    channel.name === targetChannelName &&
    channel.parent && channel.parent.name === categoryName &&
    (message.content.startsWith('霊媒@') || message.content.startsWith('s@'))
  ) {
    const playerId = message.content.split('@')[1].trim();
    // playerIdから名前を引っ張る
    const playerName = players[playerId];
    const confirmationMessage = `霊媒対象は"${playerName}"でいいですか? y/n`;

    try {
      await channel.send(confirmationMessage);
      console.log(`Sent message: ${confirmationMessage}`);

      // メッセージコレクターを設定してユーザーの応答を待つ
      const filter = response => {
        return response.author.id === message.author.id && ['y', 'n'].includes(response.content.toLowerCase());
      };

      const collector = channel.createMessageCollector({ filter, time: 15000, max: 1 });

      collector.on('collect', async response => {
        if (response.content.toLowerCase() === 'y') {
          const resultMessage = `霊媒結果："${playerName}" は"${uranai(playerId)}"です`;
          await channel.send(resultMessage);
          console.log(`Sent message: ${resultMessage}`);

          // "霊媒師"という名前のチャンネルにも霊媒結果を表示
          const reibaiChannel = channel.guild.channels.cache.find(ch => ch.name === '霊媒師' && ch.type === ChannelType.GuildText);
          if (reibaiChannel) {
            await reibaiChannel.send(resultMessage);
            console.log(`Sent message to 霊媒師 channel: ${resultMessage}`);
          } else {
            console.log('霊媒師チャンネルが見つかりませんでした。');
          }
        } else {
          await channel.send('霊媒をキャンセルしました。');
          console.log('霊媒をキャンセルしました。');
        }
      });

      collector.on('end', collected => {
        if (collected.size === 0) {
          channel.send('時間切れです。霊媒をキャンセルしました。');
          console.log('時間切れです。霊媒をキャンセルしました。');
        }
      });

    } catch (error) {
      console.error(`Failed to send message: ${error}`);
    }
  }

  // 護衛コマンド (g@playerID)
  if (message.content.startsWith('護衛@') || message.content.startsWith('g@')) {
    const playerId = message.content.split('@')[1].trim();
    const playerName = players[playerId];
    const confirmationMessage = `護衛対象は"${playerName}"でいいですか? y/n`;

    try {
      await channel.send(confirmationMessage);
      console.log(`Sent message: ${confirmationMessage}`);

      // メッセージコレクターを設定してユーザーの応答を待つ
      const filter = response => {
        return response.author.id === message.author.id && ['y', 'n'].includes(response.content.toLowerCase());
      };

      const collector = channel.createMessageCollector({ filter, time: 15000, max: 1 });

      collector.on('collect', async response => {
        if (response.content.toLowerCase() === 'y') {
          guardTarget = playerId;
          const resultMessage = `護衛対象は"${playerName}"です。`;
          await channel.send(resultMessage);
          console.log(`Sent message: ${resultMessage}`);
        } else {
          await channel.send('護衛をキャンセルしました。');
          console.log('護衛をキャンセルしました。');
        }
      });

      collector.on('end', collected => {
        if (collected.size === 0) {
          channel.send('時間切れです。護衛をキャンセルしました。');
          console.log('時間切れです。護衛をキャンセルしました。');
        }
      });

    } catch (error) {
      console.error(`Failed to send message: ${error}`);
    }
  }

  // 襲撃コマンド (w@playerID)
  if (message.content.startsWith('襲撃@') || message.content.startsWith('w@')) {
    const playerId = message.content.split('@')[1].trim();
    const playerName = players[playerId];
    const confirmationMessage = `襲撃対象は"${playerName}"でいいですか? y/n`;

    try {
      await channel.send(confirmationMessage);
      console.log(`Sent message: ${confirmationMessage}`);

      // メッセージコレクターを設定してユーザーの応答を待つ
      const filter = response => {
        return response.author.id === message.author.id && ['y', 'n'].includes(response.content.toLowerCase());
      };

      const collector = channel.createMessageCollector({ filter, time: 15000, max: 1 });

      collector.on('collect', async response => {
        if (response.content.toLowerCase() === 'y') {
          attackTarget = playerId;
          const resultMessage = `襲撃対象は"${playerName}"です。`;
          await channel.send(resultMessage);
          console.log(`Sent message: ${resultMessage}`);
        } else {
          await channel.send('襲撃をキャンセルしました。');
          console.log('襲撃をキャンセルしました。');
        }
      });

      collector.on('end', collected => {
        if (collected.size === 0) {
          channel.send('時間切れです。襲撃をキャンセルしました。');
          console.log('時間切れです。襲撃をキャンセルしました。');
        }
      });

    } catch (error) {
      console.error(`Failed to send message: ${error}`);
    }
  }

  // 結果コマンド (r@)
  if (message.content.startsWith('結果@') || message.content.startsWith('r@')) {
    const gmChannel = channel.guild.channels.cache.find(ch => ch.name === 'gm' && ch.type === ChannelType.GuildText);
    if (gmChannel) {
      let resultMessage = '';

      // 妖狐が占われた場合の処理
      if (foxKilled) {
        resultMessage += `占い結果："${players[uranaiTarget]}"が妖狐であり、死亡しました。\n`;
        players[uranaiTarget].alive = false;
        foxKilled = false; // リセット
      }

      if (!guardTarget || !attackTarget) {
        resultMessage += '護衛または襲撃のターゲットが設定されていません。';
      } else if (guardTarget === attackTarget) {
        resultMessage += `襲撃は失敗しました。護衛対象と襲撃対象が同じでした。`;
      } else {
        resultMessage += `襲撃成功："${players[attackTarget]}"が襲撃されました。`;
        // 襲撃されたプレイヤーを死亡状態にする
        players[attackTarget].alive = false;
      }

      await gmChannel.send(resultMessage);
      console.log(`Sent message to GM channel: ${resultMessage}`);

      // 護衛と襲撃のターゲットをリセット
      guardTarget = null;
      attackTarget = null;
      uranaiTarget = null;
    } else {
      console.log('GMチャンネルが見つかりませんでした。');
    }
  }
});



client.login(process.env.DISCORD_TOKEN);