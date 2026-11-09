// ゲーム一覧。新しいゲームは下に import して配列へ追加するだけ。
//
// 各ゲームの形式:
//   { id, name, desc, create(ctx) -> { onMessage(data), destroy() } }
//   ctx = { root: 描画先要素, role: 0(作成側)|1(参加側), send(data): 相手へ送信 }
import othello from "./othello.js";
import connect4 from "./connect4.js";
import reaction from "./reaction.js";
import mushi from "./mushi.js";
import vs from "./vs.js";
import spire from "./spire.js";

export const games = [othello, connect4, reaction, mushi, vs, spire];
