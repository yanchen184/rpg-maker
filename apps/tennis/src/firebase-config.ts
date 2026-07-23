/**
 * Firebase web 設定(線上對戰用,借用尊上現成的 squash-72502 專案的 Realtime Database)。
 *
 * 說明:Firebase 的 web apiKey 不是機密 —— 它是前端專案識別碼,任何開啟網頁的人都看得到,
 * Google 官方明講可公開(https://firebase.google.com/docs/projects/api-keys)。真正的存取控制
 * 靠 Realtime Database 的 Security Rules,不是靠藏這串 key。因此硬寫在前端是正常用法。
 */
export const firebaseConfig = {
  apiKey: 'AIzaSyCigfC9SYs8RGwRmF4dAnNJ_qyCu_bFSig',
  authDomain: 'squash-72502.firebaseapp.com',
  databaseURL: 'https://squash-72502-default-rtdb.firebaseio.com',
  projectId: 'squash-72502',
  storageBucket: 'squash-72502.firebasestorage.app',
  messagingSenderId: '592036326649',
  appId: '1:592036326649:web:54d1a65a5d2da819504628',
};

/**
 * 本遊戲在 RTDB 用的根節點。
 * 掛在 squash-72502 專案現成的 `settings/` 底下(它的 security rules 對 settings 開放公開讀寫),
 * 用獨立子路徑 `rpg-maker-tennis` 與其他遊戲的資料隔開;每個房間再往下一層 `<room>/`。
 */
export const TENNIS_ROOT = 'settings/rpg-maker-tennis';
