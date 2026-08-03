/**
 * Firebase web config is a public client identifier. Access control belongs in
 * Realtime Database rules; this app stays under the existing public `settings`
 * subtree and uses its own namespace.
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

export const SQUASH_ROOT = 'settings/rpg-maker-squash';
