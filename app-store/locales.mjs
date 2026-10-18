// The words on the store images, one entry per language: the headline/subtitle lines of the six screenshots (same order as
// the screens in store-art.mjs), the tagline under the logo on the App Store Header / Play feature graphic, and the one-line
// subtitle of the Search Results image. `*word*` is drawn in red. Store codes: `apple` = App Store Connect localization,
// `play` = Play Console languages (the same images are uploaded to each). Listing text is in listings/<lang>.md.
// Japanese is drawn with the Mac's Hiragino font (Inter has no kana); add a language by adding an entry here and a
// listings/<lang>.md. English outputs stay in app-store/ itself; the others go to app-store/localized/<lang>/.
export const LOCALES = {
  en: {
    apple: ['en-US'], play: ['en-US'],
    tagline: ['Know the second', 'your rivals *fail*'],
    headerSub: 'Real-time alerts for the rivals you can’t stand',
    searchSub: 'Real-time alerts when the players and teams you can’t stand mess up',
    shots: [
      ['Know the second', 'your rivals *fail*', 'Real-time alerts when the players', 'and teams you can’t stand mess up'],
      ['Track anyone', 'you love to *hate*', 'Teams and athletes across the pros,', 'college football, F1 and UFC'],
      ['Watch their games', 'as they *happen*', 'Live scores and win chances for every', 'game your rivals play'],
      ['Mute the pings,', 'keep the *misery*', 'Silence push for anyone and', 'still see their alerts in your feed'],
      ['Your rules,', '*player* by player', 'Turn off one alert for one player', 'and keep it for everyone else'],
      ['Every *painful*', 'moment', 'Strikeouts, picks, blown leads,', 'DNFs and dozens more'],
    ],
  },
  es: {
    // Latin American Spanish: App Store has no es-US, so es-MX serves US Spanish devices too; Play has es-US and es-419.
    apple: ['es-MX'], play: ['es-US', 'es-419'],
    tagline: ['Al segundo en que', 'tus rivales *fallan*'],
    headerSub: 'Alertas en tiempo real de los rivales que no soportas',
    searchSub: 'Alertas al instante cuando los jugadores y equipos que no soportas fallan',
    shots: [
      ['Al segundo en que', 'tus rivales *fallan*', 'Alertas en tiempo real cuando los', 'rivales que odias cometen errores'],
      ['Sigue a quien', 'amas *odiar*', 'Equipos y atletas de las ligas pro,', 'fútbol americano universitario, F1 y UFC'],
      ['Mira sus partidos', 'mientras *suceden*', 'Marcadores en vivo y probabilidad de', 'ganar de cada partido de tus rivales'],
      ['Sin avisos,', 'toda la *miseria*', 'Silencia las notificaciones y aun así', 've sus alertas en tu feed'],
      ['Tus reglas,', 'jugador por *jugador*', 'Desactiva una alerta para un jugador', 'y consérvala para todos los demás'],
      ['Cada momento', '*doloroso*', 'Ponches, intercepciones, ventajas', 'perdidas, abandonos y muchos más'],
    ],
  },
  fr: {
    apple: ['fr-CA'], play: ['fr-CA'],
    tagline: ['À la seconde où', 'vos rivaux *échouent*'],
    headerSub: 'Alertes en temps réel sur les rivaux que vous ne supportez pas',
    searchSub: 'Alertes en temps réel quand les joueurs et équipes que vous détestez flanchent',
    shots: [
      ['À la seconde où', 'vos rivaux *échouent*', 'Alertes en temps réel quand les joueurs', 'et équipes que vous détestez flanchent'],
      ['Suivez ceux que', 'vous aimez *détester*', 'Équipes et athlètes des ligues pro,', 'du football universitaire, F1 et UFC'],
      ['Regardez leurs matchs', 'en *direct*', 'Pointages en direct et probabilités de', 'victoire pour chaque match de vos rivaux'],
      ['Moins de pings,', 'plus de *misère*', 'Coupez les notifications et gardez', 'quand même leurs alertes dans votre fil'],
      ['Vos règles,', 'joueur par *joueur*', 'Désactivez une alerte pour un joueur', 'et gardez-la pour tous les autres'],
      ['Chaque moment', '*douloureux*', 'Retraits sur trois prises, interceptions,', 'avances perdues, abandons et bien plus'],
    ],
  },
  pt: {
    apple: ['pt-BR'], play: ['pt-BR'],
    tagline: ['No segundo em que', 'seus rivais *falham*'],
    headerSub: 'Alertas em tempo real dos rivais que você não suporta',
    searchSub: 'Alertas em tempo real quando os jogadores e times que você não suporta erram',
    shots: [
      ['No segundo em que', 'seus rivais *falham*', 'Alertas em tempo real quando os jogadores', 'e times que você não suporta erram'],
      ['Acompanhe quem', 'você adora *odiar*', 'Times e atletas das ligas profissionais,', 'futebol americano universitário, F1 e UFC'],
      ['Veja os jogos', 'enquanto *acontecem*', 'Placares ao vivo e chances de vitória de', 'cada jogo dos seus rivais'],
      ['Sem notificações,', 'só a *miséria*', 'Silencie o push de qualquer um e ainda', 'veja os alertas no seu feed'],
      ['Suas regras,', 'jogador por *jogador*', 'Desative um alerta para um jogador', 'e mantenha para todos os outros'],
      ['Cada momento', '*doloroso*', 'Strikeouts, interceptações, vantagens', 'perdidas, abandonos e muito mais'],
    ],
  },
  de: {
    apple: ['de-DE'], play: ['de-DE'],
    tagline: ['Sofort erfahren:', 'Rivalen *scheitern*'],
    headerSub: 'Echtzeit-Alerts zu den Rivalen, die du nicht ausstehen kannst',
    searchSub: 'Echtzeit-Alerts, wenn Spieler und Teams, die du nicht ausstehen kannst, patzen',
    shots: [
      ['Sofort erfahren:', 'Rivalen *scheitern*', 'Echtzeit-Alerts, wenn Spieler und Teams,', 'die du nicht ausstehen kannst, patzen'],
      ['Folge allen,', 'die du *gern hasst*', 'Teams und Athleten der Profiligen,', 'College Football, F1 und UFC'],
      ['Verfolge ihre Spiele', 'in *Echtzeit*', 'Live-Ergebnisse und Siegchancen für jedes', 'Spiel deiner Rivalen'],
      ['Ohne Pings,', 'voller *Schadenfreude*', 'Schalte Push für jeden stumm und sieh', 'trotzdem alle Alerts in deinem Feed'],
      ['Deine Regeln,', 'Spieler für *Spieler*', 'Schalte einen Alert für einen Spieler ab', 'und behalte ihn für alle anderen'],
      ['Jeder *schmerzhafte*', 'Moment', 'Strikeouts, Interceptions, verspielte', 'Führungen, Ausfälle und vieles mehr'],
    ],
  },
  ja: {
    font: 'ja',
    apple: ['ja'], play: ['ja-JP'],
    tagline: ['ライバルの失敗を', '*瞬時*にキャッチ'],
    headerSub: '嫌いなライバルの失敗をリアルタイムで通知',
    searchSub: '嫌いな選手やチームがミスしたらすぐにリアルタイムで通知',
    shots: [
      ['ライバルの失敗を', '*瞬時*にキャッチ', '嫌いな選手やチームがミスしたら', 'すぐにリアルタイム通知'],
      ['嫌いな相手を', '*追跡*しよう', 'プロリーグ、大学フットボール、', 'F1、UFCの選手とチームに対応'],
      ['試合の展開を', '*リアルタイム*で', 'ライバルが出場する全試合の', 'ライブスコアと勝率'],
      ['通知はオフでも', '*悲劇*は見逃さない', '誰の通知もミュートしながら', 'アラートはフィードで確認'],
      ['ルールは', '*選手*ごとに自由に', 'ある選手だけアラートをオフにして', '他の選手では残せます'],
      ['すべての*惨めな*', '瞬間を逃さない', '三振、インターセプト、逆転負け、', 'リタイアなど数十種類'],
    ],
  },
};
